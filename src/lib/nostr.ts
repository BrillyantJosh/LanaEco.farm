/**
 * Client-side Nostr relay communication for KIND 30901 business units
 */

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/**
 * Fetch KIND 30901 events from relays for a specific pubkey
 */
export async function fetchBusinessUnits(
  pubkey: string,
  relays: string[],
  timeout = 15000
): Promise<NostrEvent[]> {
  const allEvents: NostrEvent[] = [];
  const seenIds = new Set<string>();

  const fetchFromRelay = (relayUrl: string): Promise<NostrEvent[]> => {
    return new Promise((resolve) => {
      const events: NostrEvent[] = [];
      const timeoutId = setTimeout(() => {
        ws.close();
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

      const subscriptionId = `bu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      ws.onopen = () => {
        ws.send(JSON.stringify(['REQ', subscriptionId, {
          kinds: [30901],
          authors: [pubkey]
        }]));
      };

      ws.onmessage = (e) => {
        try {
          const message = JSON.parse(e.data);
          if (message[0] === 'EVENT' && message[1] === subscriptionId) {
            events.push(message[2] as NostrEvent);
          } else if (message[0] === 'EOSE') {
            clearTimeout(timeoutId);
            ws.close();
            resolve(events);
          }
        } catch {}
      };

      ws.onerror = () => {
        clearTimeout(timeoutId);
        resolve(events);
      };

      ws.onclose = () => {
        clearTimeout(timeoutId);
      };
    });
  };

  const results = await Promise.all(
    relays.map(relay => fetchFromRelay(relay))
  );

  // Deduplicate by d-tag (NIP-33: keep only latest per d-tag)
  const byDTag = new Map<string, NostrEvent>();

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

/**
 * Publish a signed event to multiple relays
 */
export async function publishToRelays(
  event: NostrEvent,
  relays: string[],
  timeout = 15000
): Promise<{ success: string[]; failed: string[] }> {
  const success: string[] = [];
  const failed: string[] = [];

  const publishToRelay = (relayUrl: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        ws.close();
        resolve(false);
      }, timeout);

      let ws: WebSocket;
      try {
        ws = new WebSocket(relayUrl);
      } catch {
        clearTimeout(timeoutId);
        resolve(false);
        return;
      }

      ws.onopen = () => {
        ws.send(JSON.stringify(['EVENT', event]));
      };

      ws.onmessage = (e) => {
        try {
          const message = JSON.parse(e.data);
          if (message[0] === 'OK' && message[1] === event.id) {
            clearTimeout(timeoutId);
            ws.close();
            resolve(message[2] === true);
          }
        } catch {}
      };

      ws.onerror = () => {
        clearTimeout(timeoutId);
        resolve(false);
      };

      ws.onclose = () => {
        clearTimeout(timeoutId);
      };
    });
  };

  await Promise.all(
    relays.map(async (relay) => {
      const ok = await publishToRelay(relay);
      if (ok) success.push(relay);
      else failed.push(relay);
    })
  );

  return { success, failed };
}

/**
 * Parse a KIND 30901 event into a structured business unit object
 */
export function parseBusinessUnit(event: NostrEvent) {
  const getTag = (name: string) => event.tags.find(t => t[0] === name)?.[1] || '';
  const getTags = (name: string) => event.tags.filter(t => t[0] === name).map(t => t[1]);

  return {
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    content: event.content,
    unitId: getTag('unit_id'),
    name: getTag('name'),
    ownerHex: getTag('owner_hex'),
    receiverName: getTag('receiver_name'),
    receiverAddress: getTag('receiver_address'),
    receiverZip: getTag('receiver_zip'),
    receiverCity: getTag('receiver_city'),
    receiverCountry: getTag('receiver_country'),
    bankName: getTag('bank_name'),
    bankAddress: getTag('bank_address'),
    bankCountry: getTag('bank_country'),
    bankSwift: getTag('bank_swift'),
    bankAccount: getTag('bank_account'),
    longitude: getTag('longitude'),
    latitude: getTag('latitude'),
    country: getTag('country'),
    currency: getTag('currency'),
    category: getTag('category'),
    categoryDetail: getTag('category_detail'),
    images: getTags('image'),
    status: getTag('status') || 'active',
    openingHoursJson: getTag('opening_hours_json'),
    video: getTag('video'),
    url: getTag('url'),
    logo: getTag('logo'),
    note: getTag('note'),
    payoutMethod: getTag('lanapays_payout_method') || 'fiat',
    payoutWallet: getTag('lanapays_payout_wallet'),
    rawEvent: event
  };
}

export type BusinessUnit = ReturnType<typeof parseBusinessUnit>;

export interface UnitSuspension {
  unitId: string;
  reason: string;
  status: string;
  activeUntil: string | null;
  content: string;
}

/**
 * Fetch KIND 30903 suspension events for given unit IDs
 */
export async function fetchSuspensions(
  unitIds: string[],
  relays: string[],
  timeout = 10000
): Promise<Record<string, UnitSuspension>> {
  if (unitIds.length === 0) return {};

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

      const subId = `susp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      ws.onopen = () => {
        ws.send(JSON.stringify(['REQ', subId, {
          kinds: [30903],
          '#d': unitIds,
        }]));
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg[0] === 'EVENT' && msg[1] === subId) {
            events.push(msg[2] as NostrEvent);
          } else if (msg[0] === 'EOSE') {
            clearTimeout(timeoutId);
            ws.close();
            resolve(events);
          }
        } catch {}
      };

      ws.onerror = () => { clearTimeout(timeoutId); resolve(events); };
      ws.onclose = () => { clearTimeout(timeoutId); };
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
      if (!existing || event.created_at > existing.created_at) {
        byDTag.set(dTag, event);
      }
    }
  }

  const suspensions: Record<string, UnitSuspension> = {};
  for (const [unitId, event] of byDTag) {
    const getTag = (name: string) => event.tags.find(t => t[0] === name)?.[1] || '';
    const status = getTag('status');
    const activeUntil = getTag('active_until') || null;

    // Determine if actually suspended
    if (status === 'suspended') {
      if (activeUntil && parseInt(activeUntil) <= Math.floor(Date.now() / 1000)) {
        continue; // expired suspension
      }
      suspensions[unitId] = {
        unitId,
        reason: getTag('reason'),
        status,
        activeUntil,
        content: event.content,
      };
    }
  }

  return suspensions;
}

// ============================================================
// KIND 36500 — Eco Listings
// ============================================================

export interface EcoListing {
  eventId: string;
  pubkey: string;
  createdAt: number;
  content: string;
  listingId: string;       // d-tag
  unitRef: string;         // a-tag → "30901:<pubkey>:<unitId>"
  title: string;
  type: string;            // product | subscription | service | experience
  price: string;
  priceCurrency: string;
  unit: string;            // kg | piece | L | ...
  status: string;          // active | sold_out | seasonal | archived
  // Stock
  stock: string;
  minOrder: string;
  maxOrder: string;
  preOrder: string;
  // Season
  harvestDate: string;
  harvestSeason: string;
  availableFrom: string;
  availableUntil: string;
  // Eco
  eco: string[];           // organic, biodynamic, local, ...
  cert: string[];
  certUrl: string[];
  // Category
  tags: string[];          // t-tags: vegetables, fruits, dairy, ...
  // Delivery
  delivery: string[];      // pickup, local_delivery, ...
  deliveryRadiusKm: string;
  marketDays: string[];
  // Subscription
  subscriptionInterval: string;
  subscriptionContent: string;
  // Experience
  capacity: string;
  durationMin: string;
  bookingRequired: string;
  // Media
  images: string[];
  thumbs: string[];
  // Payment
  payment: string[];
  lud16: string;
  // Location override
  geoLat: string;
  geoLon: string;
  geoLabel: string;
  // Transparency
  sprayLog: string;
  soilTestYear: string;
  youtubeUrl: string;
  language: string;
  // Raw
  rawEvent: NostrEvent;
}

/**
 * Parse a KIND 36500 event into a structured EcoListing
 */
export function parseEcoListing(event: NostrEvent): EcoListing {
  const getTag = (name: string) => event.tags.find(t => t[0] === name)?.[1] || '';
  const getTags = (name: string) => event.tags.filter(t => t[0] === name).map(t => t[1]);
  const priceTag = event.tags.find(t => t[0] === 'price');
  const geoTag = event.tags.find(t => t[0] === 'geo');

  return {
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    content: event.content,
    listingId: getTag('d'),
    unitRef: getTag('a'),
    title: getTag('title'),
    type: getTag('type'),
    price: priceTag?.[1] || '',
    priceCurrency: priceTag?.[2] || 'EUR',
    unit: getTag('unit'),
    status: getTag('status') || 'active',
    stock: getTag('stock'),
    minOrder: getTag('min_order'),
    maxOrder: getTag('max_order'),
    preOrder: getTag('pre_order'),
    harvestDate: getTag('harvest_date'),
    harvestSeason: getTag('harvest_season'),
    availableFrom: getTag('available_from'),
    availableUntil: getTag('available_until'),
    eco: getTags('eco'),
    cert: getTags('cert'),
    certUrl: getTags('cert_url'),
    tags: getTags('t'),
    delivery: getTags('delivery'),
    deliveryRadiusKm: getTag('delivery_radius_km'),
    marketDays: getTags('market_day'),
    subscriptionInterval: getTag('subscription_interval'),
    subscriptionContent: getTag('subscription_content'),
    capacity: getTag('capacity'),
    durationMin: getTag('duration_min'),
    bookingRequired: getTag('booking_required'),
    images: getTags('image'),
    thumbs: getTags('thumb'),
    payment: getTags('payment'),
    lud16: getTag('lud16'),
    geoLat: geoTag?.[1] || '',
    geoLon: geoTag?.[2] || '',
    geoLabel: geoTag?.[3] || '',
    sprayLog: getTag('spray_log'),
    soilTestYear: getTag('soil_test_year'),
    youtubeUrl: getTag('youtube_url'),
    language: getTag('language'),
    rawEvent: event,
  };
}

/**
 * Fetch KIND 36500 eco listings from relays
 * @param filter - optional: { authors?, '#a'?, '#status'?, '#type'?, '#t'? }
 */
export async function fetchListings(
  relays: string[],
  filter: Record<string, any> = {},
  timeout = 15000
): Promise<NostrEvent[]> {
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

      const subId = `lst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      ws.onopen = () => {
        ws.send(JSON.stringify(['REQ', subId, {
          kinds: [36500],
          ...filter,
        }]));
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg[0] === 'EVENT' && msg[1] === subId) {
            events.push(msg[2] as NostrEvent);
          } else if (msg[0] === 'EOSE') {
            clearTimeout(timeoutId);
            ws.close();
            resolve(events);
          }
        } catch {}
      };

      ws.onerror = () => { clearTimeout(timeoutId); resolve(events); };
      ws.onclose = () => { clearTimeout(timeoutId); };
    });
  };

  const results = await Promise.all(relays.map(r => fetchFromRelay(r)));

  // Deduplicate by d-tag (NIP-33)
  const byDTag = new Map<string, NostrEvent>();
  const seenIds = new Set<string>();

  for (const relayEvents of results) {
    for (const event of relayEvents) {
      if (seenIds.has(event.id)) continue;
      seenIds.add(event.id);
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
      const key = `${event.pubkey}:${dTag}`;
      const existing = byDTag.get(key);
      if (!existing || event.created_at > existing.created_at) {
        byDTag.set(key, event);
      }
    }
  }

  return Array.from(byDTag.values());
}
