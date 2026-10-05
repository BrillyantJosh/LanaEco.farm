/**
 * Brilly's review of the orders step 5 does not pay although a verified 30933
 * was there (order_settle_review — round 3, 2 Oct 2026; round 5, 5 Oct 2026).
 * Run by hand on the server, in the portal's directory (it opens the portal's
 * own SQLite file):
 *
 *   npx tsx server/scripts/settle-review.ts list [--all]
 *   npx tsx server/scripts/settle-review.ts confirm <order_id> <order_event_id> --taken <event id the broker took>
 *
 * `list` prints every open entry that needs a look — ids, amounts, the
 * reason and the mirrored lines (listing address, qty, unit price), no buyer
 * data. Reasons: step5_not_paid (an older 'paid' step 5 does not pay),
 * not_computable / terms_mismatch (an order of this code whose 30933 pays its
 * own total, judged amount_mismatch). An entry listed less than an hour ago
 * is left out (the mirror may still be catching up: a shop back a minute
 * later, a listing that lands after its 30933); `--all` shows those too, and
 * the entries of listing kinds this portal does not mirror
 * (listing_kind_not_mirrored: other portals' orders, not suspicious). Check
 * each against what the broker took and checked at order time:
 * shop.lanapays.us `npx tsx server/scripts/order-as-taken.ts <order_id>`
 * (its lines, total and the 36520 event id it took).
 *
 * `confirm` makes the entry's purchase the step-5a pin of exactly that 36520
 * event (orderJoin.confirmSettleReview). `--taken` is the event id the
 * broker's order-as-taken.ts printed; it must be the event id you confirm.
 * Refused, with nothing written, when the buyer has replaced the order since,
 * the event id is not the mirrored one, the broker took another event, or the
 * order's own total is not the paid amount; it pays only while the NEWEST
 * version of that 30933 still pays that amount — a cancellation un-pays it as
 * it un-pays every pin. The portal never calls it.
 */
import { getDb, closeDb } from '../db/connection.js';
import { settleReviewView, confirmSettleReview, SETTLE_REVIEW_MIN_AGE_SEC } from '../lib/orderJoin.js';

const USAGE = 'usage: settle-review.ts list [--all] | confirm <order_id> <order_event_id> --taken <event id the broker took>';

function orderView(orderJson: string | null): Record<string, unknown> {
  try {
    const o = JSON.parse(orderJson || '{}');
    return {
      fulfillment: o.fulfillment, shipping: o.shippingFee, total: o.total, currency: o.currency,
      lines: Array.isArray(o.items) ? o.items.map((i: any) => ({ a: i?.a, qty: i?.qty, unitPrice: i?.unitPrice, currency: i?.currency })) : [],
    };
  } catch { return {}; }
}

/** `confirm <order_id> <order_event_id> --taken <id>` → its three ids, or null. */
export function parseConfirmArgs(args: string[]): { orderId: string; eventId: string; takenEventId: string } | null {
  const rest = [...args];
  const at = rest.indexOf('--taken');
  if (at < 0 || !rest[at + 1] || rest[at + 1].startsWith('--')) return null;
  const takenEventId = rest[at + 1];
  rest.splice(at, 2);
  if (rest.length !== 2 || rest.some(a => !a || a.startsWith('--'))) return null;
  return { orderId: rest[0], eventId: rest[1], takenEventId };
}

function main(): number {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'list' && (args.length === 0 || (args.length === 1 && args[0] === '--all'))) {
    const all = args[0] === '--all';
    const now = Math.floor(Date.now() / 1000);
    const { shown, hidden } = settleReviewView(getDb(), now, all);
    for (const e of shown) {
      console.log(JSON.stringify({
        order_id: e.order_id,
        order_event_id: e.order_event_id,
        replaced_since: !!e.current_event_id && e.current_event_id !== e.order_event_id,
        reason: e.reason,
        verdict_now: e.verdict,
        expected_now: e.expected_total,
        paid_amount: e.old_paid_amount,
        paid_tx_id: e.old_paid_tx_id,
        listed_at: new Date(e.listed_at * 1000).toISOString(),
        unit_id: e.unit_id,
        ...orderView(e.order_json),
      }));
    }
    console.log(`open entries: ${shown.length}`
      + (hidden ? ` (${hidden} more younger than ${SETTLE_REVIEW_MIN_AGE_SEC / 3600} h or of another portal's listing kinds: --all)` : ''));
    return 0;
  }
  if (cmd === 'confirm') {
    const a = parseConfirmArgs(args);
    if (!a) { console.error(USAGE); return 2; }
    const r = confirmSettleReview(getDb(), a.orderId, a.eventId, a.takenEventId);
    console.log(JSON.stringify(r));
    return r.ok ? 0 : 1;
  }
  console.error(USAGE);
  return 2;
}

// Run only as a script (a test imports parseConfirmArgs).
if (process.argv[1] && /settle-review\.ts$/.test(process.argv[1])) {
  let code = 1;
  try { code = main(); } catch (err: any) { console.error(err?.message || err); }
  closeDb();
  process.exitCode = code;
}
