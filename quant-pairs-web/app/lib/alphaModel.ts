import type {
  HyperliquidCandle,
  HyperliquidFundingPoint,
} from "./hyperliquid";

const HOUR_MS = 60 * 60 * 1000;
const HORIZON_HOURS = 4;
const MIN_EXAMPLES = 320;
const HOLDOUT_SHARE = 0.3;
const ROUND_TRIP_FEE_PCT = 0.09;
const RETRAIN_EVERY = 24;

export const ALPHA_FEATURES = [
  { key: "momentum1h", label: "1h momentum" },
  { key: "momentum4h", label: "4h momentum" },
  { key: "momentum24h", label: "24h momentum" },
  { key: "emaGap20", label: "EMA20 gap" },
  { key: "emaSlope4h", label: "EMA20 slope" },
  { key: "rsi14", label: "RSI14" },
  { key: "realizedVol24h", label: "24h volatility" },
  { key: "volumeZ24h", label: "Volume surprise" },
  { key: "fundingAnnualPct", label: "Funding level" },
  { key: "fundingZ168h", label: "Funding percentile" },
  { key: "premiumBps", label: "Funding premium" },
] as const;

export type AlphaFeatureKey = (typeof ALPHA_FEATURES)[number]["key"];
export type EmpiricalAlphaStatus =
  | "READY"
  | "WEAK"
  | "UNSTABLE"
  | "INSUFFICIENT_DATA";

export interface AlphaFactorAttribution {
  key: AlphaFeatureKey;
  label: string;
  value: number;
  zScore: number;
  coefficient: number;
  contributionPct: number;
}

export interface EmpiricalAlphaModel {
  coin: string;
  observedAt: string;
  dataStart: string | null;
  dataEnd: string | null;
  horizonHours: number;
  status: EmpiricalAlphaStatus;
  statusReason: string;
  direction: "LONG" | "SHORT" | "NEUTRAL";
  predictedReturnPct: number | null;
  predictedFundingPct: number | null;
  predictedNetReturnPct: number | null;
  entryThresholdPct: number | null;
  edgePercentile: number;
  forecastZ: number | null;
  qualifies: boolean;
  observations: number;
  formationObservations: number;
  holdoutObservations: number;
  holdoutTrades: number;
  holdoutHitRatePct: number | null;
  holdoutMeanNetReturnPct: number | null;
  holdoutInformationCoefficient: number | null;
  holdoutRmsePct: number | null;
  earlyHoldoutMeanPct: number | null;
  recentHoldoutMeanPct: number | null;
  selectedLambda: number | null;
  feeAssumptionBps: number;
  impactCostBps: number;
  factors: AlphaFactorAttribution[];
}

interface AlphaSnapshot {
  observedTime: number;
  values: number[];
  fundingRate: number;
}

interface AlphaExample extends AlphaSnapshot {
  targetTime: number;
  targetReturnPct: number;
  longFundingReturnPct: number;
}

interface RidgeFit {
  means: number[];
  scales: number[];
  lowerBounds: number[];
  upperBounds: number[];
  targetMean: number;
  targetLower: number;
  targetUpper: number;
  coefficients: number[];
}

interface Prediction {
  example: AlphaExample;
  predictedReturnPct: number;
  netReturnPct: number;
}

function average(values: number[]): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      (values.length - 1),
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function quantile(values: number[], probability: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = clamp(probability, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return (
    sorted[lower] +
    (sorted[upper] - sorted[lower]) * (position - lower)
  );
}

function percentileRank(values: number[], current: number): number {
  if (values.length === 0 || !Number.isFinite(current)) return 0;
  const below = values.filter((value) => value < current).length;
  const equal = values.filter((value) => value === current).length;
  return Math.round(((below + equal * 0.5) / values.length) * 100);
}

function correlation(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 3) return null;
  const leftMean = average(left);
  const rightMean = average(right);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? covariance / denominator : null;
}

function emaSeries(values: number[], period: number): Array<number | null> {
  const result = Array<number | null>(values.length).fill(null);
  if (values.length < period) return result;
  let current = average(values.slice(0, period));
  result[period - 1] = current;
  const multiplier = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    current = values[index] * multiplier + current * (1 - multiplier);
    result[index] = current;
  }
  return result;
}

function returnPct(values: number[], index: number, bars: number): number {
  const prior = values[index - bars];
  return prior > 0 ? (values[index] / prior - 1) * 100 : 0;
}

