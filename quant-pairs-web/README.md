# HyperEdge Web App

HyperEdge is a read-only dashboard for researching perpetual futures. It uses
public market data and does not connect to a wallet or place orders.

## Edge Radar

The main page scans Hyperliquid and HIP-3 markets for three rule-based setup
types:

- crowded longs with positive funding, premium, and weak price action
- crowded shorts with negative funding, discount, and firm price action
- continuation setups where price, basis, and turnover agree

Each market receives a `0-100` confluence score based on volume, open interest,
impact spread, funding, basis, momentum, and rule agreement. The score is a
ranking tool, not a probability of profit.

A market is only qualified when it also passes the execution gates below. Open
a row to review the chart, trigger, invalidation, risk notes, and empirical
model diagnostics.

### Empirical overlay

The empirical overlay estimates four-hour returns from 90 days of hourly
Hyperliquid candles and funding history. Inputs include:

- 1-hour, 4-hour, and 24-hour momentum
- distance from the 20-hour EMA
- four-hour EMA slope
- RSI14 and 24-hour realized volatility
- volume surprise
- funding level, funding z-score, and funding premium

The ridge model selects regularization chronologically and reports expanding
walk-forward holdout results after fee, funding, and impact assumptions. It
labels the current rule signal as `Confirmed`, `Conflict`, `Unvalidated`, or
`Building`. It does not generate qualified setups independently.

## Venue Lens

Venue Lens compares public snapshots from Hyperliquid, Lighter, and
Variational. Same-ticker markets are only compared when their marks are within
5% of one another, which filters obvious ticker collisions and contract-scale
mismatches.

The page shows:

- funding agreement or disagreement
- mark-price dispersion
- venue-reported volume and open interest
- funding values with their native period labels
- available venue-specific execution-cost estimates

Open interest remains in each venue's reported convention. Combined figures
are context, not a standardized market-wide total. Price dispersion is not
presented as executable arbitrage.

## Trade Journal

Qualified Edge Radar setups can be saved as paper trades with a manual
direction, margin, and leverage. The journal records the entry context, marks
open positions with current Hyperliquid prices, and flags positions whose setup
or execution conditions have deteriorated.

Paper P&L is price-based. It does not simulate actual fills, liquidation,
maintenance margin, or complete funding paid over the life of a position.

## Pages

| Route | Page |
| --- | --- |
| `/` | Edge Radar |
| `/venues` | Venue Lens |
| `/paper` | Trade Journal |

## Execution Gates

| Check | Requirement |
| --- | ---: |
| Valid market | Mark and oracle prices are available |
| 24-hour volume | At least `$1,000,000` |
| Open interest | At least `$500,000` |
| Impact spread | Available and no wider than `40 bps` |

`Execution blocked` means a market does not meet the minimum conditions for a
paper setup. It is not a directional signal.

## Local Data

Watchlists, settings, and paper trades are stored in browser local storage.
Clearing site data removes them. There is no account or shared database.

Live pages use public endpoints from:

- Hyperliquid Info API
- Lighter REST API
- Variational Omni read-only statistics API

No API key is required. Variational provides a current snapshot but not matching
public candle history, so it is used for cross-venue context rather than the
walk-forward model.

## Development

Requires Node.js `22.13` or newer.

```powershell
npm install
npm run dev
```

Run the checks:

```powershell
npm run lint
npm test
npm run build
```

`npm test` includes a production build, server-rendered route checks, and core
quantitative tests.

## Stack

- Next.js 16, React 19, and TypeScript
- Vinext and Vite
- Recharts
- Lucide icons
- Browser local storage

## Important Notes

- Annualized funding assumes the current hourly rate continues. It is not a
  return forecast.
- Impact spread is a cost estimate, not a guaranteed fill price.
- Candidate rules and confluence weights are heuristics.
- HIP-3 markets can differ from core crypto perpetuals in oracle design, fees,
  sessions, and liquidity.

## Disclaimer

HyperEdge is for research and education. Data and calculations can be delayed,
incomplete, or wrong. Validate the inputs and assumptions before using any
output in a trading decision.