import { and, eq } from "drizzle-orm";
import { db, adminGatewayConfigsTable, adminSettingsTable } from "@workspace/db";

export const GATEWAYS = [
  { key: "freepay", label: "FreePay", supported: true },
  { key: "blackcat", label: "BlackCat", supported: true },
  { key: "flevopay", label: "FlevoPay", supported: true, documentationUrl: "https://app.flevopay.com.br/documentation" },
  { key: "duttyfy", label: "Duttyfy", supported: false },
  { key: "pingupag", label: "PinguPag", supported: true, documentationUrl: "https://app.pingupag.com/documentation" },
  { key: "magicpay", label: "MagicPay", supported: true, documentationUrl: "https://app.dashboardmagicpay.com/docs/intro/first-steps" },
] as const;

const defaultLimit = 10000000;

export async function ensureGatewayRows() {
  await db.insert(adminSettingsTable).values({ id: 1, activeGatewayKey: "freepay" }).onConflictDoNothing();
  for (const gateway of GATEWAYS) {
    await db.insert(adminGatewayConfigsTable).values({
      gatewayKey: gateway.key,
      gatewayLabel: gateway.label,
      maxAmountCents: defaultLimit,
    }).onConflictDoNothing();
  }
}

export async function getAdminSettings() {
  await ensureGatewayRows();
  const [settings] = await db.select().from(adminSettingsTable).where(eq(adminSettingsTable.id, 1)).limit(1);
  return settings;
}

export async function getGatewayConfig(gatewayKey = "freepay") {
  await ensureGatewayRows();
  const [config] = await db.select().from(adminGatewayConfigsTable)
    .where(eq(adminGatewayConfigsTable.gatewayKey, gatewayKey)).limit(1);
  return config;
}

export async function getGatewayCredentials(gatewayKey: string) {
  const config = await getGatewayConfig(gatewayKey);
  if (gatewayKey === "freepay") {
    return {
      publicKey: config?.publicKey || process.env.FREEPAY_PUBLIC_KEY || "",
      secretKey: config?.secretKey || process.env.FREEPAY_SECRET_KEY || "",
    };
  }
  const environmentSecret = gatewayKey === "blackcat"
    ? process.env.BLACKCAT_API_KEY
    : gatewayKey === "flevopay"
      ? process.env.FLEVOPAY_SECRET_KEY
      : gatewayKey === "magicpay"
        ? process.env.MAGICPAY_SECRET_KEY
      : undefined;
  return {
    publicKey: config?.publicKey || (gatewayKey === "magicpay" ? process.env.MAGICPAY_PUBLIC_KEY : "") || "",
    secretKey: config?.secretKey || environmentSecret || "",
  };
}

export function maskSecret(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 4) return "••••";
  return `${"•".repeat(Math.min(8, Math.max(4, value.length - 4)))}${value.slice(-4)}`;
}

export function maskPublicKey(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 6) return "••••••";
  return `${value.slice(0, 3)}${"•".repeat(Math.min(14, Math.max(5, value.length - 7)))}${value.slice(-4)}`;
}

export async function updateGatewaySettings(input: {
  gatewayKey?: string;
  activeGatewayKey?: string;
  productName?: string;
  secretKey?: string;
  publicKey?: string;
  maxAmountCents?: number;
}) {
  await ensureGatewayRows();
  const gatewayKey = input.gatewayKey || input.activeGatewayKey;
  const activeGateway = input.activeGatewayKey
    ? GATEWAYS.find((gateway) => gateway.key === input.activeGatewayKey)
    : undefined;
  if (activeGateway?.supported) {
    await db.update(adminSettingsTable).set({ activeGatewayKey: input.activeGatewayKey }).where(eq(adminSettingsTable.id, 1));
  }
  if (typeof input.productName === "string" && input.productName.trim()) {
    await db.update(adminSettingsTable).set({ productName: input.productName.trim() }).where(eq(adminSettingsTable.id, 1));
  }
  if (!gatewayKey || !GATEWAYS.some((gateway) => gateway.key === gatewayKey)) return;
  const updates: Record<string, unknown> = {};
  if (typeof input.secretKey === "string" && input.secretKey.trim()) updates.secretKey = input.secretKey.trim();
  if (typeof input.publicKey === "string" && input.publicKey.trim()) updates.publicKey = input.publicKey.trim();
  if (typeof input.maxAmountCents === "number" && Number.isFinite(input.maxAmountCents) && input.maxAmountCents >= 0) {
    updates.maxAmountCents = Math.round(input.maxAmountCents);
  }
  if (Object.keys(updates).length > 0) {
    await db.update(adminGatewayConfigsTable).set(updates).where(eq(adminGatewayConfigsTable.gatewayKey, gatewayKey));
  }
}