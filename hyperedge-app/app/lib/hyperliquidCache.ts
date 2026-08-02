import {
  fetchHyperliquidMarkets,
  isHyperliquidRateLimitError,
  type HyperliquidMarketsResponse,
} from "./hyperliquid.ts";

const FRESH_MS = 60_000;
const STALE_MS = 30 * 60_000;
const ERROR_BACKOFF_MS = 15_000;
const MAX_BACKOFF_MS = 5 * 60_000;

interface MarketsCache {
  value: HyperliquidMarketsResponse | null;
  freshUntil: number;
  staleUntil: number;
  retryAt: number;
  failures: number;
  lastError: string | null;
  pending: Promise<HyperliquidMarketsResponse> | null;
}

const runtime = globalThis as typeof globalThis & {
  __hyperedgeSharedMarketsCache?: MarketsCache;
};

const cache = (runtime.__hyperedgeSharedMarketsCache ??= {
  value: null,
  freshUntil: 0,
  staleUntil: 0,
  retryAt: 0,
  failures: 0,
  lastError: null,
  pending: null,
});

function snapshot(
  value: HyperliquidMarketsResponse,
  status: "LIVE" | "STALE",
): HyperliquidMarketsResponse {
  return {
    ...value,
    source: {
      ...value.source,
      status,
      notice:
        status === "STALE"
          ? cache.lastError ?? "Hyperliquid refresh is temporarily unavailable."
          : null,
      nextRetryAt:
        status === "STALE" && cache.retryAt > Date.now()
          ? new Date(cache.retryAt).toISOString()
          : null,
    },
  };
}

function staleSnapshot(): HyperliquidMarketsResponse | null {
  if (!cache.value || Date.now() >= cache.staleUntil) return null;
  return snapshot(cache.value, "STALE");
}

function backoffMs(error: unknown): number {
  if (isHyperliquidRateLimitError(error)) {
    return Math.max(0, error.retryAt - Date.now());
  }
  return Math.min(
    MAX_BACKOFF_MS,
    ERROR_BACKOFF_MS * 2 ** Math.max(0, cache.failures - 1),
  );
}

export async function getHyperliquidMarketsSnapshot(): Promise<HyperliquidMarketsResponse> {
  const now = Date.now();
  if (cache.value && now < cache.freshUntil) {
    return snapshot(cache.value, "LIVE");
  }
  if (cache.pending) return cache.pending;
  if (now < cache.retryAt) {
    const stale = staleSnapshot();
    if (stale) return stale;
    throw new Error(
      `Hyperliquid refresh is cooling down until ${new Date(cache.retryAt).toISOString()}.`,
    );
  }

  cache.pending = fetchHyperliquidMarkets()
    .then((value) => {
      const completedAt = Date.now();
      cache.value = value;
      cache.freshUntil = completedAt + FRESH_MS;
      cache.staleUntil = completedAt + STALE_MS;
      cache.retryAt = 0;
      cache.failures = 0;
      cache.lastError = null;
      return snapshot(value, "LIVE");
    })
    .catch((error: unknown) => {
      cache.failures += 1;
      cache.lastError =
        error instanceof Error
          ? error.message
          : "Hyperliquid market refresh failed.";
      cache.retryAt = Date.now() + backoffMs(error);
      const stale = staleSnapshot();
      if (stale) return stale;
      throw error;
    })
    .finally(() => {
      cache.pending = null;
    });

  return cache.pending;
}
