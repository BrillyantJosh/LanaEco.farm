/**
 * What a relay hands us is not trusted until its signature checks out.
 * Ported from lanaeco-shop f1d100d (27 Sep 2026).
 *
 * - fetchEvents (hourly safety net) kept the newest event per (pubkey, d)
 *   BEFORE anything was verified: a forged copy with a newer created_at, or
 *   reusing the real event's id, pushed the real one out. The key also
 *   ignored the kind.
 * - KIND 38888 (relays + the trusted signers every registry check relies on)
 *   was taken on its pubkey alone.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchEvents } from './relaySync.js';
import { fetchKind38888From } from './nostr.js';
import { key, signed, suspensionEvent, feePolicyEvent, brokenSig, tampered, UNIT_ID } from '../test/fixtures.js';
import { fakeRelay, type FakeRelay } from '../test/fakeRelay.js';

const open: FakeRelay[] = [];
async function relay(answer: (f: any) => any[]) {
  const r = await fakeRelay(answer);
  open.push(r);
  return r;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

const T = Math.floor(Date.now() / 1000);

describe('fetchEvents keeps only verified events', () => {
  it('a forged copy with a newer created_at does not push the real event out', async () => {
    const processor = key(), owner = key();
    const real = suspensionEvent(processor, owner, UNIT_ID, 'active', T - 10);
    const forged = brokenSig(suspensionEvent(processor, owner, UNIT_ID, 'suspended', T));
    const r = await relay(() => [forged, real]);
    const got = await fetchEvents([r.url], { kinds: [30903], timeoutMs: 3000 });
    assert.deepEqual(got.map(e => e.id), [real.id]);
  });

  it('a forged copy reusing the real id on one relay does not shadow the real one on another', async () => {
    const processor = key(), owner = key();
    const real = suspensionEvent(processor, owner, UNIT_ID, 'active', T - 10);
    const liar = tampered(real, real.tags.map(t => (t[0] === 'status' ? ['status', 'suspended'] : t)));
    const r1 = await relay(() => [liar]);
    const r2 = await relay(() => [real]);
    const got = await fetchEvents([r1.url, r2.url], { kinds: [30903], timeoutMs: 3000 });
    assert.equal(got.length, 1);
    assert.ok(got[0].tags.some(t => t[0] === 'status' && t[1] === 'active'));
  });

  it('two kinds with the same d from the same signer both survive', async () => {
    const processor = key(), owner = key();
    const sus = suspensionEvent(processor, owner, UNIT_ID, 'active', T - 10);
    const fee = signed(processor, 30902, [['d', UNIT_ID], ['unit_id', UNIT_ID], ['a', `30901:${owner.pk}:${UNIT_ID}`], ['lana_discount_per', '9']], '', T);
    const r = await relay(() => [sus, fee, feePolicyEvent(processor, owner, '3.00')]);
    const got = await fetchEvents([r.url], { kinds: [30902, 30903], timeoutMs: 3000 });
    assert.deepEqual(got.map(e => e.kind).sort(), [30902, 30902, 30903]);
  });
});

describe('KIND 38888 is taken only with a valid signature', () => {
  function params(k: ReturnType<typeof key>, created_at: number) {
    return signed(k, 38888, [['d', 'main'], ['relay', 'wss://relay.test'], ['fx', 'EUR', '0.01']],
      JSON.stringify({ trusted_signers: { LanaPaysUs: [k.pk] } }), created_at);
  }

  it('a forged 38888 bearing the params key is rejected', async () => {
    const params38888 = key();
    const r = await relay(() => [brokenSig(params(params38888, T))]);
    assert.equal(await fetchKind38888From([r.url], params38888.pk, 3000), null);
  });

  it('a forged newer 38888 does not win over the real one', async () => {
    const params38888 = key();
    const real = params(params38888, T - 100);
    const r1 = await relay(() => [brokenSig(params(params38888, T))]);
    const r2 = await relay(() => [real]);
    const got = await fetchKind38888From([r1.url, r2.url], params38888.pk, 3000);
    assert.equal(got?.event_id, real.id);
    assert.deepEqual(got?.relays, ['wss://relay.test']);
  });

  it('an event from another key is rejected even with a valid signature', async () => {
    const params38888 = key(), other = key();
    const r = await relay(() => [params(other, T)]);
    assert.equal(await fetchKind38888From([r.url], params38888.pk, 3000), null);
  });
});
