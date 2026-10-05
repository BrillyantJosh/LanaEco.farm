/**
 * Signed-event fixtures for the server tests. Every event is a REAL Nostr
 * event (finalizeEvent), so the same code paths that verify production relay
 * traffic run in the tests.
 */
import Database from 'better-sqlite3';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { initializeSchema } from '../db/schema.js';
import type { NostrEvent } from '../lib/relaySync.js';
import { CATEGORY } from './portal.js';

export interface Key { sk: Uint8Array; pk: string }

export function key(): Key {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
}

export function signed(k: Key, kind: number, tags: string[][], content = '', created_at?: number): NostrEvent {
  return finalizeEvent({ kind, tags, content, created_at: created_at ?? Math.floor(Date.now() / 1000) }, k.sk) as NostrEvent;
}

export function makeDb(): Database.Database {
  const db = new Database(':memory:');
  initializeSchema(db);
  return db;
}

/** The KIND 38888 row liveSync would have saved, with `trusted` in the LanaPaysUs group. */
export function seed38888(db: Database.Database, trusted: string[], relays: string[] = []): void {
  db.prepare(`
    INSERT OR REPLACE INTO kind_38888 (id, event_id, split, exchange_rates, electrum_servers, relays, trusted_signers, version, valid_from, raw_event)
    VALUES (1, 'ev38888', '', '{}', '[]', ?, ?, '1', 0, '{}')
  `).run(JSON.stringify(relays), JSON.stringify({ LanaPaysUs: trusted }));
}

export const UNIT_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
export const LISTING_ID = 'lst-test';

export interface UnitOpts {
  unitId?: string;
  name?: string;
  category?: string;
  created_at?: number;
}

/** KIND 30901 in this portal's category. */
export function unitEvent(owner: Key, o: UnitOpts = {}): NostrEvent {
  const unitId = o.unitId ?? UNIT_ID;
  return signed(owner, 30901, [
    ['d', unitId],
    ['unit_id', unitId],
    ['name', o.name ?? 'Test Shop'],
    ['owner_hex', owner.pk],
    ['currency', 'EUR'],
    ['category', o.category ?? CATEGORY],
    ['status', 'active'],
    ['country', 'SI'],
  ], '', o.created_at);
}

export interface ListingOpts {
  listingId?: string;
  unitId?: string;
  /** `a` tag; default 30901:<owner>:<unit id>. */
  a?: string;
  price?: string;
  created_at?: number;
}

/** A listing (KIND 36502) on the owner's unit. */
export function listingEvent(owner: Key, o: ListingOpts = {}): NostrEvent {
  return signed(owner, 36502, [
    ['d', o.listingId ?? LISTING_ID],
    ['a', o.a ?? `30901:${owner.pk}:${o.unitId ?? UNIT_ID}`],
    ['title', 'Izdelek'],
    ['type', 'product'],
    ['price', o.price ?? '5.00', 'EUR'],
    ['unit', 'piece'],
    ['status', 'active'],
  ], '', o.created_at);
}

/**
 * KIND 30903 as the registrar publishes it: `a` names the unit it rules on
 * (30901:<owner>:<unit id>). `processor` must be a trusted signer (seed38888).
 */
export function suspensionEvent(processor: Key, owner: Key, unitId = UNIT_ID, status = 'active', created_at?: number): NostrEvent {
  return signed(processor, 30903, [
    ['d', unitId], ['unit_id', unitId], ['a', `30901:${owner.pk}:${unitId}`], ['status', status],
  ], '', created_at);
}

/** KIND 30902 as the registrar publishes it: d = policy_<unit8>_<quarter>, `a` names the unit. */
export function feePolicyEvent(processor: Key, owner: Key, percent: string, unitId = UNIT_ID, created_at?: number): NostrEvent {
  return signed(processor, 30902, [
    ['d', `policy_${unitId.slice(0, 8)}_2026Q3`], ['unit_id', unitId], ['a', `30901:${owner.pk}:${unitId}`],
    ['lana_discount_per', percent], ['status', 'active'],
  ], '', created_at);
}

/** KIND 5 (NIP-09) naming events by `e` and/or addresses by `a`. */
export function deletionEvent(k: Key, targets: Array<{ e?: string; a?: string }>, created_at?: number): NostrEvent {
  const tags: string[][] = [];
  for (const t of targets) {
    if (t.e) tags.push(['e', t.e]);
    if (t.a) tags.push(['a', t.a]);
  }
  return signed(k, 5, tags, '', created_at);
}

/** The same event with a signature that no longer matches it. */
export function brokenSig(ev: NostrEvent): NostrEvent {
  const flip = ev.sig[0] === '0' ? '1' : '0';
  return { ...ev, sig: flip + ev.sig.slice(1) };
}

/** Same id and sig, different tags — what a lying relay would send. */
export function tampered(ev: NostrEvent, tags: string[][]): NostrEvent {
  return { id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags, content: ev.content, sig: ev.sig };
}
