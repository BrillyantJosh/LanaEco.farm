/**
 * Live Nostr subscription engine.
 *
 * Replaces the legacy heartbeat polling loop. For each relay in KIND 38888
 * we open ONE long-lived WebSocket and subscribe to every kind we care
 * about. Events stream in as the relay receives them; we parse and upsert
 * each event the moment it lands. The cache is therefore push-driven and
 * close-to-real-time.
 *
 * Crucially: we NEVER delete rows on absence. Nostr is append-only — the
 * only legitimate deletes come from KIND 5 (NIP-09) or from the API
 * filter hiding rows whose latest KIND 30903 isn't 'active'. The
 * "snapshot drift" failure mode of the old design is structurally gone.
 *
 * Reconnect strategy:
 *   - exponential backoff 1s → 60s capped.
 *   - on reconnect, re-subscribe with `since = lastSeenCreatedAt - 60`
 *     so the relay replays anything that landed during the gap.
 *
 * Keepalive: ping/pong every 30s, tear down if no pong for 90s.
 *
 * KIND 38888 (system params) stays as a periodic 5-min poll because it
 * changes on the order of days and drives the relay list itself.
 *
 * Hourly safety net: a single full-snapshot fetchEvents() per kind, upsert
 * only (never delete). Catches anything a relay failed to replay correctly
 * on reconnect.
 */

import WebSocket from 'ws';
import type Database from 'better-sqlite3';
import {
  parseUnit, parseListing, parseFeePolicy, parseSuspension,
  parseShopOrder, parseFulfillment, parsePurchase,
} from './parsers.js';
import { fetchKind38888 } from './nostr.js';
import { fetchEvents, signatureOk, getTag, type NostrEvent } from './relaySync.js';
import { listingOwnsUnitRef, registrarSigners, registryOwner } from './shopIdentity.js';
import {
  loadTrustedSigners, recomputeOrder, recomputeOrdersForPurchase,
  recomputeOrdersForUnit, orderHasMoney, upsertOrderEvent, rejudgeLegacyPaidOrders,
} from './orderJoin.js';
import { devRelays } from './devOverrides.js';
import { invalidateCatalogue } from './catalogueCache.js';
import { purchaseVersionWins } from './orderResolver.js';

/** Lana Online Shop kinds (SPEC §2/§3). 36522 is NEVER subscribed to nor stored. */
const KIND_SHOP_ORDER = 36520;
const KIND_SHOP_FULFILLMENT = 36521;
const KIND_PURCHASE = 30933;
const PURCHASE_SAFETY_NET_WINDOW = 7 * 24 * 3600; // 30933 since now−7d

/** Registry kinds: the registrar's word about one shop (fee policy, registration status). */
const KIND_FEE_POLICY = 30902;
const KIND_REGISTRATION = 30903;

/**
 * The full set of "listing" kinds we recognise. shop.lanapays.us maps
 * each merchant category to a different KIND in the 36500–36511 range
 * (Producer=36500, Café/Restaurant=36501, Shop=36502, Kids=36503,
 * Construction=36504, Fashion=36505, Furniture=36506, Pet=36507,
 * Accommodation=36508, Care/Beauty/Wellness=36509, Marketplace=36510,
 * Body Arts=36511). KIND 31923 is NIP-52 calendar events used only by
 * lana-events (hashtag-scoped). Every portal subscribes to ALL kinds —
 * the per-portal PORTAL_CATEGORIES filter at the API layer hides
 * listings whose parent unit isn't in this portal's scope.
 */
const ALL_LISTING_KINDS = [
  31923,
  36500, 36501, 36502, 36503, 36504, 36505,
  36506, 36507, 36508, 36509, 36510, 36511,
];
const LISTING_KIND_SET = new Set(ALL_LISTING_KINDS);

const KIND_38888_POLL_INTERVAL = 5 * 60 * 1000; // 5 min
const SAFETY_NET_INTERVAL = 60 * 60 * 1000;     // 60 min
const PING_INTERVAL = 30_000;
const PONG_TIMEOUT = 90_000;
const RECONNECT_BACKOFF_MIN = 1_000;
const RECONNECT_BACKOFF_MAX = 60_000;
const SINCE_OVERLAP = 60;
const SEEN_IDS_CAP = 10_000;

export interface LiveSyncConfig {
  /** Listing kinds this portal cares about. Default: [36502, 36510]. */
  listingKinds?: number[];
  /**
   * If set, KIND 31923 subscription is scoped by '#t' to this hashtag.
   * lana-events uses 'lana-event'.
   */
  listingHashtag?: string;
  /**
   * Tests only: these relays instead of KIND 38888's, and no KIND 38888
   * fetch at all (a loopback relay; nothing may reach the real ones).
   */
  relays?: string[];
}

interface ResolvedConfig {
  listingKinds: number[];
  listingHashtag?: string;
}

interface SubIds {
  /** {kinds:[30901,5]} */
  misc: string;
  /** {kinds:[30902], authors: registrar signers} */
  fees: string;
  /** {kinds:[30903], authors: registrar signers} */
  registrations: string;
  listings: string;
  cal31923?: string;
  /** {kinds:[36520,36521]} */
  orders: string;
  /** {kinds:[30933], authors: trusted signers} */
  purchases: string;
}

interface RelayState {
  url: string;
  ws: WebSocket | null;
  state: 'idle' | 'connecting' | 'live' | 'reconnecting' | 'closed';
  lastSeenCreatedAt: number;
  backoff: number;
  reconnectTimer: NodeJS.Timeout | null;
  pingTimer: NodeJS.Timeout | null;
  lastPongAt: number;
  subIds: SubIds;
}

let isRunning = false;
let dbRef: Database.Database;
let cfg: ResolvedConfig;
const relays = new Map<string, RelayState>();
let kind38888Timer: NodeJS.Timeout | null = null;
let safetyNetTimer: NodeJS.Timeout | null = null;
const seenEventIds = new Set<string>();

// ─────────────────────────────────────────── helpers

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function dedupRemember(id: string): boolean {
  if (seenEventIds.has(id)) return false;
  seenEventIds.add(id);
  if (seenEventIds.size > SEEN_IDS_CAP) {
    // bounded LRU-ish prune: keep newer half
    const keep = Array.from(seenEventIds).slice(SEEN_IDS_CAP / 2);
    seenEventIds.clear();
    keep.forEach(x => seenEventIds.add(x));
  }
  return true;
}

function getRelayList(db: Database.Database): string[] {
  const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY id DESC LIMIT 1').get() as any;
  if (!row) return [];
  try { return JSON.parse(row.relays || '[]'); } catch { return []; }
}

