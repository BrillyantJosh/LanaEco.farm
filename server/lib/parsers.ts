/**
 * Event parsers shared between heartbeat sync and admin routes.
 */

import { NostrEvent, getTag, getTags } from './relaySync.js';

const UPLOADS_BASE = 'https://shop.lanapays.us';

export interface ParsedUnit {
  eventId: string;
  pubkey: string;
  createdAt: number;
  unitId: string;
  name: string;
  ownerHex: string;
  country: string;
  currency: string;
  category: string;
  categoryDetail: string;
  images: string[];
  status: string;
  registeredAt: number;
  longitude: string;
  latitude: string;
  logo: string;
  video: string;
  url: string;
  email: string;
  phone: string;
  note: string;
  openingHoursJson: string;
  receiverName: string;
  receiverCity: string;
  receiverCountry: string;
  content: string;
  // KIND 30901 v1.2.0 — online shop opt-in (merchant-signed, OPTIONAL tags).
  // Absent tag == false / '0.00' (fail-closed: a unit that never said
  // 'online_shop true' is NOT buyable).
  onlineShop: boolean;
  onlineShopShippingFee: string;
  onlineShopPickup: boolean;
  onlineShopFreeFrom: string | null;
  /** Every `p` tag on the 30901 — staff hexes allowed to sign KIND 36521. */
  staffHexes: string[];
}

const HEX64_RE = /^[0-9a-f]{64}$/;
const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;

/** '12.5' → '12.50'; anything that is not a 2-decimal fiat string → fallback. */
function normalizeDecimal(raw: string, fallback: string | null): string | null {
  const s = String(raw || '').trim();
  if (!DECIMAL_RE.test(s)) return fallback;
  const [w, f = ''] = s.split('.');
  return `${Number(w)}.${(f + '00').slice(0, 2)}`;
}

export function parseUnit(event: NostrEvent): ParsedUnit {
  const remap = (img: string) =>
    img.startsWith('/api/uploads/') ? `${UPLOADS_BASE}${img}` : img;

  return {
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    unitId: getTag(event, 'unit_id') || getTag(event, 'd'),
    name: getTag(event, 'name'),
    ownerHex: getTag(event, 'owner_hex'),
    country: getTag(event, 'country'),
    currency: getTag(event, 'currency'),
    category: getTag(event, 'category'),
    categoryDetail: getTag(event, 'category_detail'),
    images: getTags(event, 'image').map(remap),
    status: getTag(event, 'status') || 'active',
    // 0 = unknown (legacy unit, no registered_at tag)
    registeredAt: parseInt(getTag(event, 'registered_at') || '0', 10) || 0,
    longitude: getTag(event, 'longitude'),
    latitude: getTag(event, 'latitude'),
    logo: remap(getTag(event, 'logo')),
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
    onlineShop: getTag(event, 'online_shop') === 'true',
    onlineShopShippingFee: normalizeDecimal(getTag(event, 'online_shop_shipping_fee'), '0.00') as string,
    onlineShopPickup: getTag(event, 'online_shop_pickup') === 'true',
    onlineShopFreeFrom: normalizeDecimal(getTag(event, 'online_shop_free_shipping_from'), null),
    staffHexes: getTags(event, 'p').map(h => String(h || '').toLowerCase()).filter(h => HEX64_RE.test(h)),
  };
}

export interface ParsedListing {
  eventId: string;
  pubkey: string;
  createdAt: number;
  /** Event kind (36500 on this portal) — needed for the 36520 `item` address. */
  kind: number;
  content: string;
  listingId: string;
  unitRef: string;
  title: string;
  type: string;
  price: string;
  priceCurrency: string;
  unit: string;
  status: string;
  stock: string;
  minOrder: string;
  maxOrder: string;
  preOrder: string;
  harvestDate: string;
  harvestSeason: string;
  availableFrom: string;
  availableUntil: string;
  eco: string[];
  cert: string[];
  certUrl: string[];
  tags: string[];
  delivery: string[];
  deliveryRadiusKm: string;
  marketDays: string[];
  subscriptionInterval: string;
  subscriptionContent: string;
  capacity: string;
  durationMin: string;
  bookingRequired: string;
  images: string[];
  thumbs: string[];
  payment: string[];
  lud16: string;
  geoLat: string;
  geoLon: string;
  geoLabel: string;
  sprayLog: string;
  soilTestYear: string;
  youtubeUrl: string;
  url: string;
  language: string;
}

