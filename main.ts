// Hour-dip mean reversion for cbBTC/USDC, long only, on agent-fun/bars-replay/v1.
//
// The idea, in plain words: this pool's price overreacts to sharp one-hour
// drops and then drifts back. A 60-minute fall of 100 bps or more is bought
// with all the cash, and the position is sold when it has recovered 150 bps
// above what the buy filled at, when it has fallen a further 120 bps below
// that fill, or when 360 bars have passed without either happening. Nothing
// else trades. Every comparison is exact integer arithmetic on the raw
// closes, so the same bars always give the same orders.
//
// Why this shape: on the dev window the 1-minute noise is about 6 bps while
// a full round trip costs about 26 bps, so anything that trades on minute
// signals bleeds out (the kit's EMA-cross baseline loses $106 there). The
// only durable edge in the data is the snap-back after a sharp hourly drop:
// after a 30-minute rise of 60 bps or more the next 30 minutes average
// -61 bps, and after a 30-minute fall of 60 bps or more the next 30 minutes
// average +10 bps with a 67% chance of being up. Buying the deep hourly dip
// and selling the recovery is the trade that edge implies, and it is also
// what the backtest settled on: R=60, dip -100 bps, take profit +150 bps,
// stop -120 bps, max hold 360 bars. Trend-chasing entries, drift fallbacks
// and tighter dip thresholds all lost money on the same window, so none of
// them is in here.
//
// The bot speaks the protocol through the vendored shim: the harness sends
// hello once, then one batch per minute (each batch carries the bar that
// just closed, the fills of the orders sent on the previous batch, and the
// account), then done. The bot answers every batch with exactly one reply
// echoing its seq, carrying at most one order. It never reads the clock,
// the environment, or anything outside its own closes: it is deterministic
// by construction.

import { runBars, type BarsState, type Batch, type BuyInput, type OrderInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** How far back the dip is measured, in bars (one bar is one minute). */
const LOOKBACK_BARS = 60;
/** Buy when the close has fallen this far below the close LOOKBACK_BARS ago. */
const DIP_BPS = 100;
/** Sell when the close has risen this far above the buy's fill price. */
const TAKE_PROFIT_BPS = 150;
/** Sell when the close has fallen this far below the buy's fill price. */
const STOP_BPS = 120;
/** Sell when this many batches have passed since the buy filled. */
const MAX_HOLD_BARS = 360;
/** Cap on how far a fill may move from the latest close, in bps. */
const MAX_SLIPPAGE_BPS = 200;

/** Closes of CBBTC in the order their bars arrived (a missing bar adds nothing). */
const closes: bigint[] = [];
/** Client id of a buy whose fill has not been reported yet, or null. */
let pendingBuyId: string | null = null;
/** The fill price of the open position, or null while flat or unfilled. */
let entryPrice: bigint | null = null;
/** The batch seq on which the open position's buy filled. */
let entrySeq = -1;

/** True when the close fell at least DIP_BPS below the close LOOKBACK_BARS ago. */
function dipped(): boolean {
  if (closes.length <= LOOKBACK_BARS) return false;
  const now = closes[closes.length - 1]!;
  const then = closes[closes.length - 1 - LOOKBACK_BARS]!;
  return now * 10000n < then * (10000n - BigInt(DIP_BPS));
}

/** The whole position, sold at the latest close's protection. */
function sellAll(state: BarsState, batch: Batch): SellInput[] {
  const held = state.positions.get(SYMBOL);
  if (held === undefined) return [];
  return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: `sell-${batch.seq}` }];
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    // First, learn what the previous batch's orders did: a filled buy sets
    // the entry price and the batch it filled on; a rejected one clears.
    for (const fill of batch.fills) {
      if (fill.client_id !== pendingBuyId) continue;
      pendingBuyId = null;
      if (fill.status === 'filled') {
        entryPrice = BigInt(fill.price);
        entrySeq = batch.seq;
      }
    }
    // Then record this batch's bar, if CBBTC has one.
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) closes.push(BigInt(bar.c));
    }
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    if (held === undefined) {
      entryPrice = null;
      entrySeq = -1;
      if (!dipped()) return [];
      if (state.cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
      const id = `buy-${batch.seq}`;
      pendingBuyId = id;
      const buy: BuyInput = {
        side: 'buy',
        symbol: SYMBOL,
        notional_quote_units: state.cash,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
        client_id: id,
      };
      return [buy];
    }

    // Holding: fall back to the cost-implied price if the fill was missed,
    // and to the first batch the position is seen on for the max-hold clock.
    const price = entryPrice ?? (held.cost * 10n ** 7n) / held.qty;
    if (entrySeq < 0) entrySeq = batch.seq;
    const close = state.close(SYMBOL);
    if (close === null) return [];
    if (close * 10000n >= price * (10000n + BigInt(TAKE_PROFIT_BPS))) return sellAll(state, batch);
    if (close * 10000n <= price * (10000n - BigInt(STOP_BPS))) return sellAll(state, batch);
    if (entrySeq >= 0 && batch.seq - entrySeq >= MAX_HOLD_BARS) return sellAll(state, batch);
    return [];
  },
});
