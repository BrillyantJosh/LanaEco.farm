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
    images: getTags(event, 'image'),
    status: getTag(event, 'status') || 'active',
    longitude: getTag(event, 'longitude'),
    latitude: getTag(event, 'latitude'),
    logo: getTag(event, 'logo'),
    video: getTag(event, 'video'),
    url: getTag(event, 'url'),
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

// Cache to avoid hammering relays on every page load
let cachedUnits: ReturnType<typeof parseUnit>[] = [];
let cacheTimestamp = 0;
const CACHE_TTL = 60_000; // 1 minute

export function createEcoUnitsRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      // Check cache
      if (Date.now() - cacheTimestamp < CACHE_TTL && cachedUnits.length > 0) {
        res.json(cachedUnits);
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

      const events = await fetchAllEcoUnits(relays);
      const categoryFilter = (req.query.category as string) || '';
      const allUnits = events
        .map(parseUnit)
        .filter(u => u.status === 'active' && u.name);

      // If category filter specified, filter by it (supports comma-separated)
      let units = allUnits;
      if (categoryFilter) {
        const cats = categoryFilter.split(',').map(c => c.trim().toLowerCase());
        units = allUnits.filter(u => cats.includes(u.category.toLowerCase()));
      }

      units.sort((a, b) => a.name.localeCompare(b.name));

      cachedUnits = units;
      cacheTimestamp = Date.now();

      res.json(units);
    } catch (error) {
      console.error('Failed to fetch eco units:', error);
      // Return cache if available, even if stale
      res.json(cachedUnits);
    }
  });

  return router;
}
