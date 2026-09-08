import { asc, eq } from "drizzle-orm";
import { db, utmifyOffersTable, utmifyOfferPixelsTable } from "@workspace/db";
import { TRACKING_PLATFORMS } from "./tracking-platforms";
import type { TrackingPlatform } from "./tracking-platforms";

export { TRACKING_PLATFORMS } from "./tracking-platforms";
export type { TrackingPlatform } from "./tracking-platforms";

export type PublicTrackingPixel = {
  platform: TrackingPlatform;
  pixelId: string;
  label: string | null;
};

export type ResolvedUtmifyOffer = {
  id: number | null;
  name: string;
  slug: string | null;
  apiToken: string;
  pixels: PublicTrackingPixel[];
};

function isTrackingPlatform(value: string): value is TrackingPlatform {
  return TRACKING_PLATFORMS.includes(value as TrackingPlatform);
}

export async function getOfferWithPixels(offer: typeof utmifyOffersTable.$inferSelect) {
  const pixels = await db.select({
    platform: utmifyOfferPixelsTable.platform,
    pixelId: utmifyOfferPixelsTable.pixelId,
    label: utmifyOfferPixelsTable.label,
  }).from(utmifyOfferPixelsTable)
    .where(eq(utmifyOfferPixelsTable.offerId, offer.id))
    .orderBy(asc(utmifyOfferPixelsTable.id));

  return {
    offer,
    pixels: pixels.filter((pixel): pixel is PublicTrackingPixel => isTrackingPlatform(pixel.platform)),
  };
}

export async function resolveUtmifyOffer(requestedSlug?: string | null): Promise<ResolvedUtmifyOffer> {
  const normalizedSlug = requestedSlug?.trim().toLowerCase();
  const [offer] = normalizedSlug
    ? await db.select().from(utmifyOffersTable).where(eq(utmifyOffersTable.slug, normalizedSlug)).limit(1)
    : [];

  const selected = offer ?? (await db.select().from(utmifyOffersTable)
    .where(eq(utmifyOffersTable.isActive, true))
    .orderBy(asc(utmifyOffersTable.id))
    .limit(1))[0];

  if (!selected) {
    return {
      id: null,
      name: "Recupera Brasil",
      slug: null,
      apiToken: process.env.UTMIFY_API_TOKEN?.trim() || "",
      pixels: [],
    };
  }

  const resolved = await getOfferWithPixels(selected);
  return {
    id: selected.id,
    name: selected.name,
    slug: selected.slug,
    apiToken: selected.apiToken?.trim() || process.env.UTMIFY_API_TOKEN?.trim() || "",
    pixels: resolved.pixels,
  };
}

export async function getPublicTrackingConfig(requestedSlug?: string | null) {
  const offer = await resolveUtmifyOffer(requestedSlug);
  return {
    offer: {
      id: offer.id,
      name: offer.name,
      slug: offer.slug,
    },
    pixels: offer.pixels,
  };
}