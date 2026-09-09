import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import {
  db,
  adminGatewayConfigsTable,
  adminSettingsTable,
  paymentOrdersTable,
  trackingPixelsTable,
  utmifyOffersTable,
  utmifyOfferPixelsTable,
} from "@workspace/db";
import {
  checkAdminCredentials,
  clearAdminSession,
  hasAdminCredentials,
  isAdminSessionValid,
  requireAdmin,
  setAdminSession,
} from "../lib/admin-auth";
import { GATEWAYS, ensureGatewayRows, getAdminSettings, getGatewayCredentials, maskPublicKey, maskSecret, updateGatewaySettings } from "../lib/gateway-config";
import { TRACKING_PLATFORMS } from "../lib/utmify-offers";
import { getAdminTrackingPixels } from "../lib/tracking-pixels";
import { testGatewayConnection } from "../lib/gateway-test";
import { getFunnelRetentionMetrics, getQuizRetentionMetrics } from "./analytics";

const ELIGIBILITY_QUIZ_QUESTION_COUNT = 7;

const router: IRouter = Router();
const validStatuses = new Set(["pending", "paid", "failed", "cancelled", "expired"]);

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeOrder(order: typeof paymentOrdersTable.$inferSelect) {
  return {
    ...order,
    // customerDocument/customerPhone are returned in full: this is an
    // authenticated admin-only endpoint and the operator needs the real
    // values to contact leads (WhatsApp deep link, leads export).
    pixKey: order.pixKey ? `${order.pixKey.slice(0, 2)}••••${order.pixKey.slice(-2)}` : null,
    pixCode: order.pixCode ? `${order.pixCode.slice(0, 10)}…` : null,
  };
}

function safeOffer(
  offer: typeof utmifyOffersTable.$inferSelect,
  pixels: Array<typeof utmifyOfferPixelsTable.$inferSelect>,
) {
  return {
    id: offer.id,
    name: offer.name,
    slug: offer.slug,
    isActive: offer.isActive,
    apiToken: maskSecret(offer.apiToken),
    pixels: pixels.map((pixel) => ({
      id: pixel.id,
      platform: pixel.platform,
      pixelId: pixel.pixelId,
      label: pixel.label,
      isActive: pixel.isActive,
    })),
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
  };
}

function parseOfferInput(value: unknown, requireToken: boolean) {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const name = asString(body.name);
  const slug = asString(body.slug).toLowerCase();
  const apiToken = asString(body.apiToken);
  const rawPixels = Array.isArray(body.pixels) ? body.pixels : [];
  if (name.length < 2 || name.length > 100) throw new Error("O nome da oferta deve ter entre 2 e 100 caracteres.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    throw new Error("O identificador deve usar apenas letras minúsculas, números e hífens.");
  }
  if (requireToken && apiToken.length < 8) throw new Error("Informe um token UTMify válido para a oferta.");
  if (apiToken && apiToken.length < 8) throw new Error("O token UTMify parece incompleto.");
  if (rawPixels.length > 1000) throw new Error("A oferta pode ter no máximo 1.000 pixels.");
  const pixels = rawPixels.map((item) => {
    const pixel = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const platform = asString(pixel.platform).toLowerCase();
    const pixelId = asString(pixel.pixelId);
    const label = asString(pixel.label);
    if (!TRACKING_PLATFORMS.includes(platform as typeof TRACKING_PLATFORMS[number])) {
      throw new Error("Plataforma de pixel inválida.");
    }
    if (pixelId.length < 2 || pixelId.length > 200) throw new Error("Cada pixel precisa ter um identificador válido.");
    if (label.length > 100) throw new Error("O nome do pixel deve ter no máximo 100 caracteres.");
    return { platform, pixelId, label: label || null };
  });
  const uniquePixels = new Set(pixels.map((pixel) => `${pixel.platform}:${pixel.pixelId}`));
  if (uniquePixels.size !== pixels.length) throw new Error("Não repita o mesmo pixel na oferta.");
  return {
    name,
    slug,
    apiToken: apiToken || undefined,
    isActive: body.isActive === true,
    pixels,
  };
}

