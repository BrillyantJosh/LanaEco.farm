/**
 * Signed-event fixtures for the server tests: the registry and the mirror
 * (ported with lanaeco-shop 74ba516 / f1d100d) and the Lana Online Shop
 * (ported 5 Oct 2026). Every event is a REAL Nostr event (finalizeEvent), so
 * the same code paths that verify production relay traffic run in the tests.
 * Units are in this portal's category and listings of this portal's listing
 * kind (./portal.ts: KIND 36500 on lanaeco.farm).
 */
import Database from 'better-sqlite3';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { initializeSchema } from '../db/schema.js';
import type { NostrEvent } from '../lib/relaySync.js';
import { CATEGORY, LISTING_KIND } from './portal.js';

export interface Key { sk: Uint8Array; pk: string }

export function key(): Key {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
}

export function signed(k: Key, kind: number, tags: string[][], content = '', created_at?: number): NostrEvent {
  return finalizeEvent({ kind, tags, content, created_at: created_at ?? Math.floor(Date.now() / 1000) }, k.sk) as NostrEvent;
}

export function makeDb(): Database.Database {
  const db = new Database(':memory:');
  initializeSchema(db);
  return db;
}

/** The KIND 38888 row liveSync would have saved, with `trusted` in the LanaPaysUs group. */
export function seed38888(db: Database.Database, trusted: string[], relays: string[] = []): void {
  db.prepare(`
    INSERT OR REPLACE INTO kind_38888 (id, event_id, split, exchange_rates, electrum_servers, relays, trusted_signers, version, valid_from, raw_event)
    VALUES (1, 'ev38888', '', '{}', '[]', ?, ?, '1', 0, '{}')
  `).run(JSON.stringify(relays), JSON.stringify({ LanaPaysUs: trusted }));
}

export const UNIT_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
export const LISTING_ID = 'lst-apples';

export interface UnitOpts {
  unitId?: string;
  name?: string;
  currency?: string;
  category?: string;
  status?: string;
  onlineShop?: boolean | 'absent';
  fee?: string;
  pickup?: boolean;
  freeFrom?: string;
  staff?: string[];
  ownerHexTag?: string;
  created_at?: number;
}

/** KIND 30901 in this portal's category; online selling on unless `onlineShop` says otherwise. */
export function unitEvent(owner: Key, o: UnitOpts = {}): NostrEvent {
  const unitId = o.unitId ?? UNIT_ID;
  const tags: string[][] = [
    ['d', unitId],
    ['unit_id', unitId],
    ['name', o.name ?? 'Test Shop'],
    ['owner_hex', o.ownerHexTag ?? owner.pk],
    ['currency', o.currency ?? 'EUR'],
    ['category', o.category ?? CATEGORY],
    ['status', o.status ?? 'active'],
    ['country', 'SI'],
  ];
  if (o.onlineShop !== 'absent') tags.push(['online_shop', o.onlineShop === false ? 'false' : 'true']);
  if (o.fee !== undefined) tags.push(['online_shop_shipping_fee', o.fee]);
  if (o.pickup !== undefined) tags.push(['online_shop_pickup', o.pickup ? 'true' : 'false']);
  if (o.freeFrom !== undefined) tags.push(['online_shop_free_shipping_from', o.freeFrom]);
  for (const s of o.staff ?? []) tags.push(['p', s]);
  return signed(owner, 30901, tags, '', o.created_at);
}

/**
 * KIND 30903 as the registrar publishes it: `a` names the unit it rules on
 * (30901:<owner>:<unit id>). `processor` must be a trusted signer (seed38888).
 */
export function suspensionEvent(processor: Key, owner: Key, unitId = UNIT_ID, status = 'active', created_at?: number): NostrEvent {
  return signed(processor, 30903, [
    ['d', unitId], ['unit_id', unitId], ['a', `30901:${owner.pk}:${unitId}`], ['status', status],
  ], '', created_at);
}

