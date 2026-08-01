"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BookOpenCheck,
  CircleCheck,
  ExternalLink,
  Layers3,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  HyperliquidMarket,
  HyperliquidMarketsResponse,
} from "../lib/hyperliquid";
import {
  loadTrackedTrades,
  paperPnl,
  saveTrackedTrades,
  tradeHealth,
  type TrackedTrade,
  type TradeHealth,
} from "../lib/tradeJournal";
import { ThemeToggle } from "./ThemeToggle";

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

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
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

function timeLabel(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function healthLabel(health: TradeHealth): string {
  if (health === "ON_PLAN") return "On plan";
  if (health === "EXIT_REVIEW") return "Exit review";
  if (health === "NO_MARK") return "No live mark";
  return "Review";
}

function healthTone(health: TradeHealth): string {
  if (health === "ON_PLAN") return "healthy";
  if (health === "EXIT_REVIEW") return "danger";
  return "review";
}

function liveRead(
  trade: TrackedTrade,
  market: HyperliquidMarket | undefined,
): string {
  if (!market) return "Live market data is temporarily unavailable.";
  const health = tradeHealth(trade, market);
  if (
    !trade.signalAlignedAtEntry &&
    market.bias !== "NEUTRAL" &&
    market.bias !== trade.direction
  ) {
    return `This manual ${trade.direction.toLowerCase()} remains against the Radar's ${market.bias.toLowerCase()} view.`;
  }
  if (health === "ON_PLAN") {
    return `${market.signalLabel} remains qualified at ${market.score}/100 confluence.`;
  }
  if (health === "EXIT_REVIEW") {
    return market.signal === "AVOID"
      ? "The market now fails a liquidity or execution gate."
      : `The live bias has changed to ${market.bias.toLowerCase()}.`;
  }
  return `${market.signalLabel} is no longer the same qualified setup.`;
}

export default function TradeJournal() {
  const [trades, setTrades] = useState<TrackedTrade[]>([]);
  const [data, setData] = useState<HyperliquidMarketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

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
          "error" in payload ? payload.error : "Live marks could not be loaded.",
        );
      }
      setData(payload);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Live marks could not be loaded.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTrades(loadTrackedTrades());
      void loadMarkets();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMarkets]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadMarkets(true), 30_000);
    return () => window.clearInterval(timer);
  }, [loadMarkets]);

  const marketByCoin = useMemo(
    () => new Map(data?.rows.map((market) => [market.coin, market]) ?? []),
    [data],
  );
  const openTrades = trades
    .filter((trade) => trade.status === "OPEN")
    .sort(
      (left, right) =>
        new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime(),
    );
  const closedTrades = trades
    .filter((trade) => trade.status === "CLOSED")
    .sort(
      (left, right) =>
        new Date(right.closedAt ?? 0).getTime() -
        new Date(left.closedAt ?? 0).getTime(),
    );
  const grossExposure = openTrades.reduce(
    (sum, trade) => sum + trade.notionalUsd,
    0,
  );
  const totalMargin = openTrades.reduce(
    (sum, trade) => sum + trade.marginUsd,
    0,
  );
  const openPnl = openTrades.reduce((sum, trade) => {
    const mark = marketByCoin.get(trade.coin)?.markPx;
    return sum + (mark ? paperPnl(trade, mark).usd : 0);
  }, 0);
  const realizedPnl = closedTrades.reduce(
    (sum, trade) => sum + (trade.realizedPnl ?? 0),
    0,
  );
  const exitReviews = openTrades.filter(
    (trade) =>
      tradeHealth(trade, marketByCoin.get(trade.coin)) === "EXIT_REVIEW",
  ).length;
  const wins = closedTrades.filter((trade) => (trade.realizedPnl ?? 0) > 0)
    .length;

  function closeAtMark(trade: TrackedTrade) {
    const market = marketByCoin.get(trade.coin);
    if (!market?.markPx) return;
    const result = paperPnl(trade, market.markPx);
    const next = trades.map((item) =>
      item.id === trade.id
        ? {
            ...item,
            status: "CLOSED" as const,
            closedAt: new Date().toISOString(),
            exitPrice: market.markPx,
            realizedPnl: result.usd,
            closeReason: "Manual close at the latest Hyperliquid mark",
          }
        : item,
    );
    setTrades(next);
    saveTrackedTrades(next);
  }

  function removeTrade(tradeId: string) {
    const next = trades.filter((trade) => trade.id !== tradeId);
    setTrades(next);
    saveTrackedTrades(next);
  }

  return (
    <div className="hl-app">
      <header className="hl-topbar">
        <Link className="hl-brand" href="/" aria-label="HyperEdge">
          <span className="hl-brand-mark">
            <Activity size={18} />
          </span>
          <div>
            <strong>HyperEdge</strong>
            <span>Perpetual market intelligence</span>
          </div>
        </Link>
        <nav className="hl-nav" aria-label="Primary navigation">
          <Link href="/">Edge Radar</Link>
          <Link href="/venues">Venue Lens</Link>
          <Link className="is-active" href="/paper">
            Trade Journal
          </Link>
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
          <span className="hl-auto-mark">Live marks every 30 sec</span>
          <Link
            className="icon-button hl-mobile-nav-link"
            href="/"
            title="Open Edge Radar"
            aria-label="Open Edge Radar"
          >
            <Activity size={17} />
          </Link>
          <button
            className="icon-button"
            type="button"
            title="Refresh live marks"
            aria-label="Refresh live marks"
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
            <p className="eyebrow">Paper trade tracking</p>
            <h1>Trade Journal</h1>
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

        <section className="hl-kpis hl-journal-kpis" aria-label="Trade summary">
          <article>
            <BookOpenCheck size={17} />
            <span>Open paper trades</span>
            <strong>{openTrades.length}</strong>
            <small>Started from Radar signals</small>
          </article>
          <article>
            <Activity size={17} />
            <span>Leveraged exposure</span>
            <strong>{compactUsd(grossExposure)}</strong>
            <small>{compactUsd(totalMargin)} paper margin</small>
          </article>
          <article>
            {openPnl >= 0 ? (
              <ArrowUpRight size={17} />
            ) : (
              <ArrowDownRight size={17} />
            )}
            <span>Open margin P&amp;L</span>
            <strong className={openPnl >= 0 ? "positive" : "negative"}>
              {money(openPnl)}
            </strong>
            <small>Before fees and funding</small>
          </article>
          <article>
            <ShieldAlert size={17} />
            <span>Exit reviews</span>
            <strong>{exitReviews}</strong>
            <small>Opposite bias or blocked market</small>
          </article>
          <article>
            <CircleCheck size={17} />
            <span>Closed record</span>
            <strong>{money(realizedPnl)}</strong>
            <small>
              {closedTrades.length > 0
                ? `${wins}/${closedTrades.length} profitable`
                : "No closed trades yet"}
            </small>
          </article>
        </section>

        <section className="hl-journal-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Live monitoring</p>
              <h2>Open trade plans</h2>
            </div>
            <span className="method-tag">
              {loading ? "Loading marks" : `${openTrades.length} active`}
            </span>
          </div>

          {openTrades.length === 0 ? (
            <div className="hl-journal-empty">
              <BookOpenCheck size={25} />
              <strong>No paper trades are being tracked</strong>
              <p>
                Open a qualified Radar setup and start a paper trade from its
                detail panel.
              </p>
              <Link className="hl-command-button" href="/">
                Open Edge Radar
              </Link>
            </div>
          ) : (
            <div className="hl-trade-list">
              {openTrades.map((trade) => {
                const market = marketByCoin.get(trade.coin);
                const mark = market?.markPx;
                const result = mark ? paperPnl(trade, mark) : null;
                const health = tradeHealth(trade, market);
                return (
                  <article className="hl-trade-card" key={trade.id}>
                    <header>
                      <div className="hl-trade-identity">
                        <span
                          className={`hl-direction tone-${trade.direction.toLowerCase()}`}
                        >
                          {trade.direction === "LONG" ? (
                            <ArrowUpRight size={14} />
                          ) : (
                            <ArrowDownRight size={14} />
                          )}
                          {trade.direction}
                        </span>
                        <div>
                          <h3>{trade.coin}</h3>
                          <p>
                            {trade.category} / {trade.dexName}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`hl-health tone-${healthTone(health)}`}
                      >
                        {healthLabel(health)}
                      </span>
                      <div className="hl-trade-pnl">
                        <span>Margin P&amp;L</span>
                        <strong
                          className={
                            (result?.usd ?? 0) >= 0 ? "positive" : "negative"
                          }
                        >
                          {result ? money(result.usd) : "-"}
                        </strong>
                        <small>
                          {result ? signed(result.pct) : "No live mark"}
                        </small>
                      </div>
                    </header>

                    <div className="hl-trade-metrics">
                      <div>
                        <span>Entry</span>
                        <strong>{price(trade.entryPrice)}</strong>
                      </div>
                      <div>
                        <span>Live mark</span>
                        <strong>{mark ? price(mark) : "-"}</strong>
                      </div>
                      <div>
                        <span>Margin</span>
                        <strong>{compactUsd(trade.marginUsd)}</strong>
                      </div>
                      <div>
                        <span>Leverage</span>
                        <strong>{trade.leverage}x</strong>
                      </div>
                      <div>
                        <span>Exposure</span>
                        <strong>{compactUsd(trade.notionalUsd)}</strong>
                      </div>
                      <div>
                        <span>Live funding</span>
                        <strong>
                          {market
                            ? signed(market.fundingAnnualPct, 1)
                            : "-"}
                        </strong>
                      </div>
                    </div>

                    <div className="hl-trade-thesis">
                      <div>
                        <span>Entry read</span>
                        <p>{trade.rationale}</p>
                      </div>
                      <div>
                        <span>Live read</span>
                        <p>{liveRead(trade, market)}</p>
                      </div>
                      <div>
                        <span>Exit condition</span>
                        <p>{trade.invalidation}</p>
                      </div>
                    </div>

                    <footer>
                      <small>
                        Started {new Date(trade.openedAt).toLocaleString()} at{" "}
                        {trade.leverage}x,{" "}
                        {trade.signalAlignedAtEntry ? "aligned with" : "against"}{" "}
                        {trade.signalLabel}
                      </small>
                      <div>
                        <a
                          className="icon-button"
                          href={`https://app.hyperliquid.xyz/trade/${encodeURIComponent(trade.coin)}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Open market on Hyperliquid"
                          aria-label={`Open ${trade.coin} on Hyperliquid`}
                        >
                          <ExternalLink size={16} />
                        </a>
                        <button
                          className="hl-close-trade"
                          type="button"
                          disabled={!mark}
                          onClick={() => closeAtMark(trade)}
                        >
                          Close at live mark
                        </button>
                      </div>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="hl-journal-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Outcome record</p>
              <h2>Closed journal</h2>
            </div>
            <span className="method-tag">
              {closedTrades.length > 0
                ? `${Math.round((wins / closedTrades.length) * 100)}% profitable`
                : "No sample yet"}
            </span>
          </div>
          <div className="hl-closed-wrap">
            <table className="hl-closed-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th>Exposure</th>
                  <th>Leverage</th>
                  <th>Margin P&amp;L</th>
                  <th>Closed</th>
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {closedTrades.map((trade) => (
                  <tr key={trade.id}>
                    <td>
                      <strong>{trade.coin}</strong>
                      <small>{trade.signalLabel}</small>
                    </td>
                    <td>{trade.direction}</td>
                    <td>{price(trade.entryPrice)}</td>
                    <td>{trade.exitPrice ? price(trade.exitPrice) : "-"}</td>
                    <td>{compactUsd(trade.notionalUsd)}</td>
                    <td>{trade.leverage}x</td>
                    <td
                      className={
                        (trade.realizedPnl ?? 0) >= 0 ? "positive" : "negative"
                      }
                    >
                      {money(trade.realizedPnl ?? 0)}
                    </td>
                    <td>
                      {trade.closedAt
                        ? new Date(trade.closedAt).toLocaleString()
                        : "-"}
                    </td>
                    <td>
                      <button
                        className="hl-bookmark"
                        type="button"
                        title="Remove journal entry"
                        aria-label={`Remove ${trade.coin} journal entry`}
                        onClick={() => removeTrade(trade.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
                {closedTrades.length === 0 && (
                  <tr>
                    <td className="hl-empty" colSpan={9}>
                      Closed paper trades will appear here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="hl-journal-note">
          Paper results apply mark-price movement to leveraged exposure. They do
          not include fees, funding payments, slippage, liquidation, margin
          maintenance, or actual fills.
        </footer>
      </main>
    </div>
  );
}
