"use client";

import {
  Activity,
  BarChart3,
  BookOpenCheck,
  CircleDollarSign,
  GitCompareArrows,
  Globe2,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  VenueComparison,
  VenueComparisonState,
  VenueFamily,
  VenueIntelligenceResponse,
  VenueMarketSnapshot,
} from "../lib/venues";
import { ThemeToggle } from "./ThemeToggle";

type ComparisonSort = "venues" | "volume" | "dispersion" | "openInterest";

function compactUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function price(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumSignificantDigits: 7,
  }).format(value);
}

function signed(value: number, digits = 2, suffix = "%"): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function comparisonTone(state: VenueComparisonState): string {
  if (state === "FUNDING_DIVERGENCE") return "divergent";
  if (state === "POSITIVE_FUNDING") return "positive-funding";
  if (state === "NEGATIVE_FUNDING") return "negative-funding";
  return "mixed";
}

function fundingText(market: VenueMarketSnapshot): string {
  if (market.fundingRatePct === null) return "Unavailable";
  if (market.fundingAnnualPct !== null) {
    return `${signed(market.fundingAnnualPct, 1)} APR est.`;
  }
  return `${signed(market.fundingRatePct, 3)} ${market.fundingPeriod}`;
}

function comparisonSortValue(
  comparison: VenueComparison,
  sort: ComparisonSort,
): number {
  if (sort === "volume") return comparison.totalDayVolumeUsd;
  if (sort === "openInterest") return comparison.totalOpenInterestUsd;
  if (sort === "dispersion") return comparison.markDispersionBps ?? -Infinity;
  return comparison.venueCount;
}

