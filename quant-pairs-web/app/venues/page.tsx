import type { Metadata } from "next";
import VenueLens from "../components/VenueLens";

export const metadata: Metadata = {
  title: "Venue Lens",
  description:
    "Compare funding, marks, open interest, volume, and execution evidence across Hyperliquid, Lighter, and Variational perpetual markets.",
};

export default function VenuesPage() {
  return <VenueLens />;
}