/** Relays we actually talk to: the dev override (see ./devOverrides.ts), else KIND 38888. */
export function getEffectiveRelays(db: Database.Database): string[] {
  return devRelays.length ? devRelays : getRelayList(db);
}

/** KIND 30933 authors we trust (kind_38888.trusted_signers → PROCESSOR_PUBKEY fallback). */
export function getTrustedSigners(db: Database.Database = dbRef): string[] {
  return Array.from(loadTrustedSigners(db));
}

function saveKind38888(db: Database.Database, p: any): void {
  db.prepare(`
    INSERT OR REPLACE INTO kind_38888
      (id, event_id, split, exchange_rates, electrum_servers, relays,
       trusted_signers, version, valid_from, split_target_lana,
       split_started_at, split_ends_at, split_approaching,
       freeze_lana_retail_account_above, raw_event, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    p.event_id,
    p.split,
    JSON.stringify(p.exchange_rates),
    JSON.stringify(p.electrum_servers),
    JSON.stringify(p.relays),
    JSON.stringify(p.trusted_signers),
    p.version,
    p.valid_from,
    p.split_target_lana || 0,
    p.split_started_at || 0,
    p.split_ends_at || 0,
    p.split_approaching ? 1 : 0,
    p.freeze_lana_retail_account_above || 0,
    p.raw_event,
  );
  // Single-row invariant: we always write id=1, and every read is
  // `ORDER BY id DESC LIMIT 1`. Purge any legacy higher-id rows (e.g. from the
  // old per-poll auto-increment heartbeat) so a stale row can never shadow the
  // fresh one — and to keep the table from bloating. The registrar signers
  // (who may publish 30902/30903) and the trusted 30933 signers are read from
  // this row.
  db.prepare('DELETE FROM kind_38888 WHERE id != 1').run();
}

async function refreshKind38888(): Promise<string[]> {
  try {
    const params = await fetchKind38888();
    if (!params) return [];
    saveKind38888(dbRef, params);
    return params.relays || [];
  } catch (err: any) {
    console.error('[liveSync] KIND 38888 fetch failed:', err.message || err);
    return [];
  }
}

// ─────────────────────────────────────────── tombstones (NIP-09)

/**
 * Returns true if a KIND 5 deletion event has already invalidated this
 * (kind, pubkey, d_tag) at or after the given event_created_at. Upserts
 * call this first so a late-arriving deleted event can't resurrect a row.
 */
function isTombstoned(kind: number, pubkey: string, dTag: string, eventCreatedAt: number): boolean {
  if (!dTag) return false;
  const row = dbRef.prepare(
    `SELECT tombstone_created_at FROM tombstones WHERE kind = ? AND pubkey = ? AND d_tag = ?`
  ).get(kind, pubkey, dTag) as any;
  if (!row) return false;
  return row.tombstone_created_at >= eventCreatedAt;
}

function recordTombstone(kind: number, pubkey: string, dTag: string, tombstoneCreatedAt: number, now: number): void {
  dbRef.prepare(`
    INSERT INTO tombstones (kind, pubkey, d_tag, tombstone_created_at, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(kind, pubkey, d_tag) DO UPDATE SET
      tombstone_created_at = CASE
        WHEN excluded.tombstone_created_at > tombstones.tombstone_created_at
        THEN excluded.tombstone_created_at
        ELSE tombstones.tombstone_created_at
      END,
      created_at = excluded.created_at
  `).run(kind, pubkey, dTag, tombstoneCreatedAt, now);
}

/**
 * F1 (round 5, 5 Oct 2026): remember an event id a KIND 5 named in an `e`
 * tag, with the key that signed the KIND 5 — the target may not have landed
 * yet. upsertUnit / upsertListing refuse an event whose (pubkey, id) is here.
 */
function rememberDeletedRef(author: string, eventId: string, deletionCreatedAt: number, now: number): void {
  dbRef.prepare(`
    INSERT INTO deleted_event_refs (author, event_id, deletion_created_at, seen_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(author, event_id) DO NOTHING
  `).run(author, eventId, deletionCreatedAt, now);
}

function isDeletedRef(author: string, eventId: string): boolean {
  return !!dbRef.prepare('SELECT 1 FROM deleted_event_refs WHERE author = ? AND event_id = ?').get(author, eventId);
}

/** The kind of a mirrored listing row: its signed raw event, else the parsed copy. */
function listingRowKind(row: { raw_event: string; parsed_json: string }): number | null {
  for (const src of [row.raw_event, row.parsed_json]) {
    try {
      const k = Number(JSON.parse(src)?.kind);
      if (Number.isInteger(k) && LISTING_KIND_SET.has(k)) return k;
    } catch { /* next */ }
  }
  return null;
}

/**
 * Process a KIND 5 (NIP-09) deletion event. The deleting pubkey MUST equal
 * the target's signer. Relays do NOT enforce this — they store and forward
 * a KIND 5 naming anybody's event — so every delete below checks it.
 *
 * `e` tags reference event IDs directly; `a` tags reference replaceable
 * coordinates (kind:pubkey:d). For each, we delete the corresponding row
 * AND write a tombstone so a late-arriving target can't resurrect.
 *
 * F1 (round 5, 5 Oct 2026): an `e` naming the mirrored version of a 30901 or
 * a listing tombstones its address at THAT version's created_at — before,
 * only the row went, and the relay's rebroadcast of an older, cheaper
 * version (or an older shipping fee / pickup offer) took its place. Lana
 * Wallet "My events" deletes with `e` only. An `e` whose target has not
 * landed yet is remembered (deleted_event_refs), so the target is refused
 * when it lands. After a unit or listing goes, the shop's orders are judged
 * again.
 */
function handleDeletion(ev: NostrEvent, now: number): void {
  // A KIND 5 can remove a unit, listing, fee policy or 30903 row. Clear the
  // catalogue even when a later step throws: rows deleted before the error
  // stay deleted, and this event id is already marked seen, so it is not
  // processed again — without the finally the storefront would keep showing
  // a deleted listing until the 60 s backstop.
  try {
    applyDeletion(ev, now);
  } finally {
    invalidateCatalogue();
  }
}

function applyDeletion(ev: NostrEvent, now: number): void {
  const deleterPubkey = ev.pubkey;
  // Shops whose 30901 or listings went: their orders are judged again below.
  const touchedUnits = new Set<string>();
  try {
    applyDeletionTags(ev, now, deleterPubkey, touchedUnits);
  } finally {
    for (const unitId of touchedUnits) recomputeOrdersForUnit(dbRef, unitId, now);
  }
}

function applyDeletionTags(ev: NostrEvent, now: number, deleterPubkey: string, touchedUnits: Set<string>): void {
  for (const tag of ev.tags || []) {
    if (!Array.isArray(tag) || tag.length < 2) continue;
    if (tag[0] === 'e' && tag[1]) {
      const eventId = tag[1];
      rememberDeletedRef(deleterPubkey, eventId, ev.created_at, now);
      // Only the key that signed a row may delete it: `pubkey` for units and
      // listings, `signer` (the registrar) for fee policies and 30903s. The
      // address of a deleted unit / listing version is tombstoned at that
      // version's created_at, so no older version comes back.
      const unit = dbRef.prepare('SELECT unit_id, event_created_at FROM business_units WHERE event_id = ? AND pubkey = ?')
        .get(eventId, deleterPubkey) as { unit_id: string; event_created_at: number } | undefined;
      if (unit) {
        recordTombstone(30901, deleterPubkey, unit.unit_id, unit.event_created_at, now);
        dbRef.prepare('DELETE FROM business_units WHERE event_id = ? AND pubkey = ?')
          .run(eventId, deleterPubkey);
        touchedUnits.add(unit.unit_id);
      }
      const listing = dbRef.prepare('SELECT listing_id, unit_id, event_created_at, raw_event, parsed_json FROM listings WHERE event_id = ? AND pubkey = ?')
        .get(eventId, deleterPubkey) as { listing_id: string; unit_id: string | null; event_created_at: number; raw_event: string; parsed_json: string } | undefined;
      if (listing) {
        const kind = listingRowKind(listing);
        if (kind !== null) recordTombstone(kind, deleterPubkey, listing.listing_id, listing.event_created_at, now);
        dbRef.prepare('DELETE FROM listings WHERE event_id = ? AND pubkey = ?')
          .run(eventId, deleterPubkey);
        if (listing.unit_id) touchedUnits.add(listing.unit_id);
      }
      dbRef.prepare('DELETE FROM fee_policies WHERE event_id = ? AND signer = ?')
        .run(eventId, deleterPubkey);
      dbRef.prepare('DELETE FROM global_suspensions WHERE event_id = ? AND signer = ?')
        .run(eventId, deleterPubkey);
      deleteOrderSideByEventId(eventId, deleterPubkey);
    } else if (tag[0] === 'a' && tag[1]) {
      const parts = tag[1].split(':');
      if (parts.length < 3) continue;
      const kind = parseInt(parts[0], 10);
      const targetPubkey = parts[1];
      const dTag = parts.slice(2).join(':'); // d-tag may contain colons
      if (isNaN(kind) || !dTag) continue;
      // Ownership check: deleter must equal target
      if (targetPubkey !== deleterPubkey) continue;
      if (kind === KIND_SHOP_ORDER || kind === KIND_SHOP_FULFILLMENT) {
        // SPEC §0: once a qualifying 30933 exists the order is money — a
        // KIND 5 from the buyer (36520) or the merchant (36521) is IGNORED,
        // and no tombstone is written so the events can still (re)land.
        if (orderHasMoney(dbRef, dTag)) continue;
        recordTombstone(kind, targetPubkey, dTag, ev.created_at, now);
        if (kind === KIND_SHOP_ORDER) {
          dbRef.prepare(
            `DELETE FROM orders WHERE order_id = ? AND buyer_pubkey = ? AND order_created_at <= ?`
          ).run(dTag, targetPubkey, ev.created_at);
        } else {
          clearFulfillment(dTag, targetPubkey, ev.created_at);
        }
        continue;
      }
      recordTombstone(kind, targetPubkey, dTag, ev.created_at, now);
      if (kind === 30901) {
        const r = dbRef.prepare(
          `DELETE FROM business_units WHERE pubkey = ? AND unit_id = ? AND event_created_at <= ?`
        ).run(targetPubkey, dTag, ev.created_at);
        if (r.changes > 0) touchedUnits.add(dTag);
      } else if (kind === KIND_FEE_POLICY) {
        // The row the registrar signed under this address — never the row
        // of whatever unit id a stranger writes as "its own" d tag.
        dbRef.prepare(
          `DELETE FROM fee_policies WHERE signer = ? AND d_tag = ? AND event_created_at <= ?`
        ).run(targetPubkey, dTag, ev.created_at);
      } else if (kind === KIND_REGISTRATION) {
        dbRef.prepare(
          `DELETE FROM global_suspensions WHERE signer = ? AND d_tag = ? AND event_created_at <= ?`
        ).run(targetPubkey, dTag, ev.created_at);
      } else if (LISTING_KIND_SET.has(kind)) {
        deleteListingUpTo(targetPubkey, dTag, ev.created_at, touchedUnits);
      }
    }
  }
}

/** Drop the mirrored listing at (owner, d) unless it is newer than `upTo`; note its shop. */
function deleteListingUpTo(pubkey: string, listingId: string, upTo: number, touchedUnits: Set<string>): void {
  const row = dbRef.prepare('SELECT unit_id FROM listings WHERE pubkey = ? AND listing_id = ? AND event_created_at <= ?')
    .get(pubkey, listingId, upTo) as { unit_id: string | null } | undefined;
  if (!row) return;
  dbRef.prepare('DELETE FROM listings WHERE pubkey = ? AND listing_id = ? AND event_created_at <= ?')
    .run(pubkey, listingId, upTo);
  if (row.unit_id) touchedUnits.add(row.unit_id);
}

function clearFulfillment(orderId: string, merchantPubkey: string, upToCreatedAt: number): void {
  const r = dbRef.prepare(`
    UPDATE orders SET
      fulfillment_event_id = NULL, fulfillment_pubkey = NULL, fulfillment_created_at = 0,
      fulfillment_json = NULL, fulfillment_raw = NULL
    WHERE order_id = ? AND fulfillment_pubkey = ? AND fulfillment_created_at <= ?
  `).run(orderId, merchantPubkey, upToCreatedAt);
  if (r.changes > 0) recomputeOrder(dbRef, orderId);
}

/** `e`-tag deletion of a 36520 / 36521 by event id — same money rule as the `a` path. */
function deleteOrderSideByEventId(eventId: string, deleterPubkey: string): void {
  const asOrder = dbRef.prepare('SELECT order_id, order_created_at FROM orders WHERE order_event_id = ? AND buyer_pubkey = ?')
    .get(eventId, deleterPubkey) as { order_id: string; order_created_at: number } | undefined;
  if (asOrder && !orderHasMoney(dbRef, asOrder.order_id)) {
    dbRef.prepare('DELETE FROM orders WHERE order_id = ? AND order_event_id = ?').run(asOrder.order_id, eventId);
  }
  const asFulfillment = dbRef.prepare('SELECT order_id, fulfillment_created_at FROM orders WHERE fulfillment_event_id = ? AND fulfillment_pubkey = ?')
    .get(eventId, deleterPubkey) as { order_id: string; fulfillment_created_at: number } | undefined;
  if (asFulfillment && !orderHasMoney(dbRef, asFulfillment.order_id)) {
    clearFulfillment(asFulfillment.order_id, deleterPubkey, asFulfillment.fulfillment_created_at);
  }
}

// ─────────────────────────────────────────── upserts (per kind)

function upsertUnit(ev: NostrEvent, now: number): void {
  const parsed = parseUnit(ev);
  if (!parsed.unitId) return;
  if (isDeletedRef(ev.pubkey, ev.id)) {
    // Its author deleted this very event by `e` before it landed here (F1):
    // refused, and neither it nor an older version of the shop comes back.
    recordTombstone(30901, ev.pubkey, parsed.unitId, ev.created_at, now);
    const r = dbRef.prepare('DELETE FROM business_units WHERE pubkey = ? AND unit_id = ? AND event_created_at <= ?')
      .run(ev.pubkey, parsed.unitId, ev.created_at);
    if (r.changes > 0) {
      invalidateCatalogue();
      recomputeOrdersForUnit(dbRef, parsed.unitId, now);
    }
    return;
  }
  if (isTombstoned(30901, ev.pubkey, parsed.unitId, ev.created_at)) return;
  const written = dbRef.prepare(`
    INSERT INTO business_units (pubkey, unit_id, event_id, event_created_at, parsed_json, raw_event, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pubkey, unit_id) DO UPDATE SET
      event_id = excluded.event_id,
      event_created_at = excluded.event_created_at,
      parsed_json = excluded.parsed_json,
      raw_event = excluded.raw_event,
      fetched_at = excluded.fetched_at
    WHERE excluded.event_created_at > business_units.event_created_at
  `).run(ev.pubkey, parsed.unitId, ev.id, ev.created_at, JSON.stringify(parsed), JSON.stringify(ev), now);
  if (written.changes > 0) invalidateCatalogue();
  // Shipping fee / staff / currency feed the resolver — re-verdict its orders.
  recomputeOrdersForUnit(dbRef, parsed.unitId, now);
}

function upsertListing(ev: NostrEvent, now: number): void {
  const parsed = parseListing(ev);
  if (!parsed.listingId) return;
  // Only the shop's own key may list on it: a stranger's listing whose `a`
  // names someone else's 30901 would otherwise join that shop's catalogue.
  if (!listingOwnsUnitRef(ev.pubkey, parsed.unitRef)) return;
  if (isDeletedRef(ev.pubkey, ev.id)) {
    // Its author deleted this very event by `e` before it landed here (F1):
    // refused, and neither it nor an older (cheaper) version comes back.
    recordTombstone(ev.kind, ev.pubkey, parsed.listingId, ev.created_at, now);
    const touched = new Set<string>();
    deleteListingUpTo(ev.pubkey, parsed.listingId, ev.created_at, touched);
    if (touched.size > 0) invalidateCatalogue();
    for (const unitId of touched) recomputeOrdersForUnit(dbRef, unitId, now);
    return;
  }
  if (isTombstoned(ev.kind, ev.pubkey, parsed.listingId, ev.created_at)) return;
  const unitId = parsed.unitRef?.split(':')[2] || null;
  const written = dbRef.prepare(`
    INSERT INTO listings (pubkey, listing_id, unit_id, event_id, event_created_at, parsed_json, raw_event, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pubkey, listing_id) DO UPDATE SET
      unit_id = excluded.unit_id,
      event_id = excluded.event_id,
      event_created_at = excluded.event_created_at,
      parsed_json = excluded.parsed_json,
      raw_event = excluded.raw_event,
      fetched_at = excluded.fetched_at
    WHERE excluded.event_created_at > listings.event_created_at
  `).run(ev.pubkey, parsed.listingId, unitId, ev.id, ev.created_at, JSON.stringify(parsed), JSON.stringify(ev), now);
  if (written.changes > 0) invalidateCatalogue();
  // A republished price moves `expected` / price_changed for open orders.
  if (unitId) recomputeOrdersForUnit(dbRef, unitId, now);
}

/**
 * KIND 36520 — buyer-signed order. Identity (buyer pubkey, d); newest wins.
 * Fail-closed: the order id MUST carry the buyer's pubkey prefix, the
 * content MUST be '' (PII lives only in 36522), and the `a`/`unit_id` pair
 * must agree.
 */
function upsertShopOrder(ev: NostrEvent, now: number): void {
  const parsed = parseShopOrder(ev);
  if (!parsed.orderId) return;
  // lanaeco.farm judges only orders for the listing kinds it mirrors (36500).
  // Every portal's 36520 arrives on this subscription; an order for another
  // portal's listings (lanaeco.shop's 36502) has no listing here to price it,
  // so the mirror could only call it amount_mismatch and, once its 30933
  // lands, list it in order_settle_review as not_computable — another
  // portal's paid order on Brilly's list, and on the per-unit open-order cap.
  if (parsed.items.length === 0 || parsed.items.some(it => !cfg.listingKinds.includes(it.kind))) return;
  if (isTombstoned(KIND_SHOP_ORDER, ev.pubkey, parsed.orderId, ev.created_at)) return;
  upsertOrderEvent(dbRef, ev, now);
}

/**
 * KIND 36521 — merchant-signed fulfillment. Stored on the order's row only
 * when the signer is the unit owner or one of its staff `p` hexes, so a
 * stranger's forged event can never shadow the merchant's real one.
 */
function upsertFulfillment(ev: NostrEvent, now: number): void {
  const parsed = parseFulfillment(ev);
  if (!parsed.orderId || !parsed.status) return;
  if (isTombstoned(KIND_SHOP_FULFILLMENT, ev.pubkey, parsed.orderId, ev.created_at)) return;
  const order = dbRef.prepare('SELECT unit_id, buyer_pubkey, order_json FROM orders WHERE order_id = ?')
    .get(parsed.orderId) as { unit_id: string; buyer_pubkey: string; order_json: string } | undefined;
  if (!order) return; // order side not mirrored yet — safety net replays hourly
  if (parsed.unitId && parsed.unitId !== order.unit_id) return;
  // SPEC §3: `p` = buyer B and `a` = 36520:<B>:<D> — a 36521 must bind to
  // THIS order's buyer, not merely reuse its `d`.
  if (parsed.buyerPubkey !== order.buyer_pubkey) return;
  if (parsed.orderRef && parsed.orderRef !== `36520:${order.buyer_pubkey}:${parsed.orderId}`) return;
  // The unit the order's `a` names (owner + unit id): a stranger's 30901
  // reusing the unit id must not become this order's merchant.
  let ownerHex = '';
  try { ownerHex = String(JSON.parse(order.order_json).ownerHex || ''); } catch { ownerHex = ''; }
  const unitRow = dbRef.prepare('SELECT raw_event FROM business_units WHERE pubkey = ? AND unit_id = ?')
    .get(ownerHex, order.unit_id) as { raw_event: string } | undefined;
  if (!unitRow) return;
  let signerOk = false;
  try {
    const unitEv = JSON.parse(unitRow.raw_event) as NostrEvent;
    const u = parseUnit(unitEv);
    signerOk = ev.pubkey === unitEv.pubkey || u.staffHexes.includes(ev.pubkey);
  } catch { signerOk = false; }
  if (!signerOk) return;
  dbRef.prepare(`
    UPDATE orders SET
      fulfillment_event_id = ?, fulfillment_pubkey = ?, fulfillment_created_at = ?,
      fulfillment_json = ?, fulfillment_raw = ?, fetched_at = ?
    WHERE order_id = ? AND ? > fulfillment_created_at
  `).run(ev.id, ev.pubkey, ev.created_at, JSON.stringify(parsed), JSON.stringify(ev), now, parsed.orderId, ev.created_at);
  recomputeOrder(dbRef, parsed.orderId, now);
}

/**
 * KIND 30933 — brain-signed purchase, join tags only. The live REQ already
 * filters by trusted authors; the safety net and any caller of ingestEvent
 * get the same check here (defence in depth).
 *
 * One row per (signer, tx id): an incoming version replaces the stored one
 * only when the resolver's version rule says it counts over it
 * (purchaseVersionWins — newer wins; in the same second the NOT-paid one,
 * then the lowest id). A strict "newer only" kept the first copy seen, so a
 * cancellation signed in the same second as the payment never landed here.
 */
function upsertPurchase(ev: NostrEvent, now: number): void {
  if (!loadTrustedSigners(dbRef).has(ev.pubkey)) return;
  const parsed = parsePurchase(ev);
  if (!parsed.txId || !parsed.unitId || !parsed.invoiceNumber) return; // not a shop purchase
  if (isTombstoned(KIND_PURCHASE, ev.pubkey, parsed.txId, ev.created_at)) return;
  const stored = dbRef.prepare('SELECT event_id, event_created_at, unit_id, invoice_number, parsed_json FROM purchases_30933 WHERE pubkey = ? AND tx_id = ?')
    .get(ev.pubkey, parsed.txId) as { event_id: string; event_created_at: number; unit_id: string; invoice_number: string; parsed_json: string } | undefined;
  if (stored) {
    let storedStatus = '';
    try { storedStatus = String(JSON.parse(stored.parsed_json)?.status ?? ''); } catch { storedStatus = ''; }
    const wins = purchaseVersionWins(
      { createdAt: ev.created_at, status: parsed.status, eventId: ev.id },
      { createdAt: stored.event_created_at, status: storedStatus, eventId: stored.event_id },
    );
    if (!wins) return;
  }
  dbRef.prepare(`
    INSERT INTO purchases_30933 (pubkey, tx_id, event_id, event_created_at, unit_id, invoice_number, parsed_json, raw_event, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pubkey, tx_id) DO UPDATE SET
      event_id = excluded.event_id,
      event_created_at = excluded.event_created_at,
      unit_id = excluded.unit_id,
      invoice_number = excluded.invoice_number,
      parsed_json = excluded.parsed_json,
      raw_event = excluded.raw_event,
      fetched_at = excluded.fetched_at
  `).run(ev.pubkey, parsed.txId, ev.id, ev.created_at, parsed.unitId, parsed.invoiceNumber, JSON.stringify(parsed), JSON.stringify(ev), now);
  recomputeOrdersForPurchase(dbRef, parsed.unitId, parsed.invoiceNumber, now);
  // A replaced version that named another order no longer pays it.
  if (stored && (stored.unit_id !== parsed.unitId || stored.invoice_number !== parsed.invoiceNumber)) {
    recomputeOrdersForPurchase(dbRef, stored.unit_id, stored.invoice_number, now);
  }
}

/**
 * KIND 30902 — the registrar's fee policy for ONE shop. One row per unit id
 * (newest wins); readers join it by (owner_pubkey, unit_id).
 */
function upsertFeePolicy(ev: NostrEvent, now: number): void {
  if (!registrarSigners(dbRef).has(ev.pubkey)) return; // only the registrar publishes fees
  const parsed = parseFeePolicy(ev);
  if (!parsed.unitId) return;
  const owner = registryOwner(ev, parsed.unitId);
  if (!owner) return;
  const dTag = getTag(ev, 'd') || parsed.unitId; // policy_<unit8>_<quarter>
  if (isTombstoned(KIND_FEE_POLICY, ev.pubkey, dTag, ev.created_at)) return;
  const written = dbRef.prepare(`
    INSERT INTO fee_policies (unit_id, event_id, event_created_at, lana_discount_per, status, raw_event, fetched_at, owner_pubkey, signer, d_tag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(unit_id) DO UPDATE SET
      event_id = excluded.event_id,
      event_created_at = excluded.event_created_at,
      lana_discount_per = excluded.lana_discount_per,
      status = excluded.status,
      raw_event = excluded.raw_event,
      fetched_at = excluded.fetched_at,
      owner_pubkey = excluded.owner_pubkey,
      signer = excluded.signer,
      d_tag = excluded.d_tag
    WHERE excluded.event_created_at > fee_policies.event_created_at
  `).run(parsed.unitId, ev.id, ev.created_at, parsed.lanaDiscountPer, parsed.status, JSON.stringify(ev), now, owner, ev.pubkey, dTag);
  if (written.changes > 0) invalidateCatalogue();
}

/**
 * KIND 30903 — the registrar's word on whether ONE shop may be public
 * (a missing status tag reads as `suspended`). Only the registrar signs it
 * (d = unit id), so the registrar also decides which owner holds a unit id.
 * One row per unit id (newest wins); readers join it by (owner_pubkey, unit_id).
 */
function upsertSuspension(ev: NostrEvent, now: number): void {
  if (!registrarSigners(dbRef).has(ev.pubkey)) return;
  const parsed = parseSuspension(ev);
  if (!parsed.unitId) return;
  const owner = registryOwner(ev, parsed.unitId);
  if (!owner) return;
  const dTag = getTag(ev, 'd') || parsed.unitId;
  if (isTombstoned(KIND_REGISTRATION, ev.pubkey, dTag, ev.created_at)) return;
  const written = dbRef.prepare(`
    INSERT INTO global_suspensions (unit_id, event_id, event_created_at, status, reason, active_until, raw_event, fetched_at, owner_pubkey, signer, d_tag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(unit_id) DO UPDATE SET
      event_id = excluded.event_id,
      event_created_at = excluded.event_created_at,
      status = excluded.status,
      reason = excluded.reason,
      active_until = excluded.active_until,
      raw_event = excluded.raw_event,
      fetched_at = excluded.fetched_at,
      owner_pubkey = excluded.owner_pubkey,
      signer = excluded.signer,
      d_tag = excluded.d_tag
    WHERE excluded.event_created_at > global_suspensions.event_created_at
  `).run(parsed.unitId, ev.id, ev.created_at, parsed.status, parsed.reason, parsed.activeUntil, JSON.stringify(ev), now, owner, ev.pubkey, dTag);
  if (written.changes > 0) invalidateCatalogue();
}

function dispatchEvent(ev: NostrEvent, relayUrl: string, skipDedup = false): void {
  if (!ev || typeof ev !== 'object') return;
  if (!skipDedup && seenEventIds.has(ev.id)) return;
  // EVERY kind: the pubkey a relay puts on an event means nothing until its
  // signature checks out (money: the brain's 30933; registry: 30902/30903;
  // shops: 30901 and listings, whose signer rules everything else). Checked
  // BEFORE the id is remembered, so a copy that reuses a real event's id
  // cannot make the live path drop the real event as a duplicate.
  if (!signatureOk(ev)) {
    console.warn(`[liveSync] dropped kind=${ev.kind} id=${String(ev.id || '').slice(0, 12)} from ${relayUrl}: bad signature`);
    return;
  }
  if (!skipDedup) dedupRemember(ev.id);
  const now = Math.floor(Date.now() / 1000);
  try {
    switch (ev.kind) {
      case 5: handleDeletion(ev, now); break;
      case 30901: upsertUnit(ev, now); break;
      case KIND_FEE_POLICY: upsertFeePolicy(ev, now); break;
      case KIND_REGISTRATION: upsertSuspension(ev, now); break;
      case KIND_SHOP_ORDER: upsertShopOrder(ev, now); break;
      case KIND_SHOP_FULFILLMENT: upsertFulfillment(ev, now); break;
      case KIND_PURCHASE: upsertPurchase(ev, now); break;
      default:
        if (LISTING_KIND_SET.has(ev.kind)) upsertListing(ev, now);
        return;
    }
  } catch (err: any) {
    console.error(`[liveSync] dispatch kind=${ev.kind}:`, err.message || err);
    return;
  }
  const r = relays.get(relayUrl);
  if (r && ev.created_at > r.lastSeenCreatedAt) r.lastSeenCreatedAt = ev.created_at;
}

// ─────────────────────────────────────────── relay connection

function openConnection(url: string): void {
  if (relays.has(url)) closeConnection(relays.get(url)!);
  const r: RelayState = {
    url,
    ws: null,
    state: 'idle',
    lastSeenCreatedAt: 0,
    backoff: RECONNECT_BACKOFF_MIN,
    reconnectTimer: null,
    pingTimer: null,
    lastPongAt: Date.now(),
    subIds: {
      misc: genId('m'), fees: genId('f'), registrations: genId('r'),
      listings: genId('l'), orders: genId('o'), purchases: genId('p'),
    },
  };
  if (cfg.listingHashtag) r.subIds.cal31923 = genId('c');
  relays.set(url, r);
  doConnect(r);
}

function doConnect(r: RelayState): void {
  if (!isRunning) return;
  r.state = 'connecting';
  console.log(`[liveSync] ${r.url} connecting`);
  let ws: WebSocket;
  try {
    ws = new WebSocket(r.url);
  } catch (err: any) {
    console.error(`[liveSync] ${r.url} construct failed:`, err.message || err);
    scheduleReconnect(r);
    return;
  }
  r.ws = ws;

  ws.on('open', () => {
    console.log(`[liveSync] ${r.url} OPEN`);
    r.state = 'live';
    r.backoff = RECONNECT_BACKOFF_MIN;
    r.lastPongAt = Date.now();
    sendSubscriptions(r);
    startPing(r);
  });

  ws.on('message', (data: Buffer) => {
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    handleMessage(r, msg);
  });

  ws.on('pong', () => { r.lastPongAt = Date.now(); });

  ws.on('close', () => {
    console.log(`[liveSync] ${r.url} CLOSE`);
    stopPing(r);
    r.ws = null;
    if (isRunning) scheduleReconnect(r);
  });

  ws.on('error', (err: any) => {
    console.error(`[liveSync] ${r.url} ERROR:`, err.message || err);
    // 'close' will fire next; reconnect handled there
  });
}

function sendSubscriptions(r: RelayState): void {
  if (!r.ws || r.ws.readyState !== WebSocket.OPEN) return;
  const sinceObj = r.lastSeenCreatedAt > 0
    ? { since: r.lastSeenCreatedAt - SINCE_OVERLAP }
    : {};

  // units + KIND 5 deletions (no hashtag scoping)
  r.ws.send(JSON.stringify(['REQ', r.subIds.misc, {
    kinds: [30901, 5],
    ...sinceObj,
  }]));
  // Registry kinds, ONLY from the registrar (the upserts check it again).
  // One REQ each: a relay answers at most 500 events per REQ.
  const registrars = Array.from(registrarSigners(dbRef));
  r.ws.send(JSON.stringify(['REQ', r.subIds.registrations, {
    kinds: [KIND_REGISTRATION],
    authors: registrars,
    ...sinceObj,
  }]));
  r.ws.send(JSON.stringify(['REQ', r.subIds.fees, {
    kinds: [KIND_FEE_POLICY],
    authors: registrars,
    ...sinceObj,
  }]));

  if (cfg.listingHashtag) {
    // KIND 31923 scoped by hashtag (e.g. lana-event)
    if (r.subIds.cal31923) {
      r.ws.send(JSON.stringify(['REQ', r.subIds.cal31923, {
        kinds: [31923],
        '#t': [cfg.listingHashtag],
        ...sinceObj,
      }]));
    }
    // Other listing kinds without hashtag (36502/36510)
    const others = cfg.listingKinds.filter(k => k !== 31923);
    if (others.length > 0) {
      r.ws.send(JSON.stringify(['REQ', r.subIds.listings, {
        kinds: others,
        ...sinceObj,
      }]));
    }
  } else {
    r.ws.send(JSON.stringify(['REQ', r.subIds.listings, {
      kinds: cfg.listingKinds,
      ...sinceObj,
    }]));
  }

  // Lana Online Shop: buyer orders + merchant fulfillments (any author) …
  r.ws.send(JSON.stringify(['REQ', r.subIds.orders, {
    kinds: [KIND_SHOP_ORDER, KIND_SHOP_FULFILLMENT],
    ...sinceObj,
  }]));
  // … and brain purchases, ONLY from KIND 38888 trusted signers.
  const trusted = getTrustedSigners(dbRef);
  if (trusted.length > 0) {
    r.ws.send(JSON.stringify(['REQ', r.subIds.purchases, {
      kinds: [KIND_PURCHASE],
      authors: trusted,
      ...sinceObj,
    }]));
  }
}

function handleMessage(r: RelayState, msg: any): void {
  if (!Array.isArray(msg) || msg.length < 1) return;
  switch (msg[0]) {
    case 'EVENT': {
      const ev = msg[2] as NostrEvent;
      if (ev && typeof ev === 'object') dispatchEvent(ev, r.url);
      break;
    }
    case 'EOSE':
      console.log(`[liveSync] ${r.url} EOSE sub=${msg[1]}`);
      break;
    case 'NOTICE':
      console.log(`[liveSync] ${r.url} NOTICE: ${msg[1]}`);
      break;
    case 'CLOSED':
      console.log(`[liveSync] ${r.url} CLOSED sub=${msg[1]} reason=${msg[2]}`);
      break;
  }
}

function startPing(r: RelayState): void {
  stopPing(r);
  r.pingTimer = setInterval(() => {
    if (!r.ws || r.ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - r.lastPongAt > PONG_TIMEOUT) {
      console.warn(`[liveSync] ${r.url} pong timeout — terminating`);
      try { r.ws.terminate(); } catch {}
      return;
    }
    try { r.ws.ping(); } catch {}
  }, PING_INTERVAL);
}

function stopPing(r: RelayState): void {
  if (r.pingTimer) { clearInterval(r.pingTimer); r.pingTimer = null; }
}

function scheduleReconnect(r: RelayState): void {
  if (!isRunning) return;
  if (r.reconnectTimer) return;
  r.state = 'reconnecting';
  const delay = r.backoff;
  console.log(`[liveSync] ${r.url} reconnect in ${delay}ms`);
  r.reconnectTimer = setTimeout(() => {
    r.reconnectTimer = null;
    r.backoff = Math.min(r.backoff * 2, RECONNECT_BACKOFF_MAX);
    doConnect(r);
  }, delay);
}

function closeConnection(r: RelayState): void {
  if (r.reconnectTimer) { clearTimeout(r.reconnectTimer); r.reconnectTimer = null; }
  stopPing(r);
  if (r.ws) { try { r.ws.terminate(); } catch {} r.ws = null; }
  r.state = 'closed';
}

// ─────────────────────────────────────────── hourly safety net

async function runSafetyNet(): Promise<void> {
  console.log('[liveSync] safety net sweep');
  const relayList = getEffectiveRelays(dbRef);
  if (relayList.length === 0) return;
  const allKinds = Array.from(new Set([
    5, 30901, ...cfg.listingKinds, KIND_SHOP_ORDER, KIND_SHOP_FULFILLMENT,
  ]));
  try {
    const events = await fetchEvents(relayList, { kinds: allKinds });
    let n = 0;
    for (const ev of events) {
      // Upsert without consuming the live dedup set; replaceable upserts
      // are idempotent thanks to the `WHERE excluded.event_created_at > ...`
      // clause in every upsert SQL.
      dispatchEvent(ev, '<safetynet>', /* skipDedup */ true);
      n++;
    }
    // Registry kinds from the registrar only, one fetch each (500 per REQ).
    const registrars = Array.from(registrarSigners(dbRef));
    for (const kind of [KIND_REGISTRATION, KIND_FEE_POLICY]) {
      for (const ev of await fetchEvents(relayList, { kinds: [kind], authors: registrars })) {
        dispatchEvent(ev, '<safetynet>', /* skipDedup */ true);
        n++;
      }
    }
    // 30933 is high-volume and only the last week can settle an open order
    // (pay_by is 30 min; a week covers relay hiccups generously).
    const trusted = getTrustedSigners(dbRef);
    if (trusted.length > 0) {
      const since = Math.floor(Date.now() / 1000) - PURCHASE_SAFETY_NET_WINDOW;
      const purchases = await fetchEvents(relayList, { kinds: [KIND_PURCHASE], authors: trusted, since });
      for (const ev of purchases) {
        dispatchEvent(ev, '<safetynet>', /* skipDedup */ true);
        n++;
      }
    }
    console.log(`[liveSync] safety net processed ${n} events`);
  } catch (err: any) {
    console.error('[liveSync] safety net failed:', err.message || err);
  }
}

/**
 * On-demand 30933 pull for one unit (used by GET /api/orders/:id?src=pay
 * when the buyer lands back from the gateway before the live sub delivered
 * the receipt). Relay truth only — the broker's word is never stored.
 */
export async function refreshPurchasesForUnit(unitId: string, since: number): Promise<number> {
  if (!dbRef) return 0;
  const relayList = getEffectiveRelays(dbRef);
  const trusted = getTrustedSigners(dbRef);
  if (relayList.length === 0 || trusted.length === 0) return 0;
  const events = await fetchEvents(relayList, {
    kinds: [KIND_PURCHASE], authors: trusted, since: Math.max(0, since), timeoutMs: 8000,
  });
  let n = 0;
  for (const ev of events) {
    if (ev.kind !== KIND_PURCHASE) continue;
    if (parsePurchase(ev).unitId !== unitId) continue;
    dispatchEvent(ev, '<ondemand>', /* skipDedup */ true);
    n++;
  }
  return n;
}

/**
 * Re-parse every mirrored 30901 / listing from its SIGNED raw event so
 * rows cached before a parser gained fields (online_shop_*, staffHexes,
 * kind) carry the current parsed_json shape. Idempotent; runs at start.
 */
function reparseMirror(db: Database.Database): void {
  const units = db.prepare('SELECT pubkey, unit_id, raw_event FROM business_units').all() as any[];
  const upU = db.prepare('UPDATE business_units SET parsed_json = ? WHERE pubkey = ? AND unit_id = ?');
  for (const u of units) {
    try { upU.run(JSON.stringify(parseUnit(JSON.parse(u.raw_event))), u.pubkey, u.unit_id); } catch {}
  }
  const listings = db.prepare('SELECT pubkey, listing_id, raw_event FROM listings').all() as any[];
  const upL = db.prepare('UPDATE listings SET parsed_json = ? WHERE pubkey = ? AND listing_id = ?');
  for (const l of listings) {
    try { upL.run(JSON.stringify(parseListing(JSON.parse(l.raw_event))), l.pubkey, l.listing_id); } catch {}
  }
  invalidateCatalogue();
}

// ─────────────────────────────────────────── test / on-demand hooks

/**
 * fee_policies / global_suspensions rows mirrored before liveSync checked who
 * signed them (no `signer` yet): re-run today's ingest rule on each one's
 * raw event. The registrar's rows keep their place and get owner / signer /
 * d tag; anything else — a stranger's, a broken signature, no `a` naming the
 * owner — is dropped, and the registrar's own event comes back with the live
 * subscription or the hourly safety net. Rows that have a signer are not
 * looked at again.
 */
export function migrateRegistryRows(db: Database.Database): { kept: number; dropped: number } {
  const signers = registrarSigners(db);
  let kept = 0;
  let dropped = 0;
  const tables = [
    { table: 'fee_policies', kind: KIND_FEE_POLICY, unitIdOf: (ev: NostrEvent) => parseFeePolicy(ev).unitId },
    { table: 'global_suspensions', kind: KIND_REGISTRATION, unitIdOf: (ev: NostrEvent) => parseSuspension(ev).unitId },
  ];
  db.transaction(() => {
    for (const { table, kind, unitIdOf } of tables) {
      const rows = db.prepare(`SELECT unit_id, raw_event FROM ${table} WHERE signer IS NULL`)
        .all() as Array<{ unit_id: string; raw_event: string }>;
      for (const r of rows) {
        let ev: NostrEvent | null = null;
        try { ev = JSON.parse(r.raw_event); } catch { ev = null; }
        const owner = ev && ev.kind === kind && signatureOk(ev) && signers.has(ev.pubkey) && unitIdOf(ev) === r.unit_id
          ? registryOwner(ev, r.unit_id)
          : null;
        if (!ev || !owner) {
          db.prepare(`DELETE FROM ${table} WHERE unit_id = ?`).run(r.unit_id);
          dropped++;
          continue;
        }
        db.prepare(`UPDATE ${table} SET owner_pubkey = ?, signer = ?, d_tag = ? WHERE unit_id = ?`)
          .run(owner, ev.pubkey, getTag(ev, 'd') || r.unit_id, r.unit_id);
        kept++;
      }
    }
  })();
  if (kept || dropped) {
    console.log(`[liveSync] registry rows checked: kept ${kept}, dropped ${dropped}`);
    invalidateCatalogue();
  }
  return { kept, dropped };
}

/** Bind the DB without opening any relay connection (tests, one-off ingest). */
export function initLiveSyncDb(db: Database.Database): void {
  dbRef = db;
  if (!cfg) cfg = { listingKinds: ALL_LISTING_KINDS.slice() };
  migrateRegistryRows(db);
  rejudgeLegacyPaidOrders(db, undefined, { listingKinds: new Set(cfg.listingKinds) });
}

/** Feed one already-fetched event through the same dispatch as the live sub. */
export function ingestEvent(ev: NostrEvent): void {
  dispatchEvent(ev, '<ingest>', /* skipDedup */ true);
}

// ─────────────────────────────────────────── public API

export async function startLiveSync(
  db: Database.Database,
  config?: LiveSyncConfig,
): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  dbRef = db;
  cfg = {
    // Default to ALL listing kinds; the API filter (PORTAL_CATEGORIES) does
    // the per-portal scoping, so over-subscription is harmless.
    listingKinds: config?.listingKinds ?? ALL_LISTING_KINDS.slice(),
    listingHashtag: config?.listingHashtag,
  };
  console.log(
    `[liveSync] start; listingKinds=${JSON.stringify(cfg.listingKinds)}`
    + (cfg.listingHashtag ? ` hashtag=${cfg.listingHashtag}` : ''),
  );

  // Synchronous, before the first await: no request is served from rows
  // that have not been checked.
  try { migrateRegistryRows(dbRef); } catch (err: any) {
    console.error('[liveSync] registry row check failed:', err.message || err);
  }
  try { reparseMirror(dbRef); } catch (err: any) {
    console.error('[liveSync] reparse failed:', err.message || err);
  }
  // 'paid' verdicts of the older rules are judged again by SPEC v1.1.2 step 5
  // before any request reads them (orderJoin.rejudgeLegacyPaidOrders). An
  // order of a listing kind this portal does not subscribe to (lanaeco.farm:
  // only 36500) cannot be judged here; it is listed apart, as
  // listing_kind_not_mirrored, not as a suspicious verdict.
  try { rejudgeLegacyPaidOrders(dbRef, undefined, { listingKinds: new Set(cfg.listingKinds) }); } catch (err: any) {
    console.error('[liveSync] legacy paid re-judge failed:', err.message || err);
  }

  // Tests: a loopback relay, and no KIND 38888 fetch or poll.
  if (config?.relays) {
    for (const url of config.relays) openConnection(url);
    return;
  }

  // Determine initial relay list from KIND 38888 (refresh + persist).
  const override = devRelays;
  if (override.length) console.log(`[liveSync] DEV relay override: ${override.join(', ')}`);
  let relayList = await refreshKind38888();
  if (override.length) relayList = override;
  if (relayList.length === 0) relayList = getRelayList(dbRef);
  if (relayList.length === 0) {
    console.error('[liveSync] no relays known — cannot start');
    isRunning = false;
    return;
  }
  console.log(`[liveSync] opening ${relayList.length} connections`);
  for (const url of relayList) openConnection(url);

  // Periodic KIND 38888 refresh — detects relay-list changes.
  kind38888Timer = setInterval(async () => {
    let next = await refreshKind38888();
    if (override.length) next = override;
    if (next.length === 0) return;
    const current = new Set(relays.keys());
    const desired = new Set(next);
    for (const url of desired) {
      if (!current.has(url)) {
        console.log(`[liveSync] new relay: ${url}`);
        openConnection(url);
      }
    }
    for (const url of current) {
      if (!desired.has(url)) {
        console.log(`[liveSync] relay dropped from KIND 38888: ${url}`);
        const r = relays.get(url);
        if (r) closeConnection(r);
        relays.delete(url);
      }
    }
  }, KIND_38888_POLL_INTERVAL);

  // Hourly safety net.
  safetyNetTimer = setInterval(runSafetyNet, SAFETY_NET_INTERVAL);
}

export function stopLiveSync(): void {
  isRunning = false;
  for (const r of relays.values()) closeConnection(r);
  relays.clear();
  if (kind38888Timer) { clearInterval(kind38888Timer); kind38888Timer = null; }
  if (safetyNetTimer) { clearInterval(safetyNetTimer); safetyNetTimer = null; }
  seenEventIds.clear();
  console.log('[liveSync] stopped');
}
