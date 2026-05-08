/**
 * Heartbeat Engine for lanaeco-shop
 * Runs every 2 minutes:
 * 1. Fetch KIND 38888 → system params (split, rates, relays)
 * 2. Incrementally fetch KIND 30901 (business units) → DB
 * 3. Incrementally fetch KIND 36502 (listings, lanaeco-shop kind) → DB
 * 4. Incrementally fetch KIND 30902 (fee policies, processor only) → DB
 * 5. Incrementally fetch KIND 30903 (global suspensions) → DB
 *
 * Incremental: stores per-kind last_synced_at in sync_state, uses Nostr
 * `since` filter so subsequent runs only return new events.
 */

import Database from 'better-sqlite3';
import { fetchKind38888 } from './lib/nostr.js';
import { fetchEvents, NostrEvent } from './lib/relaySync.js';
import {
  parseUnit,
  parseListing,
  parseFeePolicy,
  parseSuspension,
} from './lib/parsers.js';

const HEARTBEAT_INTERVAL = 2 * 60 * 1000; // 2 minutes
const SINCE_OVERLAP = 60; // 60s overlap for safety on incremental fetches
const PROCESSOR_PUBKEY =
  '79730aba75d71584e8a4f9d0cc1173085e75590ce489760078d2bf6f5210d692';

// Kind constants for lanaeco-shop
const KIND_UNIT = 30901;
const KIND_LISTING = 36502;
const KIND_FEE = 30902;
const KIND_SUSPENSION = 30903;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

function getRelays(db: Database.Database): string[] {
  const row = db
    .prepare('SELECT relays FROM kind_38888 ORDER BY id DESC LIMIT 1')
    .get() as any;
  if (!row) return [];
  try {
    return JSON.parse(row.relays || '[]');
  } catch {
    return [];
  }
}

function getSinceForKind(db: Database.Database, kind: number): number {
  const row = db
    .prepare('SELECT last_synced_at FROM sync_state WHERE kind = ?')
    .get(kind) as any;
  return row?.last_synced_at || 0;
}

function setSyncState(
  db: Database.Database,
  kind: number,
  newSyncedAt: number,
  eventsSeen: number
): void {
  db.prepare(
    `INSERT INTO sync_state (kind, last_synced_at, last_run_at, events_seen)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(kind) DO UPDATE SET
       last_synced_at = excluded.last_synced_at,
       last_run_at = excluded.last_run_at,
       events_seen = excluded.events_seen`
  ).run(kind, newSyncedAt, Math.floor(Date.now() / 1000), eventsSeen);
}

async function syncUnits(
  db: Database.Database,
  relays: string[]
): Promise<number> {
  const since = getSinceForKind(db, KIND_UNIT);
  const events = await fetchEvents(relays, {
    kinds: [KIND_UNIT],
    since: since > 0 ? since - SINCE_OVERLAP : undefined,
  });

  const upsert = db.prepare(`
    INSERT INTO business_units (pubkey, unit_id, event_id, event_created_at, parsed_json, raw_event, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pubkey, unit_id) DO UPDATE SET
      event_id = excluded.event_id,
      event_created_at = excluded.event_created_at,
      parsed_json = excluded.parsed_json,
      raw_event = excluded.raw_event,
      fetched_at = excluded.fetched_at
    WHERE excluded.event_created_at > business_units.event_created_at
  `);

  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction((evs: NostrEvent[]) => {
    for (const ev of evs) {
      const parsed = parseUnit(ev);
      if (!parsed.unitId) continue;
      upsert.run(
        ev.pubkey,
        parsed.unitId,
        ev.id,
        ev.created_at,
        JSON.stringify(parsed),
        JSON.stringify(ev),
        now
      );
    }
  });
  tx(events);

  setSyncState(db, KIND_UNIT, now, events.length);
  return events.length;
}

async function syncListings(
  db: Database.Database,
  relays: string[]
): Promise<number> {
  const since = getSinceForKind(db, KIND_LISTING);
  const events = await fetchEvents(relays, {
    kinds: [KIND_LISTING],
    since: since > 0 ? since - SINCE_OVERLAP : undefined,
  });

  const upsert = db.prepare(`
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
  `);

  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction((evs: NostrEvent[]) => {
    for (const ev of evs) {
      const parsed = parseListing(ev);
      if (!parsed.listingId) continue;
      const unitIdFromRef = parsed.unitRef.split(':')[2] || null;
      upsert.run(
        ev.pubkey,
        parsed.listingId,
        unitIdFromRef,
        ev.id,
        ev.created_at,
        JSON.stringify(parsed),
        JSON.stringify(ev),
        now
      );
    }
  });
  tx(events);

  setSyncState(db, KIND_LISTING, now, events.length);
  return events.length;
}

