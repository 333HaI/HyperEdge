import { NextResponse } from "next/server";
import {
  fetchHyperliquidMarkets,
  type HyperliquidMarketsResponse,
} from "../../../lib/hyperliquid";

export const dynamic = "force-dynamic";

const CACHE_MS = 15_000;

interface MarketsCache {
  value: HyperliquidMarketsResponse | null;
  expiresAt: number;
  pending: Promise<HyperliquidMarketsResponse> | null;
}

const runtime = globalThis as typeof globalThis & {
  __hyperedgeMarketsCache?: MarketsCache;
};
const cache = (runtime.__hyperedgeMarketsCache ??= {
  value: null,
  expiresAt: 0,
  pending: null,
});

async function marketsSnapshot(): Promise<HyperliquidMarketsResponse> {
  if (cache.value && Date.now() < cache.expiresAt) return cache.value;
  if (cache.pending) return cache.pending;

  cache.pending = fetchHyperliquidMarkets()
    .then((value) => {
      cache.value = value;
      cache.expiresAt = Date.now() + CACHE_MS;
      return value;
    })
    .finally(() => {
      cache.pending = null;
    });

  return cache.pending;
}

export async function GET() {
  try {
    const result = await marketsSnapshot();
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=15",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Hyperliquid market data could not be loaded.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
