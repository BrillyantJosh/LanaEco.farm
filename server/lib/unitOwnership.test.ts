// @vitest-environment node
/**
 * A shop is (30901 signer, unit id), never the unit id alone. Ported from
 * lanaeco-shop 74ba516 (25 Sep 2026).
 *
 * - A listing may name only its own signer's shop in its `a` tag
 *   (30901:<pubkey>:<unit id>). A stranger's listing pointing at another
 *   shop showed on that shop's page and in its unit filter.
 * - A stranger's 30901 that reuses a shop's unit id is a DIFFERENT unit: it
 *   must not let that stranger's listings into the portal's category.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { initLiveSyncDb, ingestEvent } from './liveSync.js';
import { parseListing } from './parsers.js';
import { startApi, type TestApi } from '../test/http.js';
import {
  key, makeDb, seed38888, signed, unitEvent, suspensionEvent, listingEvent,
  UNIT_ID, LISTING_ID, type Key,
} from '../test/fixtures.js';
import { LISTING_KIND } from '../test/portal.js';

let db: Database.Database;
let api: TestApi;
let owner: Key, stranger: Key, processor: Key;
const T = Math.floor(Date.now() / 1000);

const ids = (items: any[]) => items.map(i => i.listingId);

/** The stranger's listing, naming (by default) the OWNER's shop in its `a` tag. */
function strangerListing(a = `30901:${owner.pk}:${UNIT_ID}`, listingId = 'fake') {
  return listingEvent(stranger, { a, listingId, price: '1.00' });
}

beforeEach(async () => {
  db = makeDb();
  initLiveSyncDb(db);
  owner = key(); stranger = key(); processor = key();
  seed38888(db, [processor.pk]);
  ingestEvent(unitEvent(owner, { name: 'Živa', created_at: T - 100 }));
  ingestEvent(suspensionEvent(processor, owner));
  ingestEvent(listingEvent(owner, { created_at: T - 50 }));
  api = await startApi(db);
});

afterEach(async () => {
  await api.close();
});

describe('a listing may name only its signer\'s own shop', () => {
  it('a stranger\'s listing naming another shop is not mirrored', () => {
    ingestEvent(strangerListing());
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM listings WHERE pubkey = ?').get(stranger.pk), { n: 0 });
  });

  it('a listing with no `a` tag is not mirrored', () => {
    ingestEvent(signed(stranger, LISTING_KIND, [['d', 'noa'], ['title', 'Brez enote'], ['status', 'active']]));
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM listings WHERE pubkey = ?').get(stranger.pk), { n: 0 });
  });

  it('the shop\'s own listing is still mirrored, even with the pubkey in capitals', async () => {
    ingestEvent(listingEvent(owner, { listingId: 'caps', a: `30901:${owner.pk.toUpperCase()}:${UNIT_ID}` }));
    assert.deepEqual(ids((await api.get('/api/listings')).body).sort(), ['caps', LISTING_ID].sort());
  });

  it('a row mirrored before the check stays out of the catalogue and the unit filter', async () => {
    const ev = strangerListing();
    db.prepare(`
      INSERT INTO listings (pubkey, listing_id, unit_id, event_id, event_created_at, parsed_json, raw_event, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(stranger.pk, 'fake', UNIT_ID, ev.id, ev.created_at, JSON.stringify(parseListing(ev)), JSON.stringify(ev), T);
    assert.deepEqual(ids((await api.get('/api/listings')).body), [LISTING_ID]);
    assert.deepEqual(ids((await api.get(`/api/listings?unit=${UNIT_ID}`)).body), [LISTING_ID]);
  });
});

describe('a stranger\'s 30901 reusing the unit id is a different unit', () => {
  it('its listings do not enter the portal through the shop\'s category or registration', async () => {
    // the stranger's own 30901 sits outside this portal; the real shop's unit
    // id is in it and is registered — neither lets the stranger's listing in
    ingestEvent(unitEvent(stranger, { name: 'Lažna trgovina', category: 'not-this-portal', created_at: T + 10 }));
    ingestEvent(listingEvent(stranger, { listingId: 'fake' }));
    assert.deepEqual(ids((await api.get('/api/listings')).body), [LISTING_ID]);
  });

  it('the shop keeps its own name on the units route', async () => {
    ingestEvent(unitEvent(stranger, { name: 'Lažna trgovina', created_at: T + 10 }));
    const { UNITS_PATH } = await import('../test/portal.js');
    assert.deepEqual((await api.get(UNITS_PATH)).body.map((u: any) => u.name), ['Živa']);
  });
});
