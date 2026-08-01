import {
  buildEmpiricalAlphaModel,
  type EmpiricalAlphaModel,
} from "./alphaModel.ts";

const INFO_URL = "https://api.hyperliquid.xyz/info";
const HOUR_MS = 60 * 60 * 1000;

export type HyperliquidCategory =
  | "Crypto"
  | "Stocks"
  | "Commodities"
  | "Indices"
  | "FX"
  | "Other";

export type HyperliquidSignal =
  | "ALPHA_SHORT"
  | "ALPHA_LONG"
  | "CARRY_SHORT"
  | "CARRY_LONG"
  | "MOMENTUM_LONG"
  | "MOMENTUM_SHORT"
  | "WATCH"
  | "AVOID";

interface PerpDexDefinition {
  name: string;
  fullName: string;
  assetToStreamingOiCap?: Array<[string, string]>;
}

interface PerpAssetMeta {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  isDelisted?: boolean;
  marginMode?: string;
  onlyIsolated?: boolean;
}

interface PerpMeta {
  universe: PerpAssetMeta[];
}

interface PerpAssetContext {
  funding?: string;
  openInterest?: string;
  prevDayPx?: string;
  dayNtlVlm?: string;
  premium?: string | null;
  oraclePx?: string;
  markPx?: string;
  midPx?: string | null;
  impactPxs?: [string, string] | null;
}

export interface HyperliquidMarket {
  coin: string;
  symbol: string;
  dex: string;
  dexName: string;
  category: HyperliquidCategory;
  isHip3: boolean;
  isDelisted: boolean;
  marginMode: string;
  maxLeverage: number;
  markPx: number;
  oraclePx: number;
  midPx: number | null;
  prevDayPx: number;
  change24hPct: number;
  fundingHourlyPct: number;
  fundingAnnualPct: number;
  premiumBps: number;
  basisBps: number;
  openInterest: number;
  openInterestUsd: number;
  dayVolumeUsd: number;
  turnover: number | null;
  impactSpreadBps: number | null;
  signal: HyperliquidSignal;
  signalLabel: string;
  bias: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  actionable: boolean;
  trigger: string;
  invalidation: string;
  rationale: string;
  risk: string;
  blockReasons: string[];
  alpha: EmpiricalAlphaModel | null;
}

export interface HyperliquidMarketsResponse {
  source: {
    provider: "Hyperliquid";
    endpoint: string;
    fetchedAt: string;
  };
  summary: {
    markets: number;
    activeMarkets: number;
    hip3Markets: number;
    actionable: number;
    dayVolumeUsd: number;
    openInterestUsd: number;
    dexCount: number;
  };
  dexs: Array<{ name: string; fullName: string; markets: number }>;
  categories: Array<{ name: HyperliquidCategory; markets: number }>;
  rows: HyperliquidMarket[];
}

