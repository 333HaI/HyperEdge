import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEmpiricalAlpha,
  empiricalOverlayVerdict,
  fetchHyperliquidFundingHistory,
  scoreHyperliquidMarket,
} from "../app/lib/hyperliquid.ts";
import {
  buildEmpiricalAlphaModel,
  type EmpiricalAlphaModel,
} from "../app/lib/alphaModel.ts";
import {
  createTrackedTrade,
  paperPnl,
  tradeHealth,
} from "../app/lib/tradeJournal.ts";
import {
  buildVenueComparisons,
  normalizeLighterMarkets,
  normalizeVariationalMarkets,
} from "../app/lib/venues.ts";

function alphaFixture(
  direction: "LONG" | "SHORT" = "SHORT",
): EmpiricalAlphaModel {
  return {
    coin: "xyz:NVDA",
    observedAt: "2026-01-01T00:00:00.000Z",
    dataStart: "2025-10-01T00:00:00.000Z",
    dataEnd: "2026-01-01T00:00:00.000Z",
    horizonHours: 4,
    status: "READY",
    statusReason: "Positive chronological holdout.",
    direction,
    predictedReturnPct: direction === "LONG" ? 0.8 : -0.8,
    predictedFundingPct: 0.01,
    predictedNetReturnPct: 0.68,
    entryThresholdPct: 0.4,
    edgePercentile: 88,
    forecastZ: direction === "LONG" ? 1.2 : -1.2,
    qualifies: true,
    observations: 1_200,
    formationObservations: 840,
    holdoutObservations: 360,
    holdoutTrades: 84,
    holdoutHitRatePct: 61,
    holdoutMeanNetReturnPct: 0.24,
    holdoutInformationCoefficient: 0.12,
    holdoutRmsePct: 0.65,
    earlyHoldoutMeanPct: 0.2,
    recentHoldoutMeanPct: 0.28,
    selectedLambda: 10,
    feeAssumptionBps: 9,
    impactCostBps: 2,
    factors: [],
  };
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function normal(next: () => number): number {
  const first = Math.max(next(), 1e-12);
  const second = next();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

test("Hyperliquid scanner keeps rule signals while alpha validates in shadow mode", () => {
  const base = {
    coin: "xyz:NVDA",
    symbol: "NVDA",
    dex: "xyz",
    dexName: "XYZ",
    category: "Stocks" as const,
    isHip3: true,
    isDelisted: false,
    marginMode: "isolated",
    maxLeverage: 20,
    markPx: 200.2,
    oraclePx: 200,
    midPx: 200.1,
    prevDayPx: 196,
    change24hPct: -1.14,
    fundingHourlyPct: 0.0025,
    fundingAnnualPct: 21.9,
    premiumBps: 9,
    basisBps: 10,
    openInterest: 100_000,
    openInterestUsd: 20_000_000,
    dayVolumeUsd: 50_000_000,
    turnover: 2.5,
    impactSpreadBps: 5,
  };

  const pending = scoreHyperliquidMarket(base);
  const alphaShort = applyEmpiricalAlpha(
    pending,
    alphaFixture("SHORT"),
  );
  const alphaLong = applyEmpiricalAlpha(pending, alphaFixture("LONG"));
  const weakAlpha = applyEmpiricalAlpha(pending, {
    ...alphaFixture("SHORT"),
    status: "WEAK",
    qualifies: false,
  });
  const blocked = scoreHyperliquidMarket({
    ...base,
    coin: "xyz:THIN",
    symbol: "THIN",
    dayVolumeUsd: 2_000,
    openInterestUsd: 8_000,
    impactSpreadBps: 220,
  });

  assert.equal(pending.signal, "CARRY_SHORT");
  assert.equal(pending.bias, "SHORT");
  assert.equal(pending.actionable, true);
  assert.ok(pending.score >= 55);
  assert.equal(alphaShort.signal, "CARRY_SHORT");
  assert.equal(alphaShort.bias, "SHORT");
  assert.equal(alphaShort.actionable, true);
  assert.equal(alphaShort.score, pending.score);
  assert.equal(empiricalOverlayVerdict(alphaShort), "CONFIRMED");
  assert.equal(empiricalOverlayVerdict(alphaLong), "CONFLICT");
  assert.equal(empiricalOverlayVerdict(weakAlpha), "UNVALIDATED");
  assert.equal(blocked.signal, "AVOID");
  assert.equal(blocked.actionable, false);
  assert.equal(blocked.signalLabel, "Execution blocked");
  assert.equal(blocked.blockReasons.length, 3);
  assert.match(blocked.rationale, /volume/i);
  assert.match(blocked.rationale, /open interest/i);
  assert.match(blocked.rationale, /impact spread/i);

  const highQualityWatch = scoreHyperliquidMarket({
    ...base,
    fundingAnnualPct: -98,
    basisBps: -11,
    change24hPct: -3,
  });
  const crowdedMomentum = scoreHyperliquidMarket({
    ...base,
    fundingAnnualPct: 45,
    basisBps: 5,
    change24hPct: 5,
  });
  const fundedMomentum = scoreHyperliquidMarket({
    ...base,
    fundingAnnualPct: -5,
    basisBps: 5,
    change24hPct: 5,
  });

  assert.equal(highQualityWatch.signal, "WATCH");
  assert.ok(highQualityWatch.score <= 54);
  assert.equal(crowdedMomentum.signal, "MOMENTUM_LONG");
  assert.equal(fundedMomentum.signal, "MOMENTUM_LONG");
  assert.ok(fundedMomentum.score > crowdedMomentum.score);
});

test("Hyperliquid journal marks long and short paper trades correctly", () => {
  const base = {
    coin: "xyz:NVDA",
    symbol: "NVDA",
    dex: "xyz",
    dexName: "XYZ",
    category: "Stocks" as const,
    isHip3: true,
    isDelisted: false,
    marginMode: "isolated",
    maxLeverage: 20,
    markPx: 200.2,
    oraclePx: 200,
    midPx: 200.1,
    prevDayPx: 202.5,
    change24hPct: -1.14,
    fundingHourlyPct: 0.0025,
    fundingAnnualPct: 21.9,
    premiumBps: 9,
    basisBps: 10,
    openInterest: 100_000,
    openInterestUsd: 20_000_000,
    dayVolumeUsd: 50_000_000,
    turnover: 2.5,
    impactSpreadBps: 5,
  };
  const market = applyEmpiricalAlpha(
    scoreHyperliquidMarket(base),
    alphaFixture("SHORT"),
  );
  const trade = createTrackedTrade(market, 10_000);
  const profit = paperPnl(trade, 190.19);
  const loss = paperPnl(trade, 210.21);

  assert.equal(trade.direction, "SHORT");
  assert.ok(Math.abs(profit.usd - 500) < 0.01);
  assert.ok(Math.abs(profit.pct - 5) < 0.001);
  assert.ok(Math.abs(loss.usd + 500) < 0.01);
  assert.equal(tradeHealth(trade, market), "ON_PLAN");
  assert.equal(
    tradeHealth(
      trade,
      applyEmpiricalAlpha(
        scoreHyperliquidMarket({
          ...base,
          fundingAnnualPct: -21.9,
          basisBps: -10,
          change24hPct: 1.14,
        }),
        alphaFixture("LONG"),
      ),
    ),
    "EXIT_REVIEW",
  );

  const leveragedManualLong = createTrackedTrade(
    market,
    2_000,
    "LONG",
    5,
  );
  const leveragedProfit = paperPnl(leveragedManualLong, 210.21);
  assert.equal(leveragedManualLong.marginUsd, 2_000);
  assert.equal(leveragedManualLong.leverage, 5);
  assert.equal(leveragedManualLong.notionalUsd, 10_000);
  assert.equal(leveragedManualLong.signalAlignedAtEntry, false);
  assert.ok(Math.abs(leveragedProfit.usd - 500) < 0.01);
  assert.ok(Math.abs(leveragedProfit.pct - 25) < 0.001);
  assert.equal(tradeHealth(leveragedManualLong, market), "REVIEW");
});

test("empirical alpha model validates a persistent synthetic return process", () => {
  const next = random(101);
  const hour = 60 * 60 * 1000;
  const start = Date.UTC(2025, 0, 1);
  let close = 100;
  let latentReturn = 0;
  const candles = Array.from({ length: 1_400 }, (_, index) => {
    const open = close;
    latentReturn =
      0.88 * latentReturn + 0.0018 * normal(next);
    close *= Math.exp(latentReturn);
    const high = Math.max(open, close) * 1.001;
    const low = Math.min(open, close) * 0.999;
    return {
      time: start + index * hour,
      endTime: start + (index + 1) * hour,
      open,
      high,
      low,
      close,
      volume: 2_000 + Math.abs(latentReturn) * 2_000_000,
      trades: 100,
    };
  });
  const funding = candles.map((candle, index) => ({
    time: candle.endTime,
    fundingRate: 0.000005 * Math.sin(index / 40),
    premium: 0.0001 * Math.sin(index / 20),
  }));
  const model = buildEmpiricalAlphaModel("SYNTH", candles, funding, 2);

  assert.equal(model.status, "READY");
  assert.ok(model.observations > 1_000);
  assert.ok(model.holdoutTrades >= 20);
  assert.ok((model.holdoutHitRatePct ?? 0) > 50);
  assert.ok((model.holdoutMeanNetReturnPct ?? 0) > 0);
  assert.ok((model.holdoutInformationCoefficient ?? 0) > 0);
  assert.equal(model.factors.length, 11);
  assert.ok(model.selectedLambda !== null);

  const sparseFundingModel = buildEmpiricalAlphaModel(
    "SYNTH-SPARSE",
    candles,
    funding.slice(-500),
    2,
  );
  assert.ok(sparseFundingModel.observations >= 300);
  assert.ok(sparseFundingModel.observations <= 330);
});

test("Hyperliquid funding history paginates past the 500-record limit", async () => {
  const originalFetch = globalThis.fetch;
  const startTime = 1_000;
  const endTime = 1_700;
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    const body = JSON.parse(String(init?.body)) as {
      startTime: number;
      endTime: number;
    };
    const pageEnd = Math.min(body.startTime + 499, body.endTime);
    const points = Array.from(
      { length: pageEnd - body.startTime + 1 },
      (_, index) => ({
        time: body.startTime + index,
        fundingRate: "0.00001",
        premium: "0.00002",
      }),
    );
    return new Response(JSON.stringify(points), { status: 200 });
  };

  try {
    const points = await fetchHyperliquidFundingHistory(
      "TEST",
      startTime,
      endTime,
    );
    assert.equal(requests, 2);
    assert.equal(points.length, 701);
    assert.equal(points[0].time, startTime);
    assert.equal(points.at(-1)?.time, endTime);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("venue adapters preserve source-native funding and OI conventions", () => {
  const lighter = normalizeLighterMarkets(
    {
      code: 200,
      order_book_details: [
        {
          symbol: "BTC",
          market_id: 1,
          market_type: "perp",
          status: "active",
          mark_price: "100",
          index_price: "99",
          open_interest: 10,
          daily_quote_token_volume: 2_000_000,
          daily_price_change: 2,
          market_config: { hidden: false },
        },
      ],
    },
    {
      code: 200,
      funding_rates: [
        { market_id: 1, exchange: "binance", symbol: "BTC", rate: -0.01 },
        { market_id: 1, exchange: "lighter", symbol: "BTC", rate: 0.0001 },
      ],
    },
  );
  const variational = normalizeVariationalMarkets({
    total_volume_24h: "3000000",
    open_interest: "5000",
    num_markets: 1,
    listings: [
      {
        ticker: "BTC",
        name: "Bitcoin",
        mark_price: "101",
        volume_24h: "3000000",
        open_interest: {
          long_open_interest: "2000",
          short_open_interest: "3000",
        },
        funding_rate: "-0.02",
        funding_interval_s: 28_800,
        quotes: {
          updated_at: "2026-01-01T00:00:00.000Z",
          size_100k: { bid: "99", ask: "101" },
        },
      },
    ],
  });

  assert.equal(lighter.length, 1);
  assert.equal(lighter[0].openInterestUsd, 1_000);
  assert.equal(lighter[0].openInterestConvention, "Base OI x mark");
  assert.equal(lighter[0].fundingRatePct, 0.01);
  assert.ok(Math.abs((lighter[0].fundingAnnualPct ?? 0) - 87.6) < 1e-9);
  assert.equal(variational[0].openInterestUsd, 5_000);
  assert.equal(
    variational[0].openInterestConvention,
    "Long + short reported OI",
  );
  assert.equal(variational[0].fundingAnnualPct, null);
  assert.ok(Math.abs((variational[0].executionBps ?? 0) - 200) < 1e-9);

  const [comparison] = buildVenueComparisons([...lighter, ...variational]);
  assert.equal(comparison.symbol, "BTC");
  assert.equal(comparison.venueCount, 2);
  assert.equal(comparison.state, "FUNDING_DIVERGENCE");
  assert.equal(comparison.totalOpenInterestUsd, 6_000);
});

test("venue comparisons reject ticker collisions and contract-scale mismatches", () => {
  const seed = normalizeLighterMarkets(
    {
      code: 200,
      order_book_details: [
        {
          symbol: "STX",
          market_id: 1,
          market_type: "perp",
          status: "active",
          mark_price: "0.135",
          index_price: "0.135",
          open_interest: 1_000,
          daily_quote_token_volume: 1_000_000,
          daily_price_change: 0,
          market_config: { hidden: false },
        },
      ],
    },
    {
      code: 200,
      funding_rates: [
        { market_id: 1, exchange: "lighter", symbol: "STX", rate: 0 },
      ],
    },
  )[0];
  const comparisons = buildVenueComparisons([
    { ...seed, id: "stx-core", venue: "Hyperliquid", venueFamily: "Hyperliquid" },
    {
      ...seed,
      id: "stx-variational",
      venue: "Variational",
      venueFamily: "Variational",
      markPx: 0.1345,
    },
    {
      ...seed,
      id: "stx-stock",
      venue: "Paragon",
      venueFamily: "Hyperliquid",
      category: "Stocks",
      markPx: 844.86,
      dayVolumeUsd: 5_000_000,
    },
    {
      ...seed,
      id: "us500-lighter",
      venue: "Lighter",
      symbol: "US500",
      category: "Indices",
      markPx: 7_445,
    },
    {
      ...seed,
      id: "us500-variational",
      venue: "Variational",
      venueFamily: "Variational",
      symbol: "US500",
      category: "Indices",
      markPx: 743,
    },
  ]);

  const stx = comparisons.find((comparison) => comparison.symbol === "STX");
  assert.ok(stx);
  assert.equal(stx.venueCount, 2);
  assert.deepEqual(stx.venues.sort(), ["Hyperliquid", "Variational"]);
  assert.equal(
    comparisons.some((comparison) => comparison.symbol === "US500"),
    false,
  );
});
