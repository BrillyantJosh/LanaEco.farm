// @vitest-environment node
/**
 * The live subscription against a loopback relay (never a production one).
 * Ported from lanaeco-shop f1d100d (27 Sep 2026).
 *
 * - The REQ for 30902 / 30903 names the registrar as author.
 * - A copy of an event that reuses its id but not its content, arriving
 *   first, used to be remembered as "seen" before any check: the real event
 *   was then dropped as a duplicate and the lie stayed.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { startLiveSync, stopLiveSync } from './liveSync.js';
import { PROCESSOR_PUBKEY } from './shopIdentity.js';
import {
  key, makeDb, seed38888, unitEvent, suspensionEvent, listingEvent, deletionEvent, tampered,
  UNIT_ID, LISTING_ID, type Key,
} from '../test/fixtures.js';
import { LISTING_KIND } from '../test/portal.js';
import { fakeRelay, asksFor, type FakeRelay } from '../test/fakeRelay.js';

let db: Database.Database;
let relay: FakeRelay | undefined;
let owner: Key, processor: Key, stranger: Key;

async function until(check: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 20));
  }
}

beforeEach(() => {
  db = makeDb();
  owner = key(); processor = key(); stranger = key();
  seed38888(db, [processor.pk]);
});

afterEach(async () => {
  stopLiveSync();
  await relay?.close();
  relay = undefined;
});

describe('live subscription', () => {
  it('asks for 30902 / 30903 only from the registrar', async () => {
    const r = relay = await fakeRelay(() => []);
    await startLiveSync(db, { listingKinds: [LISTING_KIND], relays: [r.url] });
    await until(() => r.filters.length >= 4);
    for (const kind of [30902, 30903]) {
      const reqs = r.filters.filter(f => asksFor(f, kind));
      assert.ok(reqs.length > 0);
      for (const f of reqs) assert.deepEqual(new Set(f.authors), new Set([processor.pk, PROCESSOR_PUBKEY]));
    }
  });

  it('a lying copy with the real id, arriving first, does not shadow the real 30903', async () => {
    const unit = unitEvent(owner, { name: 'Živa' });
    const real = suspensionEvent(processor, owner, UNIT_ID, 'active');
    const lie = tampered(real, real.tags.map(t => (t[0] === 'status' ? ['status', 'suspended'] : t)));
    relay = await fakeRelay(f => [
      ...(asksFor(f, 30901) ? [unit] : []),
      ...(asksFor(f, 30903) ? [lie, real] : []),
      ...(asksFor(f, LISTING_KIND) ? [listingEvent(owner)] : []),
    ]);
    await startLiveSync(db, { listingKinds: [LISTING_KIND], relays: [relay.url] });
    await until(() => !!db.prepare('SELECT 1 FROM global_suspensions').get());
    assert.deepEqual(db.prepare('SELECT status, event_id FROM global_suspensions').get(), { status: 'active', event_id: real.id });
  });

  it('a stranger\'s 30903 and KIND 5 from a relay change nothing', async () => {
    const real = suspensionEvent(processor, owner, UNIT_ID, 'active', 1000);
    const hide = suspensionEvent(stranger, owner, UNIT_ID, 'suspended', 2000);
    const del = deletionEvent(stranger, [{ e: real.id }, { a: `30903:${stranger.pk}:${UNIT_ID}` }, { a: `${LISTING_KIND}:${owner.pk}:${LISTING_ID}` }], 3000);
    // a relay that ignores `authors` and hands everybody's events to everyone
    relay = await fakeRelay(f => [
      ...(asksFor(f, 30901) ? [unitEvent(owner)] : []),
      ...(asksFor(f, 30903) ? [real, hide] : []),
      ...(asksFor(f, 5) ? [del] : []),
      ...(asksFor(f, LISTING_KIND) ? [listingEvent(owner)] : []),
    ]);
    await startLiveSync(db, { listingKinds: [LISTING_KIND], relays: [relay.url] });
    await until(() => !!db.prepare('SELECT 1 FROM global_suspensions').get() && !!db.prepare('SELECT 1 FROM listings').get());
    await new Promise(r => setTimeout(r, 200));
    assert.deepEqual(db.prepare('SELECT status, signer FROM global_suspensions').get(), { status: 'active', signer: processor.pk });
    assert.deepEqual(db.prepare('SELECT listing_id FROM listings').all(), [{ listing_id: LISTING_ID }]);
  });
});