/** KIND 30902 as the registrar publishes it: d = policy_<unit8>_<quarter>, `a` names the unit. */
export function feePolicyEvent(processor: Key, owner: Key, percent: string, unitId = UNIT_ID, created_at?: number): NostrEvent {
  return signed(processor, 30902, [
    ['d', `policy_${unitId.slice(0, 8)}_2026Q3`], ['unit_id', unitId], ['a', `30901:${owner.pk}:${unitId}`],
    ['lana_discount_per', percent], ['status', 'active'],
  ], '', created_at);
}

export interface ListingOpts {
  listingId?: string;
  unitId?: string;
  /** `a` tag; default 30901:<owner>:<unit id>. */
  a?: string;
  price?: string;
  currency?: string;
  stock?: string;
  minOrder?: string;
  maxOrder?: string;
  status?: string;
  title?: string;
  unit?: string;
  /** `delivery` tags, one per value (KIND 36500); absent = no tag. */
  delivery?: string[];
  created_at?: number;
}

/** A listing of this portal's kind (LISTING_KIND) on the owner's unit. */
export function listingEvent(owner: Key, o: ListingOpts = {}): NostrEvent {
  const tags: string[][] = [
    ['d', o.listingId ?? LISTING_ID],
    ['a', o.a ?? `30901:${owner.pk}:${o.unitId ?? UNIT_ID}`],
    ['title', o.title ?? 'Jabolka'],
    ['type', 'product'],
    ['price', o.price ?? '5.00', o.currency ?? 'EUR'],
    ['unit', o.unit ?? 'kg'],
    ['status', o.status ?? 'active'],
  ];
  if (o.stock !== undefined) tags.push(['stock', o.stock]);
  if (o.minOrder !== undefined) tags.push(['min_order', o.minOrder]);
  if (o.maxOrder !== undefined) tags.push(['max_order', o.maxOrder]);
  for (const d of o.delivery ?? []) tags.push(['delivery', d]);
  return signed(owner, LISTING_KIND, tags, 'opis', o.created_at);
}

export function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

export function orderIdFor(buyer: Key): string {
  return buyer.pk.slice(0, 24) + '.' + randomHex(16);
}

export interface OrderOpts {
  orderId: string;
  ownerHex: string;
  unitId?: string;
  itemA: string;
  qty?: string;
  saleUnit?: string;
  unitPrice?: string;
  currency?: string;
  shipping?: string;
  total?: string;
  fulfillment?: string;
  status?: string;
  client?: string;
  created_at?: number;
  payBy?: number;
  supersedes?: string;
  content?: string;
  v?: string;
  /** SPEC v1.1.0 cart: the full list of `item` tags (replaces the single default item). */
  items?: string[][];
}

/** KIND 36520 with the SPEC §2 tag order. */
export function orderEvent(buyer: Key, o: OrderOpts): NostrEvent {
  const created_at = o.created_at ?? Math.floor(Date.now() / 1000);
  const cur = o.currency ?? 'EUR';
  const tags: string[][] = [
    ['d', o.orderId],
    ['a', `30901:${o.ownerHex}:${o.unitId ?? UNIT_ID}`],
    ['p', o.ownerHex],
    ['unit_id', o.unitId ?? UNIT_ID],
    ['invoice_number', o.orderId],
    ...(o.items ?? [['item', o.itemA, o.qty ?? '2', o.saleUnit ?? 'kg', o.unitPrice ?? '5.00', cur]]),
    ['shipping', o.shipping ?? '2.50', cur],
    ['total', o.total ?? '12.50', cur],
    ['fulfillment', o.fulfillment ?? 'shipping'],
    ['status', o.status ?? 'placed'],
    ['pay_by', String(o.payBy ?? created_at + 1800)],
    ['client', o.client ?? 'localhost:5173'],
    ['v', o.v ?? '1'],
  ];
  if (o.supersedes) tags.push(['supersedes', o.supersedes]);
  return signed(buyer, 36520, tags, o.content ?? '', created_at);
}

export const PII = {
  name: 'Janez Novak',
  email: 'janez@example.com',
  phone: '+38640111222',
  address: { line1: 'Trubarjeva 7', city: 'Ljubljana', postcode: '1000', country: 'SI' },
  note: 'pozvoni dvakrat',
};

