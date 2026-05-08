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
  };
}

export interface ParsedListing {
  eventId: string;
  pubkey: string;
  createdAt: number;
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
