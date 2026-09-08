import { createInsertSchema } from "drizzle-zod";
import { boolean, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const trackingPixelsTable = pgTable("tracking_pixels", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull(),
  pixelId: text("pixel_id").notNull(),
  code: text("code"),
  token: text("token"),
  label: text("label"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  platformPixelUnique: uniqueIndex("tracking_pixels_platform_pixel_id_unique").on(table.platform, table.pixelId),
}));

export const insertTrackingPixelSchema = createInsertSchema(trackingPixelsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });

export type TrackingPixel = typeof trackingPixelsTable.$inferSelect;
export type InsertTrackingPixel = z.infer<typeof insertTrackingPixelSchema>;