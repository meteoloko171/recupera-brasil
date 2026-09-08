import { GATEWAYS, getGatewayCredentials } from "./gateway-config";
import {
  buildGatewayPaymentRequest,
  buildMagicPayPaymentRequest,
  getGatewayCreateUrl,
  getGatewayHeaders,
  isDocumentedGatewayKey,
  parseGatewayCreateResponse,
} from "./gateway-adapters";

const FREEPAY_URL = "https://api.freepaybrasil.com/v1/payment-transaction/create";
const BLACKCAT_URL = "https://api.blackcatoficial.com/api/sales/create-sale";
const TEST_AMOUNT_CENTS = 100;
const TEST_CPF = "52998224725";
const TEST_PHONE = "11999999999";
const TEST_EMAIL = "teste@recuperabrasil.local";

type JsonRecord = Record<string, unknown>;

export type GatewayTestResult = {
  success: boolean;
  gatewayKey: string;
  gatewayLabel: string;
  status?: string;
  transactionId?: string;
  pixCode?: string;
  message: string;
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function getPaymentData(payload: unknown): JsonRecord | null {
  const record = asRecord(payload);
  if (!record) return null;
  if (Array.isArray(record.data)) return asRecord(record.data[0]);
  return asRecord(record.data) ?? record;
}

function getString(value: unknown, keys: string[]) {
  const record = asRecord(value);
  if (!record) return null;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return null;
}

function fallbackWebhookUrl() {
  return process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}/api/pagamento/webhook`
    : "";
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

function safeGatewayMessage(payload: unknown, secretKey: string) {
  const record = asRecord(payload);
  const message = typeof payload === "string"
    ? payload
    : getString(record, ["message", "error", "detail"]);
  return message
    ?.replaceAll(secretKey, "[chave protegida]")
    .trim()
    .slice(0, 240);
}

function failureMessage(status: number, payload: unknown, secretKey: string) {
  if (status === 401) return "A chave da gateway é inválida ou não tem permissão.";
  if (status === 403) return "A conta da gateway não tem permissão para criar cobranças.";
  if (status === 429) return "A gateway recusou o teste por limite de requisições. Tente novamente em alguns instantes.";
  if (status >= 500) return "A gateway está indisponível no momento.";
  const detail = safeGatewayMessage(payload, secretKey);
  return detail
    ? `A gateway rejeitou os dados do teste: ${detail}`
    : `A gateway rejeitou os dados do teste (HTTP ${status}).`;
}

function testReference(gatewayKey: string) {
  return `gateway-test-${gatewayKey}-${Date.now()}`;
}

export async function testGatewayConnection(input: {
  gatewayKey: string;
  secretKey?: string;
  publicKey?: string;
}): Promise<GatewayTestResult> {
  const gateway = GATEWAYS.find((item) => item.key === input.gatewayKey);
  if (!gateway || !gateway.supported) {
    return {
      success: false,
      gatewayKey: input.gatewayKey,
      gatewayLabel: gateway?.label || input.gatewayKey,
      message: "Esta gateway ainda não possui integração de cobrança disponível.",
    };
  }

  const storedCredentials = await getGatewayCredentials(input.gatewayKey);
  const secretKey = input.secretKey?.trim() || storedCredentials.secretKey;
  const publicKey = input.publicKey?.trim() || storedCredentials.publicKey;
  if (!secretKey || ((input.gatewayKey === "freepay" || input.gatewayKey === "magicpay") && !publicKey)) {
    return {
      success: false,
      gatewayKey: input.gatewayKey,
      gatewayLabel: gateway.label,
      message: `Configure as credenciais da ${gateway.label} antes de testar.`,
    };
  }

  const reference = testReference(input.gatewayKey);
  const postbackUrl = getWebhookUrl(input.gatewayKey);
  const documentedGatewayKey = isDocumentedGatewayKey(input.gatewayKey) ? input.gatewayKey : null;
  const body = input.gatewayKey === "magicpay"
    ? buildMagicPayPaymentRequest({
      amountCents: TEST_AMOUNT_CENTS,
      description: "Teste de conexão",
      reference,
      name: "Teste de conexão",
      email: TEST_EMAIL,
      cpf: TEST_CPF,
      phone: TEST_PHONE,
      postbackUrl,
    })
    : input.gatewayKey === "blackcat"
    ? {
      amount: TEST_AMOUNT_CENTS,
      currency: "BRL",
      paymentMethod: "pix",
      items: [{ title: "Teste de conexão", unitPrice: TEST_AMOUNT_CENTS, quantity: 1, tangible: false }],
      customer: {
        name: "Teste de conexão",
        email: TEST_EMAIL,
        phone: TEST_PHONE,
        document: { number: TEST_CPF, type: "cpf" },
      },
      pix: { expiresInDays: 1 },
      metadata: "Teste técnico de integração",
      externalRef: reference,
      ...(postbackUrl ? { postbackUrl } : {}),
    }
    : input.gatewayKey === "freepay"
      ? {
      amount: TEST_AMOUNT_CENTS,
      payment_method: "pix",
      postback_url: postbackUrl,
      customer: {
        name: "Teste de conexão",
        email: TEST_EMAIL,
        document: { number: TEST_CPF, type: "cpf" },
        phone: `+55${TEST_PHONE}`,
        external_ref: reference,
      },
      items: [{
        title: "Teste de conexão",
        unit_price: TEST_AMOUNT_CENTS,
        quantity: 1,
        tangible: false,
        external_ref: reference,
      }],
      pix: { expires_in_days: 1 },
      metadata: { purpose: "gateway_connection_test" },
    }
      : documentedGatewayKey
        ? buildGatewayPaymentRequest({
          amountCents: TEST_AMOUNT_CENTS,
          description: "Teste de conexão",
          reference,
          name: "Teste de conexão",
          email: TEST_EMAIL,
          cpf: TEST_CPF,
          phone: TEST_PHONE,
          postbackUrl,
        })
        : null;
  if (!body) {
    return {
      success: false,
      gatewayKey: input.gatewayKey,
      gatewayLabel: gateway.label,
      message: "Esta gateway ainda não possui integração de cobrança disponível.",
    };
  }

  try {
    const createUrl = input.gatewayKey === "blackcat"
      ? BLACKCAT_URL
      : input.gatewayKey === "freepay"
        ? FREEPAY_URL
        : getGatewayCreateUrl(documentedGatewayKey!);
    const response = await fetch(createUrl, {
      method: "POST",
      headers: {
        ...(input.gatewayKey === "blackcat"
          ? { "x-api-key": secretKey }
          : input.gatewayKey === "freepay"
            ? { authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}` }
             : input.gatewayKey === "magicpay"
               ? { authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}` }
               : getGatewayHeaders(secretKey)),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const responseText = await response.text();
    let payload: unknown = null;
    try {
      payload = responseText ? JSON.parse(responseText) : responseText;
    } catch {
      payload = responseText;
    }
    if (!response.ok) {
      return {
        success: false,
        gatewayKey: input.gatewayKey,
        gatewayLabel: gateway.label,
        message: failureMessage(response.status, payload, secretKey),
      };
    }

    const data = getPaymentData(payload);
    const documentedResult = documentedGatewayKey ? parseGatewayCreateResponse(payload) : null;
    const paymentData = input.gatewayKey === "blackcat" ? asRecord(data?.paymentData) : asRecord(data?.pix);
    const transactionId = documentedResult?.transactionId ?? getString(data, ["transactionId", "id", "Id"]);
    const pixCode = documentedResult?.pixCode ?? (input.gatewayKey === "blackcat"
      ? getString(paymentData, ["copyPaste", "copy_paste", "qrCode", "qr_code"])
      : getString(paymentData, ["e2_e", "qr_code"]));
    const status = documentedResult?.status ?? (getString(data, ["status", "Status"])?.toUpperCase() || "PENDING");

    if (!transactionId || !pixCode) {
      return {
        success: false,
        gatewayKey: input.gatewayKey,
        gatewayLabel: gateway.label,
        message: "A gateway respondeu, mas não retornou o ID da transação e o código PIX esperado.",
      };
    }

    return {
      success: true,
      gatewayKey: input.gatewayKey,
      gatewayLabel: gateway.label,
      status,
      transactionId,
      pixCode,
      message: `PIX de teste de R$ 1,00 gerado com sucesso. A transação ficou ${status === "PAID" ? "paga" : "pendente"}.`,
    };
  } catch (error) {
    const detail = error instanceof Error && error.name === "TimeoutError"
      ? "A gateway demorou mais que o limite de 20 segundos para responder."
      : "Não foi possível conectar à gateway.";
    return {
      success: false,
      gatewayKey: input.gatewayKey,
      gatewayLabel: gateway.label,
      message: detail,
    };
  }
}