async function syncFeePolicies(
  db: Database.Database,
  relays: string[]
): Promise<number> {
  const since = getSinceForKind(db, KIND_FEE);
  const events = await fetchEvents(relays, {
    kinds: [KIND_FEE],
    authors: [PROCESSOR_PUBKEY],
    since: since > 0 ? since - SINCE_OVERLAP : undefined,
  });

  const upsert = db.prepare(`
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
  `);

  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction((evs: NostrEvent[]) => {
    for (const ev of evs) {
      const parsed = parseFeePolicy(ev);
      if (!parsed.unitId) continue;
      upsert.run(
        parsed.unitId,
        ev.id,
        ev.created_at,
        parsed.lanaDiscountPer,
        parsed.status,
        JSON.stringify(ev),
        now
      );
    }
  });
  tx(events);

  setSyncState(db, KIND_FEE, now, events.length);
  return events.length;
}

async function syncSuspensions(
  db: Database.Database,
  relays: string[]
): Promise<number> {
  const since = getSinceForKind(db, KIND_SUSPENSION);
  const events = await fetchEvents(relays, {
    kinds: [KIND_SUSPENSION],
    since: since > 0 ? since - SINCE_OVERLAP : undefined,
  });

  const upsert = db.prepare(`
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
  `);

  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction((evs: NostrEvent[]) => {
    for (const ev of evs) {
      const parsed = parseSuspension(ev);
      if (!parsed.unitId) continue;
      upsert.run(
        parsed.unitId,
        ev.id,
        ev.created_at,
        parsed.status,
        parsed.reason,
        parsed.activeUntil,
        JSON.stringify(ev),
        now
      );
    }
  });
  tx(events);

  setSyncState(db, KIND_SUSPENSION, now, events.length);
  return events.length;
}

export async function runHeartbeat(db: Database.Database): Promise<void> {
  if (isRunning) {
    console.log('Heartbeat already running, skipping');
    return;
  }

  isRunning = true;
  const logId = db
    .prepare("INSERT INTO heartbeat_logs (started_at) VALUES (datetime('now'))")
    .run().lastInsertRowid;

  console.log('Heartbeat started');
  let total = 0;

  try {
    // 1. KIND 38888 — system params (always fresh fetch, single event)
    const systemParams = await fetchKind38888();
    if (systemParams) {
      db.prepare(
        `
        INSERT INTO kind_38888 (event_id, split, exchange_rates, electrum_servers, relays, trusted_signers, version, valid_from, split_target_lana, split_started_at, split_ends_at, raw_event, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `
      ).run(
        systemParams.event_id,
        systemParams.split,
        JSON.stringify(systemParams.exchange_rates),
        JSON.stringify(systemParams.electrum_servers),
        JSON.stringify(systemParams.relays),
        JSON.stringify(systemParams.trusted_signers),
        systemParams.version,
        systemParams.valid_from,
        systemParams.split_target_lana || 0,
        systemParams.split_started_at || 0,
        systemParams.split_ends_at || 0,
        systemParams.raw_event
      );
      console.log(
        `KIND 38888: split=${systemParams.split}, EUR=${systemParams.exchange_rates.EUR}`
      );
      total += 1;
    } else {
      console.warn('KIND 38888 fetch returned null, continuing with cached relays');
    }

    // 2-5. Incremental kinds — needs relay list
    const relays = getRelays(db);
    if (relays.length === 0) {
      console.warn('No relays available, skipping incremental sync');
    } else {
      const [units, listings, fees, suspensions] = await Promise.all([
        syncUnits(db, relays),
        syncListings(db, relays),
        syncFeePolicies(db, relays),
        syncSuspensions(db, relays),
      ]);
      console.log(
        `Incremental: units=${units}, listings=${listings}, fees=${fees}, suspensions=${suspensions}`
      );
      total += units + listings + fees + suspensions;
    }

    db.prepare(
      `
      UPDATE heartbeat_logs SET
        completed_at = datetime('now'),
        events_fetched = ?
      WHERE id = ?
    `
    ).run(total, logId);

    console.log(`Heartbeat completed: ${total} events`);
  } catch (error: any) {
    console.error('Heartbeat failed:', error);
    db.prepare(
      `
      UPDATE heartbeat_logs SET
        completed_at = datetime('now'),
        error = ?
      WHERE id = ?
    `
    ).run(error.message || String(error), logId);
  } finally {
    isRunning = false;
  }
}

export function startHeartbeat(db: Database.Database): void {
  console.log('Starting heartbeat engine (interval: 2 min)');
  runHeartbeat(db);
  heartbeatTimer = setInterval(() => {
    runHeartbeat(db);
  }, HEARTBEAT_INTERVAL);
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log('Heartbeat stopped');
  }
}