function safeTrackingPixel(pixel: typeof trackingPixelsTable.$inferSelect) {
  return {
    id: pixel.id,
    platform: pixel.platform,
    pixelId: pixel.pixelId,
    code: pixel.code,
    token: maskSecret(pixel.token),
    label: pixel.label,
    isActive: pixel.isActive,
    createdAt: pixel.createdAt,
    updatedAt: pixel.updatedAt,
  };
}

function parseTrackingPixels(value: unknown) {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawPixels = Array.isArray(body.pixels) ? body.pixels : [];
  if (rawPixels.length > 1000) throw new Error("Você pode cadastrar no máximo 1.000 pixels.");
  const pixels = rawPixels.map((item) => {
    const pixel = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const platform = asString(pixel.platform).toLowerCase();
    const pixelId = asString(pixel.pixelId);
    const code = asString(pixel.code);
    const token = asString(pixel.token);
    const label = asString(pixel.label);
    const id = Number.isInteger(pixel.id) ? pixel.id as number : null;
    if (!TRACKING_PLATFORMS.includes(platform as typeof TRACKING_PLATFORMS[number])) {
      throw new Error("Plataforma de pixel inválida.");
    }
    if (pixelId.length < 2 || pixelId.length > 200) throw new Error("Cada pixel precisa ter um ID válido.");
    if (code.length > 100000) throw new Error("O código do pixel é muito grande.");
    if (token.length > 2000) throw new Error("O token do pixel é muito grande.");
    if (label.length > 100) throw new Error("O nome do pixel deve ter no máximo 100 caracteres.");
    return {
      id,
      platform: platform as typeof TRACKING_PLATFORMS[number],
      pixelId,
      code: code || null,
      token: token || null,
      label: label || null,
    };
  });
  const uniquePixels = new Set(pixels.map((pixel) => `${pixel.platform}:${pixel.pixelId}`));
  if (uniquePixels.size !== pixels.length) throw new Error("Não repita o mesmo pixel.");
  return pixels;
}

router.post("/admin/auth/login", async (req, res) => {
  if (!hasAdminCredentials()) {
    return res.status(503).json({ success: false, error: "Credenciais administrativas ainda não configuradas no ambiente." });
  }
  const username = asString(req.body?.username);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!username || !password || !checkAdminCredentials(username, password)) {
    return res.status(401).json({ success: false, error: "Usuário ou senha inválidos." });
  }
  setAdminSession(res);
  return res.json({ success: true, username });
});

router.get("/admin/auth/me", (req, res) => {
  if (!isAdminSessionValid(req)) return res.status(401).json({ success: false, authenticated: false });
  return res.json({ success: true, authenticated: true });
});

router.post("/admin/auth/logout", (req, res) => {
  clearAdminSession(res);
  return res.json({ success: true });
});

router.use("/admin", requireAdmin);

router.get("/admin/gateway-config", async (_req, res) => {
  await ensureGatewayRows();
  const settings = await getAdminSettings();
  const configs = await db.select().from(adminGatewayConfigsTable);
  return res.json({
    activeGatewayKey: settings?.activeGatewayKey || "freepay",
    productName: settings?.productName || "Ebook Emagrecimento*",
    originalFeeCents: settings?.originalFeeCents ?? 6897,
    feeCents: settings?.feeCents ?? 4781,
    whatsappTemplate: settings?.whatsappTemplate || "",
    gateways: GATEWAYS.map((gateway) => {
      const config = configs.find((item) => item.gatewayKey === gateway.key);
      return {
        ...gateway,
        maxAmountCents: config?.maxAmountCents ?? 10000000,
        configured: Boolean(config?.secretKey
          || (gateway.key === "freepay" && process.env.FREEPAY_SECRET_KEY)
          || (gateway.key === "blackcat" && process.env.BLACKCAT_API_KEY)
           || (gateway.key === "flevopay" && process.env.FLEVOPAY_SECRET_KEY)
           || (gateway.key === "magicpay" && process.env.MAGICPAY_SECRET_KEY)),
      };
    }),
  });
});

