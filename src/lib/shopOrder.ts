/**
 * Lana Online Shop — buyer-side order construction (SPEC §1, §2, §4).
 *
 * The buyer never logs in. Each order gets its own EPHEMERAL Nostr key,
 * generated here and kept only in this browser's localStorage
 * (`lana_shop_order_key_<order_id>`, 30-day TTL). It holds no funds; it
 * only signs the order (36520) and the encrypted delivery details (36522).
 *
 * PII is encrypted in THIS browser with NIP-44 v2 to the unit owner — whose
 * hex is taken from `verifyEvent(raw30901).pubkey`, never from a bare hex in
 * JSON — and leaves the browser only as ciphertext.
 */

import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { signNostrEvent } from './nostrSigning';

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export const KIND_SHOP_ORDER = 36520;
export const KIND_SHOP_DELIVERY = 36522;
export const PAY_WINDOW_SEC = 1800;
export const ORDER_ID_RE = /^[0-9a-f]{24}\.[0-9a-f]{32}$/;
/** SPEC v1.1.0: different products ONE order may carry (all of one shop). */
export const MAX_ITEMS_PER_ORDER = 30;

const KEY_PREFIX = 'lana_shop_order_key_';
const ORDERS_KEY = 'lana_shop_orders';
const KEY_TTL_SEC = 30 * 24 * 3600;
const MAX_STORED_ORDERS = 200;

// ─────────────────────────────────────────── identity

export interface OrderIdentity {
  privHex: string;
  pubkey: string;
  orderId: string;
}

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

/** D = B.slice(0,24) + '.' + 32 random hex (57 chars). */
export function makeOrderId(pubkey: string): string {
  return pubkey.slice(0, 24) + '.' + randomHex(16);
}

export function orderIdMatchesPubkey(orderId: string, pubkey: string): boolean {
  return ORDER_ID_RE.test(orderId) && orderId.slice(0, 24) === pubkey.slice(0, 24);
}

/** Fresh ephemeral key + the order id derived from it. Nothing is stored yet. */
export function newOrderIdentity(): OrderIdentity {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  return { privHex: bytesToHex(sk), pubkey, orderId: makeOrderId(pubkey) };
}

// ─────────────────────────────────────────── KIND 36520

export interface OrderItemInput {
  /** '<listing_kind>:<unit_owner_hex>:<listing_d>' */
  a: string;
  qty: number;
  saleUnit: string;
  unitPrice: string;
  currency: string;
}

export interface OrderInput {
  orderId: string;
  unitOwnerHex: string;
  unitId: string;
  /**
   * 1..MAX_ITEMS_PER_ORDER lines of THIS shop, exactly as the server quote
   * returned them (same order, same strings) — the server re-derives them
   * byte for byte. Each listing at most once.
   */
  items: OrderItemInput[];
  shipping: string;
  total: string;
  currency: string;
  fulfillment: 'shipping' | 'pickup';
  status: 'placed' | 'cancelled';
  /** portal host, e.g. lanaeco.shop */
  client: string;
  /** '36520:<B_old>:<D_old>' — only on retry-after-expiry orders */
  supersedes?: string;
}

/**
 * Tags in the EXACT order of SPEC §2; the `item` tags sit together where the
 * single item always was, so a one-item order is byte-identical to v1.0.
 */
export function buildOrderTags(input: OrderInput, createdAt: number): string[][] {
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length < 1 || items.length > MAX_ITEMS_PER_ORDER) {
    throw new Error(`an order needs 1..${MAX_ITEMS_PER_ORDER} items`);
  }
  const seen = new Set<string>();
  for (const it of items) {
    if (it.a.split(':')[1] !== input.unitOwnerHex) throw new Error('every item must be a listing of this shop');
    if (seen.has(it.a)) throw new Error('the same listing twice in one order');
    seen.add(it.a);
  }
  const tags: string[][] = [
    ['d', input.orderId],
    ['a', `30901:${input.unitOwnerHex}:${input.unitId}`],
    ['p', input.unitOwnerHex],
    ['unit_id', input.unitId],
    ['invoice_number', input.orderId],
    ...items.map(it => ['item', it.a, String(it.qty), it.saleUnit, it.unitPrice, it.currency]),
    ['shipping', input.shipping, input.currency],
    ['total', input.total, input.currency],
    ['fulfillment', input.fulfillment],
    ['status', input.status],
    ['pay_by', String(createdAt + PAY_WINDOW_SEC)],
    ['client', input.client],
    ['v', '1'],
  ];
  if (input.supersedes) tags.push(['supersedes', input.supersedes]);
  return tags;
}