export function parseListing(event: NostrEvent): ParsedListing {
  const priceTag = event.tags.find(t => t[0] === 'price');
  const geoTag = event.tags.find(t => t[0] === 'geo');
  const remap = (img: string) =>
    img.startsWith('/api/uploads/') ? `${UPLOADS_BASE}${img}` : img;

  return {
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    kind: event.kind,
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
    images: getTags(event, 'image').map(remap),
    thumbs: getTags(event, 'thumb').map(remap),
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

export interface ParsedFeePolicy {
  unitId: string;
  status: string;
  lanaDiscountPer: number;
}

export function parseFeePolicy(event: NostrEvent): ParsedFeePolicy {
  return {
    unitId: getTag(event, 'unit_id') || getTag(event, 'd'),
    status: getTag(event, 'status'),
    lanaDiscountPer: parseFloat(getTag(event, 'lana_discount_per') || '0'),
  };
}

export interface ParsedSuspension {
  unitId: string;
  status: string;
  reason: string;
  activeUntil: number | null;
}

export function parseSuspension(event: NostrEvent): ParsedSuspension {
  const activeUntilStr = getTag(event, 'active_until');
  return {
    unitId: getTag(event, 'unit_id') || getTag(event, 'd'),
    status: getTag(event, 'status') || 'suspended',
    reason: getTag(event, 'reason'),
    activeUntil: activeUntilStr ? parseInt(activeUntilStr, 10) : null,
  };
}

// ─────────────────────────────────────────── Lana Online Shop (SPEC §2/§3/§7)

export interface ParsedShopOrderItem {
  /** '<listing_kind>:<unit_owner_hex>:<listing_d>' */
  a: string;
  kind: number;
  ownerHex: string;
  listingId: string;
  qty: number;
  saleUnit: string;
  unitPrice: string;
  currency: string;
}

/**
 * KIND 36520 — Lana Shop Order, signed by the buyer's ephemeral key.
 * Carries NO PII by construction (content MUST be '').
 */
export interface ParsedShopOrder {
  eventId: string;
  pubkey: string;
  createdAt: number;
  orderId: string;
  unitRef: string;
  ownerHex: string;
  unitId: string;
  invoiceNumber: string;
  items: ParsedShopOrderItem[];
  shippingFee: string;
  shippingCurrency: string;
  total: string;
  currency: string;
  fulfillment: string;
  status: string;
  payBy: number;
  client: string;
  version: string;
  supersedes: string;
  contentEmpty: boolean;
}

function parseAddress(a: string): { kind: number; pubkey: string; d: string } | null {
  const parts = String(a || '').split(':');
  if (parts.length < 3) return null;
  const kind = parseInt(parts[0], 10);
  if (!Number.isInteger(kind)) return null;
  return { kind, pubkey: parts[1], d: parts.slice(2).join(':') };
}

export function parseShopOrder(event: NostrEvent): ParsedShopOrder {
  const items: ParsedShopOrderItem[] = [];
  for (const t of event.tags) {
    if (t[0] !== 'item') continue;
    const addr = parseAddress(t[1]);
    items.push({
      a: t[1] || '',
      kind: addr?.kind ?? 0,
      ownerHex: addr?.pubkey || '',
      listingId: addr?.d || '',
      qty: parseInt(t[2] || '', 10),
      saleUnit: t[3] || '',
      unitPrice: t[4] || '',
      currency: t[5] || '',
    });
  }
  const shipping = event.tags.find(t => t[0] === 'shipping');
  const total = event.tags.find(t => t[0] === 'total');
  const payBy = parseInt(getTag(event, 'pay_by') || '', 10);
  return {
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    orderId: getTag(event, 'd'),
    unitRef: getTag(event, 'a'),
    ownerHex: getTag(event, 'p'),
    unitId: getTag(event, 'unit_id'),
    invoiceNumber: getTag(event, 'invoice_number'),
    items,
    shippingFee: shipping?.[1] || '',
    shippingCurrency: shipping?.[2] || '',
    total: total?.[1] || '',
    currency: total?.[2] || '',
    fulfillment: getTag(event, 'fulfillment'),
    status: getTag(event, 'status'),
    payBy: Number.isFinite(payBy) ? payBy : 0,
    client: getTag(event, 'client'),
    version: getTag(event, 'v'),
    supersedes: getTag(event, 'supersedes'),
    contentEmpty: event.content === '',
  };
}

/** KIND 36521 — Lana Shop Order Fulfillment, signed by the merchant (owner or staff). */
export interface ParsedFulfillment {
  eventId: string;
  pubkey: string;
  createdAt: number;
  orderId: string;
  /** 'a' → 36520:<B>:<D> */
  orderRef: string;
  /** 'a' → 30901:<owner>:<unit_id> */
  unitRef: string;
  buyerPubkey: string;
  unitId: string;
  status: string;
  paymentRef: string;
  carrier: string;
  tracking: string;
  shippedAt: string;
  deliveredAt: string;
  eta: string;
  refund: { amount: string; currency: string; txHash: string; at: string } | null;
  version: string;
  /** Public, non-PII note (may be ''). */
  note: string;
}

export function parseFulfillment(event: NostrEvent): ParsedFulfillment {
  const aTags = getTags(event, 'a');
  const refundTag = event.tags.find(t => t[0] === 'refund');
  return {
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    orderId: getTag(event, 'd'),
    orderRef: aTags.find(a => a.startsWith('36520:')) || '',
    unitRef: aTags.find(a => a.startsWith('30901:')) || '',
    buyerPubkey: getTag(event, 'p'),
    unitId: getTag(event, 'unit_id'),
    status: getTag(event, 'status'),
    paymentRef: getTag(event, 'payment'),
    carrier: getTag(event, 'carrier'),
    tracking: getTag(event, 'tracking'),
    shippedAt: getTag(event, 'shipped_at'),
    deliveredAt: getTag(event, 'delivered_at'),
    eta: getTag(event, 'eta'),
    refund: refundTag
      ? { amount: refundTag[1] || '', currency: refundTag[2] || '', txHash: refundTag[3] || '', at: refundTag[4] || '' }
      : null,
    version: getTag(event, 'v'),
    note: event.content,
  };
}

/**
 * KIND 30933 — brain-signed purchase. We keep ONLY the join tags the
 * resolver needs (SPEC §7); investor allocations etc. are not mirrored.
 */
export interface ParsedPurchase {
  eventId: string;
  pubkey: string;
  createdAt: number;
  /** 'd' == brain transaction id */
  txId: string;
  unitId: string;
  invoiceNumber: string;
  receiptDescription: string;
  amount: string;
  currency: string;
  lanaAmount: string;
  paymentType: string;
  status: string;
  customerHex: string;
  txHash: string;
}

export function parsePurchase(event: NostrEvent): ParsedPurchase {
  return {
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    txId: getTag(event, 'd'),
    unitId: getTag(event, 'unit_id'),
    invoiceNumber: getTag(event, 'invoice_number'),
    receiptDescription: getTag(event, 'receipt_description'),
    amount: getTag(event, 'amount'),
    currency: getTag(event, 'currency'),
    lanaAmount: getTag(event, 'lana_amount'),
    paymentType: getTag(event, 'payment_type'),
    status: getTag(event, 'status'),
    customerHex: getTag(event, 'customer_hex') || getTag(event, 'p'),
    txHash: getTag(event, 'tx_hash'),
  };
}
