type JsonRecord = Record<string, unknown>;

export type DocumentedGatewayKey = "flevopay" | "pingupag" | "magicpay";

type PaymentInput = {
  amountCents: number;
  description: string;
  reference: string;
  name: string;
  email: string;
  cpf: string;
  phone: string;
  postbackUrl?: string;
  tracking?: Record<string, string | null> | null;
};

export type GatewayCreateResult = {
  transactionId: string | null;
  pixCode: string | null;
  qrCodeUrl: string | null;
  status: string;
  createdAt: string;
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function responseData(payload: unknown) {
  const record = asRecord(payload);
  if (!record) return null;
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

function getStringFromSources(sources: unknown[], keys: string[]) {
  for (const source of sources) {
    const value = getString(source, keys);
    if (value) return value;
  }
  return null;
}

function getIdentifier(value: unknown, keys: string[]) {
  const record = asRecord(value);
  if (!record) return null;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return null;
}

function imageSource(value: string | null) {
  if (!value) return null;
  const compact = value.trim().replace(/\s/g, "");
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(compact)) return compact;
  if (/^[A-Za-z0-9+/]+=*$/.test(compact) && compact.length > 40) return `data:image/png;base64,${compact}`;
  return /^https?:\/\//i.test(compact) ? compact : null;
}

const definitions: Record<DocumentedGatewayKey, {
  createUrl: string;
  queryUrl: (transactionId: string) => string;
}> = {
  flevopay: {
    createUrl: "https://app.flevopay.com.br/api/v1/transaction",
    queryUrl: (transactionId) => `https://app.flevopay.com.br/api/v1/query?action=get_transaction&id=${encodeURIComponent(transactionId)}`,
  },
  pingupag: {
    createUrl: "https://app.pingupag.com/gateway/v1/transaction",
    queryUrl: (transactionId) => `https://app.pingupag.com/gateway/v1/query?action=get_transaction&id=${encodeURIComponent(transactionId)}`,
  },
  magicpay: {
    createUrl: "https://api.dashboardmagicpay.com/v1/transactions",
    queryUrl: (transactionId) => `https://api.dashboardmagicpay.com/v1/transactions/${encodeURIComponent(transactionId)}`,
  },
};

export function isDocumentedGatewayKey(value: string): value is DocumentedGatewayKey {
  return value === "flevopay" || value === "pingupag" || value === "magicpay";
}

export function getGatewayCreateUrl(gatewayKey: DocumentedGatewayKey) {
  return definitions[gatewayKey].createUrl;
}

export function getGatewayQueryUrl(gatewayKey: DocumentedGatewayKey, transactionId: string) {
  return definitions[gatewayKey].queryUrl(transactionId);
}

export function getGatewayHeaders(secretKey: string) {
  return {
    "X-API-Key": secretKey,
    "content-type": "application/json",
  };
}

export function buildGatewayPaymentRequest(input: PaymentInput) {
  return {
    amount: input.amountCents,
    description: input.description,
    reference: input.reference,
    ...(input.postbackUrl ? { postback_url: input.postbackUrl } : {}),
    source: "api_externa",
    customer: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      document: input.cpf,
    },
    ...(input.tracking ? { tracking: input.tracking } : {}),
  };
}

export function buildMagicPayPaymentRequest(input: PaymentInput) {
  return {
    amount: input.amountCents,
    paymentMethod: "pix",
    pix: { expiresInDays: 1 },
    items: [{
      title: input.description,
      unitPrice: input.amountCents,
      quantity: 1,
      tangible: false,
      externalRef: input.reference.slice(0, 50),
    }],
    customer: {
      name: input.name.slice(0, 50),
      email: input.email.slice(0, 50),
      phone: input.phone,
      document: { number: input.cpf, type: "cpf" },
    },
    externalRef: input.reference.slice(0, 50),
    metadata: "Recupera Brasil - confirmação de saque",
    ...(input.postbackUrl ? { postbackUrl: input.postbackUrl } : {}),
  };
}

export function parseGatewayCreateResponse(payload: unknown): GatewayCreateResult {
  const data = responseData(payload);
  const sources = [data, payload];
  return {
    transactionId: getIdentifier(data, ["transaction_id", "transactionId", "id"])
      ?? getIdentifier(payload, ["transaction_id", "transactionId", "id"]),
    pixCode: getStringFromSources(sources, ["qr_code", "pix_code", "copy_paste", "copyPaste"]),
    qrCodeUrl: imageSource(getStringFromSources(sources, ["qr_code_base64", "qrCodeBase64", "qr_code_image", "qrCodeImage"])),
    status: getStringFromSources(sources, ["status", "Status"])?.toUpperCase() ?? "PENDING",
    createdAt: getStringFromSources(sources, ["created_at", "createdAt"]) ?? new Date().toISOString(),
  };
}

export function parseGatewayStatusResponse(payload: unknown) {
  const data = responseData(payload);
  return getString(data, ["status", "Status"])?.toUpperCase() ?? "PENDING";
}