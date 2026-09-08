import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, paymentOrdersTable } from "@workspace/db";
import { sendUtmifyOrder } from "../lib/utmify";
import { GATEWAYS, getAdminSettings, getGatewayCredentials } from "../lib/gateway-config";
import {
  buildGatewayPaymentRequest,
  buildMagicPayPaymentRequest,
  getGatewayCreateUrl,
  getGatewayHeaders,
  getGatewayQueryUrl,
  isDocumentedGatewayKey,
  parseGatewayCreateResponse,
  parseGatewayStatusResponse,
} from "../lib/gateway-adapters";
import { getPublicTrackingConfig } from "../lib/tracking-pixels";
import { resolveUtmifyOffer } from "../lib/utmify-offers";
import { sendConfiguredTrackingEvent } from "../lib/server-tracking";

const router: IRouter = Router();
const FREEPAY_URL = "https://api.freepaybrasil.com/v1/payment-transaction/create";
const FREEPAY_INFO_URL = "https://api.freepaybrasil.com/v1/payment-transaction/info";
const BLACKCAT_URL = "https://api.blackcatoficial.com/api/sales/create-sale";
const BLACKCAT_INFO_URL = "https://api.blackcatoficial.com/api/sales";
const PAYMENT_AMOUNT_CENTS = 2992;
const sentUtmifyNotifications = new Set<string>();

type PaymentContext = {
  name: string;
  email: string;
  cpf: string;
  phone: string;
  createdAt: string;
  offerSlug: string | null;
  utm: Record<string, string | null> | null;
};

