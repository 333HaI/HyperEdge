import {
  type HyperliquidCategory,
  type HyperliquidMarketsResponse,
} from "./hyperliquid.ts";
import { getHyperliquidMarketsSnapshot } from "./hyperliquidCache.ts";

const LIGHTER_BASE_URL = "https://mainnet.zklighter.elliot.ai";
const VARIATIONAL_BASE_URL =
  "https://omni-client-api.prod.ap-northeast-1.variational.io";

export type VenueFamily = "Hyperliquid" | "Lighter" | "Variational";

export interface VenueMarketSnapshot {
  id: string;
  venue: string;
  venueFamily: VenueFamily;
  venueMarketId: string;
  symbol: string;
  category: HyperliquidCategory;
  markPx: number;
  indexPx: number | null;
  basisBps: number | null;
  change24hPct: number | null;
  dayVolumeUsd: number;
  openInterestUsd: number;
  openInterestConvention: string;
  fundingRatePct: number | null;
  fundingPeriod: string;
  fundingAnnualPct: number | null;
  executionBps: number | null;
  executionLabel: string;
  quoteUpdatedAt: string | null;
  sourceUrl: string;
}

export type VenueComparisonState =
  | "FUNDING_DIVERGENCE"
  | "POSITIVE_FUNDING"
  | "NEGATIVE_FUNDING"
  | "MIXED";

export interface VenueComparison {
  symbol: string;
  category: HyperliquidCategory;
  venueCount: number;
  venues: string[];
  state: VenueComparisonState;
  stateLabel: string;
  markDispersionBps: number | null;
  totalDayVolumeUsd: number;
  totalOpenInterestUsd: number;
  positiveFundingVenues: number;
  negativeFundingVenues: number;
  markets: VenueMarketSnapshot[];
}

export interface VenueSourceStatus {
  venue: VenueFamily;
  ok: boolean;
  stale: boolean;
  markets: number;
  message: string;
}

export interface VenueIntelligenceResponse {
  fetchedAt: string;
  summary: {
    venueFamilies: number;
    venues: number;
    markets: number;
    overlaps: number;
    dayVolumeUsd: number;
    openInterestUsd: number;
  };
  sources: VenueSourceStatus[];
  comparisons: VenueComparison[];
  markets: VenueMarketSnapshot[];
}

interface LighterMarket {
  symbol: string;
  market_id: number;
  market_type: string;
  status: string;
  mark_price: string;
  index_price: string;
  open_interest: number | string;
  daily_quote_token_volume: number;
  daily_price_change: number;
  market_config?: {
    hidden?: boolean;
  };
}

interface LighterMarketResponse {
  code: number;
  order_book_details: LighterMarket[];
}

interface LighterFundingRate {
  market_id: number;
  exchange: string;
  symbol: string;
  rate: number;
}

interface LighterFundingResponse {
  code: number;
  funding_rates: LighterFundingRate[];
}

interface VariationalQuote {
  bid: string;
  ask: string;
}

interface VariationalListing {
  ticker: string;
  name: string;
  mark_price: string;
  volume_24h: string;
  open_interest: {
    long_open_interest: string;
    short_open_interest: string;
  };
  funding_rate: string;
  funding_interval_s: number;
  base_spread_bps?: string;
  quotes?: {
    updated_at?: string;
    base?: VariationalQuote;
    size_1k?: VariationalQuote;
    size_100k?: VariationalQuote;
    size_1m?: VariationalQuote;
  };
}

interface VariationalStatsResponse {
  total_volume_24h: string;
  open_interest: string;
  num_markets: number;
  listings: VariationalListing[];
}

