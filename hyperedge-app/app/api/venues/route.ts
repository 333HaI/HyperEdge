import { NextResponse } from "next/server";
import { fetchVenueIntelligence } from "../../lib/venues";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await fetchVenueIntelligence();
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=30",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Cross-venue data could not be loaded.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
