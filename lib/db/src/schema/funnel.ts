import { boolean, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const funnelEventsTable = pgTable("funnel_events", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  eventName: text("event_name").notNull(),
  stage: text("stage"),
  offerSlug: text("offer_slug"),
  properties: jsonb("properties").$type<Record<string, string | number | boolean>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sessionEventStageIndex: uniqueIndex("funnel_events_session_event_stage_unique").on(table.sessionId, table.eventName, table.stage),
}));

export const insertFunnelEventSchema = createInsertSchema(funnelEventsTable).omit({ id: true, createdAt: true });
export type FunnelEvent = typeof funnelEventsTable.$inferSelect;
export type InsertFunnelEvent = typeof funnelEventsTable.$inferInsert;