/**
 * Sign a 36520 with the ephemeral key. content is ALWAYS ''. `pay_by` must
 * equal created_at + 1800, and signNostrEvent stamps its own created_at, so
 * re-sign if the clock ticked between computing the tags and signing.
 */
export function buildOrderEvent(privHex: string, input: OrderInput): NostrEvent {
  if (!orderIdMatchesPubkey(input.orderId, getPublicKey(hexToBytes(privHex)))) {
    throw new Error('order id does not belong to this key');
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const createdAt = Math.floor(Date.now() / 1000);
    const ev = signNostrEvent(privHex, KIND_SHOP_ORDER, '', buildOrderTags(input, createdAt));
    if (ev.created_at === createdAt) return ev as NostrEvent;
  }
  throw new Error('could not stamp pay_by consistently');
}

/**
 * Cancel = NIP-33 republish of the SAME tags with status 'cancelled' and a
 * newer created_at (pay_by is kept from the original order).
 */
export function buildCancelEvent(privHex: string, originalTags: string[][]): NostrEvent {
  const tags = originalTags.map(t => (t[0] === 'status' ? ['status', 'cancelled'] : [...t]));
  const orderId = tags.find(t => t[0] === 'd')?.[1] || '';
  if (!orderIdMatchesPubkey(orderId, getPublicKey(hexToBytes(privHex)))) {
    throw new Error('order id does not belong to this key');
  }
  return signNostrEvent(privHex, KIND_SHOP_ORDER, '', tags) as NostrEvent;
}

// ─────────────────────────────────────────── KIND 36522

export interface DeliveryDetails {
  name: string;
  email?: string;
  phone?: string;
  address: { line1: string; line2?: string; city: string; postcode: string; country: string };
  note?: string;
  pickup_slot?: string;
}

export interface DeliveryInput {
  orderId: string;
  unitId: string;
  /** The SIGNED KIND 30901 of the unit, as returned by /api/orders/quote. */
  rawUnitEvent: NostrEvent;
  details: DeliveryDetails;
}

/**
 * Recipient hex MUST come from the verified 30901 — a bare hex in JSON could
 * be swapped by anyone between the mirror and the browser.
 */
export function recipientFromUnitEvent(rawUnitEvent: NostrEvent, unitId: string): string {
  if (!rawUnitEvent || rawUnitEvent.kind !== 30901) throw new Error('not a KIND 30901');
  // Verify a PLAIN copy: nostr-tools caches its verdict under a symbol that
  // survives object spread — never let a cached `true` vouch for this object.
  const plain = { id: rawUnitEvent.id, pubkey: rawUnitEvent.pubkey, created_at: rawUnitEvent.created_at, kind: rawUnitEvent.kind, tags: rawUnitEvent.tags, content: rawUnitEvent.content, sig: rawUnitEvent.sig };
  if (verifyEvent(plain as any) !== true) throw new Error('unit event signature invalid');
  const taggedUnit = rawUnitEvent.tags.find(t => t[0] === 'unit_id')?.[1] || rawUnitEvent.tags.find(t => t[0] === 'd')?.[1];
  if (taggedUnit !== unitId) throw new Error('unit event does not describe this unit');
  return rawUnitEvent.pubkey;
}

