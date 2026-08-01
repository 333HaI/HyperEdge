# HyperEdge

HyperEdge is a read-only market dashboard for perpetual futures. It scans live
Hyperliquid markets, compares selected perpetual exchanges, and lets you record
paper trades without connecting a wallet.

The dashboard covers crypto and HIP-3 markets such as stocks, commodities,
indices, and foreign exchange where they are available.

## Main Pages

### Edge Radar

Edge Radar ranks live markets using funding, basis, price direction, volume,
open interest, turnover, and estimated execution cost. It highlights crowded
positioning and continuation setups, then separates qualified markets from
markets that fail the minimum liquidity checks.

The displayed `0-100` score measures agreement between the rules. It is not a
probability of profit.

A separate four-hour ridge model uses hourly prices, volume, trend, volatility,
and funding history. Chronological holdout results label each rule signal as
confirmed, conflicting, unvalidated, or still building. The model is supporting
evidence and does not create signals by itself.

### Venue Lens

Venue Lens compares public snapshots from Hyperliquid, Lighter, and
Variational. It shows funding agreement, mark-price differences, reported
volume, reported open interest, and the execution-cost fields that each venue
makes available.

Values are kept in each venue's native reporting convention. Cross-venue price
differences are market context, not guaranteed arbitrage opportunities.

### Trade Journal

Qualified setups can be saved as local paper trades with a chosen direction,
margin, and leverage. Open positions are marked against current Hyperliquid
prices and can be reviewed or closed manually.

Paper trades are stored in the browser. The app does not place real orders.

## Run Locally

Requirements:

- Node.js `22.13` or newer
- npm

```powershell
cd "C:\Users\YOUR_NAME\Desktop\HyperEdge\hyperedge-app"
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

To use port `4322` instead:

```powershell
npm run dev -- --port 4322
```

## Validate

```powershell
cd hyperedge-app
npm run lint
npm test
npm run build
```

## Repository Layout

```text
.
|-- hyperedge-app/
|   |-- app/          Pages, components, APIs, and market models
|   |-- tests/        Route and quantitative tests
|   `-- README.md     Detailed application notes
|-- LICENSE
`-- README.md
```

## Data Sources

- Hyperliquid public Info API
- Lighter public REST API
- Variational Omni read-only statistics API

No API key or wallet connection is required.

## Execution Gates

| Check | Requirement |
| --- | ---: |
| Valid market | Mark and oracle prices available |
| 24-hour volume | At least `$1,000,000` |
| Open interest | At least `$500,000` |
| Impact spread | Available and no wider than `40 bps` |

`Execution blocked` is a liquidity or execution warning. It is not a bearish
signal.

## Limitations

- Annualized funding is not a return forecast.
- Impact spread is an estimate, not a guaranteed fill price.
- Paper trading does not simulate liquidation, maintenance margin, or complete
  funding cash flows.
- Public venue fields are not always directly comparable.
- HIP-3 products can differ from core crypto perpetuals in oracle design, fees,
  trading sessions, and liquidity.

## Disclaimer

HyperEdge is for research and education. Market data and calculations can be
delayed, incomplete, or wrong. Validate the inputs before using any output in a
trading decision.