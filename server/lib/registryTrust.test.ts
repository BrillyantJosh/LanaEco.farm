// @vitest-environment node
/**
 * KIND 30902 / 30903 are the registrar's word, about ONE shop. Ported from
 * lanaeco-shop f1d100d (27 Sep 2026); on this portal the holes were still
 * open on 5 Oct 2026.
 *
 * - A 30903 from any key was accepted. `global_suspensions` holds one row per
 *   unit id, newest wins, and a missing status tag means `suspended`: one
 *   event from anybody hid a shop, and `active` from anybody approved or
 *   un-suspended one.
 * - The registrar's row was joined by unit id alone, so a stranger's 30901
 *   reusing an approved unit id rode that approval (and its 30902 cashback).
 * - A KIND 5 from anybody deleted the registrar's rows: by event id (`e`), or
 *   by `a` = 30903:<the deleter>:<unit id>, since the `a` path deleted by unit id.
 * - No kind was signature-checked: every event trusted the pubkey a relay put on it.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { ADMIN_HEXES } from '../routes/admin.js';
import { initLiveSyncDb, ingestEvent, migrateRegistryRows } from './liveSync.js';
import { unitKey } from './shopIdentity.js';
import { UNITS_PATH, LISTING_KIND } from '../test/portal.js';
import { startApi, type TestApi } from '../test/http.js';
import {
  key, makeDb, seed38888, signed, unitEvent, suspensionEvent, feePolicyEvent, listingEvent,
  deletionEvent, brokenSig, tampered, UNIT_ID, LISTING_ID, type Key,
} from '../test/fixtures.js';

let db: Database.Database;
let api: TestApi;
let owner: Key, stranger: Key, processor: Key;
const T = Math.floor(Date.now() / 1000);

const ids = (items: any[]) => items.map(i => i.listingId);
const visible = async () => ids((await api.get('/api/listings')).body);
const shopKeys = async () => (await api.get(UNITS_PATH)).body.map((u: any) => unitKey(u.pubkey, u.unitId));
const cashback = async () => (await api.get('/api/listings')).body.find((l: any) => l.listingId === LISTING_ID)?.cashbackPercent;
const gsRow = () => db.prepare('SELECT * FROM global_suspensions WHERE unit_id = ?').get(UNIT_ID) as any;
const fpRow = () => db.prepare('SELECT * FROM fee_policies WHERE unit_id = ?').get(UNIT_ID) as any;

/** A 30903 about the owner's unit, signed by `signer` (tags as given). */
function raw30903(signer: Key, tags: string[][], created_at: number) {
  return signed(signer, 30903, [['d', UNIT_ID], ['unit_id', UNIT_ID], ...tags], '', created_at);
}

beforeEach(async () => {
  db = makeDb();
  initLiveSyncDb(db);
  owner = key(); stranger = key(); processor = key();
  // processor = the registrar, trusted through the KIND 38888.
  seed38888(db, [processor.pk]);
  ingestEvent(unitEvent(owner, { name: 'Živa', created_at: T - 100 }));
  ingestEvent(listingEvent(owner, { created_at: T - 90 }));
  api = await startApi(db);
});

afterEach(async () => {
  await api.close();
});