/** KIND 36522 — NIP-44 v2 ciphertext for the recipient. */
export function deliveryEvent(buyer: Key, orderId: string, recipientHex: string, unitId = UNIT_ID, details: unknown = PII, overrides: Partial<{ d: string; p: string; a: string }> = {}): NostrEvent {
  const ck = nip44.v2.utils.getConversationKey(buyer.sk, recipientHex);
  const content = nip44.v2.encrypt(JSON.stringify({ v: 1, ...(details as object) }), ck);
  return signed(buyer, 36522, [
    ['d', overrides.d ?? `${orderId}__${recipientHex}`],
    ['a', overrides.a ?? `36520:${buyer.pk}:${orderId}`],
    ['p', overrides.p ?? recipientHex],
    ['unit_id', unitId],
    ['encryption', 'nip44'],
    ['v', '1'],
  ], content);
}

export interface PurchaseOpts {
  txId?: string;
  unitId?: string;
  invoiceNumber: string;
  receiptDescription: string;
  amount?: string;
  currency?: string;
  lanaAmount?: string;
  paymentType?: string;
  status?: string;
  customerHex?: string;
  created_at?: number;
}

/** KIND 30933 with the brain's tag list (orchestrator.ts). */
export function purchaseEvent(brain: Key, o: PurchaseOpts): NostrEvent {
  const customer = o.customerHex ?? '9'.repeat(64);
  return signed(brain, 30933, [
    ['d', o.txId ?? randomHex(16)],
    ['p', customer],
    ['unit_id', o.unitId ?? UNIT_ID],
    ['payment_type', o.paymentType ?? 'lana'],
    ['customer_hex', customer],
    ['customer_wallet', 'Ltestwallet'],
    ['merchant_hex', 'm'.repeat(64)],
    ['amount', o.amount ?? '12.50'],
    ['currency', o.currency ?? 'EUR'],
    ['exchange_rate', '0.001'],
    ['lana_amount', o.lanaAmount ?? '12500'],
    ['status', o.status ?? 'processing'],
    ['invoice_number', o.invoiceNumber],
    ['receipt_description', o.receiptDescription],
  ], '', o.created_at);
}

export function fulfillmentEvent(signer: Key, o: { orderId: string; buyerPubkey: string; ownerHex: string; unitId?: string; status: string; paymentRef?: string; carrier?: string; tracking?: string; created_at?: number }): NostrEvent {
  const tags: string[][] = [
    ['d', o.orderId],
    ['a', `36520:${o.buyerPubkey}:${o.orderId}`],
    ['a', `30901:${o.ownerHex}:${o.unitId ?? UNIT_ID}`],
    ['p', o.buyerPubkey],
    ['unit_id', o.unitId ?? UNIT_ID],
    ['status', o.status],
  ];
  if (o.paymentRef) tags.push(['payment', o.paymentRef]);
  if (o.carrier) tags.push(['carrier', o.carrier]);
  if (o.tracking) tags.push(['tracking', o.tracking]);
  tags.push(['v', '1']);
  return signed(signer, 36521, tags, '', o.created_at);
}

/** KIND 5 (NIP-09) naming addresses by `a` and/or events by `e`. */
export function deletionEvent(signer: Key, targets: { a?: string; e?: string }[], created_at?: number): NostrEvent {
  const tags: string[][] = [];
  for (const t of targets) {
    if (t.a) tags.push(['a', t.a]);
    if (t.e) tags.push(['e', t.e]);
  }
  return signed(signer, 5, tags, '', created_at);
}

/** Dump every text column of every table — used to prove NO PII reached the DB. */
export function dumpDb(db: Database.Database): string {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>;
  const out: string[] = [];
  for (const t of tables) {
    const rows = db.prepare(`SELECT * FROM "${t.name}"`).all();
    out.push(JSON.stringify(rows));
  }
  return out.join('\n');
}

/** The same event with a signature that no longer matches it. */
export function brokenSig(ev: NostrEvent): NostrEvent {
  const flip = ev.sig[0] === '0' ? '1' : '0';
  return { ...ev, sig: flip + ev.sig.slice(1) };
}

/** Same id and sig, different tags — what a lying relay would send. */
export function tampered(ev: NostrEvent, tags: string[][]): NostrEvent {
  return { id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags, content: ev.content, sig: ev.sig };
}
