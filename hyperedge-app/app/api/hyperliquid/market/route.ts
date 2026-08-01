import { NextResponse } from "next/server";
import { fetchHyperliquidMarketDetail } from "../../../lib/hyperliquid";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const coin = new URL(request.url).searchParams.get("coin") ?? "";
    const result = await fetchHyperliquidMarketDetail(coin);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=10",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Hyperliquid market detail could not be loaded.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
