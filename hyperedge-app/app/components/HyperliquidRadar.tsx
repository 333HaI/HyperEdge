"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bookmark,
  BookmarkCheck,
  BookOpenCheck,
  BrainCircuit,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  Gauge,
  Layers3,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  HyperliquidCategory,
  HyperliquidMarket,
  HyperliquidMarketDetail,
  HyperliquidMarketsResponse,
  HyperliquidSignal,
} from "../lib/hyperliquid";
import {
  applyEmpiricalAlpha,
  empiricalOverlayVerdict,
  type EmpiricalOverlayVerdict,
} from "../lib/hyperliquid";
import type { EmpiricalAlphaModel } from "../lib/alphaModel";
import {
  createTrackedTrade,
  loadTrackedTrades,
  saveTrackedTrades,
  TRADE_LEVERAGE_KEY,
  TRADE_SIZE_KEY,
  type TradeDirection,
} from "../lib/tradeJournal";
import { ThemeToggle } from "./ThemeToggle";

const WATCHLIST_KEY = "hyperliquid-edge-watchlist-v1";
const REFRESH_KEY = "hyperliquid-edge-refresh-v1";

type SortKey =
  | "score"
  | "forecast"
  | "volume"
  | "openInterest"
  | "funding"
  | "basis"
  | "change";

function compactUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function price(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const digits = value >= 1000 ? 1 : value >= 1 ? 3 : 6;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(value);
}

