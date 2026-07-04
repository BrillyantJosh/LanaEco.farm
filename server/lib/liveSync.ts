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
import { parseUnit, parseListing, parseFeePolicy, parseSuspension } from './parsers.js';
import { fetchKind38888 } from './nostr.js';
import { fetchEvents, type NostrEvent } from './relaySync.js';

const PROCESSOR_PUBKEY =
  '79730aba75d71584e8a4f9d0cc1173085e75590ce489760078d2bf6f5210d692';

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
}

interface ResolvedConfig {
  listingKinds: number[];
  listingHashtag?: string;
}

interface SubIds {
  misc: string;
  listings: string;
  cal31923?: string;
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
  // fresh one — and to keep the table from bloating.
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
 * Process a KIND 5 (NIP-09) deletion event. The deleting pubkey MUST equal
 * the target pubkey — relays enforce this, but we double-check.
 *
 * `e` tags reference event IDs directly; `a` tags reference replaceable
 * coordinates (kind:pubkey:d). For each, we delete the corresponding row
 * AND write a tombstone so a late-arriving target can't resurrect.
 */
function handleDeletion(ev: NostrEvent, now: number): void {
  const deleterPubkey = ev.pubkey;
  for (const tag of ev.tags || []) {
    if (!Array.isArray(tag) || tag.length < 2) continue;
    if (tag[0] === 'e' && tag[1]) {
      const eventId = tag[1];
      // Ownership check via `AND pubkey = ?` clause; tables that aren't
      // keyed on pubkey (fee_policies, global_suspensions) match by event_id
      // only — relays already enforce NIP-09 ownership.
      dbRef.prepare('DELETE FROM business_units WHERE event_id = ? AND pubkey = ?')
        .run(eventId, deleterPubkey);
      dbRef.prepare('DELETE FROM listings WHERE event_id = ? AND pubkey = ?')
        .run(eventId, deleterPubkey);
      dbRef.prepare('DELETE FROM fee_policies WHERE event_id = ?')
        .run(eventId);
      dbRef.prepare('DELETE FROM global_suspensions WHERE event_id = ?')
        .run(eventId);
    } else if (tag[0] === 'a' && tag[1]) {
      const parts = tag[1].split(':');
      if (parts.length < 3) continue;
      const kind = parseInt(parts[0], 10);
      const targetPubkey = parts[1];
      const dTag = parts.slice(2).join(':'); // d-tag may contain colons
      if (isNaN(kind) || !dTag) continue;
      // Ownership check: deleter must equal target
      if (targetPubkey !== deleterPubkey) continue;
      recordTombstone(kind, targetPubkey, dTag, ev.created_at, now);
      if (kind === 30901) {
        dbRef.prepare(
          `DELETE FROM business_units WHERE pubkey = ? AND unit_id = ? AND event_created_at <= ?`
        ).run(targetPubkey, dTag, ev.created_at);
      } else if (kind === 30902) {
        dbRef.prepare(
          `DELETE FROM fee_policies WHERE unit_id = ? AND event_created_at <= ?`
        ).run(dTag, ev.created_at);
      } else if (kind === 30903) {
        dbRef.prepare(
          `DELETE FROM global_suspensions WHERE unit_id = ? AND event_created_at <= ?`
        ).run(dTag, ev.created_at);
      } else if (LISTING_KIND_SET.has(kind)) {
        dbRef.prepare(
          `DELETE FROM listings WHERE pubkey = ? AND listing_id = ? AND event_created_at <= ?`
        ).run(targetPubkey, dTag, ev.created_at);
      }
    }
  }
}

// ─────────────────────────────────────────── upserts (per kind)

function upsertUnit(ev: NostrEvent, now: number): void {
  const parsed = parseUnit(ev);
  if (!parsed.unitId) return;
  if (isTombstoned(30901, ev.pubkey, parsed.unitId, ev.created_at)) return;
  dbRef.prepare(`
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
}

function upsertListing(ev: NostrEvent, now: number): void {
  const parsed = parseListing(ev);
  if (!parsed.listingId) return;
  if (isTombstoned(ev.kind, ev.pubkey, parsed.listingId, ev.created_at)) return;
  const unitId = parsed.unitRef?.split(':')[2] || null;
  dbRef.prepare(`
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
}

function upsertFeePolicy(ev: NostrEvent, now: number): void {
  if (ev.pubkey !== PROCESSOR_PUBKEY) return; // only processor publishes fees
  const parsed = parseFeePolicy(ev);
  if (!parsed.unitId) return;
  if (isTombstoned(30902, ev.pubkey, parsed.unitId, ev.created_at)) return;
  dbRef.prepare(`
    INSERT INTO fee_policies (unit_id, event_id, event_created_at, lana_discount_per, status, raw_event, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(unit_id) DO UPDATE SET
      event_id = excluded.event_id,
      event_created_at = excluded.event_created_at,
      lana_discount_per = excluded.lana_discount_per,
      status = excluded.status,
      raw_event = excluded.raw_event,
      fetched_at = excluded.fetched_at
    WHERE excluded.event_created_at > fee_policies.event_created_at
  `).run(parsed.unitId, ev.id, ev.created_at, parsed.lanaDiscountPer, parsed.status, JSON.stringify(ev), now);
}

function upsertSuspension(ev: NostrEvent, now: number): void {
  const parsed = parseSuspension(ev);
  if (!parsed.unitId) return;
  if (isTombstoned(30903, ev.pubkey, parsed.unitId, ev.created_at)) return;
  dbRef.prepare(`
    INSERT INTO global_suspensions (unit_id, event_id, event_created_at, status, reason, active_until, raw_event, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(unit_id) DO UPDATE SET
      event_id = excluded.event_id,
      event_created_at = excluded.event_created_at,
      status = excluded.status,
      reason = excluded.reason,
      active_until = excluded.active_until,
      raw_event = excluded.raw_event,
      fetched_at = excluded.fetched_at
    WHERE excluded.event_created_at > global_suspensions.event_created_at
  `).run(parsed.unitId, ev.id, ev.created_at, parsed.status, parsed.reason, parsed.activeUntil, JSON.stringify(ev), now);
}

function dispatchEvent(ev: NostrEvent, relayUrl: string, skipDedup = false): void {
  if (!skipDedup && !dedupRemember(ev.id)) return;
  const now = Math.floor(Date.now() / 1000);
  try {
    switch (ev.kind) {
      case 5: handleDeletion(ev, now); break;
      case 30901: upsertUnit(ev, now); break;
      case 30902: upsertFeePolicy(ev, now); break;
      case 30903: upsertSuspension(ev, now); break;
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
    subIds: { misc: genId('m'), listings: genId('l') },
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

  // unit + fee + suspension + KIND 5 deletions (no hashtag scoping)
  r.ws.send(JSON.stringify(['REQ', r.subIds.misc, {
    kinds: [30901, 30902, 30903, 5],
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
  const relayList = getRelayList(dbRef);
  if (relayList.length === 0) return;
  const allKinds = Array.from(new Set([5, 30901, 30902, 30903, ...cfg.listingKinds]));
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
    console.log(`[liveSync] safety net processed ${n} events`);
  } catch (err: any) {
    console.error('[liveSync] safety net failed:', err.message || err);
  }
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

  // Determine initial relay list from KIND 38888 (refresh + persist).
  let relayList = await refreshKind38888();
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
    const next = await refreshKind38888();
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