router.get("/admin/gateway-keys", async (_req, res) => {
  await ensureGatewayRows();
  const configs = await db.select().from(adminGatewayConfigsTable);
  return res.json({
    gateways: GATEWAYS.map((gateway) => {
      const config = configs.find((item) => item.gatewayKey === gateway.key);
      const secretKey = config?.secretKey
        || (gateway.key === "freepay" ? process.env.FREEPAY_SECRET_KEY : "")
        || (gateway.key === "blackcat" ? process.env.BLACKCAT_API_KEY : "")
        || (gateway.key === "flevopay" ? process.env.FLEVOPAY_SECRET_KEY : "")
        || (gateway.key === "magicpay" ? process.env.MAGICPAY_SECRET_KEY : "");
      const publicKey = config?.publicKey
        || (gateway.key === "freepay" ? process.env.FREEPAY_PUBLIC_KEY : "")
        || (gateway.key === "magicpay" ? process.env.MAGICPAY_PUBLIC_KEY : "");
      return {
        gatewayKey: gateway.key,
        secretKey: maskSecret(secretKey),
        publicKey: maskPublicKey(publicKey),
      };
    }),
  });
});

router.post("/admin/gateway-test", async (req, res) => {
  const gatewayKey = asString(req.body?.gatewayKey);
  const gateway = GATEWAYS.find((item) => item.key === gatewayKey);
  if (!gateway) {
    return res.status(400).json({ success: false, error: "Gateway inválido." });
  }
  if (!gateway.supported) {
    return res.status(400).json({ success: false, error: `${gateway.label} ainda não possui integração de cobrança e não pode ser testada.` });
  }

  const secretKey = asString(req.body?.secretKey);
  const publicKey = asString(req.body?.publicKey);
  const maxAmountCents = Number(req.body?.maxAmountCents);
  await updateGatewaySettings({
    gatewayKey,
    secretKey: secretKey || undefined,
    publicKey: publicKey || undefined,
    maxAmountCents: Number.isFinite(maxAmountCents) ? maxAmountCents : undefined,
  });

  const test = await testGatewayConnection({ gatewayKey, secretKey, publicKey });
  if (!test.success) {
    return res.status(502).json({ success: false, error: test.message, test: { ...test, pixCode: undefined } });
  }

  await updateGatewaySettings({ activeGatewayKey: gatewayKey });
  return res.json({
    success: true,
    activeGatewayKey: gatewayKey,
    test: { ...test, pixCode: undefined },
  });
});

router.put("/admin/gateway-config", async (req, res) => {
  const activeGatewayKey = asString(req.body?.activeGatewayKey);
  const gatewayKey = asString(req.body?.gatewayKey);
  const maxAmountCents = Number(req.body?.maxAmountCents);
  const productName = asString(req.body?.productName);
  if (productName && (productName.length < 2 || productName.length > 150)) {
    return res.status(400).json({ success: false, error: "O nome do produto deve ter entre 2 e 150 caracteres." });
  }
  const originalFeeCentsRaw = req.body?.originalFeeCents;
  const feeCentsRaw = req.body?.feeCents;
  const originalFeeCents = originalFeeCentsRaw === undefined ? undefined : Number(originalFeeCentsRaw);
  const feeCents = feeCentsRaw === undefined ? undefined : Number(feeCentsRaw);
  if (originalFeeCents !== undefined && (!Number.isFinite(originalFeeCents) || originalFeeCents <= 0 || originalFeeCents > 100000000)) {
    return res.status(400).json({ success: false, error: "O valor riscado (de) é inválido." });
  }
  if (feeCents !== undefined && (!Number.isFinite(feeCents) || feeCents <= 0 || feeCents > 100000000)) {
    return res.status(400).json({ success: false, error: "O valor do PIX (por) é inválido." });
  }
  if (originalFeeCents !== undefined && feeCents !== undefined && feeCents > originalFeeCents) {
    return res.status(400).json({ success: false, error: "O valor do PIX não pode ser maior que o valor riscado." });
  }
  if ((activeGatewayKey && !GATEWAYS.some((gateway) => gateway.key === activeGatewayKey))
    || (gatewayKey && !GATEWAYS.some((gateway) => gateway.key === gatewayKey))) {
    return res.status(400).json({ success: false, error: "Gateway inválido." });
  }
  const selectedActiveGateway = GATEWAYS.find((gateway) => gateway.key === activeGatewayKey);
  if (selectedActiveGateway && !selectedActiveGateway.supported) {
    return res.status(400).json({ success: false, error: `${selectedActiveGateway.label} ainda não possui integração de cobrança e não pode ser ativado.` });
  }
  if (selectedActiveGateway) {
    const currentCredentials = await getGatewayCredentials(activeGatewayKey);
    const incomingSecretKey = gatewayKey === activeGatewayKey ? asString(req.body?.secretKey) : "";
    const incomingPublicKey = gatewayKey === activeGatewayKey ? asString(req.body?.publicKey) : "";
    if (!currentCredentials.secretKey && !incomingSecretKey) {
      return res.status(400).json({ success: false, error: `Configure a chave secreta da ${selectedActiveGateway.label} antes de ativá-la.` });
    }
    if (activeGatewayKey === "magicpay" && !currentCredentials.publicKey && !incomingPublicKey) {
      return res.status(400).json({ success: false, error: "Configure a chave pública da MagicPay antes de ativá-la." });
    }
  }
  await updateGatewaySettings({
    activeGatewayKey: activeGatewayKey || undefined,
    gatewayKey: gatewayKey || activeGatewayKey || undefined,
    productName: productName || undefined,
    originalFeeCents,
    feeCents,
    secretKey: asString(req.body?.secretKey) || undefined,
    publicKey: asString(req.body?.publicKey) || undefined,
    maxAmountCents: Number.isFinite(maxAmountCents) ? maxAmountCents : undefined,
  });
  return res.json({ success: true });
});

