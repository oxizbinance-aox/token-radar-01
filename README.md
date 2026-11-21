# Token Radar — Build the best token launch radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/oxizbinance-aox/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/oxizbinance-aox/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A web dashboard that finds the pre-token protocols worth a launch — and shows
exactly how to farm each one.

**Entry for the make.fun bounty [`token-radar-01`](https://make.fun/bounty/token-radar-01)**
— $1,325 in prizes, 1st place $1,000. Deadline 14 Dec 2026.

## What it does

1. **Finds the protocols that record no token.** Reads the sealed snapshot
   (758 protocols, fetched 14 Nov 2026) and keeps only the ones that record
   no token — no market cap, no CoinGecko id, no symbol — and are not a
   wrapped, staked or bridged product of a token that already trades, not an
   exchange, and not a versioned pool. The snapshot's 40-protocol watchlist
   is the floor; the board adds every rankable protocol below it (138 more,
   178 rows in all).
2. **Prices the launch from the market's own comps.** Implied value =
   TVL × category multiple × 2.0 FDV uplift × P(launch) × growth × maturity.
   The multiple is the median market-cap / TVL of the snapshot's own
   live-token protocols in the same category (categories with fewer than 3
   comps use the global median). P(launch) runs 0.30–0.85 by category:
   retail protocols launch; institutional vault curators mostly do not.
3. **Shows how to farm each one.** Every row carries a six-step farm plan
   derived from the protocol's own record (category, chains, TVL, age),
   with a cost and a time per step.

## Run it

Node 22 or later, standard library only — nothing to install.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

`--input` defaults to `/input` (the sealed snapshot's mount) and the output
directory defaults to `/output` (or `MAKEFUN_OUTPUT_DIR`). The run is
deterministic: the same snapshot always writes the same bytes. It writes
`board.json` (178 rows), `data.js` (the dashboard's data), `dashboard/`,
`screenshots/` and `dossier.json` (via the vendored `vendor/makefun-board.ts`).

To view the dashboard, open `out/dashboard/index.html` in a desktop browser
(it loads `../data.js`, no network), or serve `out/` over HTTP.

## Layout

- `main.ts` — the program: reads the snapshot, ranks, writes the outputs.
- `lib/model.ts` — the model: category comps, launch probabilities, farm plans.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied unchanged.
- `dashboard/` — the static page (index.html, app.css, app.js; 23,909 bytes,
  no network addresses anywhere in its source).
- `screenshots/` — the board, a protocol detail view, a filtered view
  (1440×900 PNG, ~160 KB each).

## Top of the board (sealed snapshot, 14 Nov 2026)

| # | Protocol | TVL | Implied launch value |
|---|----------|-----|----------------------|
| 1 | Steakhouse Financial | $2.75B | $297M |
| 2 | USDD | $1.06B | $199M |
| 3 | Veda | $1.56B | $198M |
| 4 | Gauntlet | $1.58B | $176M |
| 5 | Bittensor dTAO | $376M | $144M |

## Method (stated in the dashboard too)

- **Pre-token:** no market cap, no CoinGecko id, no symbol in the snapshot;
  not a CEX, not a versioned pool, not a wrapped/staked/bridged product,
  not an exchange-prefixed name. Say a protocol "records no token", never
  that it "has none" — the snapshot is a record, not proof.
- **Multiple:** median mcap/TVL of live-token protocols in the same
  category, clamped to 0.05–2.50; fewer than 3 comps falls back to the
  global median (×0.21 in this snapshot).
- **FDV uplift:** 2.0× — a launch's fully-diluted value runs about twice
  its circulating market cap.
- **P(launch):** 0.85 prediction markets, 0.80 DEXes, 0.75 lending, down to
  0.30 risk curators, 0.35 onchain capital allocators.
- **Growth:** 7-day TVL change clamped to −50…+100%, weight 0.4.
- **Maturity:** 0.7 + min(age, 1095)/1095 × 0.3; unknown age counts as 365 days.
- **Farmability:** 0–100 from chain count, growth and category.

## Verification (run before submitting)

```sh
mkdir -p out out2
MAKEFUN_OUTPUT_DIR=out  node main.ts --input <snapshot.json>
MAKEFUN_OUTPUT_DIR=out2 node main.ts --input <snapshot.json>
diff -r out out2   # must be identical
```

The board holds 178 rows (40 watchlist + 138 early), ranks exactly 1..178,
implied values non-increasing, every farm plan 6 steps of 20–600 characters.
The dossier is byte-for-byte what `buildDossier` writes (675,684 bytes,
under the 1.5 MiB cap).

---

*Not financial advice — do your own research, never farm with money you
cannot lose.*