describe('KIND 30903 counts only when a trusted registrar signs it', () => {
  it('a stranger\'s "suspended" does not hide the shop', async () => {
    ingestEvent(suspensionEvent(processor, owner, UNIT_ID, 'active', T - 40));
    ingestEvent(suspensionEvent(stranger, owner, UNIT_ID, 'suspended', T - 10));
    assert.deepEqual(await visible(), [LISTING_ID]);
    assert.deepEqual(await shopKeys(), [unitKey(owner.pk, UNIT_ID)]);
  });

  it('a stranger\'s 30903 with no status tag (read as "suspended") does not hide the shop', async () => {
    ingestEvent(suspensionEvent(processor, owner, UNIT_ID, 'active', T - 40));
    ingestEvent(raw30903(stranger, [['a', `30901:${owner.pk}:${UNIT_ID}`]], T - 10));
    assert.deepEqual(await visible(), [LISTING_ID]);
  });

  it('a stranger cannot lift the registrar\'s suspension', async () => {
    for (const status of ['suspended', 'rejected', 'quota_blocked']) {
      ingestEvent(suspensionEvent(processor, owner, UNIT_ID, status, T - 40));
      ingestEvent(suspensionEvent(stranger, owner, UNIT_ID, 'active', T - 10));
      assert.deepEqual(await visible(), []);
      assert.equal(gsRow().status, status);
      db.prepare('DELETE FROM global_suspensions').run();
    }
  });

  it('a stranger cannot approve a shop — neither someone else\'s nor its own', async () => {
    ingestEvent(suspensionEvent(stranger, owner, UNIT_ID, 'active', T - 10));
    assert.deepEqual(await visible(), []);
    const OWN = 'f'.repeat(32);
    ingestEvent(unitEvent(stranger, { unitId: OWN, name: 'Samooklicana' }));
    ingestEvent(listingEvent(stranger, { unitId: OWN, listingId: 'self' }));
    ingestEvent(suspensionEvent(stranger, stranger, OWN, 'active'));
    assert.deepEqual(await visible(), []);
    assert.deepEqual(await shopKeys(), []);
  });

  it('a 30903 with a trusted pubkey but a broken signature is ignored', async () => {
    ingestEvent(suspensionEvent(processor, owner, UNIT_ID, 'active', T - 40));
    ingestEvent(brokenSig(suspensionEvent(processor, owner, UNIT_ID, 'suspended', T - 10)));
    assert.deepEqual(await visible(), [LISTING_ID]);
    // the registrar's real "active", its tags swapped for "suspended" by a relay
    const real = suspensionEvent(processor, owner, UNIT_ID, 'active', T - 5);
    ingestEvent(tampered(real, real.tags.map(t => (t[0] === 'status' ? ['status', 'suspended'] : t))));
    assert.deepEqual(await visible(), [LISTING_ID]);
    assert.equal(gsRow().status, 'active');
  });

  it('a registrar 30903 must name the owner and the same unit in `a`', async () => {
    ingestEvent(raw30903(processor, [['status', 'active']], T - 40));
    assert.deepEqual(await visible(), []);
    ingestEvent(raw30903(processor, [['a', `30901:${owner.pk}:${'0'.repeat(32)}`], ['status', 'active']], T - 30));
    assert.deepEqual(await visible(), []);
    ingestEvent(raw30903(processor, [['a', `30901:not-a-key:${UNIT_ID}`], ['status', 'active']], T - 20));
    assert.deepEqual(await visible(), []);
    ingestEvent(suspensionEvent(processor, owner, UNIT_ID, 'active', T - 10));
    assert.deepEqual(await visible(), [LISTING_ID]);
  });

  it('the registration is the named owner\'s: a look-alike 30901 reusing the unit id does not ride it', async () => {
    ingestEvent(suspensionEvent(processor, owner, UNIT_ID, 'active', T - 40));
    ingestEvent(unitEvent(stranger, { name: 'Lažna trgovina', created_at: T - 5 }));
    ingestEvent(listingEvent(stranger, { listingId: 'fake', price: '1.00' }));
    assert.deepEqual(await visible(), [LISTING_ID]);
    assert.deepEqual(ids((await api.get(`/api/listings?unit=${UNIT_ID}`)).body), [LISTING_ID]);
    assert.deepEqual(await shopKeys(), [unitKey(owner.pk, UNIT_ID)]);
  });

  it('the registrar decides which owner holds a unit id — never both', async () => {
    ingestEvent(suspensionEvent(processor, owner, UNIT_ID, 'active', T - 40));
    ingestEvent(unitEvent(stranger, { name: 'Druga', created_at: T - 5 }));
    ingestEvent(listingEvent(stranger, { listingId: 'other' }));
    ingestEvent(suspensionEvent(processor, stranger, UNIT_ID, 'active', T - 10));
    assert.deepEqual(await visible(), ['other']);
    assert.deepEqual(await shopKeys(), [unitKey(stranger.pk, UNIT_ID)]);
  });
});

describe('KIND 30902 cashback belongs to the unit its `a` names', () => {
  beforeEach(() => {
    ingestEvent(suspensionEvent(processor, owner, UNIT_ID, 'active', T - 40));
  });

  it('the registrar\'s policy for the shop applies', async () => {
    ingestEvent(feePolicyEvent(processor, owner, '12.00', UNIT_ID, T - 30));
    assert.equal(await cashback(), 12);
    const row = fpRow();
    assert.deepEqual(
      { owner_pubkey: row.owner_pubkey, signer: row.signer, d_tag: row.d_tag },
      { owner_pubkey: owner.pk, signer: processor.pk, d_tag: `policy_${UNIT_ID.slice(0, 8)}_2026Q3` },
    );
  });

  it('a policy naming another owner under the same unit id does not', async () => {
    ingestEvent(feePolicyEvent(processor, stranger, '12.00', UNIT_ID, T - 30));
    assert.equal(await cashback(), 5);
  });

  it('a stranger\'s policy, or one with a broken signature, is ignored', async () => {
    ingestEvent(feePolicyEvent(processor, owner, '12.00', UNIT_ID, T - 30));
    ingestEvent(feePolicyEvent(stranger, owner, '1.00', UNIT_ID, T - 10));
    ingestEvent(brokenSig(feePolicyEvent(processor, owner, '2.00', UNIT_ID, T - 5)));
    assert.equal(await cashback(), 12);
  });
});