router.put("/admin/whatsapp-config", async (req, res) => {
  const whatsappTemplate = asString(req.body?.whatsappTemplate);
  if (whatsappTemplate.length < 10 || whatsappTemplate.length > 500) {
    return res.status(400).json({ success: false, error: "Mensagem de WhatsApp inválida." });
  }
  await db.update(adminSettingsTable).set({ whatsappTemplate }).where(eq(adminSettingsTable.id, 1));
  return res.json({ success: true });
});

router.get("/admin/tracking-pixels", async (_req, res) => {
  const pixels = await getAdminTrackingPixels();
  return res.json({ success: true, pixels: pixels.map(safeTrackingPixel) });
});

router.put("/admin/tracking-pixels", async (req, res) => {
  let pixels: ReturnType<typeof parseTrackingPixels>;
  try {
    pixels = parseTrackingPixels(req.body);
  } catch (error) {
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Dados de pixels inválidos." });
  }

  try {
    const existing = await getAdminTrackingPixels();
    const existingById = new Map(existing.map((pixel) => [pixel.id, pixel.token]));
    const existingByKey = new Map(existing.map((pixel) => [`${pixel.platform}:${pixel.pixelId}`, pixel.token]));
    const values = pixels.map((pixel) => {
      const preservedToken = (pixel.id !== null ? existingById.get(pixel.id) : undefined)
        ?? existingByKey.get(`${pixel.platform}:${pixel.pixelId}`)
        ?? null;
      return {
        platform: pixel.platform,
        pixelId: pixel.pixelId,
        code: pixel.code,
        label: pixel.label,
        token: pixel.token || preservedToken,
        isActive: true,
      };
    });
    await db.transaction(async (tx) => {
      await tx.delete(trackingPixelsTable);
      if (values.length) await tx.insert(trackingPixelsTable).values(values);
    });
    const saved = await getAdminTrackingPixels();
    return res.json({ success: true, pixels: saved.map(safeTrackingPixel) });
  } catch (error) {
    req.log.error({ err: error }, "Global tracking pixel save failed");
    return res.status(500).json({ success: false, error: "Não foi possível salvar os pixels." });
  }
});

router.get("/admin/offers", async (_req, res) => {
  const [offers, pixels] = await Promise.all([
    db.select().from(utmifyOffersTable).orderBy(desc(utmifyOffersTable.isActive), asc(utmifyOffersTable.name)),
    db.select().from(utmifyOfferPixelsTable).orderBy(asc(utmifyOfferPixelsTable.id)),
  ]);
  return res.json({
    success: true,
    offers: offers.map((offer) => safeOffer(offer, pixels.filter((pixel) => pixel.offerId === offer.id))),
    fallbackConfigured: Boolean(process.env.UTMIFY_API_TOKEN),
  });
});