export function buildDeliveryEvent(privHex: string, input: DeliveryInput): NostrEvent {
  // This portal always sends e-mail and phone: the seller needs both to
  // confirm the order (lib/checkoutValidation). They stay optional at
  // protocol level (SPEC §4) — nobody downstream can check the ciphertext,
  // so the builder is where a caller that skips them gets stopped.
  if (!input.details?.email?.trim() || !input.details?.phone?.trim()) {
    throw new Error('delivery details need email and phone');
  }
  const recipient = recipientFromUnitEvent(input.rawUnitEvent, input.unitId);
  const buyerPriv = hexToBytes(privHex);
  const buyerPub = getPublicKey(buyerPriv);
  if (!orderIdMatchesPubkey(input.orderId, buyerPub)) throw new Error('order id does not belong to this key');
  const ck = nip44.v2.utils.getConversationKey(buyerPriv, recipient);
  const content = nip44.v2.encrypt(JSON.stringify({ v: 1, ...input.details }), ck);
  const tags: string[][] = [
    ['d', `${input.orderId}__${recipient}`],
    ['a', `36520:${buyerPub}:${input.orderId}`],
    ['p', recipient],
    ['unit_id', input.unitId],
    ['encryption', 'nip44'],
    ['v', '1'],
  ];
  return signNostrEvent(privHex, KIND_SHOP_DELIVERY, content, tags) as NostrEvent;
}

// ─────────────────────────────────────────── localStorage

function ls(): Storage | null {
  // window.localStorage explicitly: under vitest/jsdom on Node ≥ 22 a bare
  // `localStorage` can resolve to Node's experimental (methodless) global.
  try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; } catch { return null; }
}

export function saveOrderKey(orderId: string, privHex: string): void {
  try { ls()?.setItem(KEY_PREFIX + orderId, privHex); } catch {}
}

export function loadOrderKey(orderId: string): string | null {
  try {
    const v = ls()?.getItem(KEY_PREFIX + orderId) || null;
    return v && /^[0-9a-f]{64}$/.test(v) ? v : null;
  } catch { return null; }
}

export function deleteOrderKey(orderId: string): void {
  try { ls()?.removeItem(KEY_PREFIX + orderId); } catch {}
}

/** Buyer pubkey B of an order placed from THIS browser (null elsewhere). */
export function pubkeyForOrderKey(orderId: string): string | null {
  const priv = loadOrderKey(orderId);
  if (!priv) return null;
  try { return getPublicKey(hexToBytes(priv)); } catch { return null; }
}

export interface StoredOrder {
  orderId: string;
  unitId: string;
  unitName: string;
  /** First item (orders stored before the cart have only this). */
  title: string;
  qty: number;
  /** Every item of the order (cart orders); absent on older entries. */
  items?: Array<{ title: string; qty: number }>;
  total: string;
  currency: string;
  /** unix seconds of the 36520 */
  createdAt: number;
  payUrl?: string;
  /** The signed 36520's tags (no PII by protocol) — needed to republish a cancel. */
  tags: string[][];
}

export function listStoredOrders(): StoredOrder[] {
  try {
    const raw = ls()?.getItem(ORDERS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(o => o && typeof o.orderId === 'string') : [];
  } catch { return []; }
}

function writeStoredOrders(list: StoredOrder[]): void {
  try { ls()?.setItem(ORDERS_KEY, JSON.stringify(list.slice(0, MAX_STORED_ORDERS))); } catch {}
}

export function rememberOrder(o: StoredOrder): void {
  const list = listStoredOrders().filter(x => x.orderId !== o.orderId);
  list.unshift(o);
  writeStoredOrders(list);
}

export function getStoredOrder(orderId: string): StoredOrder | null {
  return listStoredOrders().find(o => o.orderId === orderId) || null;
}

/** Drop keys (and list entries) older than the 30-day TTL. */
export function pruneExpiredOrders(now = Math.floor(Date.now() / 1000)): void {
  const list = listStoredOrders();
  const keep: StoredOrder[] = [];
  for (const o of list) {
    if (now - (o.createdAt || 0) > KEY_TTL_SEC) deleteOrderKey(o.orderId);
    else keep.push(o);
  }
  if (keep.length !== list.length) writeStoredOrders(keep);
}
