import { createInsertSchema } from "drizzle-zod";
import { boolean, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const adminSettingsTable = pgTable("admin_settings", {
  id: serial("id").primaryKey(),
  activeGatewayKey: text("active_gateway_key").notNull().default("freepay"),
  productName: text("product_name").notNull().default("Ebook Emagrecimento*"),
  whatsappTemplate: text("whatsapp_template").notNull().default("Olá, {nome}! Vi que seu PIX de confirmação ainda está pendente. Posso te ajudar?"),
  trackingPixelsMigrated: boolean("tracking_pixels_migrated").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const adminGatewayConfigsTable = pgTable("admin_gateway_configs", {
  id: serial("id").primaryKey(),
  gatewayKey: text("gateway_key").notNull(),
  gatewayLabel: text("gateway_label").notNull(),
  secretKey: text("secret_key"),
  publicKey: text("public_key"),
  maxAmountCents: integer("max_amount_cents").notNull().default(10000000),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  gatewayKeyUnique: uniqueIndex("admin_gateway_configs_gateway_key_unique").on(table.gatewayKey),
}));

export const utmifyOffersTable = pgTable("utmify_offers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  apiToken: text("api_token"),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  slugUnique: uniqueIndex("utmify_offers_slug_unique").on(table.slug),
}));

export const utmifyOfferPixelsTable = pgTable("utmify_offer_pixels", {
  id: serial("id").primaryKey(),
  offerId: integer("offer_id").notNull().references(() => utmifyOffersTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull().default("utmify"),
  pixelId: text("pixel_id").notNull(),
  label: text("label"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  offerPixelUnique: uniqueIndex("utmify_offer_pixels_offer_platform_pixel_unique").on(table.offerId, table.platform, table.pixelId),
}));

export const paymentOrdersTable = pgTable("payment_orders", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull(),
  gatewayKey: text("gateway_key").notNull().default("freepay"),
  gatewayLabel: text("gateway_label").notNull().default("FreePay"),
  gatewayTransactionId: text("gateway_transaction_id"),
  pixCode: text("pix_code"),
  qrCodeUrl: text("qr_code_url"),
  amountCents: integer("amount_cents").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerDocument: text("customer_document").notNull(),
  pixKey: text("pix_key"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  pixCopied: boolean("pix_copied").notNull().default(false),
  pixCopiedAt: timestamp("pix_copied_at", { withTimezone: true }),
  utm: jsonb("utm").$type<Record<string, string | null>>(),
  offerId: integer("offer_id"),
  offerSlug: text("offer_slug"),
}, (table) => ({
  referenceUnique: uniqueIndex("payment_orders_reference_unique").on(table.reference),
  transactionUnique: uniqueIndex("payment_orders_transaction_unique").on(table.gatewayTransactionId),
}));

export const insertAdminSettingsSchema = createInsertSchema(adminSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAdminGatewayConfigSchema = createInsertSchema(adminGatewayConfigsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUtmifyOfferSchema = createInsertSchema(utmifyOffersTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUtmifyOfferPixelSchema = createInsertSchema(utmifyOfferPixelsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPaymentOrderSchema = createInsertSchema(paymentOrdersTable).omit({ id: true, createdAt: true, approvedAt: true, pixCopiedAt: true });

export type AdminSettings = typeof adminSettingsTable.$inferSelect;
export type AdminGatewayConfig = typeof adminGatewayConfigsTable.$inferSelect;
export type UtmifyOffer = typeof utmifyOffersTable.$inferSelect;
export type UtmifyOfferPixel = typeof utmifyOfferPixelsTable.$inferSelect;
export type PaymentOrder = typeof paymentOrdersTable.$inferSelect;
export type InsertAdminSettings = z.infer<typeof insertAdminSettingsSchema>;
export type InsertAdminGatewayConfig = z.infer<typeof insertAdminGatewayConfigSchema>;
export type InsertUtmifyOffer = z.infer<typeof insertUtmifyOfferSchema>;
export type InsertUtmifyOfferPixel = z.infer<typeof insertUtmifyOfferPixelSchema>;
export type InsertPaymentOrder = z.infer<typeof insertPaymentOrderSchema>;