router.post("/admin/offers", async (req, res) => {
  let input: ReturnType<typeof parseOfferInput>;
  try {
    input = parseOfferInput(req.body, true);
  } catch (error) {
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Dados da oferta inválidos." });
  }
  try {
    const created = await db.transaction(async (tx) => {
      const existing = await tx.select({ id: utmifyOffersTable.id }).from(utmifyOffersTable).limit(1);
      const [offer] = await tx.insert(utmifyOffersTable).values({
        name: input.name,
        slug: input.slug,
        apiToken: input.apiToken,
        isActive: input.isActive || existing.length === 0,
      }).returning();
      if (input.pixels.length) {
        await tx.insert(utmifyOfferPixelsTable).values(input.pixels.map((pixel) => ({ ...pixel, offerId: offer.id })));
      }
      if (offer.isActive) {
        await tx.update(utmifyOffersTable).set({ isActive: false }).where(sql`${utmifyOffersTable.id} <> ${offer.id}`);
        await tx.update(utmifyOffersTable).set({ isActive: true }).where(eq(utmifyOffersTable.id, offer.id));
      }
      return offer;
    });
    const pixels = await db.select().from(utmifyOfferPixelsTable).where(eq(utmifyOfferPixelsTable.offerId, created.id));
    return res.status(201).json({ success: true, offer: safeOffer(created, pixels) });
  } catch (error) {
    req.log.warn({ err: error }, "UTMify offer creation failed");
    return res.status(409).json({ success: false, error: "Não foi possível criar a oferta. Verifique se o identificador já existe." });
  }
});

router.put("/admin/offers/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: "Oferta inválida." });
  let input: ReturnType<typeof parseOfferInput>;
  try {
    input = parseOfferInput(req.body, false);
  } catch (error) {
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Dados da oferta inválidos." });
  }
  try {
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(utmifyOffersTable).where(eq(utmifyOffersTable.id, id)).limit(1);
      if (!current) throw new Error("NOT_FOUND");
      const [offer] = await tx.update(utmifyOffersTable).set({
        name: input.name,
        slug: input.slug,
        ...(input.apiToken ? { apiToken: input.apiToken } : {}),
        isActive: input.isActive,
      }).where(eq(utmifyOffersTable.id, id)).returning();
      await tx.delete(utmifyOfferPixelsTable).where(eq(utmifyOfferPixelsTable.offerId, id));
      if (input.pixels.length) {
        await tx.insert(utmifyOfferPixelsTable).values(input.pixels.map((pixel) => ({ ...pixel, offerId: id })));
      }
      if (input.isActive) {
        await tx.update(utmifyOffersTable).set({ isActive: false }).where(sql`${utmifyOffersTable.id} <> ${id}`);
        await tx.update(utmifyOffersTable).set({ isActive: true }).where(eq(utmifyOffersTable.id, id));
      } else if (current.isActive) {
        const [next] = await tx.select().from(utmifyOffersTable)
          .where(sql`${utmifyOffersTable.id} <> ${id}`)
          .orderBy(asc(utmifyOffersTable.id))
          .limit(1);
        if (next) await tx.update(utmifyOffersTable).set({ isActive: true }).where(eq(utmifyOffersTable.id, next.id));
      }
      return offer;
    });
    if (!updated) return res.status(404).json({ success: false, error: "Oferta não encontrada." });
    const pixels = await db.select().from(utmifyOfferPixelsTable).where(eq(utmifyOfferPixelsTable.offerId, id));
    return res.json({ success: true, offer: safeOffer(updated, pixels) });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return res.status(404).json({ success: false, error: "Oferta não encontrada." });
    req.log.warn({ err: error, id }, "UTMify offer update failed");
    return res.status(409).json({ success: false, error: "Não foi possível atualizar a oferta. Verifique se o identificador já existe." });
  }
});

