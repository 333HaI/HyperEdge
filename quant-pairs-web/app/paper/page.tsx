import type { Metadata } from "next";
import TradeJournal from "../components/TradeJournal";

export const metadata: Metadata = {
  title: "Trade Journal",
  description:
    "Track HyperEdge signals with live marks, setup health, and a device-local paper-trade journal.",
};

export default function PaperPage() {
  return <TradeJournal />;
}
