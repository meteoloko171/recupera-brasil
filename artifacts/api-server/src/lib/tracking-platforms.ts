export const TRACKING_PLATFORMS = ["utmify", "meta", "tiktok"] as const;
export type TrackingPlatform = typeof TRACKING_PLATFORMS[number];