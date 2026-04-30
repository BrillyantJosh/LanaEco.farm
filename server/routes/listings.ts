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

function parseListing(event: NostrEvent) {
  const priceTag = event.tags.find(t => t[0] === 'price');
  const geoTag = event.tags.find(t => t[0] === 'geo');

  return {
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    content: event.content,
    listingId: getTag(event, 'd'),
    unitRef: getTag(event, 'a'),
    title: getTag(event, 'title'),
    type: getTag(event, 'type'),
    price: priceTag?.[1] || '',
    priceCurrency: priceTag?.[2] || 'EUR',
    unit: getTag(event, 'unit'),
    status: getTag(event, 'status') || 'active',
    stock: getTag(event, 'stock'),
    minOrder: getTag(event, 'min_order'),
    maxOrder: getTag(event, 'max_order'),
    preOrder: getTag(event, 'pre_order'),
    harvestDate: getTag(event, 'harvest_date'),
    harvestSeason: getTag(event, 'harvest_season'),
    availableFrom: getTag(event, 'available_from'),
    availableUntil: getTag(event, 'available_until'),
    eco: getTags(event, 'eco'),
    cert: getTags(event, 'cert'),
    certUrl: getTags(event, 'cert_url'),
    tags: getTags(event, 't'),
    delivery: getTags(event, 'delivery'),
    deliveryRadiusKm: getTag(event, 'delivery_radius_km'),
    marketDays: getTags(event, 'market_day'),
    subscriptionInterval: getTag(event, 'subscription_interval'),
    subscriptionContent: getTag(event, 'subscription_content'),
    capacity: getTag(event, 'capacity'),
    durationMin: getTag(event, 'duration_min'),
    bookingRequired: getTag(event, 'booking_required'),
    images: getTags(event, 'image').map(img => img.startsWith('/api/uploads/') ? `https://shop.lanapays.us${img}` : img),
    thumbs: getTags(event, 'thumb').map(img => img.startsWith('/api/uploads/') ? `https://shop.lanapays.us${img}` : img),
    payment: getTags(event, 'payment'),
    lud16: getTag(event, 'lud16'),
    geoLat: geoTag?.[1] || '',
    geoLon: geoTag?.[2] || '',
    geoLabel: geoTag?.[3] || '',
    sprayLog: getTag(event, 'spray_log'),
    soilTestYear: getTag(event, 'soil_test_year'),
    youtubeUrl: getTag(event, 'youtube_url'),
    url: getTag(event, 'website_url'),
    language: getTag(event, 'language'),
  };
}

async function fetchAllListings(relays: string[], timeout = 12000): Promise<NostrEvent[]> {
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

      const subId = `lst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      ws.on('open', () => {
        ws.send(JSON.stringify(['REQ', subId, {
          kinds: [36500],
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

  // Deduplicate by pubkey+d-tag (NIP-33)
  const byKey = new Map<string, NostrEvent>();
  const seenIds = new Set<string>();

  for (const relayEvents of results) {
    for (const event of relayEvents) {
      if (seenIds.has(event.id)) continue;
      seenIds.add(event.id);

      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
      const key = `${event.pubkey}:${dTag}`;
      const existing = byKey.get(key);
      if (!existing || event.created_at > existing.created_at) {
        byKey.set(key, event);
      }
    }
  }

  return Array.from(byKey.values());
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

  const suspendedUnitIds = new Set<string>();
  for (const [unitId, event] of byDTag) {
    const status = getTag(event, 'status');
    const activeUntil = getTag(event, 'active_until');
    if (status === 'suspended') {
      if (activeUntil && parseInt(activeUntil) <= Math.floor(Date.now() / 1000)) {
        continue; // expired suspension
      }
      suspendedUnitIds.add(unitId);
    }
  }
  return suspendedUnitIds;
}

// Cache
let cachedListings: (ReturnType<typeof parseListing> & { cashbackPercent: number })[] = [];
let cacheTimestamp = 0;
const CACHE_TTL = 60_000; // 1 minute

export function createListingsRouter(db: Database.Database): Router {
  const router = Router();

  // GET /api/listings — all active listings with optional filters
  router.get('/', async (req: Request, res: Response) => {
    try {
      if (Date.now() - cacheTimestamp < CACHE_TTL && cachedListings.length > 0) {
        res.json(applyFilters(cachedListings, req.query));
        return;
      }

      const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY id DESC LIMIT 1').get() as any;
      if (!row) { res.json([]); return; }

      const relays: string[] = JSON.parse(row.relays || '[]');
      if (relays.length === 0) { res.json([]); return; }

      const [events, feeEvents, suspendedIds] = await Promise.all([
        fetchAllListings(relays),
        fetchFeePolicies(relays),
        fetchSuspensions(relays),
      ]);

      // Build cashback map: unitId → lana_discount_per
      const cashbackMap = new Map<string, number>();
      for (const fe of feeEvents) {
        const unitId = getTag(fe, 'unit_id');
        const status = getTag(fe, 'status');
        if (!unitId || status !== 'active') continue;
        const pct = parseFloat(getTag(fe, 'lana_discount_per') || '0');
        if (pct > 0 && pct <= 20) cashbackMap.set(unitId, pct);
      }

      cachedListings = events
        .map(e => {
          const parsed = parseListing(e);
          // Extract unitId from the a-tag: "30901:<pubkey>:<unitId>"
          const unitIdFromRef = parsed.unitRef.split(':')[2] || '';
          return { ...parsed, cashbackPercent: cashbackMap.get(unitIdFromRef) || DEFAULT_CASHBACK };
        })
        .filter(l => l.status === 'active' && l.title && !suspendedIds.has(l.unitRef.split(':')[2] || ''));
      cacheTimestamp = Date.now();

      res.json(applyFilters(cachedListings, req.query));
    } catch (error) {
      console.error('Failed to fetch listings:', error);
      res.json(applyFilters(cachedListings, req.query));
    }
  });

  return router;
}

function applyFilters(listings: ReturnType<typeof parseListing>[], query: any) {
  let result = [...listings];

  // ?unit=<unitId> — filter by business unit reference
  if (query.unit) {
    const unitRef = query.unit as string;
    result = result.filter(l => l.unitRef.includes(unitRef));
  }

  // ?type=product
  if (query.type) {
    result = result.filter(l => l.type === query.type);
  }

  // ?t=vegetables
  if (query.t) {
    const t = query.t as string;
    result = result.filter(l => l.tags.includes(t));
  }

  // ?eco=organic
  if (query.eco) {
    const eco = query.eco as string;
    result = result.filter(l => l.eco.includes(eco));
  }

  // ?search=apple
  if (query.search) {
    const s = (query.search as string).toLowerCase();
    result = result.filter(l =>
      l.title.toLowerCase().includes(s) ||
      l.content.toLowerCase().includes(s) ||
      l.tags.some(t => t.toLowerCase().includes(s))
    );
  }

  // Sort newest first by default
  // Sort by cashback desc (best deals first), then by date
  result.sort((a, b) => ((b as any).cashbackPercent || 5) - ((a as any).cashbackPercent || 5) || b.createdAt - a.createdAt);

  return result;
}