describe('KIND 5 removes a registrar row only when the registrar signs it', () => {
  let sus: ReturnType<typeof suspensionEvent>;
  let fee: ReturnType<typeof feePolicyEvent>;
  beforeEach(() => {
    sus = suspensionEvent(processor, owner, UNIT_ID, 'active', T - 40);
    fee = feePolicyEvent(processor, owner, '12.00', UNIT_ID, T - 30);
    ingestEvent(sus);
    ingestEvent(fee);
  });

  it('a stranger\'s `e` deletion of the 30903 / 30902 does nothing', async () => {
    ingestEvent(deletionEvent(stranger, [{ e: sus.id }, { e: fee.id }], T));
    assert.deepEqual(await visible(), [LISTING_ID]);
    assert.equal(await cashback(), 12);
  });

  it('a stranger\'s `a` deletion under its own pubkey does not reach the registrar\'s rows', async () => {
    ingestEvent(deletionEvent(stranger, [
      { a: `30903:${stranger.pk}:${UNIT_ID}` },
      { a: `30902:${stranger.pk}:${UNIT_ID}` },
      { a: `30902:${stranger.pk}:${fee.tags[0][1]}` },
    ], T));
    assert.deepEqual(await visible(), [LISTING_ID]);
    assert.equal(await cashback(), 12);
  });

  it('a stranger\'s KIND 5 bearing the registrar\'s pubkey with a broken signature does nothing', async () => {
    const forged = brokenSig(deletionEvent(processor, [{ e: sus.id }, { a: `30903:${processor.pk}:${UNIT_ID}` }], T));
    ingestEvent(forged);
    assert.deepEqual(await visible(), [LISTING_ID]);
  });

  it('the registrar can delete its 30903 by `e` or by `a`, and a late copy stays deleted', async () => {
    ingestEvent(deletionEvent(processor, [{ e: sus.id }], T));
    assert.deepEqual(await visible(), []);
    ingestEvent(sus);
    ingestEvent(deletionEvent(processor, [{ a: `30903:${processor.pk}:${UNIT_ID}` }], T));
    assert.equal(gsRow(), undefined);
    ingestEvent(sus); // a relay replays it
    assert.deepEqual(await visible(), []);
  });

  it('the registrar can delete its 30902 by `a` (d = policy_…), and a late copy stays deleted', async () => {
    ingestEvent(deletionEvent(processor, [{ a: `30902:${processor.pk}:${fee.tags[0][1]}` }], T));
    assert.equal(await cashback(), 5);
    ingestEvent(fee);
    assert.equal(await cashback(), 5);
  });
});

describe('every kind is signature-checked', () => {
  it('a 30901 with a broken signature does not replace the shop', async () => {
    ingestEvent(suspensionEvent(processor, owner, UNIT_ID, 'active', T - 40));
    ingestEvent(brokenSig(unitEvent(owner, { name: 'Ponaredek', created_at: T - 5 })));
    assert.deepEqual((await api.get(UNITS_PATH)).body.map((u: any) => u.name), ['Živa']);
  });

  it('a listing with a broken signature is not mirrored, and a tampered one keeps its real price', async () => {
    ingestEvent(suspensionEvent(processor, owner, UNIT_ID, 'active', T - 40));
    ingestEvent(brokenSig(listingEvent(owner, { listingId: 'forged', price: '0.01' })));
    const real = listingEvent(owner, { price: '5.00', created_at: T - 20 });
    ingestEvent(tampered(real, real.tags.map(t => (t[0] === 'price' ? ['price', '0.01', 'EUR'] : t))));
    assert.deepEqual(db.prepare(`SELECT COUNT(*) AS n FROM listings WHERE listing_id = 'forged'`).get(), { n: 0 });
    // the stored listing is still the owner's own, not the relay's 0.01 copy
    const row = db.prepare('SELECT event_id, raw_event FROM listings WHERE listing_id = ?').get(LISTING_ID) as any;
    assert.notEqual(row.event_id, real.id);
    assert.ok(!row.raw_event.includes('0.01'));
    assert.deepEqual(await visible(), [LISTING_ID]);
  });

  it('a stranger\'s KIND 5 bearing the owner\'s pubkey with a broken signature does not delete the listing', async () => {
    ingestEvent(suspensionEvent(processor, owner, UNIT_ID, 'active', T - 40));
    ingestEvent(brokenSig(deletionEvent(owner, [{ a: `${LISTING_KIND}:${owner.pk}:${LISTING_ID}` }], T)));
    assert.deepEqual(await visible(), [LISTING_ID]);
  });
});

