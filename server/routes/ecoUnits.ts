import { Router, Request, Response } from 'express';
import WebSocket from 'ws';
import Database from 'better-sqlite3';

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

function getTag(event: NostrEvent, name: string): string {
  return event.tags.find(t => t[0] === name)?.[1] || '';
}

function getTags(event: NostrEvent, name: string): string[] {
  return event.tags.filter(t => t[0] === name).map(t => t[1]);
}

function parseUnit(event: NostrEvent) {
  return {
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    unitId: getTag(event, 'unit_id'),
    name: getTag(event, 'name'),
    ownerHex: getTag(event, 'owner_hex'),
    country: getTag(event, 'country'),
    currency: getTag(event, 'currency'),
    category: getTag(event, 'category'),
    categoryDetail: getTag(event, 'category_detail'),
    images: getTags(event, 'image').map(img =>
      img.startsWith('/api/uploads/') ? `https://shop.lanapays.us${img}` : img
    ),
    status: getTag(event, 'status') || 'active',
    longitude: getTag(event, 'longitude'),
    latitude: getTag(event, 'latitude'),
    logo: (() => { const l = getTag(event, 'logo'); return l.startsWith('/api/uploads/') ? `https://shop.lanapays.us${l}` : l; })(),
    video: getTag(event, 'video'),
    url: getTag(event, 'url'),
    email: getTag(event, 'email'),
    phone: getTag(event, 'phone'),
    note: getTag(event, 'note'),
    openingHoursJson: getTag(event, 'opening_hours_json'),
    receiverName: getTag(event, 'receiver_name'),
    receiverCity: getTag(event, 'receiver_city'),
    receiverCountry: getTag(event, 'receiver_country'),
    content: event.content,
  };
}

async function fetchAllEcoUnits(relays: string[], timeout = 12000): Promise<NostrEvent[]> {
  const fetchFromRelay = (relayUrl: string): Promise<NostrEvent[]> => {
    return new Promise((resolve) => {
      const events: NostrEvent[] = [];
      const timeoutId = setTimeout(() => {
        try { ws.close(); } catch {}
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

      const subId = `eco_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      ws.on('open', () => {
        ws.send(JSON.stringify(['REQ', subId, {
          kinds: [30901],
        }]));
      });

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg[0] === 'EVENT' && msg[1] === subId) {
            events.push(msg[2] as NostrEvent);
          } else if (msg[0] === 'EOSE') {
            clearTimeout(timeoutId);
            ws.close();
            resolve(events);
          }
        } catch {}
      });

      ws.on('error', () => {
        clearTimeout(timeoutId);
        resolve(events);
      });
    });
  };

  const results = await Promise.all(relays.map(r => fetchFromRelay(r)));

  // Deduplicate by d-tag (NIP-33), keep newest
  const byDTag = new Map<string, NostrEvent>();
  const seenIds = new Set<string>();

  for (const relayEvents of results) {
    for (const event of relayEvents) {
      if (seenIds.has(event.id)) continue;
      seenIds.add(event.id);

      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
      const existing = byDTag.get(dTag);
      if (!existing || event.created_at > existing.created_at) {
        byDTag.set(dTag, event);
      }
    }
  }

  return Array.from(byDTag.values());
}

const PROCESSOR_PUBKEY = '79730aba75d71584e8a4f9d0cc1173085e75590ce489760078d2bf6f5210d692';
const DEFAULT_CASHBACK = 5;

async function fetchFeePolicies(relays: string[], timeout = 12000): Promise<NostrEvent[]> {
  const fetchFromRelay = (relayUrl: string): Promise<NostrEvent[]> => {
    return new Promise((resolve) => {
      const events: NostrEvent[] = [];
      const timeoutId = setTimeout(() => { try { ws.close(); } catch {} resolve(events); }, timeout);
      let ws: WebSocket;
      try { ws = new WebSocket(relayUrl); } catch { clearTimeout(timeoutId); resolve([]); return; }
      const subId = `fee_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      ws.on('open', () => {
        ws.send(JSON.stringify(['REQ', subId, { kinds: [30902], authors: [PROCESSOR_PUBKEY] }]));
      });
      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg[0] === 'EVENT' && msg[1] === subId) events.push(msg[2] as NostrEvent);
          else if (msg[0] === 'EOSE') { clearTimeout(timeoutId); ws.close(); resolve(events); }
        } catch {}
      });
      ws.on('error', () => { clearTimeout(timeoutId); resolve(events); });
    });
  };

  const results = await Promise.all(relays.map(r => fetchFromRelay(r)));
  // Deduplicate by d-tag, keep newest
  const byDTag = new Map<string, NostrEvent>();
  const seenIds = new Set<string>();
  for (const relayEvents of results) {
    for (const event of relayEvents) {
      if (seenIds.has(event.id)) continue;
      seenIds.add(event.id);
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
      const existing = byDTag.get(dTag);
      if (!existing || event.created_at > existing.created_at) byDTag.set(dTag, event);
    }
  }
  return Array.from(byDTag.values());
}