type PaymentRequest = {
  name?: unknown;
  email?: unknown;
  cpf?: unknown;
  phone?: unknown;
  pixKey?: unknown;
  offerSlug?: unknown;
  trackingParameters?: unknown;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getPaymentData(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (Array.isArray(value.data)) {
    const first = value.data[0];
    return first && typeof first === "object" ? first as Record<string, unknown> : null;
  }
  return value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : value;
}

function getString(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return null;
}

function getIdentifier(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return null;
}

function paymentStatus(status: string) {
  if (status === "PAID" || status === "COMPLETED" || status === "APPROVED") return "paid";
  if (status === "FAILED" || status === "CANCELLED" || status === "EXPIRED" || status === "CHARGEBACK" || status === "REFUNDED") return status.toLowerCase();
  return "pending";
}

function normalizeTrackingParameters(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, string | null> = {};
  for (const key of ["src", "sck", "utm_source", "utm_campaign", "utm_medium", "utm_content", "utm_term"]) {
    const item = (value as Record<string, unknown>)[key];
    if (typeof item === "string" && item.trim()) result[key] = item.trim().slice(0, 200);
  }
  return Object.keys(result).length ? result : null;
}

async function findOrder(transactionId: string) {
  const [order] = await db.select().from(paymentOrdersTable)
    .where(eq(paymentOrdersTable.gatewayTransactionId, transactionId)).limit(1);
  return order;
}

async function contextFor(transactionId: string): Promise<PaymentContext | undefined> {
  const order = await findOrder(transactionId);
  if (!order) return undefined;
  return {
    name: order.customerName,
    email: order.customerEmail,
    cpf: order.customerDocument,
    phone: order.customerPhone,
    createdAt: order.createdAt.toISOString(),
    offerSlug: order.offerSlug,
    utm: order.utm,
  };
}

function fallbackWebhookUrl() {
  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return domain ? `https://${domain}/api/pagamento/webhook` : "";
}

function getWebhookUrl(gatewayKey: string) {
  const configuredUrl = gatewayKey === "blackcat"
    ? process.env.BLACKCAT_POSTBACK_URL
    : gatewayKey === "freepay"
      ? process.env.FREEPAY_POSTBACK_URL
      : gatewayKey === "flevopay"
        ? process.env.FLEVOPAY_POSTBACK_URL
        : gatewayKey === "pingupag"
          ? process.env.PINGUPAG_POSTBACK_URL
          : gatewayKey === "magicpay"
            ? process.env.MAGICPAY_POSTBACK_URL
          : undefined;
  return configuredUrl ?? fallbackWebhookUrl();
}

function getGatewayStatusPayload(payload: unknown) {
  const data = getPaymentData(payload);
  return {
    data,
    status: getString(data, ["status", "Status"])?.toUpperCase() ?? "PENDING",
  };
}

function blackcatUtmFields(trackingParameters: Record<string, string | null> | null) {
  return {
    utm_source: trackingParameters?.utm_source ?? undefined,
    utm_medium: trackingParameters?.utm_medium ?? undefined,
    utm_campaign: trackingParameters?.utm_campaign ?? undefined,
    utm_content: trackingParameters?.utm_content ?? undefined,
    utm_term: trackingParameters?.utm_term ?? undefined,
  };
}

router.get("/tracking-config", async (req, res) => {
  try {
    const requestedSlug = typeof req.query.offer === "string"
      ? req.query.offer
      : typeof req.query.oferta === "string"
        ? req.query.oferta
        : null;
    return res.json({ success: true, ...(await getPublicTrackingConfig(requestedSlug)) });
  } catch (error) {
    req.log.error({ err: error }, "Public tracking configuration failed");
    return res.status(500).json({ success: false, error: "Não foi possível carregar o rastreamento." });
  }
});

router.post("/pagamento", async (req, res) => {
  const body = req.body as PaymentRequest;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const cpf = typeof body.cpf === "string" ? body.cpf.replace(/\D/g, "") : "";
  const phone = typeof body.phone === "string" ? body.phone.replace(/\D/g, "") : "";

  if (!name || !isValidEmail(email) || cpf.length !== 11 || phone.length < 10) {
    return res.status(400).json({ success: false, status: "INVALID", error: "Dados do pagamento inválidos." });
  }
  const trackingParameters = normalizeTrackingParameters(body.trackingParameters);

  try {
    const settings = await getAdminSettings();
    const productName = settings?.productName || "Ebook Emagrecimento*";
    const gatewayKey = settings?.activeGatewayKey || "freepay";
    const gateway = GATEWAYS.find((item) => item.key === gatewayKey);
    if (!gateway || !gateway.supported) {
      const gatewayLabel = gateway?.label || gatewayKey;
      return res.status(503).json({ success: false, status: "UNAVAILABLE", error: `O gateway ${gatewayLabel} foi selecionado, mas ainda não possui integração de cobrança.` });
    }
    const postbackUrl = getWebhookUrl(gatewayKey);
    const gatewayReference = `withdrawal-confirmation-${cpf}-${Date.now()}`;
    if (!postbackUrl && gatewayKey === "freepay") {
      return res.status(503).json({ success: false, status: "UNAVAILABLE", error: "Webhook de pagamento não configurado." });
    }
    const { publicKey, secretKey } = await getGatewayCredentials(gatewayKey);
    if (!secretKey || ((gatewayKey === "freepay" || gatewayKey === "magicpay") && !publicKey)) {
      req.log.error({ gatewayKey }, "Payment gateway credentials are not configured");
      return res.status(503).json({ success: false, status: "UNAVAILABLE", error: "Gateway de pagamento indisponível." });
    }
    const documentedGatewayKey = isDocumentedGatewayKey(gatewayKey) ? gatewayKey : null;
    const gatewayRequest = gatewayKey === "magicpay"
      ? buildMagicPayPaymentRequest({
        amountCents: PAYMENT_AMOUNT_CENTS,
        description: productName,
        reference: gatewayReference,
        name,
        email,
        cpf,
        phone,
        postbackUrl,
      })
      : gatewayKey === "blackcat"
      ? {
        amount: PAYMENT_AMOUNT_CENTS,
        currency: "BRL",
        paymentMethod: "pix",
        externalRef: `withdrawal-confirmation-${cpf}`,
        items: [{
          title: productName,
          unitPrice: PAYMENT_AMOUNT_CENTS,
          quantity: 1,
          tangible: false,
        }],
        customer: {
          name,
          email,
          phone,
          document: { number: cpf, type: "cpf" },
        },
        pix: { expiresInDays: 1 },
        metadata: "Recupera Brasil - confirmação de saque",
        ...(postbackUrl ? { postbackUrl } : {}),
        ...blackcatUtmFields(trackingParameters),
      }
      : gatewayKey === "freepay"
        ? {
        amount: PAYMENT_AMOUNT_CENTS,
        payment_method: "pix",
        postback_url: postbackUrl,
        customer: {
          name,
          email,
          document: { number: cpf, type: "cpf" },
          phone: phone.startsWith("55") ? `+${phone}` : `+55${phone}`,
          external_ref: `withdrawal-confirmation-${cpf}`,
        },
        items: [{
          title: productName,
          unit_price: PAYMENT_AMOUNT_CENTS,
          quantity: 1,
          tangible: false,
          external_ref: `confirmacao-${cpf}`,
        }],
        pix: { expires_in_days: 1 },
        metadata: {
          provider_name: "Recupera Brasil",
          purpose: "withdrawal_confirmation",
          cpf,
        },
      }
        : documentedGatewayKey
          ? buildGatewayPaymentRequest({
            amountCents: PAYMENT_AMOUNT_CENTS,
            description: productName,
            reference: gatewayReference,
            name,
            email,
            cpf,
            phone,
            postbackUrl,
            tracking: trackingParameters,
          })
          : null;
    if (!gatewayRequest) {
      return res.status(503).json({ success: false, status: "UNAVAILABLE", error: `O gateway ${gateway.label} ainda não possui um adaptador de cobrança.` });
    }
    const createUrl = gatewayKey === "blackcat"
      ? BLACKCAT_URL
      : gatewayKey === "freepay"
        ? FREEPAY_URL
        : getGatewayCreateUrl(documentedGatewayKey!);
    const response = await fetch(createUrl, {
      method: "POST",
      headers: {
        ...(gatewayKey === "blackcat"
          ? { "x-api-key": secretKey }
          : gatewayKey === "freepay"
            ? { authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}` }
            : gatewayKey === "magicpay"
              ? { authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}` }
              : getGatewayHeaders(secretKey)),
        "content-type": "application/json",
      },
      body: JSON.stringify(gatewayRequest),
      // Some gateways confirm PIX creation asynchronously and can take more
      // than 20 seconds to return the copy-and-paste code under load.
      signal: AbortSignal.timeout(60000),
    });
    const responseText = await response.text();
    let payload: unknown = null;
    try {
      payload = responseText ? JSON.parse(responseText) : responseText;
    } catch {
      payload = responseText;
    }
    if (!response.ok) {
      const gatewayMessage = typeof payload === "string"
        ? payload.trim()
        : getString(payload, ["message", "error", "detail"]);
      req.log.warn({ gatewayKey, status: response.status, gatewayMessage }, "Payment gateway creation failed");
      const clientStatus = response.status === 400 ? 400 : 502;
      return res.status(clientStatus).json({ success: false, status: "ERROR", error: gatewayMessage || "Não foi possível gerar o pagamento." });
    }

    const data = getPaymentData(payload);
    const documentedResult = documentedGatewayKey ? parseGatewayCreateResponse(payload) : null;
    const pix = gatewayKey === "blackcat" ? data?.paymentData : data?.pix;
    const pixRecord = Array.isArray(pix) ? pix[0] : pix;
    const status = documentedResult?.status ?? getString(data, ["status"])?.toUpperCase() ?? "PENDING";
    const transactionId = documentedResult?.transactionId ?? getString(data, ["transactionId", "id", "Id"]);
    const createdAt = documentedResult?.createdAt ?? getString(data, ["createdAt"]) ?? new Date().toISOString();
    const parsedGatewayResult = parseGatewayCreateResponse(payload);
    const pixCode = documentedResult?.pixCode ?? parsedGatewayResult.pixCode ?? (gatewayKey === "blackcat"
      ? getString(pixRecord, ["copyPaste", "copy_paste", "qrCode", "qr_code"])
      : getString(pixRecord, ["e2_e", "qr_code"]));
    const qrCodeUrl = documentedResult?.qrCodeUrl ?? parsedGatewayResult.qrCodeUrl ?? (gatewayKey === "blackcat"
      ? getString(data, ["invoiceUrl"])
      : getString(pixRecord, ["url"]));
    const normalizedStatus = paymentStatus(status);
    if (!pixCode) {
      req.log.warn({ gatewayKey, transactionId }, "Payment gateway did not return a PIX copy-and-paste code");
      return res.status(502).json({ success: false, status: "ERROR", error: "A gateway não retornou o código PIX copia e cola." });
    }

    if (transactionId) {
      try {
        await db.insert(paymentOrdersTable).values({
          reference: transactionId,
          gatewayKey,
          gatewayLabel: gateway.label,
          gatewayTransactionId: transactionId,
          pixCode,
          qrCodeUrl,
          amountCents: PAYMENT_AMOUNT_CENTS,
          customerName: name,
          customerEmail: email,
          customerPhone: phone,
          customerDocument: cpf,
          pixKey: typeof body.pixKey === "string" ? body.pixKey.trim() : null,
          status: normalizedStatus,
          offerId: null,
          offerSlug: null,
          utm: trackingParameters,
        }).onConflictDoUpdate({
          target: paymentOrdersTable.gatewayTransactionId,
          set: {
            status: normalizedStatus,
            pixCode,
            qrCodeUrl,
            offerId: null,
            offerSlug: null,
            utm: trackingParameters,
          },
        });
      } catch (error) {
        req.log.error({ err: error, transactionId }, "Payment order persistence failed");
      }
      try {
        const utmifyResult = await sendUtmifyOrder({
          event: normalizedStatus === "paid" ? "transaction.paid" : "transaction.created",
          transactionId,
          status: normalizedStatus === "paid" ? "PAID" : "PENDING",
          amount: PAYMENT_AMOUNT_CENTS,
          createdAt,
          paidAt: normalizedStatus === "paid" ? createdAt : undefined,
          customer: { name, email, phone, document: cpf },
          utm: trackingParameters,
          gatewayKey,
          gatewayLabel: gateway.label,
        });
        if (utmifyResult.sent) {
          req.log.info({ transactionId, status: utmifyResult.status }, "UTMify payment creation notification sent");
          sentUtmifyNotifications.add(`${transactionId}:${utmifyResult.status}`);
        }
      } catch (error) {
        req.log.error({ err: error, transactionId }, "UTMify payment creation notification failed");
      }
      void sendConfiguredTrackingEvent({
        eventName: normalizedStatus === "paid" ? "Purchase" : "InitiateCheckout",
        eventId: `${transactionId}:${normalizedStatus === "paid" ? "purchase" : "checkout"}`,
        email,
        phone,
        cpf,
        amountCents: PAYMENT_AMOUNT_CENTS,
        sourceUrl: req.get("origin") || undefined,
      }).then((result) => {
        if (result.attempted) req.log.info({ transactionId, ...result }, "Server tracking event dispatched");
      }).catch((error) => req.log.warn({ err: error, transactionId }, "Server tracking event failed"));
    }

    return res.json({ success: true, status, transactionId, pixCode, qrCodeUrl });
  } catch (error) {
    req.log.warn({ err: error }, "Payment gateway request failed");
    return res.status(502).json({ success: false, status: "ERROR", error: "Não foi possível conectar ao gateway de pagamento." });
  }
});