function numeric(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedSymbol(value: string): string {
  const withoutVenue = value.includes(":") ? value.split(":").at(-1)! : value;
  return withoutVenue
    .toUpperCase()
    .replace(/\/USDC$/, "")
    .replace(/-PERP$/, "")
    .replace(/-USD$/, "");
}

const STOCKS = new Set([
  "AAPL",
  "AMD",
  "AMZN",
  "ASML",
  "BABA",
  "COIN",
  "GOOGL",
  "HOOD",
  "INTC",
  "META",
  "MSFT",
  "MSTR",
  "MU",
  "NFLX",
  "NVDA",
  "ORCL",
  "PLTR",
  "SNDK",
  "TSLA",
]);
const COMMODITIES = new Set([
  "NATGAS",
  "WTI",
  "XAG",
  "XAU",
  "XCU",
  "XPD",
  "XPT",
]);
const INDICES = new Set([
  "DIA",
  "IWM",
  "MAGS",
  "NAS100",
  "QQQ",
  "SPY",
  "US500",
]);
const FX = new Set([
  "AUDUSD",
  "EURUSD",
  "GBPUSD",
  "NZDUSD",
  "USDCAD",
  "USDCHF",
  "USDJPY",
]);

function inferCategory(symbol: string): HyperliquidCategory {
  if (STOCKS.has(symbol)) return "Stocks";
  if (COMMODITIES.has(symbol)) return "Commodities";
  if (INDICES.has(symbol)) return "Indices";
  if (FX.has(symbol)) return "FX";
  return "Crypto";
}

const MAX_COMPARABLE_MARK_RATIO = 1.05;

function priceCompatibleClusters(
  markets: VenueMarketSnapshot[],
): VenueMarketSnapshot[][] {
  const sorted = [...markets]
    .filter((market) => market.markPx > 0)
    .sort((left, right) => left.markPx - right.markPx);
  const clusters: VenueMarketSnapshot[][] = [];

  for (const market of sorted) {
    const cluster = clusters.find((candidate) => {
      const minimum = candidate[0].markPx;
      const maximum = candidate.at(-1)!.markPx;
      return (
        Math.max(maximum, market.markPx) /
          Math.min(minimum, market.markPx) <=
        MAX_COMPARABLE_MARK_RATIO
      );
    });
    if (cluster) cluster.push(market);
    else clusters.push([market]);
  }

  return clusters;
}

function preferredCategory(
  markets: VenueMarketSnapshot[],
): HyperliquidCategory {
  const authoritative = markets.find(
    (market) =>
      market.venueFamily === "Hyperliquid" && market.category !== "Other",
  );
  if (authoritative) return authoritative.category;

  const counts = new Map<HyperliquidCategory, number>();
  for (const market of markets) {
    counts.set(market.category, (counts.get(market.category) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    (left, right) =>
      right[1] - left[1] ||
      Number(left[0] === "Other") - Number(right[0] === "Other"),
  )[0]?.[0] ?? "Other";
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

export function normalizeHyperliquidMarkets(
  payload: HyperliquidMarketsResponse,
): VenueMarketSnapshot[] {
  return payload.rows
    .filter((market) => !market.isDelisted && market.markPx > 0)
    .map((market) => ({
      id: `hyperliquid:${market.dex || "core"}:${market.coin}`,
      venue: market.dexName,
      venueFamily: "Hyperliquid",
      venueMarketId: market.coin,
      symbol: normalizedSymbol(market.symbol),
      category: market.category,
      markPx: market.markPx,
      indexPx: market.oraclePx > 0 ? market.oraclePx : null,
      basisBps: market.oraclePx > 0 ? market.basisBps : null,
      change24hPct: market.change24hPct,
      dayVolumeUsd: market.dayVolumeUsd,
      openInterestUsd: market.openInterestUsd,
      openInterestConvention: "Base OI x mark",
      fundingRatePct: market.fundingHourlyPct,
      fundingPeriod: "1h",
      fundingAnnualPct: market.fundingAnnualPct,
      executionBps: market.impactSpreadBps,
      executionLabel: "Impact prices",
      quoteUpdatedAt: payload.source.fetchedAt,
      sourceUrl: "https://api.hyperliquid.xyz/info",
    }));
}

export function normalizeLighterMarkets(
  details: LighterMarketResponse,
  funding: LighterFundingResponse,
): VenueMarketSnapshot[] {
  const fundingByMarket = new Map(
    funding.funding_rates
      .filter((rate) => rate.exchange.toLowerCase() === "lighter")
      .map((rate) => [rate.market_id, rate.rate]),
  );
  return details.order_book_details
    .filter(
      (market) =>
        market.market_type === "perp" &&
        market.status === "active" &&
        market.market_config?.hidden !== true,
    )
    .map((market) => {
      const symbol = normalizedSymbol(market.symbol);
      const markPx = numeric(market.mark_price);
      const indexPx = numeric(market.index_price);
      const fundingRate = fundingByMarket.get(market.market_id) ?? null;
      return {
        id: `lighter:${market.market_id}`,
        venue: "Lighter",
        venueFamily: "Lighter" as const,
        venueMarketId: String(market.market_id),
        symbol,
        category: inferCategory(symbol),
        markPx,
        indexPx: indexPx > 0 ? indexPx : null,
        basisBps:
          markPx > 0 && indexPx > 0
            ? ((markPx - indexPx) / indexPx) * 10_000
            : null,
        change24hPct: numeric(market.daily_price_change),
        dayVolumeUsd: numeric(market.daily_quote_token_volume),
        openInterestUsd: numeric(market.open_interest) * markPx,
        openInterestConvention: "Base OI x mark",
        fundingRatePct:
          fundingRate === null ? null : fundingRate * 100,
        fundingPeriod: "1h",
        fundingAnnualPct:
          fundingRate === null ? null : fundingRate * 24 * 365 * 100,
        executionBps: null,
        executionLabel: "Unavailable",
        quoteUpdatedAt: null,
        sourceUrl: `${LIGHTER_BASE_URL}/api/v1/orderBookDetails`,
      };
    });
}

function quoteSpreadBps(quote: VariationalQuote | undefined): number | null {
  if (!quote) return null;
  const bid = numeric(quote.bid);
  const ask = numeric(quote.ask);
  const mid = (bid + ask) / 2;
  return bid > 0 && ask >= bid && mid > 0
    ? ((ask - bid) / mid) * 10_000
    : null;
}

export function normalizeVariationalMarkets(
  payload: VariationalStatsResponse,
): VenueMarketSnapshot[] {
  return payload.listings
    .map((listing) => {
      const symbol = normalizedSymbol(listing.ticker);
      const quote = listing.quotes?.size_100k ?? listing.quotes?.size_1k;
      const quoteSize = listing.quotes?.size_100k ? "$100K quote" : "$1K quote";
      const intervalHours = Math.max(1, listing.funding_interval_s / 3_600);
      return {
        id: `variational:${symbol}`,
        venue: "Variational",
        venueFamily: "Variational" as const,
        venueMarketId: listing.ticker,
        symbol,
        category: inferCategory(symbol),
        markPx: numeric(listing.mark_price),
        indexPx: null,
        basisBps: null,
        change24hPct: null,
        dayVolumeUsd: numeric(listing.volume_24h),
        openInterestUsd:
          numeric(listing.open_interest.long_open_interest) +
          numeric(listing.open_interest.short_open_interest),
        openInterestConvention: "Long + short reported OI",
        fundingRatePct: numeric(listing.funding_rate) * 100,
        fundingPeriod: `${intervalHours.toFixed(0)}h reported`,
        fundingAnnualPct: null,
        executionBps: quoteSpreadBps(quote),
        executionLabel: quote ? quoteSize : "Unavailable",
        quoteUpdatedAt: listing.quotes?.updated_at ?? null,
        sourceUrl: `${VARIATIONAL_BASE_URL}/metadata/stats`,
      };
    })
    .filter((market) => market.markPx > 0);
}

function comparisonState(markets: VenueMarketSnapshot[]): {
  state: VenueComparisonState;
  label: string;
  positive: number;
  negative: number;
} {
  const funding = markets
    .map((market) => market.fundingRatePct)
    .filter((value): value is number => value !== null && value !== 0);
  const positive = funding.filter((value) => value > 0).length;
  const negative = funding.filter((value) => value < 0).length;
  if (positive > 0 && negative > 0) {
    return {
      state: "FUNDING_DIVERGENCE",
      label: "Funding disagreement",
      positive,
      negative,
    };
  }
  if (positive >= 2) {
    return {
      state: "POSITIVE_FUNDING",
      label: "Longs pay across venues",
      positive,
      negative,
    };
  }
  if (negative >= 2) {
    return {
      state: "NEGATIVE_FUNDING",
      label: "Shorts pay across venues",
      positive,
      negative,
    };
  }
  return { state: "MIXED", label: "Limited agreement", positive, negative };
}

export function buildVenueComparisons(
  markets: VenueMarketSnapshot[],
): VenueComparison[] {
  const bySymbol = new Map<string, VenueMarketSnapshot[]>();
  for (const market of markets) {
    bySymbol.set(market.symbol, [...(bySymbol.get(market.symbol) ?? []), market]);
  }

  return [...bySymbol.entries()]
    .map(([symbol, values]) => {
      const candidates = priceCompatibleClusters(values)
        .map((cluster) => {
          const byVenue = new Map<string, VenueMarketSnapshot>();
          for (const market of cluster) {
            const current = byVenue.get(market.venue);
            if (!current || market.dayVolumeUsd > current.dayVolumeUsd) {
              byVenue.set(market.venue, market);
            }
          }
          return [...byVenue.values()];
        })
        .filter((cluster) => cluster.length >= 2)
        .sort(
          (left, right) =>
            right.length - left.length ||
            right.reduce((sum, market) => sum + market.dayVolumeUsd, 0) -
              left.reduce((sum, market) => sum + market.dayVolumeUsd, 0),
        );
      const deduplicated = candidates[0];
      if (!deduplicated) return null;
      const marks = deduplicated
        .map((market) => market.markPx)
        .filter((value) => value > 0)
        .sort((left, right) => left - right);
      const midpoint =
        marks.length > 0 ? marks.reduce((sum, value) => sum + value, 0) / marks.length : 0;
      const state = comparisonState(deduplicated);
      return {
        symbol,
        category: preferredCategory(deduplicated),
        venueCount: deduplicated.length,
        venues: deduplicated.map((market) => market.venue),
        state: state.state,
        stateLabel: state.label,
        markDispersionBps:
          marks.length >= 2 && midpoint > 0
            ? ((marks.at(-1)! - marks[0]) / midpoint) * 10_000
            : null,
        totalDayVolumeUsd: deduplicated.reduce(
          (sum, market) => sum + market.dayVolumeUsd,
          0,
        ),
        totalOpenInterestUsd: deduplicated.reduce(
          (sum, market) => sum + market.openInterestUsd,
          0,
        ),
        positiveFundingVenues: state.positive,
        negativeFundingVenues: state.negative,
        markets: deduplicated.sort(
          (left, right) => right.dayVolumeUsd - left.dayVolumeUsd,
        ),
      } satisfies VenueComparison;
    })
    .filter((value): value is VenueComparison => value !== null)
    .sort(
      (left, right) =>
        Number(right.state === "FUNDING_DIVERGENCE") -
          Number(left.state === "FUNDING_DIVERGENCE") ||
        right.venueCount - left.venueCount ||
        right.totalDayVolumeUsd - left.totalDayVolumeUsd,
    );
}

async function fetchLighterMarkets(): Promise<VenueMarketSnapshot[]> {
  const [details, funding] = await Promise.all([
    fetchJson<LighterMarketResponse>(
      `${LIGHTER_BASE_URL}/api/v1/orderBookDetails`,
    ),
    fetchJson<LighterFundingResponse>(
      `${LIGHTER_BASE_URL}/api/v1/funding-rates`,
    ),
  ]);
  return normalizeLighterMarkets(details, funding);
}

async function fetchVariationalMarkets(): Promise<VenueMarketSnapshot[]> {
  const payload = await fetchJson<VariationalStatsResponse>(
    `${VARIATIONAL_BASE_URL}/metadata/stats`,
  );
  return normalizeVariationalMarkets(payload);
}

interface VenueFetchResult {
  markets: VenueMarketSnapshot[];
  stale: boolean;
  message: string;
}

export async function fetchVenueIntelligence(): Promise<VenueIntelligenceResponse> {
  const results = await Promise.allSettled<VenueFetchResult>([
    getHyperliquidMarketsSnapshot().then((payload) => ({
      markets: normalizeHyperliquidMarkets(payload),
      stale: payload.source.status === "STALE",
      message:
        payload.source.status === "STALE"
          ? `Cached from ${payload.source.fetchedAt}`
          : "Live",
    })),
    fetchLighterMarkets().then((markets) => ({
      markets,
      stale: false,
      message: "Live",
    })),
    fetchVariationalMarkets().then((markets) => ({
      markets,
      stale: false,
      message: "Live",
    })),
  ]);
  const families: VenueFamily[] = ["Hyperliquid", "Lighter", "Variational"];
  const sources = results.map((result, index) => ({
    venue: families[index],
    ok: result.status === "fulfilled",
    stale: result.status === "fulfilled" && result.value.stale,
    markets: result.status === "fulfilled" ? result.value.markets.length : 0,
    message:
      result.status === "fulfilled"
        ? result.value.message
        : result.reason instanceof Error
          ? result.reason.message
          : "Unavailable",
  }));
  const markets = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value.markets : [],
  );
  if (markets.length === 0) {
    throw new Error("Every venue data source is currently unavailable.");
  }
  const comparisons = buildVenueComparisons(markets);
  return {
    fetchedAt: new Date().toISOString(),
    summary: {
      venueFamilies: sources.filter((source) => source.ok).length,
      venues: new Set(markets.map((market) => market.venue)).size,
      markets: markets.length,
      overlaps: comparisons.length,
      dayVolumeUsd: markets.reduce(
        (sum, market) => sum + market.dayVolumeUsd,
        0,
      ),
      openInterestUsd: markets.reduce(
        (sum, market) => sum + market.openInterestUsd,
        0,
      ),
    },
    sources,
    comparisons,
    markets: markets.sort(
      (left, right) => right.dayVolumeUsd - left.dayVolumeUsd,
    ),
  };
}
