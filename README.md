# makefun-btc-race-24h-20261117-0603

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/Alfatih15/makefun-btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/Alfatih15/makefun-btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

Hour-dip mean-reversion BTC trading bot for make.fun's 24h race: buys sharp 60-minute dips in cbBTC/USDC and sells the snap-back. Dev window: net PnL +$27.02 (+2.70%), 5 trades, max drawdown 0.72%.

## Run it

```sh
node cli/makefun.mjs grade-local --kit . --bot <path-to-this-repo> --driver process
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=hjff56h1&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>

# Hour-Dip Mean Reversion — cbBTC/USDC trading bot

A bot for the make.fun competition `btc-race-24h-20261117-0603`. It trades
Coinbase Wrapped BTC (cbBTC) against USDC, minute by minute, starting with
1,000 USDC of paper money. Long only, at most one open position, at most one
order per reply. It speaks `agent-fun/bars-replay/v1` (newline-delimited JSON
on stdin/stdout: `hello` once, then one `batch` per minute, then `done`).

## Strategy (in plain words)

The pool's price overreacts to sharp one-hour drops and then drifts back.
So the bot buys the deep hourly dip and sells the recovery:

- **Buy** (with all cash) when the close has fallen **100 bps or more**
  below the close 60 bars ago.
- **Sell** the whole position when any of these is true:
  - the close is **150 bps above** the buy's fill price (take profit),
  - the close is **120 bps below** the buy's fill price (stop loss),
  - **360 bars** have passed since the buy filled (max hold).
- Otherwise it holds cash and waits.

Every comparison is exact integer arithmetic on the raw closes, so the same
bars always produce the same orders — the bot is deterministic by
construction. It never reads the clock, the environment, or any file.

## Why this shape

On the dev window the 1-minute noise is ~6 bps while a full round trip
costs ~26 bps in fees, slippage and price impact, so anything trading on
minute signals bleeds out (the kit's EMA-cross baseline loses $106 there,
RSI-Bollinger $24, ADX-momentum $33). The durable edge in the data is the
snap-back after a sharp hourly drop: after a 30-minute rise of 60+ bps the
next 30 minutes average −61 bps, and after a 30-minute fall of 60+ bps the
next 30 minutes average +10 bps. Buying the deep dip and selling the
recovery is the trade that edge implies. Trend-chasing entries, drift
fallbacks and tighter dip thresholds all lost money on the same window.

## Files

- `main.ts` — the bot (entrypoint, run as `node /bot/main.ts`).
- `vendor/makefun-bars.ts` — byte-for-byte copy of the kit's SDK shim.
- `LICENSE` — MIT.
- `BUILD_LOG.md` — build log with backtest numbers per iteration.

## Grade locally

From inside the unpacked kit directory:

```
node cli/makefun.mjs grade-local --kit . --bot <path-to-this-repo> --driver process
```

Dev-window result: **net PnL +$27.02 (+2.70%), 5 trades, max drawdown
0.72%**, deterministic (two runs, action logs byte-identical).