router.get("/pagamento/:transactionId", async (req, res) => {
  const transactionId = typeof req.params.transactionId === "string" ? req.params.transactionId : "";
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(transactionId)) {
    return res.status(400).json({ success: false, status: "INVALID", paid: false, error: "Identificador de pagamento inválido." });
  }

  try {
    const order = await findOrder(transactionId);
    const settings = await getAdminSettings();
    const gatewayKey = order?.gatewayKey || settings?.activeGatewayKey || "freepay";
    const gateway = GATEWAYS.find((item) => item.key === gatewayKey);
    if (!gateway || !gateway.supported) {
      return res.status(503).json({ success: false, status: "UNAVAILABLE", paid: false, error: `O gateway ${gatewayKey} não possui integração de consulta.` });
    }
    const { publicKey, secretKey } = await getGatewayCredentials(gatewayKey);
    if (!secretKey || ((gatewayKey === "freepay" || gatewayKey === "magicpay") && !publicKey)) {
      return res.status(503).json({ success: false, status: "UNAVAILABLE", paid: false, error: "Gateway de pagamento indisponível." });
    }
    const documentedGatewayKey = isDocumentedGatewayKey(gatewayKey) ? gatewayKey : null;
    const statusUrl = gatewayKey === "blackcat"
      ? `${BLACKCAT_INFO_URL}/${encodeURIComponent(transactionId)}/status`
      : gatewayKey === "freepay"
        ? `${FREEPAY_INFO_URL}/${encodeURIComponent(transactionId)}`
        : getGatewayQueryUrl(documentedGatewayKey!, transactionId);
    const response = await fetch(statusUrl, {
        headers: gatewayKey === "blackcat"
          ? { "x-api-key": secretKey }
          : gatewayKey === "freepay"
            ? { authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}` }
            : gatewayKey === "magicpay"
              ? { authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}` }
              : getGatewayHeaders(secretKey),
        signal: AbortSignal.timeout(15000),
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      req.log.warn({ gatewayKey, status: response.status, transactionId }, "Payment gateway status lookup failed");
      return res.status(502).json({ success: false, status: "ERROR", paid: false, error: "Não foi possível consultar o pagamento." });
    }

    const status = documentedGatewayKey
      ? parseGatewayStatusResponse(payload)
      : getGatewayStatusPayload(payload).status;
    const normalizedStatus = paymentStatus(status);
    if (order && normalizedStatus !== order.status) {
      await db.update(paymentOrdersTable).set({
        status: normalizedStatus,
        approvedAt: normalizedStatus === "paid" ? new Date() : order.approvedAt,
      }).where(eq(paymentOrdersTable.id, order.id));
    }
    const context = await contextFor(transactionId);
    if (normalizedStatus === "paid" && context && !sentUtmifyNotifications.has(`${transactionId}:paid`)) {
      try {
        const offer = await resolveUtmifyOffer(context.offerSlug);
        const utmifyResult = await sendUtmifyOrder({
          event: "transaction.paid",
          transactionId,
          status: "PAID",
          amount: PAYMENT_AMOUNT_CENTS,
          createdAt: context.createdAt,
          paidAt: new Date().toISOString(),
          customer: { name: context.name, email: context.email, phone: context.phone, document: context.cpf },
          offer: { name: offer.name, slug: offer.slug },
          utm: context.utm,
          gatewayKey,
          gatewayLabel: gateway.label,
        }, offer.apiToken);
        if (utmifyResult.sent) {
          sentUtmifyNotifications.add(`${transactionId}:${utmifyResult.status}`);
          req.log.info({ transactionId, status: utmifyResult.status }, "UTMify payment confirmation notification sent");
        }
        void sendConfiguredTrackingEvent({
          eventName: "Purchase",
          eventId: `${transactionId}:purchase`,
          email: context.email,
          phone: context.phone,
          cpf: context.cpf,
          amountCents: PAYMENT_AMOUNT_CENTS,
        }).then((result) => {
          if (result.attempted) req.log.info({ transactionId, ...result }, "Server purchase tracking dispatched");
        }).catch((error) => req.log.warn({ err: error, transactionId }, "Server purchase tracking failed"));
      } catch (error) {
        req.log.error({ err: error, transactionId }, "UTMify payment confirmation notification failed");
      }
    }
    return res.json({ success: true, status, paid: normalizedStatus === "paid", error: null });
  } catch (error) {
    req.log.warn({ err: error, transactionId }, "Payment gateway status request failed");
    return res.status(502).json({ success: false, status: "ERROR", paid: false, error: "Não foi possível conectar ao gateway de pagamento." });
  }
});