function rollingZScore(
  values: number[],
  index: number,
  window: number,
): number {
  const history = values.slice(Math.max(0, index - window), index);
  const deviation = standardDeviation(history);
  return deviation > 1e-12
    ? (values[index] - average(history)) / deviation
    : 0;
}

function rsiAt(values: number[], index: number, period: number): number {
  let gains = 0;
  let losses = 0;
  for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
    const change = values[cursor] - values[cursor - 1];
    gains += Math.max(0, change);
    losses += Math.max(0, -change);
  }
  if (losses <= 1e-12) return 100;
  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

function realizedVolatility(values: number[], index: number): number {
  const returns: number[] = [];
  for (let cursor = index - 23; cursor <= index; cursor += 1) {
    const prior = values[cursor - 1];
    if (prior > 0 && values[cursor] > 0) {
      returns.push(Math.log(values[cursor] / prior));
    }
  }
  return standardDeviation(returns) * Math.sqrt(24) * 100;
}

function futureIndex(
  candles: HyperliquidCandle[],
  index: number,
  horizonHours: number,
): number {
  const target = candles[index].endTime + horizonHours * HOUR_MS;
  let low = index + 1;
  let high = candles.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].endTime >= target) {
      match = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return match;
}

function prepareExamples(
  rawCandles: HyperliquidCandle[],
  rawFunding: HyperliquidFundingPoint[],
): { examples: AlphaExample[]; current: AlphaSnapshot | null } {
  const candles = [...rawCandles]
    .filter(
      (candle) =>
        candle.close > 0 &&
        candle.volume >= 0 &&
        Number.isFinite(candle.endTime),
    )
    .sort((left, right) => left.endTime - right.endTime)
    .filter(
      (candle, index, values) =>
        index === 0 || candle.endTime !== values[index - 1].endTime,
    );
  const funding = [...rawFunding]
    .filter(
      (point) =>
        Number.isFinite(point.time) &&
        Number.isFinite(point.fundingRate) &&
        Number.isFinite(point.premium),
    )
    .sort((left, right) => left.time - right.time);
  if (candles.length < 180) return { examples: [], current: null };

  const closes = candles.map((candle) => candle.close);
  const logVolumes = candles.map((candle) =>
    Math.log(Math.max(candle.volume * candle.close, 1)),
  );
  const ema20 = emaSeries(closes, 20);
  const fundingRates = Array<number | null>(candles.length).fill(null);
  const premiums = Array<number | null>(candles.length).fill(null);
  let fundingCursor = -1;
  let fundingCoverageStart = -1;

  for (let index = 0; index < candles.length; index += 1) {
    while (
      fundingCursor + 1 < funding.length &&
      funding[fundingCursor + 1].time <= candles[index].endTime
    ) {
      fundingCursor += 1;
    }
    if (fundingCursor >= 0) {
      fundingRates[index] = funding[fundingCursor].fundingRate;
      premiums[index] = funding[fundingCursor].premium;
      if (fundingCoverageStart < 0) fundingCoverageStart = index;
    }
  }
  const annualFundingSeries = fundingRates.map((rate) =>
    rate === null ? Number.NaN : rate * 24 * 365 * 100,
  );

  function snapshotAt(index: number): AlphaSnapshot | null {
    const currentEma = ema20[index];
    const priorEma = ema20[index - 4];
    const fundingRate = fundingRates[index];
    const premium = premiums[index];
    if (
      currentEma === null ||
      priorEma === null ||
      fundingRate === null ||
      premium === null ||
      fundingCoverageStart < 0 ||
      index - fundingCoverageStart < 168
    ) {
      return null;
    }
    const annualFunding = fundingRate * 24 * 365 * 100;
    return {
      observedTime: candles[index].endTime,
      fundingRate,
      values: [
        returnPct(closes, index, 1),
        returnPct(closes, index, 4),
        returnPct(closes, index, 24),
        (closes[index] / currentEma - 1) * 100,
        (currentEma / priorEma - 1) * 100,
        rsiAt(closes, index, 14),
        realizedVolatility(closes, index),
        rollingZScore(logVolumes, index, 24),
        annualFunding,
        rollingZScore(annualFundingSeries, index, 168),
        premium * 10_000,
      ],
    };
  }

  const examples: AlphaExample[] = [];
  for (let index = 168; index < candles.length; index += 1) {
    const snapshot = snapshotAt(index);
    const targetIndex = futureIndex(candles, index, HORIZON_HOURS);
    if (!snapshot || targetIndex < 0) continue;
    const elapsed = candles[targetIndex].endTime - candles[index].endTime;
    if (elapsed > HORIZON_HOURS * HOUR_MS * 2) continue;
    const fundingPaid = funding
      .filter(
        (point) =>
          point.time > candles[index].endTime &&
          point.time <= candles[targetIndex].endTime,
      )
      .reduce((sum, point) => sum + point.fundingRate, 0);
    examples.push({
      ...snapshot,
      targetTime: candles[targetIndex].endTime,
      targetReturnPct:
        (candles[targetIndex].close / candles[index].close - 1) * 100,
      longFundingReturnPct: -fundingPaid * 100,
    });
  }

  return {
    examples,
    current: snapshotAt(candles.length - 1),
  };
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (
        Math.abs(augmented[row][column]) >
        Math.abs(augmented[pivot][column])
      ) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) {
      return Array(size).fill(0);
    }
    [augmented[column], augmented[pivot]] = [
      augmented[pivot],
      augmented[column],
    ];
    const divisor = augmented[column][column];
    for (let cursor = column; cursor <= size; cursor += 1) {
      augmented[column][cursor] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let cursor = column; cursor <= size; cursor += 1) {
        augmented[row][cursor] -= factor * augmented[column][cursor];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function fitRidge(examples: AlphaExample[], lambda: number): RidgeFit {
  const featureCount = ALPHA_FEATURES.length;
  const lowerBounds = Array.from({ length: featureCount }, (_, feature) =>
    quantile(
      examples.map((example) => example.values[feature]),
      0.01,
    ),
  );
  const upperBounds = Array.from({ length: featureCount }, (_, feature) =>
    quantile(
      examples.map((example) => example.values[feature]),
      0.99,
    ),
  );
  const clippedRows = examples.map((example) =>
    example.values.map((value, feature) =>
      clamp(value, lowerBounds[feature], upperBounds[feature]),
    ),
  );
  const means = Array.from({ length: featureCount }, (_, feature) =>
    average(clippedRows.map((row) => row[feature])),
  );
  const scales = Array.from({ length: featureCount }, (_, feature) =>
    Math.max(
      standardDeviation(clippedRows.map((row) => row[feature])),
      1e-8,
    ),
  );
  const targetLower = quantile(
    examples.map((example) => example.targetReturnPct),
    0.01,
  );
  const targetUpper = quantile(
    examples.map((example) => example.targetReturnPct),
    0.99,
  );
  const targets = examples.map((example) =>
    clamp(example.targetReturnPct, targetLower, targetUpper),
  );
  const targetMean = average(targets);
  const matrix = Array.from({ length: featureCount }, () =>
    Array(featureCount).fill(0),
  );
  const vector = Array(featureCount).fill(0);

  for (let row = 0; row < clippedRows.length; row += 1) {
    const standardized = clippedRows[row].map(
      (value, feature) => (value - means[feature]) / scales[feature],
    );
    const centeredTarget = targets[row] - targetMean;
    for (let left = 0; left < featureCount; left += 1) {
      vector[left] += standardized[left] * centeredTarget;
      for (let right = 0; right < featureCount; right += 1) {
        matrix[left][right] += standardized[left] * standardized[right];
      }
    }
  }
  for (let feature = 0; feature < featureCount; feature += 1) {
    matrix[feature][feature] += lambda;
  }

  return {
    means,
    scales,
    lowerBounds,
    upperBounds,
    targetMean,
    targetLower,
    targetUpper,
    coefficients: solveLinearSystem(matrix, vector),
  };
}

function standardizedValues(fit: RidgeFit, values: number[]): number[] {
  return values.map(
    (value, feature) =>
      (clamp(
        value,
        fit.lowerBounds[feature],
        fit.upperBounds[feature],
      ) -
        fit.means[feature]) /
      fit.scales[feature],
  );
}

function predict(fit: RidgeFit, values: number[]): number {
  const standardized = standardizedValues(fit, values);
  return (
    fit.targetMean +
    standardized.reduce(
      (sum, value, feature) =>
        sum + value * fit.coefficients[feature],
      0,
    )
  );
}

function chooseLambda(formation: AlphaExample[]): {
  lambda: number;
  threshold: number;
} {
  const validationStart = Math.floor(formation.length * 0.75);
  const validation = formation.slice(validationStart);
  const firstValidationTime = validation[0]?.observedTime ?? Infinity;
  const tuningFormation = formation
    .slice(0, validationStart)
    .filter((example) => example.targetTime <= firstValidationTime);
  const candidates = [0.1, 1, 10, 100];
  let bestLambda = candidates[0];
  let bestError = Infinity;
  let bestPredictions: number[] = [];

  for (const lambda of candidates) {
    const fit = fitRidge(tuningFormation, lambda);
    const predictions = validation.map((example) =>
      predict(fit, example.values),
    );
    const error = average(
      predictions.map(
        (prediction, index) =>
          (prediction - validation[index].targetReturnPct) ** 2,
      ),
    );
    if (error < bestError) {
      bestError = error;
      bestLambda = lambda;
      bestPredictions = predictions;
    }
  }

  return {
    lambda: bestLambda,
    threshold: Math.max(
      ROUND_TRIP_FEE_PCT,
      quantile(bestPredictions.map(Math.abs), 0.65),
    ),
  };
}

function predictionNetReturn(
  prediction: number,
  example: AlphaExample,
): number {
  const direction = prediction >= 0 ? 1 : -1;
  const directionalFunding =
    direction > 0
      ? example.longFundingReturnPct
      : -example.longFundingReturnPct;
  return (
    direction * example.targetReturnPct +
    directionalFunding -
    ROUND_TRIP_FEE_PCT
  );
}

function walkForwardPredictions(
  examples: AlphaExample[],
  holdoutStart: number,
  lambda: number,
): Prediction[] {
  const predictions: Prediction[] = [];
  let fit: RidgeFit | null = null;

  for (let index = holdoutStart; index < examples.length; index += 1) {
    if (!fit || (index - holdoutStart) % RETRAIN_EVERY === 0) {
      const available = examples
        .slice(0, index)
        .filter(
          (example) => example.targetTime <= examples[index].observedTime,
        );
      fit = fitRidge(available, lambda);
    }
    const predictedReturnPct = predict(fit, examples[index].values);
    predictions.push({
      example: examples[index],
      predictedReturnPct,
      netReturnPct: predictionNetReturn(
        predictedReturnPct,
        examples[index],
      ),
    });
  }
  return predictions;
}

function emptyModel(
  coin: string,
  observations: number,
  start: number | null,
  end: number | null,
): EmpiricalAlphaModel {
  return {
    coin,
    observedAt: new Date().toISOString(),
    dataStart: start === null ? null : new Date(start).toISOString(),
    dataEnd: end === null ? null : new Date(end).toISOString(),
    horizonHours: HORIZON_HOURS,
    status: "INSUFFICIENT_DATA",
    statusReason: `Need at least ${MIN_EXAMPLES} labeled hourly observations; ${observations} are available.`,
    direction: "NEUTRAL",
    predictedReturnPct: null,
    predictedFundingPct: null,
    predictedNetReturnPct: null,
    entryThresholdPct: null,
    edgePercentile: 0,
    forecastZ: null,
    qualifies: false,
    observations,
    formationObservations: 0,
    holdoutObservations: 0,
    holdoutTrades: 0,
    holdoutHitRatePct: null,
    holdoutMeanNetReturnPct: null,
    holdoutInformationCoefficient: null,
    holdoutRmsePct: null,
    earlyHoldoutMeanPct: null,
    recentHoldoutMeanPct: null,
    selectedLambda: null,
    feeAssumptionBps: ROUND_TRIP_FEE_PCT * 100,
    impactCostBps: 0,
    factors: [],
  };
}

export function buildEmpiricalAlphaModel(
  coin: string,
  candles: HyperliquidCandle[],
  funding: HyperliquidFundingPoint[],
  impactSpreadBps: number | null,
): EmpiricalAlphaModel {
  const prepared = prepareExamples(candles, funding);
  const start = candles.length > 0 ? Math.min(...candles.map((c) => c.time)) : null;
  const end =
    candles.length > 0 ? Math.max(...candles.map((c) => c.endTime)) : null;
  if (
    prepared.examples.length < MIN_EXAMPLES ||
    prepared.current === null
  ) {
    return emptyModel(
      coin,
      prepared.examples.length,
      start,
      end,
    );
  }

  const holdoutStart = Math.floor(
    prepared.examples.length * (1 - HOLDOUT_SHARE),
  );
  const formation = prepared.examples.slice(0, holdoutStart);
  const selection = chooseLambda(formation);
  const holdout = walkForwardPredictions(
    prepared.examples,
    holdoutStart,
    selection.lambda,
  );
  const holdoutTrades = holdout.filter(
    (item) => Math.abs(item.predictedReturnPct) >= selection.threshold,
  );
  const holdoutNetReturns = holdoutTrades.map((item) => item.netReturnPct);
  const holdoutMean = average(holdoutNetReturns);
  const hitRate =
    holdoutTrades.length > 0
      ? (holdoutTrades.filter((item) => item.netReturnPct > 0).length /
          holdoutTrades.length) *
        100
      : null;
  const informationCoefficient = correlation(
    holdout.map((item) => item.predictedReturnPct),
    holdout.map((item) => item.example.targetReturnPct),
  );
  const rmse = Math.sqrt(
    average(
      holdout.map(
        (item) =>
          (item.predictedReturnPct - item.example.targetReturnPct) ** 2,
      ),
    ),
  );
  const stabilitySplit = Math.floor(holdoutTrades.length / 2);
  const earlyMean =
    holdoutTrades.length >= 8
      ? average(
          holdoutTrades
            .slice(0, stabilitySplit)
            .map((item) => item.netReturnPct),
        )
      : null;
  const recentMean =
    holdoutTrades.length >= 8
      ? average(
          holdoutTrades
            .slice(stabilitySplit)
            .map((item) => item.netReturnPct),
        )
      : null;
  const weak =
    holdoutTrades.length < 20 ||
    holdoutMean <= 0 ||
    (hitRate ?? 0) <= 50 ||
    (informationCoefficient ?? 0) <= 0;
  const unstable =
    !weak &&
    earlyMean !== null &&
    recentMean !== null &&
    (earlyMean <= 0 || recentMean <= 0);
  const status: EmpiricalAlphaStatus = weak
    ? "WEAK"
    : unstable
      ? "UNSTABLE"
      : "READY";
  const statusReason =
    status === "READY"
      ? "Positive and stable chronological holdout performance after fees."
      : status === "UNSTABLE"
        ? "The model's early and recent holdout trade returns are not both positive."
        : "The chronological holdout does not yet show positive, repeatable predictive value.";

  const finalFit = fitRidge(prepared.examples, selection.lambda);
  const predictedReturnPct = predict(finalFit, prepared.current.values);
  const direction = predictedReturnPct >= 0 ? "LONG" : "SHORT";
  const predictedFundingPct =
    (direction === "LONG" ? -1 : 1) *
    prepared.current.fundingRate *
    HORIZON_HOURS *
    100;
  const boundedImpactBps = Math.max(0, impactSpreadBps ?? 0);
  const predictedNetReturnPct =
    Math.abs(predictedReturnPct) +
    predictedFundingPct -
    ROUND_TRIP_FEE_PCT -
    boundedImpactBps / 100;
  const edgePercentile = percentileRank(
    holdout.map((item) => Math.abs(item.predictedReturnPct)),
    Math.abs(predictedReturnPct),
  );
  const forecastZ = rmse > 1e-8 ? predictedReturnPct / rmse : null;
  const zScores = standardizedValues(finalFit, prepared.current.values);
  const factors = ALPHA_FEATURES.map((definition, index) => ({
    key: definition.key,
    label: definition.label,
    value: prepared.current!.values[index],
    zScore: zScores[index],
    coefficient: finalFit.coefficients[index],
    contributionPct: zScores[index] * finalFit.coefficients[index],
  })).sort(
    (left, right) =>
      Math.abs(right.contributionPct) - Math.abs(left.contributionPct),
  );
  const qualifies =
    status === "READY" &&
    Math.abs(predictedReturnPct) >= selection.threshold &&
    predictedNetReturnPct > 0;

  return {
    coin,
    observedAt: new Date().toISOString(),
    dataStart: start === null ? null : new Date(start).toISOString(),
    dataEnd: end === null ? null : new Date(end).toISOString(),
    horizonHours: HORIZON_HOURS,
    status,
    statusReason,
    direction,
    predictedReturnPct,
    predictedFundingPct,
    predictedNetReturnPct,
    entryThresholdPct: selection.threshold,
    edgePercentile,
    forecastZ,
    qualifies,
    observations: prepared.examples.length,
    formationObservations: formation.length,
    holdoutObservations: holdout.length,
    holdoutTrades: holdoutTrades.length,
    holdoutHitRatePct: hitRate,
    holdoutMeanNetReturnPct: holdoutMean,
    holdoutInformationCoefficient: informationCoefficient,
    holdoutRmsePct: rmse,
    earlyHoldoutMeanPct: earlyMean,
    recentHoldoutMeanPct: recentMean,
    selectedLambda: selection.lambda,
    feeAssumptionBps: ROUND_TRIP_FEE_PCT * 100,
    impactCostBps: boundedImpactBps,
    factors,
  };
}
