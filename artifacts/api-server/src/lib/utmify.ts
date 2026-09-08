import { resolveUtmifyOffer } from "./utmify-offers";
import { getConfiguredUtmifyTokens } from "./tracking-pixels";

const UTMIFY_ORDERS_URL = "https://api.utmify.com.br/api-credentials/orders";
const PAYMENT_AMOUNT_CENTS = 2992;

type JsonRecord = Record<string, unknown>;
type UtmifyStatus = "waiting_payment" | "paid";

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function getString(value: unknown, keys: string[]) {
  const record = asRecord(value);
  if (!record) return null;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return null;
}

function getNumber(value: unknown, keys: string[], fallback: number) {
  const record = asRecord(value);
  if (!record) return fallback;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return fallback;
}

function toUtcDateTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function getUtmifyStatus(payload: JsonRecord): UtmifyStatus | null {
  const event = getString(payload, ["event"])?.toLowerCase();
  const status = getString(payload, ["status"])?.toUpperCase();
  if (event === "transaction.paid" || status === "PAID" || status === "APPROVED") return "paid";
  if (event === "transaction.created" || status === "PENDING" || status === "SUCCESS") return "waiting_payment";
  return null;
}

function getTrackingParameters(payload: JsonRecord) {
  const utm = asRecord(payload.utm) ?? asRecord(payload.trackingParameters);
  return {
    src: getString(utm, ["src"]),
    sck: getString(utm, ["sck"]),
    utm_source: getString(utm, ["utm_source"]),
    utm_campaign: getString(utm, ["utm_campaign"]),
    utm_medium: getString(utm, ["utm_medium"]),
    utm_content: getString(utm, ["utm_content"]),
    utm_term: getString(utm, ["utm_term"]),
  };
}

export function buildUtmifyOrder(payload: JsonRecord) {
  const status = getUtmifyStatus(payload);
  if (!status) return null;

   const transactionId = getString(payload, ["transactionId", "transaction_id", "id"]);
  const createdAt = toUtcDateTime(payload.createdAt ?? payload.timestamp);
  const customer = asRecord(payload.customer);
  if (!transactionId || !createdAt) {
    throw new Error("Webhook Blackcat sem transactionId ou data de criação válida.");
  }

  const amount = getNumber(payload, ["amount"], PAYMENT_AMOUNT_CENTS);
  const fees = getNumber(payload, ["fees"], 0);
  const offer = asRecord(payload.offer);
  const approvedDate = status === "paid"
    ? toUtcDateTime(payload.paidAt ?? payload.timestamp)
    : null;

  return {
    orderId: transactionId,
     platform: getString(payload, ["gatewayLabel", "platform"]) ?? "PIX",
    paymentMethod: "pix",
    status,
    createdAt,
    approvedDate,
    refundedAt: null,
    customer: {
      name: getString(customer, ["name"]) ?? "Cliente PIX",
      email: getString(customer, ["email"]) ?? "",
      phone: getString(customer, ["phone"]),
      document: getString(customer, ["document"]),
      country: "BR",
    },
    products: [{
      id: getString(offer, ["slug"]) ?? "recupera-brasil-confirmacao",
      name: getString(offer, ["name"]) ?? "Taxa de confirmação",
      planId: null,
      planName: null,
      quantity: 1,
      priceInCents: amount,
    }],
    trackingParameters: getTrackingParameters(payload),
    commission: {
      totalPriceInCents: amount,
      gatewayFeeInCents: Math.max(0, fees),
      userCommissionInCents: Math.max(0, amount - fees),
      currency: "BRL",
    },
    isTest: payload.isTest === true,
  };
}

export async function sendUtmifyOrder(payload: JsonRecord, tokenOverride?: string) {
  const order = buildUtmifyOrder(payload);
  if (!order) return { sent: false, reason: "ignored_event" as const };

  const offer = asRecord(payload.offer);
  const offerSlug = getString(offer, ["slug"]);
  const legacyOffer = offerSlug ? await resolveUtmifyOffer(offerSlug) : null;
  const tokens = await getConfiguredUtmifyTokens(tokenOverride?.trim() || legacyOffer?.apiToken);
  if (!tokens.length) throw new Error("UTMify API token is not configured.");

  const deliveries = await Promise.allSettled(tokens.map(async (apiToken) => {
    const response = await fetch(UTMIFY_ORDERS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-token": apiToken,
      },
      body: JSON.stringify(order),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`UTMify rejected order with HTTP ${response.status}.`);
  }));
  const sentCount = deliveries.filter((delivery) => delivery.status === "fulfilled").length;
  if (!sentCount) throw new Error("UTMify rejected the order for every configured token.");
  return { sent: true as const, orderId: order.orderId, status: order.status, deliveries: sentCount };
}