import { asc, eq } from "drizzle-orm";
import { adminSettingsTable, db, trackingPixelsTable, utmifyOfferPixelsTable, utmifyOffersTable } from "@workspace/db";
import { resolveUtmifyOffer } from "./utmify-offers";
import { TRACKING_PLATFORMS, type TrackingPlatform } from "./tracking-platforms";

export { TRACKING_PLATFORMS } from "./tracking-platforms";
export type { TrackingPlatform } from "./tracking-platforms";

export type PublicTrackingPixel = {
  platform: TrackingPlatform;
  pixelId: string;
  code: string | null;
  label: string | null;
};

function isTrackingPlatform(value: string): value is TrackingPlatform {
  return TRACKING_PLATFORMS.includes(value as TrackingPlatform);
}

function publicPixel(pixel: typeof trackingPixelsTable.$inferSelect): PublicTrackingPixel | null {
  if (!isTrackingPlatform(pixel.platform) || !pixel.isActive) return null;
  return {
    platform: pixel.platform,
    pixelId: pixel.pixelId,
    code: pixel.code,
    label: pixel.label,
  };
}

export async function getGlobalTrackingPixels() {
  const pixels = await ensureGlobalTrackingPixels();
  return pixels.map(publicPixel).filter((pixel): pixel is PublicTrackingPixel => Boolean(pixel));
}

async function ensureGlobalTrackingPixels() {
  const current = await db.select().from(trackingPixelsTable)
    .where(eq(trackingPixelsTable.isActive, true))
    .orderBy(asc(trackingPixelsTable.id));
  if (current.length) return current;
  const [settings] = await db.select({ migrated: adminSettingsTable.trackingPixelsMigrated })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.id, 1))
    .limit(1);
  if (settings?.migrated) return current;

  const [legacyOffer] = await db.select().from(utmifyOffersTable)
    .where(eq(utmifyOffersTable.isActive, true))
    .orderBy(asc(utmifyOffersTable.id))
    .limit(1);
  if (!legacyOffer) return current;

  const legacyPixels = await db.select().from(utmifyOfferPixelsTable)
    .where(eq(utmifyOfferPixelsTable.offerId, legacyOffer.id))
    .orderBy(asc(utmifyOfferPixelsTable.id));
  const values = legacyPixels
    .filter((pixel) => isTrackingPlatform(pixel.platform))
    .map((pixel) => ({
      platform: pixel.platform,
      pixelId: pixel.pixelId,
      code: null,
      token: pixel.platform === "utmify" ? legacyOffer.apiToken : null,
      label: pixel.label,
      isActive: pixel.isActive,
    }));
  if (values.length) {
    await db.insert(trackingPixelsTable).values(values).onConflictDoNothing();
  }
  await db.update(adminSettingsTable).set({ trackingPixelsMigrated: true }).where(eq(adminSettingsTable.id, 1));
  return db.select().from(trackingPixelsTable)
    .where(eq(trackingPixelsTable.isActive, true))
    .orderBy(asc(trackingPixelsTable.id));
}

export async function getPublicTrackingConfig(requestedSlug?: string | null) {
  const globalPixels = await getGlobalTrackingPixels();
  if (globalPixels.length) return { pixels: globalPixels };

  // Keep existing campaigns working until the administrator saves the new global list.
  const legacy = await resolveUtmifyOffer(requestedSlug);
  return {
    pixels: legacy.pixels.map((pixel) => ({
      platform: pixel.platform,
      pixelId: pixel.pixelId,
      code: null,
      label: pixel.label,
    })),
  };
}

export async function getConfiguredUtmifyTokens(tokenOverride?: string) {
  const configured = await db.select({ token: trackingPixelsTable.token })
    .from(trackingPixelsTable)
    .where(eq(trackingPixelsTable.platform, "utmify"));
  const legacyToken = configured.length ? null : (await resolveUtmifyOffer()).apiToken;
  const tokens = [
    tokenOverride?.trim(),
    ...configured.map((pixel) => pixel.token?.trim()),
    legacyToken,
    process.env.UTMIFY_API_TOKEN?.trim(),
  ].filter((token): token is string => Boolean(token));
  return Array.from(new Set(tokens));
}

export async function getAdminTrackingPixels() {
  return ensureGlobalTrackingPixels();
}