export interface HyperliquidCandle {
  time: number;
  endTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

export interface HyperliquidFundingPoint {
  time: number;
  fundingRate: number;
  premium: number;
}

export interface HyperliquidMarketDetail {
  coin: string;
  observedAt: string;
  trend: {
    return4hPct: number | null;
    return24hPct: number | null;
    range7dPct: number | null;
    realizedVol24hPct: number | null;
    ema20: number | null;
    rsi14: number | null;
  };
  funding: {
    currentAnnualPct: number | null;
    averageAnnualPct: number | null;
    positiveShare: number | null;
    observations: number;
    points: HyperliquidFundingPoint[];
  };
  candles: HyperliquidCandle[];
}


interface RawCandle {
  t: number;
  T: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: number;
}

interface RawFunding {
  time: number;
  fundingRate: string;
  premium: string;
}

function numberValue(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function candleFromRaw(candle: RawCandle): HyperliquidCandle {
  return {
    time: candle.t,
    endTime: candle.T,
    open: numberValue(candle.o),
    high: numberValue(candle.h),
    low: numberValue(candle.l),
    close: numberValue(candle.c),
    volume: numberValue(candle.v),
    trades: candle.n,
  };
}

function fundingFromRaw(point: RawFunding): HyperliquidFundingPoint {
  return {
    time: point.time,
    fundingRate: numberValue(point.fundingRate),
    premium: numberValue(point.premium),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function categoryName(value: string | undefined): HyperliquidCategory {
  switch (value?.toLowerCase()) {
    case "crypto":
      return "Crypto";
    case "stocks":
      return "Stocks";
    case "commodities":
      return "Commodities";
    case "indices":
      return "Indices";
    case "fx":
      return "FX";
    default:
      return "Other";
  }
}

function displaySymbol(coin: string): string {
  const separator = coin.indexOf(":");
  return separator >= 0 ? coin.slice(separator + 1) : coin;
}

async function infoRequest<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(INFO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Hyperliquid info request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

export async function fetchHyperliquidFundingHistory(
  coin: string,
  startTime: number,
  endTime: number,
): Promise<RawFunding[]> {
  const points = new Map<number, RawFunding>();
  let cursor = startTime;

  for (let page = 0; page < 20 && cursor <= endTime; page += 1) {
    const batch = await infoRequest<RawFunding[]>({
      type: "fundingHistory",
      coin,
      startTime: cursor,
      endTime,
    });
    if (batch.length === 0) break;

    for (const point of batch) {
      if (point.time >= startTime && point.time <= endTime) {
        points.set(point.time, point);
      }
    }
    const lastTime = Math.max(...batch.map((point) => point.time));
    if (batch.length < 500 || lastTime >= endTime) break;
    if (lastTime < cursor) {
      throw new Error("Hyperliquid funding pagination did not advance.");
    }
    cursor = lastTime + 1;
  }

  return [...points.values()].sort((left, right) => left.time - right.time);
}

function planForMarket(
  signal: HyperliquidSignal,
  fundingAnnualPct: number,
  basisBps: number,
  change24hPct: number,
  blockReasons: string[],
): Pick<
  HyperliquidMarket,
  "signalLabel" | "bias" | "trigger" | "invalidation" | "rationale" | "risk"
> {
  const fundingText = `${Math.abs(fundingAnnualPct).toFixed(1)}% annualized funding`;
  const basisText = `${Math.abs(basisBps).toFixed(1)} bps ${
    basisBps >= 0 ? "premium" : "discount"
  }`;

  if (signal === "CARRY_SHORT") {
    return {
      signalLabel: "Crowded longs",
      bias: "SHORT",
      trigger: `Short bias only while funding stays above +15% annualized, mark remains above oracle, and 24-hour momentum is non-positive.`,
      invalidation:
        "Funding turns non-positive, the premium closes, or price accelerates above the prior-day reference.",
      rationale: `Longs are paying ${fundingText} while the perp trades at a ${basisText}.`,
      risk: "Positive momentum can overwhelm carry; use isolated risk and avoid thin books.",
    };
  }
  if (signal === "CARRY_LONG") {
    return {
      signalLabel: "Crowded shorts",
      bias: "LONG",
      trigger: `Long bias only while funding stays below -15% annualized, mark remains below oracle, and 24-hour momentum is non-negative.`,
      invalidation:
        "Funding turns non-negative, the discount closes, or price breaks below the prior-day reference.",
      rationale: `Shorts are paying ${fundingText} while the perp trades at a ${basisText}.`,
      risk: "Negative momentum can overwhelm carry; use isolated risk and avoid thin books.",
    };
  }
  if (signal === "MOMENTUM_LONG") {
    return {
      signalLabel: "Long continuation",
      bias: "LONG",
      trigger:
        "Long bias while mark holds above both oracle and the prior-day reference.",
      invalidation:
        "Mark falls below oracle or the 24-hour move loses half of its current advance.",
      rationale: `Price is up ${change24hPct.toFixed(1)}% with a positive perp premium and active turnover.`,
      risk:
        fundingAnnualPct > 10
          ? `Longs currently pay ${fundingAnnualPct.toFixed(1)}% annualized funding; the trend must outrun carry.`
          : "Do not chase a wide impact spread or enter after volume collapses.",
    };
  }
  if (signal === "MOMENTUM_SHORT") {
    return {
      signalLabel: "Short continuation",
      bias: "SHORT",
      trigger:
        "Short bias while mark holds below both oracle and the prior-day reference.",
      invalidation:
        "Mark rises above oracle or the 24-hour move recovers half of its current decline.",
      rationale: `Price is down ${Math.abs(change24hPct).toFixed(1)}% with a negative perp premium and active turnover.`,
      risk:
        fundingAnnualPct < -10
          ? `Shorts currently pay ${Math.abs(fundingAnnualPct).toFixed(1)}% annualized funding; the trend must outrun carry.`
          : "Do not chase a wide impact spread or enter after volume collapses.",
    };
  }
  if (signal === "AVOID") {
    return {
      signalLabel: "Execution blocked",
      bias: "NEUTRAL",
      trigger: "No entry.",
      invalidation:
        "Re-evaluate after every listed liquidity and execution gate clears.",
      rationale: blockReasons.join(" "),
      risk:
        "Blocked is an execution-quality warning, not a bearish market signal.",
    };
  }
  return {
    signalLabel: "No edge",
    bias: "NEUTRAL",
    trigger: "Wait for funding, basis, and price direction to align.",
    invalidation: "No position is active.",
    rationale: "Current public market data does not show enough confluence.",
    risk: "A single funding or momentum reading is not a complete trade thesis.",
  };
}

export function scoreHyperliquidMarket(
  market: Omit<
    HyperliquidMarket,
    | "signal"
    | "signalLabel"
    | "bias"
    | "score"
    | "actionable"
    | "trigger"
    | "invalidation"
    | "rationale"
    | "risk"
    | "blockReasons"
    | "alpha"
  >,
): HyperliquidMarket {
  const blockReasons: string[] = [];
  if (market.isDelisted) blockReasons.push("Market is delisted.");
  if (market.markPx <= 0 || market.oraclePx <= 0) {
    blockReasons.push("A valid mark or oracle price is unavailable.");
  }
  if (market.dayVolumeUsd < 1_000_000) {
    blockReasons.push(
      `24h volume is $${(market.dayVolumeUsd / 1_000_000).toFixed(2)}M, below the $1.00M minimum.`,
    );
  }
  if (market.openInterestUsd < 500_000) {
    blockReasons.push(
      `Open interest is $${(market.openInterestUsd / 1_000).toFixed(0)}K, below the $500K minimum.`,
    );
  }
  if (market.impactSpreadBps === null) {
    blockReasons.push("An impact-price spread is unavailable.");
  } else if (market.impactSpreadBps > 40) {
    blockReasons.push(
      `Impact spread is ${market.impactSpreadBps.toFixed(1)} bps, above the 40 bps limit.`,
    );
  }
  const liquid = blockReasons.length === 0;

  let signal: HyperliquidSignal = "WATCH";
  if (!liquid) {
    signal = "AVOID";
  } else if (
    market.fundingAnnualPct >= 15 &&
    market.basisBps >= 2 &&
    market.change24hPct <= 0
  ) {
    signal = "CARRY_SHORT";
  } else if (
    market.fundingAnnualPct <= -15 &&
    market.basisBps <= -2 &&
    market.change24hPct >= 0
  ) {
    signal = "CARRY_LONG";
  } else if (
    market.change24hPct >= 4 &&
    market.basisBps > 0 &&
    market.fundingAnnualPct < 50 &&
    (market.turnover ?? 0) >= 0.25
  ) {
    signal = "MOMENTUM_LONG";
  } else if (
    market.change24hPct <= -4 &&
    market.basisBps < 0 &&
    market.fundingAnnualPct > -50 &&
    (market.turnover ?? 0) >= 0.25
  ) {
    signal = "MOMENTUM_SHORT";
  }

  const volumeScore = clamp(
    (Math.log10(Math.max(market.dayVolumeUsd, 1)) - 5) * 8,
    0,
    24,
  );
  const openInterestScore = clamp(
    (Math.log10(Math.max(market.openInterestUsd, 1)) - 5) * 6,
    0,
    18,
  );
  const executionScore =
    market.impactSpreadBps === null
      ? 0
      : clamp(18 - market.impactSpreadBps / 4, 0, 18);
  const isLongSignal = signal === "CARRY_LONG" || signal === "MOMENTUM_LONG";
  const isShortSignal = signal === "CARRY_SHORT" || signal === "MOMENTUM_SHORT";
  const directionalBasis =
    signal === "CARRY_LONG" || signal === "MOMENTUM_SHORT"
      ? -market.basisBps
      : signal === "CARRY_SHORT" || signal === "MOMENTUM_LONG"
        ? market.basisBps
        : 0;
  const directionalMomentum = isLongSignal
    ? market.change24hPct
    : isShortSignal
      ? -market.change24hPct
      : 0;
  const directionalFunding =
    signal === "CARRY_LONG" || signal === "MOMENTUM_LONG"
      ? -market.fundingAnnualPct
      : signal === "CARRY_SHORT" || signal === "MOMENTUM_SHORT"
        ? market.fundingAnnualPct
        : 0;
  const carrySignal = signal === "CARRY_LONG" || signal === "CARRY_SHORT";
  const momentumSignal =
    signal === "MOMENTUM_LONG" || signal === "MOMENTUM_SHORT";
  const fundingScore = carrySignal
    ? clamp(directionalFunding * 0.8, 0, 18)
    : momentumSignal
      ? clamp(directionalFunding * 0.4, 0, 10)
      : 0;
  const fundingPenalty = momentumSignal
    ? clamp(-directionalFunding * 0.25, 0, 12)
    : 0;
  const basisScore = clamp(directionalBasis * 0.8, 0, 12);
  const momentumScore = clamp(directionalMomentum * 1.5, 0, 10);
  const confluenceBonus = signal === "WATCH" || signal === "AVOID" ? 0 : 10;
  const score =
    signal === "AVOID"
      ? Math.min(39, Math.round(volumeScore + executionScore))
      : signal === "WATCH"
        ? Math.min(
            54,
            Math.round(volumeScore + openInterestScore + executionScore),
          )
      : Math.round(
          clamp(
            volumeScore +
              openInterestScore +
              executionScore +
              fundingScore +
              basisScore +
              momentumScore +
              confluenceBonus -
              fundingPenalty,
            0,
            100,
          ),
        );
  const plan = planForMarket(
    signal,
    market.fundingAnnualPct,
    market.basisBps,
    market.change24hPct,
    blockReasons,
  );

  return {
    ...market,
    ...plan,
    blockReasons,
    signal,
    score,
    actionable:
      signal !== "WATCH" && signal !== "AVOID" && score >= 55,
    alpha: null,
  };
}

export function applyEmpiricalAlpha(
  market: HyperliquidMarket,
  alpha: EmpiricalAlphaModel,
): HyperliquidMarket {
  return { ...market, alpha };
}

export type EmpiricalOverlayVerdict =
  | "CONFIRMED"
  | "CONFLICT"
  | "UNVALIDATED"
  | "BUILDING"
  | "MODEL_ONLY"
  | "NOT_APPLICABLE";

export function empiricalOverlayVerdict(
  market: HyperliquidMarket,
): EmpiricalOverlayVerdict {
  if (market.signal === "AVOID") return "NOT_APPLICABLE";
  if (!market.alpha || market.alpha.status === "INSUFFICIENT_DATA") {
    return "BUILDING";
  }
  if (!market.actionable) {
    return market.alpha.qualifies ? "MODEL_ONLY" : "UNVALIDATED";
  }
  if (!market.alpha.qualifies) return "UNVALIDATED";
  return market.alpha.direction === market.bias ? "CONFIRMED" : "CONFLICT";
}

export async function fetchHyperliquidMarkets(): Promise<HyperliquidMarketsResponse> {
  const [dexResponse, categoryResponse] = await Promise.all([
    infoRequest<Array<PerpDexDefinition | null>>({ type: "perpDexs" }),
    infoRequest<Array<[string, string]>>({ type: "perpCategories" }),
  ]);

  const categoryByCoin = new Map(
    categoryResponse.map(([coin, category]) => [coin, categoryName(category)]),
  );
  const dexDefinitions = dexResponse.map((dex, index) =>
    dex ?? {
      name: "",
      fullName: index === 0 ? "Hyperliquid" : `Perp DEX ${index + 1}`,
    },
  );
  const marketsByDex = await Promise.all(
    dexDefinitions.map((dex) =>
      infoRequest<[PerpMeta, PerpAssetContext[]]>({
        type: "metaAndAssetCtxs",
        ...(dex.name ? { dex: dex.name } : {}),
      }),
    ),
  );
  const rows: HyperliquidMarket[] = [];

  dexDefinitions.forEach((dex, dexIndex) => {
    const meta = marketsByDex[dexIndex]?.[0];
    const contexts = marketsByDex[dexIndex]?.[1];
    if (!meta?.universe || !Array.isArray(contexts)) return;

    meta.universe.forEach((asset, assetIndex) => {
      const context = contexts[assetIndex];
      if (!context) return;
      const markPx = numberValue(context.markPx);
      const oraclePx = numberValue(context.oraclePx);
      const midPx =
        context.midPx === null || context.midPx === undefined
          ? null
          : numberValue(context.midPx);
      const prevDayPx = numberValue(context.prevDayPx);
      const fundingRate = numberValue(context.funding);
      const premium = numberValue(context.premium);
      const openInterest = numberValue(context.openInterest);
      const dayVolumeUsd = numberValue(context.dayNtlVlm);
      const openInterestUsd = openInterest * markPx;
      const impactBid = numberValue(context.impactPxs?.[0]);
      const impactAsk = numberValue(context.impactPxs?.[1]);
      const impactMid =
        impactBid > 0 && impactAsk > 0 ? (impactBid + impactAsk) / 2 : 0;
      const impactSpreadBps =
        impactMid > 0 ? ((impactAsk - impactBid) / impactMid) * 10_000 : null;
      const isHip3 = dex.name !== "";
      const baseMarket = {
        coin: asset.name,
        symbol: displaySymbol(asset.name),
        dex: dex.name,
        dexName: dex.fullName,
        category:
          categoryByCoin.get(asset.name) ?? (isHip3 ? "Other" : "Crypto"),
        isHip3,
        isDelisted: asset.isDelisted === true,
        marginMode:
          asset.marginMode ?? (asset.onlyIsolated ? "isolated" : "cross"),
        maxLeverage: asset.maxLeverage,
        markPx,
        oraclePx,
        midPx,
        prevDayPx,
        change24hPct:
          prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0,
        fundingHourlyPct: fundingRate * 100,
        fundingAnnualPct: fundingRate * 24 * 365 * 100,
        premiumBps: premium * 10_000,
        basisBps:
          oraclePx > 0 ? ((markPx - oraclePx) / oraclePx) * 10_000 : 0,
        openInterest,
        openInterestUsd,
        dayVolumeUsd,
        turnover: openInterestUsd > 0 ? dayVolumeUsd / openInterestUsd : null,
        impactSpreadBps,
      } satisfies Omit<
        HyperliquidMarket,
        | "signal"
        | "signalLabel"
        | "bias"
        | "score"
        | "actionable"
        | "trigger"
        | "invalidation"
        | "rationale"
        | "risk"
        | "blockReasons"
        | "alpha"
      >;
      rows.push(scoreHyperliquidMarket(baseMarket));
    });
  });

  rows.sort((left, right) => {
    if (left.actionable !== right.actionable) return left.actionable ? -1 : 1;
    return right.score - left.score || right.dayVolumeUsd - left.dayVolumeUsd;
  });

  const categories = (
    ["Crypto", "Stocks", "Commodities", "Indices", "FX", "Other"] as const
  )
    .map((name) => ({
      name,
      markets: rows.filter((row) => row.category === name).length,
    }))
    .filter((item) => item.markets > 0);
  const dexs = dexDefinitions
    .map((dex) => ({
      name: dex.name,
      fullName: dex.fullName,
      markets: rows.filter((row) => row.dex === dex.name).length,
    }))
    .filter((dex) => dex.markets > 0);

  return {
    source: {
      provider: "Hyperliquid",
      endpoint: INFO_URL,
      fetchedAt: new Date().toISOString(),
    },
    summary: {
      markets: rows.length,
      activeMarkets: rows.filter((row) => !row.isDelisted).length,
      hip3Markets: rows.filter((row) => row.isHip3 && !row.isDelisted).length,
      actionable: rows.filter((row) => row.actionable).length,
      dayVolumeUsd: rows.reduce((sum, row) => sum + row.dayVolumeUsd, 0),
      openInterestUsd: rows.reduce(
        (sum, row) => sum + row.openInterestUsd,
        0,
      ),
      dexCount: dexs.length,
    },
    dexs,
    categories,
    rows,
  };
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let result = values.slice(0, period).reduce((sum, value) => sum + value, 0) /
    period;
  for (const value of values.slice(period)) {
    result = value * multiplier + result * (1 - multiplier);
  }
  return result;
}

function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  const changes = values
    .slice(1)
    .map((value, index) => value - values[index]);
  const recent = changes.slice(-period);
  const gains = recent.reduce(
    (sum, value) => sum + Math.max(0, value),
    0,
  );
  const losses = recent.reduce(
    (sum, value) => sum + Math.max(0, -value),
    0,
  );
  if (losses <= 0) return 100;
  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

function returnOver(closes: number[], bars: number): number | null {
  if (closes.length <= bars) return null;
  const prior = closes[closes.length - 1 - bars];
  return prior > 0 ? ((closes.at(-1)! - prior) / prior) * 100 : null;
}

export async function fetchHyperliquidAlphaModel(
  coin: string,
  impactSpreadBps: number | null,
): Promise<EmpiricalAlphaModel> {
  if (!/^[A-Za-z0-9:_-]{1,40}$/.test(coin)) {
    throw new Error("Invalid Hyperliquid market symbol.");
  }
  const endTime = Date.now();
  const startTime = endTime - 90 * 24 * HOUR_MS;
  const [rawCandles, rawFunding] = await Promise.all([
    infoRequest<RawCandle[]>({
      type: "candleSnapshot",
      req: { coin, interval: "1h", startTime, endTime },
    }),
    fetchHyperliquidFundingHistory(coin, startTime, endTime),
  ]);

  return buildEmpiricalAlphaModel(
    coin,
    rawCandles.map(candleFromRaw),
    rawFunding.map(fundingFromRaw),
    impactSpreadBps,
  );
}

export async function fetchHyperliquidMarketDetail(
  coin: string,
): Promise<HyperliquidMarketDetail> {
  if (!/^[A-Za-z0-9:_-]{1,40}$/.test(coin)) {
    throw new Error("Invalid Hyperliquid market symbol.");
  }
  const endTime = Date.now();
  const startTime = endTime - 7 * 24 * HOUR_MS;
  const [rawCandles, rawFunding] = await Promise.all([
    infoRequest<RawCandle[]>({
      type: "candleSnapshot",
      req: { coin, interval: "1h", startTime, endTime },
    }),
    infoRequest<RawFunding[]>({
      type: "fundingHistory",
      coin,
      startTime,
      endTime,
    }),
  ]);

  const candles = rawCandles.map(candleFromRaw);
  const closes = candles.map((candle) => candle.close);
  const recentReturns = closes
    .slice(-25)
    .slice(1)
    .map((value, index) => {
      const prior = closes.slice(-25)[index];
      return prior > 0 ? Math.log(value / prior) : 0;
    });
  const returnMean =
    recentReturns.length > 0
      ? recentReturns.reduce((sum, value) => sum + value, 0) /
        recentReturns.length
      : 0;
  const returnVariance =
    recentReturns.length > 1
      ? recentReturns.reduce(
          (sum, value) => sum + (value - returnMean) ** 2,
          0,
        ) /
        (recentReturns.length - 1)
      : 0;
  const high7d = Math.max(...candles.map((candle) => candle.high));
  const low7d = Math.min(...candles.map((candle) => candle.low));

  const fundingPoints = rawFunding.map(fundingFromRaw);
  const averageFunding =
    fundingPoints.length > 0
      ? fundingPoints.reduce((sum, point) => sum + point.fundingRate, 0) /
        fundingPoints.length
      : null;
  const currentFunding = fundingPoints.at(-1)?.fundingRate ?? null;

  return {
    coin,
    observedAt: new Date().toISOString(),
    trend: {
      return4hPct: returnOver(closes, 4),
      return24hPct: returnOver(closes, 24),
      range7dPct:
        low7d > 0 && Number.isFinite(high7d)
          ? ((high7d - low7d) / low7d) * 100
          : null,
      realizedVol24hPct:
        recentReturns.length > 1 ? Math.sqrt(returnVariance * 24) * 100 : null,
      ema20: ema(closes, 20),
      rsi14: rsi(closes),
    },
    funding: {
      currentAnnualPct:
        currentFunding === null ? null : currentFunding * 24 * 365 * 100,
      averageAnnualPct:
        averageFunding === null ? null : averageFunding * 24 * 365 * 100,
      positiveShare:
        fundingPoints.length > 0
          ? fundingPoints.filter((point) => point.fundingRate > 0).length /
            fundingPoints.length
          : null,
      observations: fundingPoints.length,
      points: fundingPoints,
    },
    candles,
  };
}
