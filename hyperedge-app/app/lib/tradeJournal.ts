import type {
  HyperliquidCategory,
  HyperliquidMarket,
  HyperliquidSignal,
} from "./hyperliquid";

export const TRADE_JOURNAL_KEY = "hyperliquid-edge-trades-v1";
export const TRADE_SIZE_KEY = "hyperliquid-edge-trade-size-v1";
export const TRADE_LEVERAGE_KEY = "hyperliquid-edge-leverage-v1";

export type TradeDirection = "LONG" | "SHORT";
export type TradeStatus = "OPEN" | "CLOSED";
export type TradeHealth = "ON_PLAN" | "REVIEW" | "EXIT_REVIEW" | "NO_MARK";

export interface TrackedTrade {
  id: string;
  coin: string;
  symbol: string;
  dexName: string;
  category: HyperliquidCategory;
  direction: TradeDirection;
  signal: HyperliquidSignal;
  signalLabel: string;
  scoreAtEntry: number;
  entryPrice: number;
  marginUsd: number;
  leverage: number;
  notionalUsd: number;
  signalAlignedAtEntry: boolean;
  openedAt: string;
  fundingAnnualPctAtEntry: number;
  basisBpsAtEntry: number;
  impactSpreadBpsAtEntry: number | null;
  trigger: string;
  invalidation: string;
  rationale: string;
  risk: string;
  status: TradeStatus;
  closedAt?: string;
  exitPrice?: number;
  realizedPnl?: number;
  closeReason?: string;
}

export function loadTrackedTrades(): TrackedTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(TRADE_JOURNAL_KEY) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as TrackedTrade[]).map((trade) => {
      const leverage =
        Number.isFinite(trade.leverage) && trade.leverage >= 1
          ? trade.leverage
          : 1;
      const marginUsd =
        Number.isFinite(trade.marginUsd) && trade.marginUsd > 0
          ? trade.marginUsd
          : trade.notionalUsd / leverage;
      return {
        ...trade,
        leverage,
        marginUsd,
        signalAlignedAtEntry:
          typeof trade.signalAlignedAtEntry === "boolean"
            ? trade.signalAlignedAtEntry
            : true,
      };
    });
  } catch {
    return [];
  }
}

export function saveTrackedTrades(trades: TrackedTrade[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TRADE_JOURNAL_KEY, JSON.stringify(trades));
}

export function createTrackedTrade(
  market: HyperliquidMarket,
  marginUsd: number,
  direction: TradeDirection = market.bias === "NEUTRAL"
    ? "LONG"
    : market.bias,
  leverage = 1,
): TrackedTrade {
  const boundedMargin = Math.min(1_000_000, Math.max(100, marginUsd));
  const boundedLeverage = Math.min(
    Math.max(1, market.maxLeverage),
    Math.max(1, Math.round(leverage)),
  );
  return {
    id: `${market.coin}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    coin: market.coin,
    symbol: market.symbol,
    dexName: market.dexName,
    category: market.category,
    direction,
    signal: market.signal,
    signalLabel: market.signalLabel,
    scoreAtEntry: market.score,
    entryPrice: market.markPx,
    marginUsd: boundedMargin,
    leverage: boundedLeverage,
    notionalUsd: boundedMargin * boundedLeverage,
    signalAlignedAtEntry: market.bias === direction,
    openedAt: new Date().toISOString(),
    fundingAnnualPctAtEntry: market.fundingAnnualPct,
    basisBpsAtEntry: market.basisBps,
    impactSpreadBpsAtEntry: market.impactSpreadBps,
    trigger: market.trigger,
    invalidation: market.invalidation,
    rationale: market.rationale,
    risk: market.risk,
    status: "OPEN",
  };
}

export function paperPnl(
  trade: TrackedTrade,
  currentPrice: number,
): { usd: number; pct: number } {
  if (
    trade.entryPrice <= 0 ||
    currentPrice <= 0 ||
    trade.notionalUsd <= 0
  ) {
    return { usd: 0, pct: 0 };
  }
  const rawReturn =
    trade.direction === "LONG"
      ? currentPrice / trade.entryPrice - 1
      : (trade.entryPrice - currentPrice) / trade.entryPrice;
  return {
    usd: rawReturn * trade.notionalUsd,
    pct: rawReturn * trade.leverage * 100,
  };
}

export function tradeHealth(
  trade: TrackedTrade,
  market: HyperliquidMarket | undefined,
): TradeHealth {
  if (!market || market.markPx <= 0) return "NO_MARK";
  if (
    market.signal === "AVOID" ||
    (trade.signalAlignedAtEntry &&
      market.bias !== "NEUTRAL" &&
      market.bias !== trade.direction)
  ) {
    return "EXIT_REVIEW";
  }
  if (market.bias !== "NEUTRAL" && market.bias !== trade.direction) {
    return "REVIEW";
  }
  if (
    !market.actionable ||
    market.signal !== trade.signal
  ) {
    return "REVIEW";
  }
  return "ON_PLAN";
}