function signed(value: number, digits = 2, suffix = "%"): string {
  if (!Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

function timeLabel(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function SignalIcon({ signal }: { signal: HyperliquidSignal }) {
  if (
    signal === "ALPHA_LONG" ||
    signal === "CARRY_LONG" ||
    signal === "MOMENTUM_LONG"
  ) {
    return <ArrowUpRight size={15} />;
  }
  if (
    signal === "ALPHA_SHORT" ||
    signal === "CARRY_SHORT" ||
    signal === "MOMENTUM_SHORT"
  ) {
    return <ArrowDownRight size={15} />;
  }
  if (signal === "AVOID") return <ShieldAlert size={15} />;
  return <Clock3 size={15} />;
}

function sortValue(row: HyperliquidMarket, sort: SortKey): number {
  if (sort === "forecast") {
    return Math.abs(row.alpha?.predictedNetReturnPct ?? -Infinity);
  }
  if (sort === "volume") return row.dayVolumeUsd;
  if (sort === "openInterest") return row.openInterestUsd;
  if (sort === "funding") return Math.abs(row.fundingAnnualPct);
  if (sort === "basis") return Math.abs(row.basisBps);
  if (sort === "change") return Math.abs(row.change24hPct);
  return row.score;
}

interface AlphaBatchResponse {
  models: Array<EmpiricalAlphaModel | { coin: string; error: string }>;
}

function hasAlphaModel(
  value: EmpiricalAlphaModel | { coin: string; error: string },
): value is EmpiricalAlphaModel {
  return !("error" in value);
}

function mergeAlphaModels(
  payload: HyperliquidMarketsResponse,
  models: EmpiricalAlphaModel[],
): HyperliquidMarketsResponse {
  const modelByCoin = new Map(models.map((model) => [model.coin, model]));
  const rows = payload.rows.map((row) => {
    const model = modelByCoin.get(row.coin);
    return model ? applyEmpiricalAlpha(row, model) : row;
  });
  return {
    ...payload,
    summary: {
      ...payload.summary,
      actionable: rows.filter((row) => row.actionable).length,
    },
    rows,
  };
}

function actionTone(row: HyperliquidMarket): string {
  if (row.signal === "AVOID") return "blocked";
  if (row.bias === "LONG") return "long";
  if (row.bias === "SHORT") return "short";
  return "watch";
}

function empiricalLabel(verdict: EmpiricalOverlayVerdict): string {
  if (verdict === "CONFIRMED") return "Confirmed";
  if (verdict === "CONFLICT") return "Conflict";
  if (verdict === "UNVALIDATED") return "Unvalidated";
  if (verdict === "BUILDING") return "Building";
  if (verdict === "MODEL_ONLY") return "Model-only";
  return "Not applicable";
}

function empiricalTone(verdict: EmpiricalOverlayVerdict): string {
  if (verdict === "CONFIRMED") return "confirmed";
  if (verdict === "CONFLICT") return "conflict";
  if (verdict === "MODEL_ONLY") return "model-only";
  if (verdict === "BUILDING") return "building";
  return "unvalidated";
}

function EmpiricalBadge({ market }: { market: HyperliquidMarket }) {
  const verdict = empiricalOverlayVerdict(market);
  return (
    <span className={`hl-empirical-badge tone-${empiricalTone(verdict)}`}>
      {empiricalLabel(verdict)}
    </span>
  );
}

export default function HyperliquidRadar() {
  const [data, setData] = useState<HyperliquidMarketsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [alphaLoading, setAlphaLoading] = useState(false);
  const [alphaError, setAlphaError] = useState("");
  const [selected, setSelected] = useState<HyperliquidMarket | null>(null);
  const [detail, setDetail] = useState<HyperliquidMarketDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"All" | HyperliquidCategory>("All");
  const [dex, setDex] = useState("All");
  const [signal, setSignal] = useState<"All" | "Actionable" | HyperliquidSignal>(
    "All",
  );
  const [sort, setSort] = useState<SortKey>("score");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchOnly, setWatchOnly] = useState(false);
  const [refreshSeconds, setRefreshSeconds] = useState(30);
  const [paperSize, setPaperSize] = useState(1000);
  const [paperDirection, setPaperDirection] =
    useState<TradeDirection>("LONG");
  const [paperLeverage, setPaperLeverage] = useState(5);
  const [trackedCoins, setTrackedCoins] = useState<string[]>([]);
  const previousSignals = useRef<Record<string, HyperliquidSignal>>({});
  const alphaRequests = useRef(new Set<string>());
  const ledgerRef = useRef<HTMLElement | null>(null);

  function showQualifiedSetups() {
    setSearch("");
    setCategory("All");
    setDex("All");
    setSignal("Actionable");
    setSort("score");
    setWatchOnly(false);

    window.requestAnimationFrame(() => {
      ledgerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setWatchlist(
          JSON.parse(window.localStorage.getItem(WATCHLIST_KEY) ?? "[]"),
        );
        setRefreshSeconds(
          Number(window.localStorage.getItem(REFRESH_KEY) ?? "30"),
        );
        const storedSize = Number(
          window.localStorage.getItem(TRADE_SIZE_KEY) ?? "1000",
        );
        setPaperSize(
          Number.isFinite(storedSize) && storedSize >= 100 ? storedSize : 1000,
        );
        const storedLeverage = Number(
          window.localStorage.getItem(TRADE_LEVERAGE_KEY) ?? "5",
        );
        setPaperLeverage(
          Number.isFinite(storedLeverage) && storedLeverage >= 1
            ? Math.round(storedLeverage)
            : 5,
        );
        setTrackedCoins(
          loadTrackedTrades()
            .filter((trade) => trade.status === "OPEN")
            .map((trade) => trade.coin),
        );
      } catch {
        setWatchlist([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const fetchAlphaModels = useCallback(
    async (markets: HyperliquidMarket[]): Promise<EmpiricalAlphaModel[]> => {
      const requested = markets
        .filter(
          (market) =>
            market.signal !== "AVOID" &&
            !market.alpha &&
            !alphaRequests.current.has(market.coin),
        )
        .slice(0, 8);
      if (requested.length === 0) return [];
      requested.forEach((market) => alphaRequests.current.add(market.coin));
      setAlphaLoading(true);
      try {
        const response = await fetch("/api/hyperliquid/alpha", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            markets: requested.map((market) => ({
              coin: market.coin,
              impactSpreadBps: market.impactSpreadBps,
            })),
          }),
          cache: "no-store",
        });
        const payload = (await response.json()) as
          | AlphaBatchResponse
          | { error: string };
        if (!response.ok || "error" in payload) {
          throw new Error(
            "error" in payload ? payload.error : "Alpha estimation failed.",
          );
        }
        return payload.models.filter(hasAlphaModel);
      } finally {
        requested.forEach((market) =>
          alphaRequests.current.delete(market.coin),
        );
        setAlphaLoading(false);
      }
    },
    [],
  );

  const loadMarkets = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/hyperliquid/markets", {
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | HyperliquidMarketsResponse
        | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "Hyperliquid scan failed.",
        );
      }

      setData(payload);
      setSelected((current) =>
        current
          ? payload.rows.find((row) => row.coin === current.coin) ?? current
          : null,
      );
      setLoading(false);

      const priority = [...payload.rows]
        .filter((row) => row.signal !== "AVOID")
        .sort(
          (left, right) =>
            Number(right.actionable) - Number(left.actionable) ||
            right.score - left.score ||
            right.dayVolumeUsd - left.dayVolumeUsd ||
            right.openInterestUsd - left.openInterestUsd,
        );
      const actionablePriority = priority.filter((row) => row.actionable);
      const watchlistPriority = priority.filter(
        (row) => !row.actionable && watchlist.includes(row.coin),
      );
      const candidates = [
        ...actionablePriority,
        ...watchlistPriority,
        ...priority.filter(
          (row) =>
            !row.actionable &&
            !watchlistPriority.some((item) => item.coin === row.coin),
        ),
      ].slice(0, 8);
      let models: EmpiricalAlphaModel[] = [];
      setAlphaError("");
      try {
        models = await fetchAlphaModels(candidates);
      } catch (alphaRequestError) {
        setAlphaError(
          alphaRequestError instanceof Error
            ? alphaRequestError.message
            : "Empirical validation is temporarily unavailable.",
        );
      }
      const enriched = mergeAlphaModels(payload, models);

      if (
        "Notification" in window &&
        window.Notification.permission === "granted"
      ) {
        const fresh = enriched.rows.filter(
          (row) =>
            row.actionable &&
            previousSignals.current[row.coin] !== row.signal &&
            (watchlist.length === 0 || watchlist.includes(row.coin)),
        );
        if (Object.keys(previousSignals.current).length > 0 && fresh.length > 0) {
          new window.Notification("HyperEdge", {
            body: `${fresh[0].coin}: ${fresh[0].signalLabel} (${fresh[0].score}/100 confluence)`,
          });
        }
      }
      previousSignals.current = Object.fromEntries(
        enriched.rows.map((row) => [row.coin, row.signal]),
      );
      setData(enriched);
      setSelected((current) =>
        current
          ? enriched.rows.find((row) => row.coin === current.coin) ?? current
          : null,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Hyperliquid scan failed.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAlphaModels, watchlist]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMarkets(), 0);
    return () => window.clearTimeout(timer);
  }, [loadMarkets]);

  useEffect(() => {
    if (refreshSeconds <= 0) return;
    const timer = window.setInterval(
      () => void loadMarkets(true),
      refreshSeconds * 1000,
    );
    return () => window.clearInterval(timer);
  }, [loadMarkets, refreshSeconds]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setDetailLoading(true);
      setDetailError("");
      setDetail(null);
      fetch(
        `/api/hyperliquid/market?coin=${encodeURIComponent(selected.coin)}`,
        { signal: controller.signal, cache: "no-store" },
      )
        .then(async (response) => {
          const payload = (await response.json()) as
            | HyperliquidMarketDetail
            | { error: string };
          if (!response.ok || "error" in payload) {
            throw new Error(
              "error" in payload ? payload.error : "Market detail failed.",
            );
          }
          setDetail(payload);
        })
        .catch((requestError) => {
          if (requestError instanceof DOMException) return;
          setDetailError(
            requestError instanceof Error
              ? requestError.message
              : "Market detail failed.",
          );
        })
        .finally(() => setDetailLoading(false));
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selected]);

  useEffect(() => {
    if (!selected || selected.alpha || selected.signal === "AVOID") return;
    let cancelled = false;
    void fetchAlphaModels([selected])
      .then((models) => {
        if (cancelled || models.length === 0) return;
        const model = models[0];
        setData((current) =>
          current ? mergeAlphaModels(current, [model]) : current,
        );
        setSelected((current) =>
          current?.coin === model.coin
            ? applyEmpiricalAlpha(current, model)
            : current,
        );
      })
      .catch((requestError) => {
        if (!cancelled) {
          setAlphaError(
            requestError instanceof Error
              ? requestError.message
              : "Empirical validation is temporarily unavailable.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAlphaModels, selected]);

  const rows = useMemo(() => {
    if (!data) return [];
    const query = search.trim().toLowerCase();
    return data.rows
      .filter(
        (row) =>
          !query ||
          row.coin.toLowerCase().includes(query) ||
          row.dexName.toLowerCase().includes(query),
      )
      .filter((row) => category === "All" || row.category === category)
      .filter((row) => dex === "All" || row.dex === dex)
      .filter((row) => {
        if (signal === "All") return true;
        if (signal === "Actionable") return row.actionable;
        return row.signal === signal;
      })
      .filter((row) => !watchOnly || watchlist.includes(row.coin))
      .sort((left, right) => sortValue(right, sort) - sortValue(left, sort));
  }, [category, data, dex, search, signal, sort, watchOnly, watchlist]);

  const topSignals =
    data?.rows
      .filter((row) => row.actionable)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6) ?? [];

  function toggleWatch(coin: string) {
    setWatchlist((current) => {
      const next = current.includes(coin)
        ? current.filter((item) => item !== coin)
        : [...current, coin];
      window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function enableAlerts() {
    if (
      "Notification" in window &&
      window.Notification.permission === "default"
    ) {
      await window.Notification.requestPermission();
    }
  }

  function updateRefresh(value: number) {
    setRefreshSeconds(value);
    window.localStorage.setItem(REFRESH_KEY, String(value));
  }

  function updatePaperSize(value: number) {
    const next = Math.min(1_000_000, Math.max(100, value || 100));
    setPaperSize(next);
    window.localStorage.setItem(TRADE_SIZE_KEY, String(next));
  }

  function updatePaperLeverage(value: number, maximum: number) {
    const next = Math.min(
      Math.max(1, maximum),
      Math.max(1, Math.round(value || 1)),
    );
    setPaperLeverage(next);
    window.localStorage.setItem(TRADE_LEVERAGE_KEY, String(next));
  }

  function openMarket(market: HyperliquidMarket) {
    setSelected(market);
    setPaperDirection(
      market.bias === "NEUTRAL" ? "LONG" : market.bias,
    );
    setPaperLeverage((current) =>
      Math.min(Math.max(1, market.maxLeverage), Math.max(1, current)),
    );
  }

  function trackPaperTrade(market: HyperliquidMarket) {
    if (!market.actionable) return;
    const trades = loadTrackedTrades();
    if (
      trades.some(
        (trade) => trade.status === "OPEN" && trade.coin === market.coin,
      )
    ) {
      setTrackedCoins((current) =>
        current.includes(market.coin) ? current : [...current, market.coin],
      );
      return;
    }
    saveTrackedTrades([
      ...trades,
      createTrackedTrade(
        market,
        paperSize,
        paperDirection,
        paperLeverage,
      ),
    ]);
    setTrackedCoins((current) => [...current, market.coin]);
  }

  return (
    <div className="hl-app">
      <header className="hl-topbar">
        <div className="hl-brand">
          <span className="hl-brand-mark">
            <Activity size={18} />
          </span>
          <div>
            <strong>HyperEdge</strong>
            <span>Perpetual market intelligence</span>
          </div>
        </div>
        <nav className="hl-nav" aria-label="Primary navigation">
          <Link className="is-active" href="/">
            Edge Radar
          </Link>
          <Link href="/venues">Venue Lens</Link>
          <Link href="/paper">Trade Journal</Link>
        </nav>
        <div className="hl-live-controls">
          <ThemeToggle />
          <Link
            className="icon-button hl-mobile-nav-link"
            href="/venues"
            title="Open Venue Lens"
            aria-label="Open Venue Lens"
          >
            <Layers3 size={17} />
          </Link>
          <Link
            className="icon-button hl-mobile-nav-link"
            href="/paper"
            title="Open Trade Journal"
            aria-label="Open Trade Journal"
          >
            <BookOpenCheck size={17} />
          </Link>
          <label>
            <span>Refresh</span>
            <select
              value={refreshSeconds}
              onChange={(event) => updateRefresh(Number(event.target.value))}
            >
              <option value={0}>Off</option>
              <option value={15}>15 sec</option>
              <option value={30}>30 sec</option>
              <option value={60}>60 sec</option>
            </select>
          </label>
          <button
            className="icon-button hl-alert-button"
            type="button"
            title="Enable signal alerts"
            aria-label="Enable signal alerts"
            onClick={() => void enableAlerts()}
          >
            <Bell size={17} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Refresh market data"
            aria-label="Refresh market data"
            disabled={refreshing}
            onClick={() => void loadMarkets(true)}
          >
            <RefreshCw className={refreshing ? "spin" : ""} size={17} />
          </button>
        </div>
      </header>

      <main className="hl-main">
        <section className="hl-heading">
          <div>
            <p className="eyebrow">Rule discovery + walk-forward validation</p>
            <h1>Hybrid Edge Radar</h1>
          </div>
          <div className="hl-source">
            <span className="live-dot" />
            <strong>Hyperliquid mainnet</strong>
            <span>
              {data ? `Updated ${timeLabel(data.source.fetchedAt)}` : "Connecting"}
            </span>
          </div>
        </section>

        {error && (
          <section className="hl-error">
            <ShieldAlert size={18} />
            <span>{error}</span>
            <button type="button" onClick={() => void loadMarkets()}>
              Retry
            </button>
          </section>
        )}

        <section className="hl-kpis" aria-label="Market summary">
          <article>
            <Layers3 size={17} />
            <span>Active markets</span>
            <strong>{data?.summary.activeMarkets ?? "-"}</strong>
            <small>{data?.summary.dexCount ?? "-"} perpetual DEXs</small>
          </article>
          <article>
            <BarChart3 size={17} />
            <span>HIP-3 markets</span>
            <strong>{data?.summary.hip3Markets ?? "-"}</strong>
            <small>Stocks, commodities, indices, FX</small>
          </article>
          <article
            className="hl-kpi-action"
            role="button"
            tabIndex={0}
            aria-label={`Show ${data?.summary.actionable ?? ""} qualified setups`}
            title="Show all qualified setups"
            onClick={showQualifiedSetups}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                showQualifiedSetups();
              }
            }}
          >
            <Gauge size={17} />
            <span>Qualified setups</span>
            <strong>{data?.summary.actionable ?? "-"}</strong>
            <small>Signal, score, and execution gated</small>
            <ChevronRight className="hl-kpi-link-icon" size={15} />
          </article>
          <article>
            <CircleDollarSign size={17} />
            <span>24h traded volume</span>
            <strong>
              {data ? compactUsd(data.summary.dayVolumeUsd) : "-"}
            </strong>
            <small>Cumulative across visible perp DEXs</small>
          </article>
          <article>
            <Activity size={17} />
            <span>Open interest</span>
            <strong>
              {data ? compactUsd(data.summary.openInterestUsd) : "-"}
            </strong>
            <small>Mark-value estimate</small>
          </article>
        </section>

        <section className="hl-queue">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Highest rule-based confluence</p>
              <h2>Action queue</h2>
            </div>
            <span className="method-tag">
              {alphaLoading
                ? "Updating validation overlay"
                : alphaError
                  ? "Overlay unavailable"
                  : `${data?.rows.filter((row) => row.alpha).length ?? 0} empirical overlays`}
            </span>
          </div>
          <div className="hl-queue-grid">
            {loading &&
              Array.from({ length: 3 }, (_, index) => (
                <div className="hl-queue-item is-loading" key={index} />
              ))}
            {!loading && topSignals.length === 0 && (
              <div className="hl-empty">
                No market clears the current signal and execution gates.
              </div>
            )}
            {topSignals.map((row) => (
              <button
                className={`hl-queue-item tone-${actionTone(row)}`}
                type="button"
                key={row.coin}
                onClick={() => openMarket(row)}
              >
                <span className="hl-queue-rank">{row.score}</span>
                <span className="hl-queue-market">
                  <strong>{row.coin}</strong>
                  <small>
                    {row.category} / {row.dexName}
                  </small>
                </span>
                <span className="hl-queue-signal">
                  <SignalIcon signal={row.signal} />
                  <strong>{row.signalLabel}</strong>
                  <small>
                    {empiricalLabel(empiricalOverlayVerdict(row))}
                    {row.alpha?.predictedNetReturnPct === null ||
                    row.alpha?.predictedNetReturnPct === undefined
                      ? ""
                      : ` / ${signed(row.alpha.predictedNetReturnPct)} 4h net`}
                  </small>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        </section>

        <section className="hl-ledger" ref={ledgerRef}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Every perpetual market</p>
              <h2>Market ledger</h2>
            </div>
            <span className="hl-row-count">{rows.length} markets</span>
          </div>

          <div className="hl-filters">
            <label className="hl-search">
              <Search size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search market or DEX"
              />
            </label>
            <select
              aria-label="Category filter"
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as "All" | HyperliquidCategory)
              }
            >
              <option value="All">All categories</option>
              {data?.categories.map((item) => (
                <option value={item.name} key={item.name}>
                  {item.name} ({item.markets})
                </option>
              ))}
            </select>
            <select
              aria-label="DEX filter"
              value={dex}
              onChange={(event) => setDex(event.target.value)}
            >
              <option value="All">All DEXs</option>
              {data?.dexs.map((item) => (
                <option value={item.name} key={item.name || "core"}>
                  {item.fullName} ({item.markets})
                </option>
              ))}
            </select>
            <select
              aria-label="Signal filter"
              value={signal}
              onChange={(event) =>
                setSignal(
                  event.target.value as
                    | "All"
                    | "Actionable"
                    | HyperliquidSignal,
                )
              }
            >
              <option value="All">All states</option>
              <option value="Actionable">Qualified setups</option>
              <option value="CARRY_LONG">Crowded shorts</option>
              <option value="CARRY_SHORT">Crowded longs</option>
              <option value="MOMENTUM_LONG">Long continuation</option>
              <option value="MOMENTUM_SHORT">Short continuation</option>
              <option value="WATCH">Watch</option>
              <option value="AVOID">Execution blocked</option>
            </select>
            <select
              aria-label="Sort markets"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
            >
              <option value="score">Sort: confluence score</option>
              <option value="forecast">Sort: net forecast</option>
              <option value="volume">Sort: volume</option>
              <option value="openInterest">Sort: open interest</option>
              <option value="funding">Sort: funding</option>
              <option value="basis">Sort: basis</option>
              <option value="change">Sort: 24h move</option>
            </select>
            <button
              className={watchOnly ? "hl-watch-filter is-active" : "hl-watch-filter"}
              type="button"
              onClick={() => setWatchOnly((value) => !value)}
            >
              <Bookmark size={15} />
              Watchlist {watchlist.length > 0 ? `(${watchlist.length})` : ""}
            </button>
          </div>

          <div className="hl-table-wrap">
            <table className="hl-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Signal</th>
                  <th>Score</th>
                  <th>Empirical</th>
                  <th>4h net</th>
                  <th>Mark</th>
                  <th>24h</th>
                  <th>Funding ann.</th>
                  <th>Basis</th>
                  <th>Open interest</th>
                  <th>24h volume</th>
                  <th>Impact</th>
                  <th aria-label="Watchlist" />
                </tr>
              </thead>
              <tbody>
                {loading &&
                  Array.from({ length: 10 }, (_, index) => (
                    <tr className="hl-skeleton-row" key={index}>
                      <td colSpan={13}>
                        <span />
                      </td>
                    </tr>
                  ))}
                {!loading &&
                  rows.slice(0, 250).map((row) => (
                    <tr key={row.coin} onClick={() => openMarket(row)}>
                      <td>
                        <strong>{row.coin}</strong>
                        <small>
                          {row.category} / {row.dexName}
                        </small>
                      </td>
                      <td>
                        <span
                          className={`hl-signal-badge tone-${actionTone(row)}`}
                        >
                          <SignalIcon signal={row.signal} />
                          {row.signalLabel}
                        </span>
                      </td>
                      <td>
                        <strong className="hl-score">{row.score}</strong>
                      </td>
                      <td>
                        <EmpiricalBadge market={row} />
                      </td>
                      <td
                        className={
                          row.actionable &&
                          (row.alpha?.predictedNetReturnPct ?? 0) > 0
                            ? "positive"
                            : row.actionable &&
                                (row.alpha?.predictedNetReturnPct ?? 0) < 0
                              ? "negative"
                              : ""
                        }
                      >
                        {row.alpha?.predictedNetReturnPct === null ||
                        row.alpha?.predictedNetReturnPct === undefined
                          ? "-"
                          : signed(row.alpha.predictedNetReturnPct)}
                      </td>
                      <td>{price(row.markPx)}</td>
                      <td
                        className={
                          row.change24hPct > 0
                            ? "positive"
                            : row.change24hPct < 0
                              ? "negative"
                              : ""
                        }
                      >
                        {signed(row.change24hPct)}
                      </td>
                      <td
                        className={
                          Math.abs(row.fundingAnnualPct) >= 10
                            ? "hl-emphasis"
                            : ""
                        }
                      >
                        {signed(row.fundingAnnualPct, 1)}
                      </td>
                      <td>{signed(row.basisBps, 1, " bps")}</td>
                      <td>{compactUsd(row.openInterestUsd)}</td>
                      <td>{compactUsd(row.dayVolumeUsd)}</td>
                      <td>
                        {row.impactSpreadBps === null
                          ? "-"
                          : `${row.impactSpreadBps.toFixed(1)} bps`}
                      </td>
                      <td>
                        <button
                          className="hl-bookmark"
                          type="button"
                          title={
                            watchlist.includes(row.coin)
                              ? "Remove from watchlist"
                              : "Add to watchlist"
                          }
                          aria-label={
                            watchlist.includes(row.coin)
                              ? "Remove from watchlist"
                              : "Add to watchlist"
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleWatch(row.coin);
                          }}
                        >
                          {watchlist.includes(row.coin) ? (
                            <BookmarkCheck size={16} />
                          ) : (
                            <Bookmark size={16} />
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td className="hl-empty" colSpan={13}>
                      No markets match the active filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {selected && (
        <>
          <button
            className="hl-drawer-backdrop"
            type="button"
            aria-label="Close market detail"
            onClick={() => setSelected(null)}
          />
          <aside className="hl-drawer">
            <header>
              <div>
                <p className="eyebrow">
                  {selected.category} / {selected.dexName}
                </p>
                <h2>{selected.coin}</h2>
              </div>
              <div className="hl-drawer-actions">
                <a
                  className="icon-button"
                  href={`https://app.hyperliquid.xyz/trade/${encodeURIComponent(selected.coin)}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open market on Hyperliquid"
                  aria-label="Open market on Hyperliquid"
                >
                  <ExternalLink size={17} />
                </a>
                <button
                  className="icon-button"
                  type="button"
                  title="Close market detail"
                  aria-label="Close market detail"
                  onClick={() => setSelected(null)}
                >
                  <X size={18} />
                </button>
              </div>
            </header>

            <section
              className={`hl-decision tone-${actionTone(selected)}`}
            >
              <div>
                <SignalIcon signal={selected.signal} />
                <span>{selected.signalLabel}</span>
              </div>
              <strong>{selected.bias}</strong>
              <small>{selected.score}/100 confluence</small>
            </section>

            <section className="hl-alpha-panel">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">Secondary evidence only</p>
                  <h3>Empirical validation overlay</h3>
                </div>
                <span
                  className={`method-tag tone-${empiricalTone(empiricalOverlayVerdict(selected))}`}
                >
                  {empiricalLabel(empiricalOverlayVerdict(selected))}
                </span>
              </div>
              {selected.alpha ? (
                <>
                  <div className="hl-alpha-metrics">
                    <div>
                      <span>4h raw forecast</span>
                      <strong>
                        {selected.alpha.predictedReturnPct === null
                          ? "-"
                          : signed(selected.alpha.predictedReturnPct)}
                      </strong>
                    </div>
                    <div>
                      <span>After costs</span>
                      <strong>
                        {selected.alpha.predictedNetReturnPct === null
                          ? "-"
                          : signed(selected.alpha.predictedNetReturnPct)}
                      </strong>
                    </div>
                    <div>
                      <span>Entry threshold</span>
                      <strong>
                        {selected.alpha.entryThresholdPct === null
                          ? "-"
                          : `${selected.alpha.entryThresholdPct.toFixed(2)}%`}
                      </strong>
                    </div>
                    <div>
                      <span>Holdout EV</span>
                      <strong>
                        {selected.alpha.holdoutMeanNetReturnPct === null
                          ? "-"
                          : signed(
                              selected.alpha.holdoutMeanNetReturnPct,
                            )}
                      </strong>
                    </div>
                    <div>
                      <span>Holdout hit rate</span>
                      <strong>
                        {selected.alpha.holdoutHitRatePct === null
                          ? "-"
                          : `${selected.alpha.holdoutHitRatePct.toFixed(1)}%`}
                      </strong>
                    </div>
                    <div>
                      <span>Holdout trades</span>
                      <strong>{selected.alpha.holdoutTrades}</strong>
                    </div>
                    <div>
                      <span>Information coeff.</span>
                      <strong>
                        {selected.alpha.holdoutInformationCoefficient === null
                          ? "-"
                          : selected.alpha.holdoutInformationCoefficient.toFixed(
                              3,
                            )}
                      </strong>
                    </div>
                    <div>
                      <span>Training sample</span>
                      <strong>{selected.alpha.observations}</strong>
                    </div>
                  </div>
                  <div className="hl-factor-list">
                    {selected.alpha.factors.slice(0, 6).map((factor) => (
                      <div key={factor.key}>
                        <span>{factor.label}</span>
                        <span>{factor.zScore.toFixed(2)}z</span>
                        <strong
                          className={
                            factor.contributionPct > 0
                              ? "positive"
                              : factor.contributionPct < 0
                                ? "negative"
                                : ""
                          }
                        >
                          {signed(factor.contributionPct)}
                        </strong>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="hl-alpha-loading">
                  <BrainCircuit size={17} />
                  <span>
                    {selected.signal === "AVOID"
                      ? selected.blockReasons.join(" ")
                      : alphaError || "Estimating the chronological model."}
                  </span>
                </div>
              )}
            </section>

            <section className="hl-track-panel">
              <div className="hl-ticket-header">
                <span>Paper trade ticket</span>
                <strong>
                  {compactUsd(paperSize * paperLeverage)} exposure
                </strong>
              </div>

              <div className="hl-ticket-grid">
                <div className="hl-ticket-field">
                  <span>Side</span>
                  <div className="hl-side-control" role="group" aria-label="Trade side">
                    <button
                      className={
                        paperDirection === "LONG"
                          ? "is-active tone-long"
                          : "tone-long"
                      }
                      type="button"
                      aria-pressed={paperDirection === "LONG"}
                      onClick={() => setPaperDirection("LONG")}
                    >
                      <ArrowUpRight size={14} />
                      Long
                    </button>
                    <button
                      className={
                        paperDirection === "SHORT"
                          ? "is-active tone-short"
                          : "tone-short"
                      }
                      type="button"
                      aria-pressed={paperDirection === "SHORT"}
                      onClick={() => setPaperDirection("SHORT")}
                    >
                      <ArrowDownRight size={14} />
                      Short
                    </button>
                  </div>
                </div>

                <label className="hl-ticket-field">
                  <span>Margin</span>
                  <span className="hl-money-input">
                    <span>$</span>
                    <input
                      type="number"
                      min={100}
                      max={1_000_000}
                      step={100}
                      value={paperSize}
                      onChange={(event) =>
                        updatePaperSize(Number(event.target.value))
                      }
                    />
                  </span>
                </label>

                <label className="hl-ticket-field hl-leverage-control">
                  <span>
                    Leverage
                    <strong>{paperLeverage}x</strong>
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={Math.max(1, selected.maxLeverage)}
                    step={1}
                    value={Math.min(
                      paperLeverage,
                      Math.max(1, selected.maxLeverage),
                    )}
                    onChange={(event) =>
                      updatePaperLeverage(
                        Number(event.target.value),
                        selected.maxLeverage,
                      )
                    }
                  />
                  <small>1x to {selected.maxLeverage}x</small>
                </label>
              </div>

              <div className="hl-ticket-summary">
                <span>
                  Radar view
                  <strong>{selected.bias}</strong>
                </span>
                <span>
                  Direction
                  <strong
                    className={
                      paperDirection === "LONG" ? "positive" : "negative"
                    }
                  >
                    {paperDirection}
                  </strong>
                </span>
                <span>
                  Signal fit
                  <strong>
                    {selected.bias === "NEUTRAL"
                      ? "Unavailable"
                      : selected.bias === paperDirection
                        ? "Aligned"
                        : "Against signal"}
                  </strong>
                </span>
              </div>

              {trackedCoins.includes(selected.coin) ? (
                <Link className="hl-track-button is-tracked" href="/paper">
                  <BookOpenCheck size={16} />
                  View active trade
                </Link>
              ) : (
                <button
                  className="hl-track-button"
                  type="button"
                  disabled={!selected.actionable}
                  onClick={() => trackPaperTrade(selected)}
                >
                  <BookOpenCheck size={16} />
                  Start {paperDirection.toLowerCase()} paper trade
                </button>
              )}
              <small>
                {selected.actionable
                  ? empiricalOverlayVerdict(selected) === "CONFLICT"
                    ? "The empirical overlay conflicts with this rule signal. Paper trading remains available for manual review."
                    : "P&L uses leveraged exposure. Fees, funding, slippage, and liquidation are not modeled."
                  : selected.blockReasons.join(" ") ||
                    "Only qualified directional setups can start a paper trade."}
              </small>
            </section>

            <section className="hl-plan">
              <div>
                <span>Trigger</span>
                <p>{selected.trigger}</p>
              </div>
              <div>
                <span>Invalidation</span>
                <p>{selected.invalidation}</p>
              </div>
              <div>
                <span>Read</span>
                <p>{selected.rationale}</p>
              </div>
              <div>
                <span>Primary risk</span>
                <p>{selected.risk}</p>
              </div>
            </section>

            <section className="hl-detail-metrics">
              <div>
                <span>Mark / oracle</span>
                <strong>
                  {price(selected.markPx)} / {price(selected.oraclePx)}
                </strong>
              </div>
              <div>
                <span>24h move</span>
                <strong>{signed(selected.change24hPct)}</strong>
              </div>
              <div>
                <span>Funding annualized</span>
                <strong>{signed(selected.fundingAnnualPct, 1)}</strong>
              </div>
              <div>
                <span>Mark basis</span>
                <strong>{signed(selected.basisBps, 1, " bps")}</strong>
              </div>
              <div>
                <span>Open interest</span>
                <strong>{compactUsd(selected.openInterestUsd)}</strong>
              </div>
              <div>
                <span>24h volume</span>
                <strong>{compactUsd(selected.dayVolumeUsd)}</strong>
              </div>
            </section>

            <section className="hl-detail-section">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">Last seven days</p>
                  <h3>Price and trend</h3>
                </div>
                {detail && (
                  <span className="method-tag">
                    RSI {detail.trend.rsi14?.toFixed(0) ?? "-"}
                  </span>
                )}
              </div>
              {detailLoading && <div className="hl-chart-loading" />}
              {detailError && <p className="hl-detail-error">{detailError}</p>}
              {detail && (
                <>
                  <div className="hl-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={detail.candles}>
                        <defs>
                          <linearGradient
                            id="hl-price-fill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="var(--green)"
                              stopOpacity={0.24}
                            />
                            <stop
                              offset="100%"
                              stopColor="var(--green)"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                        <XAxis
                          dataKey="time"
                          tickFormatter={(value) =>
                            new Date(value).toLocaleDateString([], {
                              month: "short",
                              day: "numeric",
                            })
                          }
                          minTickGap={42}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          domain={["auto", "auto"]}
                          tickFormatter={(value) => price(value)}
                          width={58}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "var(--tooltip-bg)",
                            border: "1px solid var(--line-strong)",
                            borderRadius: 6,
                            color: "var(--ink)",
                            boxShadow: "var(--shadow)",
                          }}
                          labelStyle={{ color: "var(--muted)" }}
                          itemStyle={{ color: "var(--green)" }}
                          labelFormatter={(value) =>
                            new Date(value).toLocaleString()
                          }
                          formatter={(value) => [price(Number(value)), "Close"]}
                        />
                        <Area
                          dataKey="close"
                          type="monotone"
                          stroke="var(--green)"
                          strokeWidth={2}
                          fill="url(#hl-price-fill)"
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="hl-trend-strip">
                    <div>
                      <span>4h</span>
                      <strong>
                        {detail.trend.return4hPct === null
                          ? "-"
                          : signed(detail.trend.return4hPct)}
                      </strong>
                    </div>
                    <div>
                      <span>24h</span>
                      <strong>
                        {detail.trend.return24hPct === null
                          ? "-"
                          : signed(detail.trend.return24hPct)}
                      </strong>
                    </div>
                    <div>
                      <span>24h realized vol</span>
                      <strong>
                        {detail.trend.realizedVol24hPct?.toFixed(1) ?? "-"}%
                      </strong>
                    </div>
                    <div>
                      <span>7d range</span>
                      <strong>
                        {detail.trend.range7dPct?.toFixed(1) ?? "-"}%
                      </strong>
                    </div>
                  </div>
                </>
              )}
            </section>

            <footer className="hl-drawer-footer">
              Hyperliquid public market data. No wallet connection or order
              routing.
            </footer>
          </aside>
        </>
      )}
    </div>
  );
}
