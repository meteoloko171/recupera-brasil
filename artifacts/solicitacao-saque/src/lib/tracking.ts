import { initTikTokPixels } from "./tiktok-pixel";

export type TrackingPixel = {
  platform: "utmify" | "meta" | "tiktok";
  pixelId: string;
  code?: string | null;
  label?: string | null;
};

type MetaFunction = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue?: unknown[]; loaded?: boolean; version?: string; push?: (...args: unknown[]) => void };

declare global {
  interface Window {
    fbq?: MetaFunction;
    _fbq?: MetaFunction;
    pixelId?: string;
  }
}

const legacyUtmifyPixel = "6a94ff4ca604a88c292d9186";
let metaInitialized = false;
const loadedUtmifyPixels = new Set<string>();
const loadedTrackingCodes = new Set<string>();

export function getTrackingParameters() {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const result: Record<string, string> = {};
  for (const key of ["src", "sck", "utm_source", "utm_campaign", "utm_medium", "utm_content", "utm_term"]) {
    const value = params.get(key)?.trim();
    if (value) result[key] = value.slice(0, 200);
  }
  return result;
}

function initMetaPixels(pixelIds: string[]) {
  if (typeof window === "undefined" || !pixelIds.length) return;
  const globalWindow = window;
  if (!globalWindow.fbq) {
    const fbq = ((...args: unknown[]) => {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue?.push(args);
    }) as MetaFunction;
    fbq.push = (...args: unknown[]) => fbq.queue?.push(args);
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.queue = [];
    globalWindow.fbq = fbq;
    globalWindow._fbq = fbq;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }
  pixelIds.forEach((id) => globalWindow.fbq?.("init", id));
  if (!metaInitialized) {
    globalWindow.fbq?.("track", "PageView");
    metaInitialized = true;
  }
}

async function loadUtmifyPixel(pixelId: string) {
  if (typeof window === "undefined" || loadedUtmifyPixels.has(pixelId)) return;
  loadedUtmifyPixels.add(pixelId);
  window.pixelId = pixelId;
  await new Promise<void>((resolve) => {
    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.src = "https://cdn.utmify.com.br/scripts/pixel/pixel.js";
    script.onload = () => resolve();
    script.onerror = () => resolve();
    (document.head || document.documentElement).appendChild(script);
  });
}

async function loadTrackingCode(code: string) {
  if (typeof window === "undefined" || !code.trim() || loadedTrackingCodes.has(code)) return;
  loadedTrackingCodes.add(code);
  const documentFragment = new DOMParser().parseFromString(code, "text/html");
  const scriptNodes = Array.from(documentFragment.querySelectorAll("script"));
  if (!scriptNodes.length) {
    const script = document.createElement("script");
    script.textContent = code;
    document.head.appendChild(script);
    return;
  }
  for (const source of scriptNodes) {
    const script = document.createElement("script");
    script.async = true;
    if (source.src) {
      script.src = source.src;
      await new Promise<void>((resolve) => {
        script.onload = () => resolve();
        script.onerror = () => resolve();
        document.head.appendChild(script);
      });
    } else {
      script.textContent = source.textContent || "";
      document.head.appendChild(script);
    }
  }
}

export async function loadTrackingPixels() {
  if (typeof window === "undefined") return;
  const response = await fetch("/api/tracking-config", {
    headers: { accept: "application/json" },
  }).catch(() => null);
  const payload = response?.ok ? await response.json().catch(() => null) : null;
  const pixels = Array.isArray(payload?.pixels) ? payload.pixels as TrackingPixel[] : [];
  const validPixels = pixels.filter((pixel) => pixel?.pixelId && ["utmify", "meta", "tiktok"].includes(pixel.platform));
  const utmifyPixels = validPixels.filter((pixel) => pixel.platform === "utmify").map((pixel) => pixel.pixelId);
  if (!utmifyPixels.length) utmifyPixels.push(legacyUtmifyPixel);
  for (const pixelId of Array.from(new Set(utmifyPixels))) await loadUtmifyPixel(pixelId);
  initMetaPixels(Array.from(new Set(validPixels.filter((pixel) => pixel.platform === "meta").map((pixel) => pixel.pixelId))));
  initTikTokPixels(Array.from(new Set(validPixels.filter((pixel) => pixel.platform === "tiktok").map((pixel) => pixel.pixelId))));
  for (const code of validPixels.map((pixel) => pixel.code).filter((code): code is string => Boolean(code?.trim()))) {
    await loadTrackingCode(code);
  }
}

export const loadOfferTracking = loadTrackingPixels;

export function trackMetaEvent(event: string, properties?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.fbq?.("track", event, properties);
}