router.delete("/admin/offers/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: "Oferta inválida." });
  try {
    const deleted = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(utmifyOffersTable).where(eq(utmifyOffersTable.id, id)).limit(1);
      if (!current) return false;
      await tx.delete(utmifyOffersTable).where(eq(utmifyOffersTable.id, id));
      if (current.isActive) {
        const [next] = await tx.select().from(utmifyOffersTable).orderBy(asc(utmifyOffersTable.id)).limit(1);
        if (next) await tx.update(utmifyOffersTable).set({ isActive: true }).where(eq(utmifyOffersTable.id, next.id));
      }
      return true;
    });
    if (!deleted) return res.status(404).json({ success: false, error: "Oferta não encontrada." });
    return res.json({ success: true });
  } catch (error) {
    req.log.warn({ err: error, id }, "UTMify offer deletion failed");
    return res.status(500).json({ success: false, error: "Não foi possível remover a oferta." });
  }
});

router.get("/admin/orders", async (req, res) => {
  const status = asString(req.query.status).toLowerCase();
  const query = asString(req.query.q);
  const from = asString(req.query.from);
  const to = asString(req.query.to);
  const filters = [];
  if (status && status !== "all" && validStatuses.has(status)) filters.push(eq(paymentOrdersTable.status, status));
  if (query) {
    filters.push(or(
      ilike(paymentOrdersTable.customerName, `%${query}%`),
      ilike(paymentOrdersTable.customerEmail, `%${query}%`),
      ilike(paymentOrdersTable.gatewayTransactionId, `%${query}%`),
    ));
  }
  if (from) filters.push(gte(paymentOrdersTable.createdAt, new Date(`${from}T00:00:00.000Z`)));
  if (to) filters.push(lt(paymentOrdersTable.createdAt, new Date(`${to}T23:59:59.999Z`)));
  const orders = await db.select().from(paymentOrdersTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(paymentOrdersTable.createdAt))
    .limit(500);
  return res.json({ success: true, orders: orders.map(safeOrder) });
});

router.get("/admin/orders/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: "Pedido inválido." });
  const [order] = await db.select().from(paymentOrdersTable).where(eq(paymentOrdersTable.id, id)).limit(1);
  if (!order) return res.status(404).json({ success: false, error: "Pedido não encontrado." });
  return res.json({ success: true, order: safeOrder(order) });
});

router.patch("/admin/orders/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const status = asString(req.body?.status).toLowerCase();
  if (!Number.isInteger(id) || !validStatuses.has(status)) {
    return res.status(400).json({ success: false, error: "Status inválido." });
  }
  await db.update(paymentOrdersTable).set({
    status,
    approvedAt: status === "paid" ? new Date() : null,
  }).where(eq(paymentOrdersTable.id, id));
  return res.json({ success: true });
});

router.get("/admin/metrics", async (_req, res) => {
  const [total] = await db.select({ count: sql<number>`count(*)` }).from(paymentOrdersTable);
  const [pending] = await db.select({ count: sql<number>`count(*)` }).from(paymentOrdersTable).where(eq(paymentOrdersTable.status, "pending"));
  const [paid] = await db.select({ count: sql<number>`count(*)` }).from(paymentOrdersTable).where(eq(paymentOrdersTable.status, "paid"));
  const [paidRevenue] = await db.select({ cents: sql<number>`coalesce(sum(${paymentOrdersTable.amountCents}), 0)` }).from(paymentOrdersTable).where(eq(paymentOrdersTable.status, "paid"));
  const [copied] = await db.select({ count: sql<number>`count(*)` }).from(paymentOrdersTable).where(eq(paymentOrdersTable.pixCopied, true));
  const [customers] = await db.select({ count: sql<number>`count(distinct ${paymentOrdersTable.customerEmail})` }).from(paymentOrdersTable);
  return res.json({
    success: true,
    metrics: {
      total: Number(total?.count || 0),
      pending: Number(pending?.count || 0),
      paid: Number(paid?.count || 0),
      paidRevenueCents: Number(paidRevenue?.cents || 0),
      copied: Number(copied?.count || 0),
      customers: Number(customers?.count || 0),
      retention: {
        returningCustomers: 0,
        repeatRate: 0,
        note: "A retenção fica parcial até existir histórico de mais de uma compra por cliente.",
        ...(await getFunnelRetentionMetrics()),
      },
      quiz: await getQuizRetentionMetrics(ELIGIBILITY_QUIZ_QUESTION_COUNT),
    },
  });
});

export default router;