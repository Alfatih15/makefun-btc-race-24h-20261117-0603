# BUILD_LOG — btc-race-24h-20261117-0603

## Approach

1. Read RULES.txt, competition.yaml, protocol.schema.json, the SDK shim and
   all six baselines. Ran the kit grader locally (`grade-local --driver
   process`, Docker is not installed on this VM) on every baseline to learn
   what the dev window rewards.
2. Built an exact Python backtester mirroring the harness fill model
   (fills at the next bar's open; 4 bps fee; 2 bps slippage; constant-product
   impact against the fill bar's open depth; final flatten at the last close).
   Validated it against the official grader: buy-and-hold +$1.0672 and
   momentum +$2.4456, both reproduced to 4 decimals, same trade counts and
   max drawdowns.
3. Explored strategy families in the backtester, then implemented the winner
   in TypeScript and verified it with the kit's own grader.

## Baseline dev-window results (official grader, --driver process)

| baseline | net PnL | trades | max DD |
| --- | --- | --- | --- |
| buy-and-hold | +$1.07 | 1 | 2.12% |
| hold-cash | $0.00 | 0 | 0% |
| momentum | +$2.45 | 1 | 2.12% |
| ema-cross | −$106.21 | 68 | 10.96% |
| rsi-bollinger | −$24.25 | 11 | 2.79% |
| adx-momentum | −$32.66 | 26 | 3.60% |

Dev-window facts that shaped the design: 1,440 bars, total buy-and-hold
return +53 bps, 1-minute return std 6.4 bps, 141 flat bars, depth
~$709k–$1,064k. A full-size round trip costs ~26 bps, so minute-scale
signals cannot pay for themselves — every trend/momentum variant tested
lost money.

## Iterations (backtester, dev window)

- EMA cross (fast 15–60 / slow 90–240, trailing stop 80, stop 60):
  best −$12.56. All variants negative.
- Donchian breakout (N 30–180, trailing stop 80, stop 60): best −$17.63.
- Momentum threshold (R 30–180, enter +30..+80, exit −30..−80): best −$7.78.
- Hold with crash exit (exit on 30-min return < −40..−100, re-enter on
  bounce): best −$2.25 — exits sell the bottom, re-entries lag.
- Dip-buying, first version (30-min return < −80, exit on 30-min return
  > +80 or stop −80): +$7.70, 6 trades.
- Dip-buying with take-profit exits (R=30, dip −80, TP +120, stop −60):
  +$15.95, 6 trades — but split-half check showed it all came from the
  first half (+$8.63 / −$8.05), so it was not kept.
- **Chosen family — 60-minute dip (R=60, dip −100, TP +150, stop −120,
  max hold 360): +$27.02, 5 trades, max DD 0.72%.** Positive on the first
  half (+$19.77) and ~breakeven on the second (−$0.09). Neighbourhood check
  (R ±15, dip ±10, TP ±30, stop ±20): mean +$19.18, worst +$6.86 — a broad
  plateau, not a knife-edge optimum. Stable across shifted windows
  (+$23.02 to +$31.93) and at doubled fees (+$26.41 at 8 bps fee).

Rejected on the evidence: drift-fallback entries (full −$9 to −$16),
softer dip thresholds (−60: −$8.32), 15-minute dip triggers, combined
30/60-minute dip triggers, and every trend-following variant.

## Final entry (main.ts)

- Entry: 60-minute return < −100 bps → buy with all cash.
- Exit: close ≥ fill × 1.0150 (take profit), close ≤ fill × 0.9880 (stop),
  or 360 bars since the fill (max hold).
- One order per reply, max slippage 200 bps, all comparisons in exact
  integer (bigint) arithmetic on raw closes.

## Final dev-window numbers (official grader, --driver process)

Run twice; both runs agree byte for byte.

- **Net PnL: +$27.0178 (+2.7018%)**
- Trades: 5 (3 buys, 2 sells; the third position is flattened at the end)
- Max drawdown: 0.7237% (guardrail: ≤ 25%)
- Sharpe (per bar): 0.0367
- Fees paid: $2.4441
- Net PnL at 2x fees: +$24.5634 — still strongly positive
- Determinism: `l1.reproduced: true`; action_log_sha256
  `e5307f9fb202af0f6c34259f2688c9aa91024e3dadfa71bf37427629ce21b158`
  identical across two separate grade-local runs; result_sha256
  `03962d9444ae483216a5eb055ac96e9ae99970c42e988a514c933a34d83b6cb8`
  identical too.
- Guardrails: ≥ 1 trade (5) and max drawdown ≤ 25% (0.72%) — met.
- Dev gate: net PnL > 0 — passed with margin ($27.02 vs $0).

Trade log (backtester, confirmed by the grader's PnL to 4 decimals):
buy bar 374 @ $64,071.64 → sell bar 511 @ $65,012.85 (+$13.88);
buy bar 571 @ $64,239.89 → sell bar 922 @ $65,134.68 (+$13.30);
buy bar 1097 @ $64,647.94 → flattened at the last close $64,775.95.

Note: `grade-local` here was run without transcripts, so its eligibility
block lists `no_transcripts` / `coverage_below_gate` / `cost_unpriced` —
those are resolved at submit time when the transcripts are bundled, not by
the bot.
