import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, trackingPixelsTable } from "@workspace/db";

type TrackingEventInput = {
  eventName: "InitiateCheckout" | "Purchase";
  eventId: string;
  email: string;
  phone: string;
  cpf: string;
  amountCents: number;
  sourceUrl?: string;
};

const sentEvents = new Set<string>();

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizedPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? (digits.startsWith("55") ? digits : `55${digits}`) : "";
}

function normalizedCpf(value: string) {
  return value.replace(/\D/g, "");
}

async function sendMetaEvent(pixelId: string, token: string, input: TrackingEventInput) {
  const response = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      data: [{
        event_name: input.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.eventId,
        action_source: "website",
        event_source_url: input.sourceUrl,
        user_data: {
          em: [sha256(normalizedEmail(input.email))],
          ph: [sha256(normalizedPhone(input.phone))],
          external_id: [sha256(normalizedCpf(input.cpf))],
        },
        custom_data: {
          currency: "BRL",
          value: input.amountCents / 100,
        },
      }],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Meta rejected ${input.eventName} with HTTP ${response.status}.`);
}

async function sendTikTokEvent(pixelId: string, token: string, input: TrackingEventInput) {
  const response = await fetch("https://business-api.tiktok.com/open_api/v1.3/event/track/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Access-Token": token,
    },
    body: JSON.stringify({
      event_source: "web",
      event_source_id: pixelId,
      data: [{
        event: input.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.eventId,
        user: {
          email: sha256(normalizedEmail(input.email)),
          phone_number: sha256(normalizedPhone(input.phone)),
          external_id: sha256(normalizedCpf(input.cpf)),
        },
        page: input.sourceUrl ? { url: input.sourceUrl } : undefined,
        properties: {
          currency: "BRL",
          value: input.amountCents / 100,
        },
      }],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`TikTok rejected ${input.eventName} with HTTP ${response.status}.`);
}

export async function sendConfiguredTrackingEvent(input: TrackingEventInput) {
  const eventKey = `${input.eventName}:${input.eventId}`;
  if (sentEvents.has(eventKey)) return { attempted: 0, sent: 0, skipped: true };
  sentEvents.add(eventKey);

  const configured = await db.select({
    platform: trackingPixelsTable.platform,
    pixelId: trackingPixelsTable.pixelId,
    token: trackingPixelsTable.token,
  }).from(trackingPixelsTable).where(eq(trackingPixelsTable.isActive, true));
  const deliveries = configured
    .filter((pixel) => (pixel.platform === "meta" || pixel.platform === "tiktok") && pixel.token)
    .map((pixel) => pixel.platform === "meta"
      ? sendMetaEvent(pixel.pixelId, pixel.token!, input)
      : sendTikTokEvent(pixel.pixelId, pixel.token!, input));
  const results = await Promise.allSettled(deliveries);
  return {
    attempted: deliveries.length,
    sent: results.filter((result) => result.status === "fulfilled").length,
    skipped: false,
  };
}