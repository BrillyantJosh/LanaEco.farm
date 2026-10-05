// @vitest-environment node
/**
 * With the dev relay override on (LANA_RELAYS_OVERRIDE = a loopback relay,
 * see ./devOverrides.ts), KIND 38888 — the relays and the trusted 30933
 * signers — must come from that local relay too. It used to be fetched from
 * the hard-coded PRODUCTION relays whatever the override said, so a local
 * devstack portal still talked to production. The broker, the merchant app
 * and the gateway already switch fully.
 *
 * Every WebSocket this file opens is checked: a non-loopback URL is recorded
 * and sent to a closed loopback port instead, so nothing here can reach a
 * real relay — not even the code from before the fix.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  relays: [] as string[],
  attempted: [] as string[],
  // x-only public key of secret key 1 (the secp256k1 generator) — a test 38888 author
  author: '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
}));

vi.mock('ws', async (importOriginal) => {
  const real: any = await importOriginal();
  const Real = real.default ?? real.WebSocket;
  class LoopbackOnly extends Real {
    constructor(url: unknown, ...rest: any[]) {
      const u = String(url);
      hoisted.attempted.push(u);
      super(/^wss?:\/\/127\.0\.0\.1:\d+/.test(u) ? u : 'ws://127.0.0.1:9', ...rest);
    }
  }
  return { ...real, default: LoopbackOnly, WebSocket: LoopbackOnly };
});
vi.mock('./devOverrides.js', () => ({ devRelays: hoisted.relays, devTrustedSigners: [], dev38888Author: hoisted.author }));

import { finalizeEvent } from 'nostr-tools/pure';
import { fetchKind38888 } from './nostr.js';
import { fakeRelay, type FakeRelay } from '../test/fakeRelay.js';

const SK1 = new Uint8Array(32); SK1[31] = 1;
const PRODUCTION = ['wss://relay.lanavault.space', 'wss://relay.lanacoin-eternity.com'];

let relay: FakeRelay | null = null;
afterEach(async () => {
  hoisted.relays.length = 0;
  hoisted.attempted.length = 0;
  await relay?.close();
  relay = null;
});

describe('KIND 38888 follows the dev relay override', () => {
  it('override on: read from the loopback relay, by the dev 38888 author, and from nowhere else', async () => {
    const ev = finalizeEvent({
      kind: 38888, created_at: Math.floor(Date.now() / 1000), content: JSON.stringify({ relays: [] }),
      tags: [['d', 'main'], ['relay', 'ws://127.0.0.1:7777'], ['trusted_signers', JSON.stringify({ Brain: ['b'.repeat(64)] })]],
    }, SK1);
    expect(ev.pubkey).toBe(hoisted.author);
    relay = await fakeRelay(f => (Array.isArray(f.authors) && f.authors.includes(hoisted.author) ? [ev as any] : []));
    hoisted.relays.push(relay.url);

    const got = await fetchKind38888();
    expect(got?.event_id).toBe(ev.id);
    expect(hoisted.attempted.length).toBeGreaterThan(0);
    expect(hoisted.attempted.every(u => u === relay!.url)).toBe(true);
    expect(relay.filters.every(f => JSON.stringify(f.authors) === JSON.stringify([hoisted.author]))).toBe(true);
  });

  it('override off: the production relays and author, exactly as before', async () => {
    expect(await fetchKind38888()).toBeNull(); // every production URL went to a closed loopback port
    expect([...new Set(hoisted.attempted)].sort()).toEqual([...PRODUCTION].sort());
  });
});
