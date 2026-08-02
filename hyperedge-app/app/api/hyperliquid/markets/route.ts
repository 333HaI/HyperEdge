import { NextResponse } from "next/server";
import { getHyperliquidMarketsSnapshot } from "../../../lib/hyperliquidCache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getHyperliquidMarketsSnapshot();
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
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
