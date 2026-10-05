/**
 * A loopback Nostr relay for tests. It answers every REQ with whatever
 * `answer(filter)` returns, in that order, then EOSE — so a test decides
 * exactly what a (possibly lying) relay hands us. Nothing leaves 127.0.0.1.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'net';
import type { NostrEvent } from '../lib/relaySync.js';

export interface FakeRelay {
  url: string;
  /** Every REQ filter received, in order. */
  filters: any[];
  close(): Promise<void>;
}

export async function fakeRelay(answer: (filter: any) => NostrEvent[]): Promise<FakeRelay> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => wss.once('listening', () => resolve()));
  const filters: any[] = [];
  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (data: Buffer) => {
      let msg: any;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!Array.isArray(msg) || msg[0] !== 'REQ') return;
      const [, subId, filter] = msg;
      filters.push(filter);
      for (const ev of answer(filter)) ws.send(JSON.stringify(['EVENT', subId, ev]));
      ws.send(JSON.stringify(['EOSE', subId]));
    });
  });
  const { port } = wss.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}`,
    filters,
    close: () => new Promise<void>(resolve => {
      for (const c of wss.clients) c.terminate();
      wss.close(() => resolve());
    }),
  };
}

/** Does this REQ filter ask for `kind`? */
export function asksFor(filter: any, kind: number): boolean {
  return Array.isArray(filter?.kinds) && filter.kinds.includes(kind);
}