router.post("/pagamento/webhook", async (req, res) => {
  const payload = req.body as Record<string, unknown>;
  const webhookData = getPaymentData(payload);
  const externalRef = getString(payload, ["externalRef", "external_ref", "externalReference", "external_id"])
    ?? getString(webhookData, ["externalRef", "external_ref", "externalReference", "external_id"]);
  if (externalRef?.startsWith("gateway-test-")) {
    req.log.info({ externalRef }, "Gateway test webhook ignored");
    return res.json({ success: true, ignored: "gateway_test" });
  }
  const transactionId = getIdentifier(payload, ["transactionId", "transaction_id", "id", "Id"])
    ?? getIdentifier(webhookData, ["transactionId", "transaction_id", "id", "Id"]);
  const event = getString(payload, ["event", "Event", "webhook_type"])
    ?? getString(webhookData, ["event", "Event", "webhook_type"])
    ?? req.get("X-Webhook-Event")
    ?? undefined;
  const status = getString(payload, ["status", "Status", "transaction_status"])?.toUpperCase()
    ?? getString(webhookData, ["status", "Status", "transaction_status"])?.toUpperCase()
    ?? (event === "transaction.paid" ? "PAID" : event === "transaction.failed" ? "CANCELLED" : event === "transaction.created" ? "PENDING" : undefined);
  const context = transactionId ? await contextFor(transactionId) : undefined;
  const order = transactionId ? await findOrder(transactionId) : undefined;
  const normalizedStatus = status ? paymentStatus(status) : null;
  if (order && normalizedStatus && normalizedStatus !== order.status) {
    await db.update(paymentOrdersTable).set({
      status: normalizedStatus,
      approvedAt: normalizedStatus === "paid" ? new Date() : order.approvedAt,
    }).where(eq(paymentOrdersTable.id, order.id));
  }
  const normalizedPayload = {
    ...payload,
    transactionId,
    status,
    gatewayKey: order?.gatewayKey,
    gatewayLabel: order?.gatewayLabel,
    event: event
      ?? (normalizedStatus === "paid" ? "transaction.paid" : normalizedStatus === "pending" ? "transaction.created" : undefined),
    createdAt: getString(payload, ["createdAt", "CreatedAt", "timestamp", "Timestamp"])
      ?? context?.createdAt
      ?? new Date().toISOString(),
    amount: payload.amount ?? payload.Amount ?? PAYMENT_AMOUNT_CENTS,
    fees: payload.fees ?? payload.Fees ?? 0,
    customer: payload.customer ?? (context ? {
      name: context.name,
      email: context.email,
      phone: context.phone,
      document: context.cpf,
    } : undefined),
    offer: context?.offerSlug ? { slug: context.offerSlug } : undefined,
    utm: context?.utm,
  };
  req.log.info({ transactionId, status, event: normalizedPayload.event, source: req.get("X-Webhook-Source") }, "Payment gateway webhook received");
  const expectedUtmifyStatus = normalizedStatus === "paid" ? "paid" : normalizedStatus === "pending" ? "waiting_payment" : null;
  if (transactionId && expectedUtmifyStatus && sentUtmifyNotifications.has(`${transactionId}:${expectedUtmifyStatus}`)) {
    return res.json({ success: true, utmify: { sent: false, reason: "already_sent" } });
  }
  try {
    const result = await sendUtmifyOrder({
      ...normalizedPayload,
      status: normalizedStatus === "paid" ? "PAID" : normalizedStatus === "pending" ? "PENDING" : status,
    });
    if (transactionId && result.sent) sentUtmifyNotifications.add(`${transactionId}:${result.status}`);
    if (transactionId && context) {
      void sendConfiguredTrackingEvent({
        eventName: normalizedStatus === "paid" ? "Purchase" : "InitiateCheckout",
        eventId: `${transactionId}:${normalizedStatus === "paid" ? "purchase" : "checkout"}`,
        email: context.email,
        phone: context.phone,
        cpf: context.cpf,
        amountCents: PAYMENT_AMOUNT_CENTS,
      }).catch((error) => req.log.warn({ err: error, transactionId }, "Server webhook tracking failed"));
    }
    return res.json({ success: true, utmify: result });
  } catch (error) {
    req.log.error({ err: error }, "UTMify order notification failed");
    return res.status(502).json({ success: false, error: "Não foi possível encaminhar a atualização do pagamento." });
  }
});

router.post("/pagamento/:transactionId/copied", async (req, res) => {
  const transactionId = typeof req.params.transactionId === "string" ? req.params.transactionId : "";
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(transactionId)) {
    return res.status(400).json({ success: false, error: "Identificador de pagamento inválido." });
  }
  const order = await findOrder(transactionId);
  if (!order) return res.status(404).json({ success: false, error: "Pedido não encontrado." });
  await db.update(paymentOrdersTable).set({ pixCopied: true, pixCopiedAt: new Date() })
    .where(eq(paymentOrdersTable.id, order.id));
  return res.json({ success: true });
});

export default router;