async function fetchSuspensions(relays: string[], timeout = 12000): Promise<Set<string>> {
  const fetchFromRelay = (relayUrl: string): Promise<NostrEvent[]> => {
    return new Promise((resolve) => {
      const events: NostrEvent[] = [];
      const timeoutId = setTimeout(() => { try { ws.close(); } catch {} resolve(events); }, timeout);
      let ws: WebSocket;
      try { ws = new WebSocket(relayUrl); } catch { clearTimeout(timeoutId); resolve([]); return; }
      const subId = `susp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      ws.on('open', () => {
        ws.send(JSON.stringify(['REQ', subId, { kinds: [30903] }]));
      });
      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg[0] === 'EVENT' && msg[1] === subId) events.push(msg[2] as NostrEvent);
          else if (msg[0] === 'EOSE') { clearTimeout(timeoutId); ws.close(); resolve(events); }
        } catch {}
      });
      ws.on('error', () => { clearTimeout(timeoutId); resolve(events); });
    });
  };

  const results = await Promise.all(relays.map(r => fetchFromRelay(r)));
  const byDTag = new Map<string, NostrEvent>();
  const seenIds = new Set<string>();
  for (const relayEvents of results) {
    for (const event of relayEvents) {
      if (seenIds.has(event.id)) continue;
      seenIds.add(event.id);
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
      const existing = byDTag.get(dTag);
      if (!existing || event.created_at > existing.created_at) byDTag.set(dTag, event);
    }
  }

  // Build set of suspended unit IDs
  const suspendedUnitIds = new Set<string>();
  for (const [unitId, event] of byDTag) {
    const status = getTag(event, 'status');
    const activeUntil = getTag(event, 'active_until');
    if (status === 'suspended') {
      // Check if suspension is still active (not expired)
      if (activeUntil && parseInt(activeUntil) <= Math.floor(Date.now() / 1000)) {
        continue; // expired suspension
      }
      suspendedUnitIds.add(unitId);
    }
  }
  return suspendedUnitIds;
}

function buildCashbackMap(policies: NostrEvent[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const event of policies) {
    const unitId = getTag(event, 'unit_id');
    const status = getTag(event, 'status');
    if (!unitId || status !== 'active') continue;
    const lanaDiscount = parseFloat(getTag(event, 'lana_discount_per') || '0');
    if (lanaDiscount > 0 && lanaDiscount <= 20) {
      map.set(unitId, lanaDiscount);
    }
  }
  return map;
}

// Cache keyed by category string to avoid cross-site contamination
const unitCache = new Map<string, { units: (ReturnType<typeof parseUnit> & { cashbackPercent: number })[]; ts: number }>();
const CACHE_TTL = 60_000; // 1 minute

export function createEcoUnitsRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      // Check category-specific cache
      const cacheKey = (req.query.category as string) || '__all__';
      const _cached = unitCache.get(cacheKey);
      if (_cached && Date.now() - _cached.ts < CACHE_TTL) {
        res.json(_cached.units);
        return;
      }

      // Get relays from system params
      const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY id DESC LIMIT 1').get() as any;
      if (!row) {
        res.json([]);
        return;
      }

      const relays: string[] = JSON.parse(row.relays || '[]');
      if (relays.length === 0) {
        res.json([]);
        return;
      }

      const [events, feeEvents, suspendedIds] = await Promise.all([
        fetchAllEcoUnits(relays),
        fetchFeePolicies(relays),
        fetchSuspensions(relays),
      ]);
      const cashbackMap = buildCashbackMap(feeEvents);

      const categoryFilter = (req.query.category as string) || '';
      const allUnits = events
        .map(e => ({
          ...parseUnit(e),
          cashbackPercent: cashbackMap.get(parseUnit(e).unitId) || DEFAULT_CASHBACK,
        }))
        .filter(u => u.status === 'active' && u.name && !suspendedIds.has(u.unitId));

      let units = allUnits;
      if (categoryFilter) {
        const cats = categoryFilter.split(',').map(c => c.trim().toLowerCase());
        units = allUnits.filter(u => cats.includes(u.category.toLowerCase()));
      }

      units.sort((a, b) => a.name.localeCompare(b.name));

      unitCache.set(cacheKey, { units, ts: Date.now() });

      res.json(units);
    } catch (error) {
      console.error('Failed to fetch eco units:', error);
      // Return stale cache if available
      res.json(unitCache.get(cacheKey)?.units || []);
    }
  });

  return router;
}
