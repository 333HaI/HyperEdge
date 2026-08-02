import { NextResponse } from "next/server";
import { fetchHyperliquidAlphaModel } from "../../../lib/hyperliquid";
import type { EmpiricalAlphaModel } from "../../../lib/alphaModel";

export const dynamic = "force-dynamic";

const MAX_BATCH = 1;
const CONCURRENCY = 1;
const CACHE_MS = 30 * 60 * 1000;

interface AlphaRequest {
  coin: string;
  impactSpreadBps: number | null;
}

interface AlphaError {
  coin: string;
  error: string;
}

interface CacheEntry {
  expiresAt: number;
  model: EmpiricalAlphaModel;
}

const modelCache = new Map<string, CacheEntry>();
const pendingModels = new Map<string, Promise<EmpiricalAlphaModel>>();

function isAlphaRequest(value: unknown): value is AlphaRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<AlphaRequest>;
  return (
    typeof request.coin === "string" &&
    /^[A-Za-z0-9:_-]{1,40}$/.test(request.coin) &&
    (request.impactSpreadBps === null ||
      (typeof request.impactSpreadBps === "number" &&
        Number.isFinite(request.impactSpreadBps) &&
        request.impactSpreadBps >= 0 &&
        request.impactSpreadBps <= 10_000))
  );
}

async function mapWithConcurrency<T, R>(
  values: T[],
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(CONCURRENCY, values.length) },
      () => runWorker(),
    ),
  );
  return results;
}

async function modelFor(request: AlphaRequest): Promise<EmpiricalAlphaModel> {
  const impactBucket =
    request.impactSpreadBps === null
      ? "none"
      : (Math.round(request.impactSpreadBps * 10) / 10).toFixed(1);
  const key = `${request.coin}:${impactBucket}`;
  const cached = modelCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.model;
  const pending = pendingModels.get(key);
  if (pending) return pending;

  const task = fetchHyperliquidAlphaModel(
    request.coin,
    request.impactSpreadBps,
  )
    .then((model) => {
      modelCache.set(key, { model, expiresAt: Date.now() + CACHE_MS });
      return model;
    })
    .finally(() => {
      pendingModels.delete(key);
    });
  pendingModels.set(key, task);
  return task;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { markets?: unknown };
    if (
      !Array.isArray(body.markets) ||
      body.markets.length === 0 ||
      body.markets.length > MAX_BATCH ||
      !body.markets.every(isAlphaRequest)
    ) {
      return NextResponse.json(
        { error: `Provide between 1 and ${MAX_BATCH} valid markets.` },
        { status: 422 },
      );
    }

    const models = await mapWithConcurrency<
      AlphaRequest,
      EmpiricalAlphaModel | AlphaError
    >(body.markets, async (item) => {
      try {
        return await modelFor(item);
      } catch (error) {
        return {
          coin: item.coin,
          error:
            error instanceof Error
              ? error.message
              : "Empirical model could not be estimated.",
        };
      }
    });

    return NextResponse.json(
      {
        source: {
          provider: "Hyperliquid",
          fetchedAt: new Date().toISOString(),
          horizonHours: 4,
          method: "Ridge regression with chronological walk-forward validation",
        },
        models,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Empirical alpha request could not be parsed." },
      { status: 400 },
    );
  }
}
