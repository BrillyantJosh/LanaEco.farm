/**
 * Generic incremental Nostr relay sync.
 * Fetches events of a given kind since a timestamp, deduplicates by (pubkey, d-tag).
 * The server uses this from the heartbeat to keep the local DB in sync.
 */

import WebSocket from 'ws';

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export function getTag(event: NostrEvent, name: string): string {
  return event.tags.find(t => t[0] === name)?.[1] || '';
}

export function getTags(event: NostrEvent, name: string): string[] {
  return event.tags.filter(t => t[0] === name).map(t => t[1]);
}

interface FetchOpts {
  kinds: number[];
  authors?: string[];
  since?: number;
  timeoutMs?: number;
}

/**
 * Fetch events from a single relay. Returns all events received until EOSE or timeout.
 */
function fetchFromRelay(relayUrl: string, filter: FetchOpts): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    const timeout = filter.timeoutMs ?? 12000;
    const timeoutId = setTimeout(() => {
      try { ws?.close(); } catch {}
      resolve(events);
    }, timeout);

    let ws: WebSocket;
    try {
      ws = new WebSocket(relayUrl);
    } catch {
      clearTimeout(timeoutId);
      resolve([]);
      return;
    }

    const subId = `sync_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    ws.on('open', () => {
      const reqFilter: any = { kinds: filter.kinds };
      if (filter.authors && filter.authors.length > 0) reqFilter.authors = filter.authors;
      if (filter.since && filter.since > 0) reqFilter.since = filter.since;
      ws.send(JSON.stringify(['REQ', subId, reqFilter]));
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'EVENT' && msg[1] === subId) {
          events.push(msg[2] as NostrEvent);
        } else if (msg[0] === 'EOSE') {
          clearTimeout(timeoutId);
          try { ws.close(); } catch {}
          resolve(events);
        }
      } catch {}
    });

    ws.on('error', () => {
      clearTimeout(timeoutId);
      resolve(events);
    });
  });
}

/**
 * Fetch events from multiple relays in parallel, deduplicate by (pubkey, d-tag),
 * keep newest by created_at.
 */
export async function fetchEvents(
  relays: string[],
  opts: FetchOpts
): Promise<NostrEvent[]> {
  const results = await Promise.all(relays.map(r => fetchFromRelay(r, opts)));

  const byKey = new Map<string, NostrEvent>();
  const seenIds = new Set<string>();

  for (const relayEvents of results) {
    for (const event of relayEvents) {
      if (seenIds.has(event.id)) continue;
      seenIds.add(event.id);

      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || event.id;
      const key = `${event.pubkey}:${dTag}`;
      const existing = byKey.get(key);
      if (!existing || event.created_at > existing.created_at) {
        byKey.set(key, event);
      }
    }
  }

  return Array.from(byKey.values());
}