export default function VenueLens() {
  const [data, setData] = useState<VenueIntelligenceResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [family, setFamily] = useState<"All" | VenueFamily>("All");
  const [state, setState] = useState<"All" | VenueComparisonState>("All");
  const [sort, setSort] = useState<ComparisonSort>("venues");

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/venues", { cache: "no-store" });
      const payload = (await response.json()) as
        | VenueIntelligenceResponse
        | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "Venue data could not be loaded.",
        );
      }
      setData(payload);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Venue data could not be loaded.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const comparisons = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.comparisons ?? [])
      .filter(
        (comparison) =>
          !query ||
          comparison.symbol.toLowerCase().includes(query) ||
          comparison.venues.some((venue) =>
            venue.toLowerCase().includes(query),
          ),
      )
      .filter(
        (comparison) =>
          family === "All" ||
          comparison.markets.some((market) => market.venueFamily === family),
      )
      .filter((comparison) => state === "All" || comparison.state === state)
      .sort(
        (left, right) =>
          comparisonSortValue(right, sort) - comparisonSortValue(left, sort),
      );
  }, [data, family, search, sort, state]);

  const markets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.markets ?? [])
      .filter(
        (market) =>
          !query ||
          market.symbol.toLowerCase().includes(query) ||
          market.venue.toLowerCase().includes(query),
      )
      .filter((market) => family === "All" || market.venueFamily === family)
      .slice(0, 300);
  }, [data, family, search]);

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
          <Link className="is-active" href="/venues">
            Venue Lens
          </Link>
          <Link href="/paper">Trade Journal</Link>
        </nav>
        <div className="hl-live-controls">
          <ThemeToggle />
          <Link
            className="icon-button hl-mobile-nav-link"
            href="/"
            title="Open Edge Radar"
            aria-label="Open Edge Radar"
          >
            <Activity size={17} />
          </Link>
          <Link
            className="icon-button hl-mobile-nav-link"
            href="/paper"
            title="Open Trade Journal"
            aria-label="Open Trade Journal"
          >
            <BookOpenCheck size={17} />
          </Link>
          <span className="hl-auto-mark">
            {data ? `Snapshot ${timeLabel(data.fetchedAt)}` : "Connecting"}
          </span>
          <button
            className="icon-button"
            type="button"
            title="Refresh venue data"
            aria-label="Refresh venue data"
            disabled={refreshing}
            onClick={() => void load(true)}
          >
            <RefreshCw className={refreshing ? "spin" : ""} size={17} />
          </button>
        </div>
      </header>

      <main className="hl-main venue-main">
        <section className="hl-heading">
          <div>
            <p className="eyebrow">Cross-venue market evidence</p>
            <h1>Venue Lens</h1>
          </div>
          <div className="hl-source">
            <span className="live-dot" />
            <strong>Public read-only APIs</strong>
            <span>Hyperliquid / Lighter / Variational</span>
          </div>
        </section>

        {error && (
          <section className="hl-error">
            <ShieldAlert size={18} />
            <span>{error}</span>
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          </section>
        )}

        <section className="hl-kpis" aria-label="Cross-venue summary">
          <article>
            <Globe2 size={17} />
            <span>Venue families</span>
            <strong>{data?.summary.venueFamilies ?? "-"}</strong>
            <small>{data?.summary.venues ?? "-"} execution venues</small>
          </article>
          <article>
            <BarChart3 size={17} />
            <span>Market observations</span>
            <strong>{data?.summary.markets ?? "-"}</strong>
            <small>Source-native public snapshots</small>
          </article>
          <article>
            <GitCompareArrows size={17} />
            <span>Cross-venue overlaps</span>
            <strong>{data?.summary.overlaps ?? "-"}</strong>
            <small>Price-compatible contracts on 2+ venues</small>
          </article>
          <article>
            <CircleDollarSign size={17} />
            <span>Combined 24h volume</span>
            <strong>
              {data ? compactUsd(data.summary.dayVolumeUsd) : "-"}
            </strong>
            <small>Sum of venue-reported notional</small>
          </article>
          <article>
            <Activity size={17} />
            <span>Reported OI sum</span>
            <strong>
              {data ? compactUsd(data.summary.openInterestUsd) : "-"}
            </strong>
            <small>Venue conventions are not interchangeable</small>
          </article>
        </section>

        <section className="venue-source-strip" aria-label="Data source status">
          {(data?.sources ?? []).map((source) => (
            <div
              className={source.stale ? "is-stale" : source.ok ? "is-live" : "is-error"}
              key={source.venue}
            >
              <span className="live-dot" />
              <strong>{source.venue}</strong>
              <small>
                {source.ok
                  ? `${source.markets} markets${source.stale ? ` / ${source.message}` : ""}`
                  : source.message}
              </small>
            </div>
          ))}
        </section>

        <section className="hl-ledger venue-comparisons">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Validated agreement and dispersion</p>
              <h2>Cross-venue comparisons</h2>
            </div>
            <span className="hl-row-count">{comparisons.length} symbols</span>
          </div>

          <div className="hl-filters venue-filters">
            <label className="hl-search">
              <Search size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search symbol or venue"
              />
            </label>
            <select
              aria-label="Venue family filter"
              value={family}
              onChange={(event) =>
                setFamily(event.target.value as "All" | VenueFamily)
              }
            >
              <option value="All">All venue families</option>
              <option value="Hyperliquid">Hyperliquid</option>
              <option value="Lighter">Lighter</option>
              <option value="Variational">Variational</option>
            </select>
            <select
              aria-label="Comparison state filter"
              value={state}
              onChange={(event) =>
                setState(event.target.value as "All" | VenueComparisonState)
              }
            >
              <option value="All">All evidence states</option>
              <option value="FUNDING_DIVERGENCE">Funding disagreement</option>
              <option value="POSITIVE_FUNDING">Longs pay across venues</option>
              <option value="NEGATIVE_FUNDING">Shorts pay across venues</option>
              <option value="MIXED">Limited agreement</option>
            </select>
            <select
              aria-label="Comparison sort"
              value={sort}
              onChange={(event) =>
                setSort(event.target.value as ComparisonSort)
              }
            >
              <option value="venues">Sort: venue coverage</option>
              <option value="volume">Sort: combined volume</option>
              <option value="openInterest">Sort: reported OI sum</option>
              <option value="dispersion">Sort: mark dispersion</option>
            </select>
          </div>

          <div className="hl-table-wrap venue-table-wrap">
            <table className="hl-table venue-table venue-comparison-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Evidence</th>
                  <th>Venues</th>
                  <th>Venue marks</th>
                  <th>Funding</th>
                  <th>Mark dispersion</th>
                  <th>Reported OI sum</th>
                  <th>Combined volume</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr className="hl-skeleton-row">
                    <td colSpan={8}>
                      <span />
                    </td>
                  </tr>
                )}
                {!loading &&
                  comparisons.map((comparison) => (
                    <tr key={comparison.symbol}>
                      <td>
                        <strong>{comparison.symbol}</strong>
                        <small>{comparison.category}</small>
                      </td>
                      <td>
                        <span
                          className={`venue-state tone-${comparisonTone(comparison.state)}`}
                        >
                          {comparison.stateLabel}
                        </span>
                      </td>
                      <td>
                        <strong>{comparison.venueCount}</strong>
                        <small>{comparison.venues.join(" / ")}</small>
                      </td>
                      <td>
                        <div className="venue-value-stack">
                          {comparison.markets.map((market) => (
                            <span key={`${comparison.symbol}-${market.venue}-mark`}>
                              <small>{market.venue}</small>
                              <strong>{price(market.markPx)}</strong>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="venue-value-stack">
                          {comparison.markets.map((market) => (
                            <span key={`${comparison.symbol}-${market.venue}-funding`}>
                              <small>{market.venue}</small>
                              <strong
                                className={
                                  (market.fundingRatePct ?? 0) > 0
                                    ? "negative"
                                    : (market.fundingRatePct ?? 0) < 0
                                      ? "positive"
                                      : ""
                                }
                              >
                                {fundingText(market)}
                              </strong>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {comparison.markDispersionBps === null
                          ? "-"
                          : `${comparison.markDispersionBps.toFixed(1)} bps`}
                      </td>
                      <td>{compactUsd(comparison.totalOpenInterestUsd)}</td>
                      <td>{compactUsd(comparison.totalDayVolumeUsd)}</td>
                    </tr>
                  ))}
                {!loading && comparisons.length === 0 && (
                  <tr>
                    <td className="hl-empty" colSpan={8}>
                      No cross-venue symbols match the active filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="hl-ledger venue-market-ledger">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Source-level observations</p>
              <h2>Venue market ledger</h2>
            </div>
            <span className="hl-row-count">{markets.length} rows</span>
          </div>
          <div className="hl-table-wrap venue-table-wrap">
            <table className="hl-table venue-table venue-market-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Venue</th>
                  <th>Mark</th>
                  <th>24h</th>
                  <th>Funding</th>
                  <th>Basis</th>
                  <th>Execution proxy</th>
                  <th>Reported open interest</th>
                  <th>24h volume</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((market) => (
                  <tr key={market.id}>
                    <td>
                      <strong>{market.symbol}</strong>
                      <small>{market.category}</small>
                    </td>
                    <td>
                      <span className={`venue-family venue-${market.venueFamily.toLowerCase()}`}>
                        {market.venue}
                      </span>
                    </td>
                    <td>{price(market.markPx)}</td>
                    <td
                      className={
                        (market.change24hPct ?? 0) > 0
                          ? "positive"
                          : (market.change24hPct ?? 0) < 0
                            ? "negative"
                            : ""
                      }
                    >
                      {market.change24hPct === null
                        ? "-"
                        : signed(market.change24hPct)}
                    </td>
                    <td>{fundingText(market)}</td>
                    <td>
                      {market.basisBps === null
                        ? "-"
                        : signed(market.basisBps, 1, " bps")}
                    </td>
                    <td>
                      {market.executionBps === null
                        ? "-"
                        : `${market.executionBps.toFixed(1)} bps`}
                      <small>
                        {market.executionLabel}
                        {market.quoteUpdatedAt
                          ? ` / ${timeLabel(market.quoteUpdatedAt)}`
                          : ""}
                      </small>
                    </td>
                    <td>
                      {compactUsd(market.openInterestUsd)}
                      <small>{market.openInterestConvention}</small>
                    </td>
                    <td>{compactUsd(market.dayVolumeUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
