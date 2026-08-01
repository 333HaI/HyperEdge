import type { Metadata } from "next";
import HyperliquidRadar from "./components/HyperliquidRadar";

export const metadata: Metadata = {
  title: {
    absolute: "HyperEdge - Live Perp Intelligence",
  },
  description:
    "Funding, basis, and momentum setups with chronological empirical validation across Hyperliquid perpetual markets.",
};

export default function Home() {
  return <HyperliquidRadar />;
}
