type TikTokQueue = Array<unknown> & {
  methods?: string[];
  setAndDefer?: (target: TikTokQueue, method: string) => void;
  instance?: (instanceId: string) => TikTokQueue;
  load?: (pixelId: string, options?: Record<string, unknown>) => void;
  page?: () => void;
  track?: (event: string, properties?: Record<string, unknown>) => void;
  _i?: Record<string, unknown>;
  _t?: Record<string, number>;
  _o?: Record<string, unknown>;
  [key: string]: unknown;
};

const pixelId = import.meta.env.VITE_TIKTOK_PIXEL_ID?.trim();
let initialized = false;

export function initTikTokPixels(configuredPixelIds: string[] = []) {
  if (initialized || typeof window === 'undefined') return;
  const pixelIds = Array.from(new Set([pixelId, ...configuredPixelIds].filter(Boolean))) as string[];
  if (!pixelIds.length) return;

  initialized = true;
  const globalWindow = window as Window & {
    TiktokAnalyticsObject?: string;
    ttq?: TikTokQueue;
  };
  globalWindow.TiktokAnalyticsObject = 'ttq';

  const ttq: TikTokQueue = globalWindow.ttq ?? (globalWindow.ttq = [] as unknown as TikTokQueue);
  ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie'];
  ttq.setAndDefer = (target, method) => {
    target[method] = (...args: unknown[]) => target.push([method, ...args]);
  };

  for (const method of ttq.methods) {
    ttq.setAndDefer(ttq, method);
  }

  ttq.instance = (instanceId) => {
    const instance: TikTokQueue = globalWindow.ttq ?? (globalWindow.ttq = [] as unknown as TikTokQueue);
    instance._i = instance._i ?? {};
    instance._i[instanceId] = [];
    return instance;
  };

  ttq.load = (id, options = {}) => {
    const scriptUrl = 'https://analytics.tiktok.com/i18n/pixel/events.js';
    ttq._i = ttq._i ?? {};
    ttq._i[id] = [];
    ttq._t = ttq._t ?? {};
    ttq._t[id] = Date.now();
    ttq._o = ttq._o ?? {};
    ttq._o[id] = options;

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src = `${scriptUrl}?sdkid=${encodeURIComponent(id)}&lib=ttq`;
    document.head.appendChild(script);
  };

  pixelIds.forEach((id) => ttq.load?.(id));
  ttq.page?.();
}

export function initTikTokPixel() {
  initTikTokPixels();
}

export function trackTikTokEvent(event: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  const globalWindow = window as Window & { ttq?: TikTokQueue };
  globalWindow.ttq?.track?.(event, properties);
}