describe('the admin views go by (owner, unit id)', () => {
  it('admin listings: a listing whose own unit is outside the portal is not let in by another owner\'s unit id', async () => {
    ingestEvent(unitEvent(stranger, { name: 'Drugje', category: 'not-this-portal' }));
    ingestEvent(listingEvent(stranger, { listingId: 'elsewhere' }));
    const r = await api.get('/api/admin/listings', { 'x-admin-hex': ADMIN_HEXES[0] });
    assert.deepEqual(r.body.map((l: any) => `${l.pubkey}:${l.listingId}`), [`${owner.pk}:${LISTING_ID}`]);
  });

  it('admin units: a stranger\'s "suspended" does not mark the shop suspended', async () => {
    ingestEvent(suspensionEvent(processor, owner, UNIT_ID, 'active', T - 40));
    ingestEvent(suspensionEvent(stranger, owner, UNIT_ID, 'suspended', T - 10));
    const r = await api.get('/api/admin/units', { 'x-admin-hex': ADMIN_HEXES[0] });
    assert.deepEqual(r.body.map((u: any) => u.globalSuspension), [null]);
  });
});

describe('rows mirrored before the check', () => {
  const legacyInsert = (table: 'global_suspensions' | 'fee_policies', ev: any, status: string) => {
    const unitId = ev.tags.find((t: string[]) => t[0] === 'unit_id')[1];
    if (table === 'global_suspensions') {
      db.prepare(`INSERT INTO global_suspensions (unit_id, event_id, event_created_at, status, reason, active_until, raw_event, fetched_at)
        VALUES (?, ?, ?, ?, '', NULL, ?, 0)`).run(unitId, ev.id, ev.created_at, status, JSON.stringify(ev));
    } else {
      db.prepare(`INSERT INTO fee_policies (unit_id, event_id, event_created_at, lana_discount_per, status, raw_event, fetched_at)
        VALUES (?, ?, ?, 12, 'active', ?, 0)`).run(unitId, ev.id, ev.created_at, JSON.stringify(ev));
    }
  };

  it('keep the registrar\'s, drop anybody else\'s, a broken signature and a missing `a`', async () => {
    const U2 = '2'.repeat(32), U3 = '3'.repeat(32), U4 = '4'.repeat(32);
    legacyInsert('global_suspensions', suspensionEvent(processor, owner, UNIT_ID, 'active'), 'active');
    legacyInsert('global_suspensions', suspensionEvent(stranger, owner, U2, 'suspended'), 'suspended');
    legacyInsert('global_suspensions', brokenSig(suspensionEvent(processor, owner, U3, 'active')), 'active');
    legacyInsert('global_suspensions', signed(processor, 30903, [['d', U4], ['unit_id', U4], ['status', 'active']]), 'active');
    legacyInsert('fee_policies', feePolicyEvent(processor, owner, '12.00'), 'active');
    legacyInsert('fee_policies', feePolicyEvent(stranger, owner, '1.00', U2), 'active');
    assert.deepEqual(migrateRegistryRows(db), { kept: 2, dropped: 4 });
    assert.deepEqual(db.prepare('SELECT unit_id, owner_pubkey, signer, d_tag FROM global_suspensions').all(),
      [{ unit_id: UNIT_ID, owner_pubkey: owner.pk, signer: processor.pk, d_tag: UNIT_ID }]);
    assert.deepEqual(db.prepare('SELECT unit_id, owner_pubkey, signer FROM fee_policies').all(),
      [{ unit_id: UNIT_ID, owner_pubkey: owner.pk, signer: processor.pk }]);
    assert.deepEqual(await visible(), [LISTING_ID]);
    assert.equal(await cashback(), 12);
    assert.deepEqual(migrateRegistryRows(db), { kept: 0, dropped: 0 }); // idempotent
    assert.deepEqual(await visible(), [LISTING_ID]);
  });
});
