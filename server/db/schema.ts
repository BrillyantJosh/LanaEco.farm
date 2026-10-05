import Database from 'better-sqlite3';

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kind_38888 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      split TEXT,
      exchange_rates TEXT,
      electrum_servers TEXT,
      relays TEXT,
      trusted_signers TEXT,
      version TEXT,
      valid_from INTEGER,
      split_target_lana INTEGER DEFAULT 0,
      split_started_at INTEGER DEFAULT 0,
      split_ends_at INTEGER DEFAULT 0,
      split_approaching INTEGER DEFAULT 0,
      freeze_lana_retail_account_above INTEGER DEFAULT 0,
      raw_event TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS heartbeat_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      events_fetched INTEGER DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS business_units (
      pubkey TEXT NOT NULL,
      unit_id TEXT NOT NULL,
      event_id TEXT,
      event_created_at INTEGER NOT NULL,
      parsed_json TEXT NOT NULL,
      raw_event TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (pubkey, unit_id)
    );
    CREATE INDEX IF NOT EXISTS idx_units_created ON business_units(event_created_at DESC);

    CREATE TABLE IF NOT EXISTS listings (
      pubkey TEXT NOT NULL,
      listing_id TEXT NOT NULL,
      unit_id TEXT,
      event_id TEXT,
      event_created_at INTEGER NOT NULL,
      parsed_json TEXT NOT NULL,
      raw_event TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (pubkey, listing_id)
    );
    CREATE INDEX IF NOT EXISTS idx_listings_unit ON listings(unit_id);
    CREATE INDEX IF NOT EXISTS idx_listings_created ON listings(event_created_at DESC);

    CREATE TABLE IF NOT EXISTS fee_policies (
      unit_id TEXT PRIMARY KEY,
      event_id TEXT,
      event_created_at INTEGER NOT NULL,
      lana_discount_per REAL,
      status TEXT,
      raw_event TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      owner_pubkey TEXT,
      signer TEXT,
      d_tag TEXT
    );

    CREATE TABLE IF NOT EXISTS global_suspensions (
      unit_id TEXT PRIMARY KEY,
      event_id TEXT,
      event_created_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      active_until INTEGER,
      raw_event TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      owner_pubkey TEXT,
      signer TEXT,
      d_tag TEXT
    );

    CREATE TABLE IF NOT EXISTS local_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,
      target_pubkey TEXT NOT NULL,
      target_id TEXT,
      blocked_by_hex TEXT NOT NULL,
      reason TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(target_type, target_pubkey, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_blocks_target ON local_blocks(target_pubkey, target_type);

    CREATE TABLE IF NOT EXISTS sync_state (
      kind INTEGER PRIMARY KEY,
      last_synced_at INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER NOT NULL DEFAULT 0,
      events_seen INTEGER NOT NULL DEFAULT 0
    );

    -- Tombstones for KIND 5 (NIP-09) deletions of replaceable events.
    -- liveSync writes one row per (kind, pubkey, d_tag) when it sees a KIND 5
    -- deletion referencing that replaceable address. Upsert paths check this
    -- table and skip events whose created_at <= tombstone_created_at, so a
    -- late-arriving target event can't resurrect a deleted row.
    CREATE TABLE IF NOT EXISTS tombstones (
      kind INTEGER NOT NULL,
      pubkey TEXT NOT NULL,
      d_tag TEXT NOT NULL,
      tombstone_created_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (kind, pubkey, d_tag)
    );
    CREATE INDEX IF NOT EXISTS idx_tombstones_pubkey ON tombstones(pubkey);

    CREATE TABLE IF NOT EXISTS local_features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,        -- 'provider' | 'listing'
      target_pubkey TEXT NOT NULL,
      target_id TEXT,                   -- unit_id (provider) or listing_id (listing)
      feature_type TEXT NOT NULL,       -- 'top' | 'new'
      featured_by_hex TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(target_type, target_pubkey, target_id, feature_type)
    );
    CREATE INDEX IF NOT EXISTS idx_features_target ON local_features(target_pubkey, target_type);

    -- Lana Online Shop (SPEC §9.3). One row per order id: the buyer-signed
    -- KIND 36520 side, the newest merchant-signed KIND 36521 side, and the
    -- resolver verdict (recomputed whenever either side or a 30933 lands).
    -- NO PII: 36522 (delivery details) is never subscribed to nor stored here.
    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      buyer_pubkey TEXT NOT NULL,
      unit_id TEXT NOT NULL,
      order_event_id TEXT,
      order_created_at INTEGER NOT NULL DEFAULT 0,
      order_json TEXT NOT NULL,
      order_raw TEXT,
      fulfillment_event_id TEXT,
      fulfillment_pubkey TEXT,
      fulfillment_created_at INTEGER NOT NULL DEFAULT 0,
      fulfillment_json TEXT,
      fulfillment_raw TEXT,
      payment_state TEXT NOT NULL DEFAULT 'unpaid',
      effective_status TEXT,
      expected_total TEXT,
      price_changed INTEGER NOT NULL DEFAULT 0,
      paid_tx_id TEXT,
      paid_event_id TEXT,
      paid_at INTEGER,
      paid_amount TEXT,
      paid_lana_amount TEXT,
      paid_tx_hash TEXT,
      -- the 36520 event id the 'paid' verdict was reached for (SPEC §8 step 5a)
      paid_order_event_id TEXT,
      local_status TEXT,
      pay_url TEXT,
      session_id TEXT,
      expires_at TEXT,
      broker_checked_at INTEGER NOT NULL DEFAULT 0,
      resolved_at INTEGER NOT NULL DEFAULT 0,
      fetched_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_unit ON orders(unit_id);
    CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_pubkey);

    -- Brain-signed KIND 30933 mirror, join tags only. NIP-33 identity is
    -- (pubkey, d == tx id); newest created_at wins (brain republishes only
    -- on cancel). Author must be a KIND 38888 trusted signer.
    CREATE TABLE IF NOT EXISTS purchases_30933 (
      pubkey TEXT NOT NULL,
      tx_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_created_at INTEGER NOT NULL,
      unit_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      parsed_json TEXT NOT NULL,
      raw_event TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (pubkey, tx_id)
    );
    CREATE INDEX IF NOT EXISTS idx_purchases_invoice ON purchases_30933(unit_id, invoice_number);
  `);

  // Migration: KIND 38888 v3 fields (split_approaching + retail wallet freeze threshold)
  try { db.exec(`ALTER TABLE kind_38888 ADD COLUMN split_approaching INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE kind_38888 ADD COLUMN freeze_lana_retail_account_above INTEGER DEFAULT 0`); } catch {}

  // KIND 30902 / 30903 rows record the owner their `a` tag names (joins go by
  // owner + unit id), the key that signed them (only it may delete them) and
  // their d tag (what a NIP-09 `a` deletion addresses). Databases created
  // before these columns get them here; liveSync's migrateRegistryRows fills
  // them in for rows mirrored earlier.
  for (const table of ['fee_policies', 'global_suspensions']) {
    const have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name));
    for (const col of ['owner_pubkey', 'signer', 'd_tag']) {
      if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`);
    }
  }

  // A 'paid' verdict remembers WHICH 36520 event it was reached for (SPEC §8
  // step 5a): a later listing or shipping-fee change must not turn that paid
  // order into amount_mismatch, while a replaced order is judged afresh.
  // Every write of order_event_id (orderJoin.upsertOrderEvent) recomputes the
  // verdict in the same call, so a row that is 'paid' now was judged paid for
  // the event id it holds now — that is what the one-time fill records.
  const orderCols = new Set((db.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>).map(c => c.name));
  if (!orderCols.has('paid_order_event_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN paid_order_event_id TEXT');
    db.exec("UPDATE orders SET paid_order_event_id = order_event_id WHERE payment_state = 'paid' AND paid_event_id IS NOT NULL");
  }

  // SPEC v1.1.2 step 5a: the settled memory, apart from the current verdict.
  // paid_* follow every verdict, so an order judged while its shop was
  // missing from the mirror lost its pin and came back as amount_mismatch
  // when the 30901 returned. settled_* name the PURCHASE (tx id + amount)
  // that settled the 36520 event settled_order_event_id; orderJoin keeps
  // them through an unknown unit and clears them on any other non-paid
  // verdict.
  //
  // NOTHING is copied into them from the 'paid' verdicts already stored
  // (third review 2 Oct 2026): those were reached by the older rules, which
  // priced an item whose listing the mirror did not know at the BUYER's own
  // unit_price — a replacement 36520 naming an unknown listing at the buyer's
  // price was 'paid'. A pin carried over from them would keep such an order
  // paid forever (SPEC §8 5a: the pin never pays what step 5 did not pay
  // first). orderJoin.rejudgeLegacyPaidOrders judges every such row again by
  // step 5 alone at start-up; the ones it pays get settled_*, the others are
  // listed in order_settle_review.
  if (!orderCols.has('settled_tx_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN settled_tx_id TEXT');
    db.exec('ALTER TABLE orders ADD COLUMN settled_amount TEXT');
    db.exec('ALTER TABLE orders ADD COLUMN settled_order_event_id TEXT');
  }

  // Orders the older rules had judged 'paid' and SPEC v1.1.2 step 5 does
  // not pay (for Brilly to look at — never paid by this table). cleared_at is
  // set when a later verdict pays the order after all (e.g. its listing or
  // shop came back to the mirror). No buyer data: ids and amounts only.
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_settle_review (
      order_id TEXT PRIMARY KEY,
      order_event_id TEXT,
      old_paid_tx_id TEXT,
      old_paid_amount TEXT,
      verdict TEXT NOT NULL,
      expected_total TEXT,
      listed_at INTEGER NOT NULL,
      cleared_at INTEGER
    );
  `);
  // Round 3 (2 Oct 2026). reason: 'step5_not_paid' — step 5 did not pay it
  // (repriced, off sale, deleted, other shipping or pickup terms, or a
  // buyer's replacement); 'listing_kind_not_mirrored' — an item names a
  // listing kind this portal does not subscribe to (another portal's order),
  // so it cannot be judged here at all and is not suspicious. confirmed_at:
  // when Brilly confirmed the entry as honest (orderJoin.confirmSettleReview —
  // the purchase it was paid with became the step-5a pin of exactly that
  // 36520 event).
  //
  // Round 5 (5 Oct 2026): not only older 'paid' verdicts. An order of this
  // code whose verified 30933 pays exactly the order's own total but whose
  // verdict is amount_mismatch is listed too: 'not_computable' (a listing or
  // the shop is unknown, off sale or does not offer the fulfilment) or
  // 'terms_mismatch' (computable, but neither today's terms nor the ones
  // seen for that event give that total). old_paid_tx_id / old_paid_amount
  // then name that candidate 30933. Cleared when the order is paid or no
  // candidate 30933 is left.
  const reviewCols = new Set((db.prepare('PRAGMA table_info(order_settle_review)').all() as Array<{ name: string }>).map(c => c.name));
  if (!reviewCols.has('reason')) db.exec(`ALTER TABLE order_settle_review ADD COLUMN reason TEXT NOT NULL DEFAULT 'step5_not_paid'`);
  if (!reviewCols.has('confirmed_at')) db.exec('ALTER TABLE order_settle_review ADD COLUMN confirmed_at INTEGER');

  // Round 4 (2 Oct 2026): the last MERCHANT-signed price this mirror saw for
  // a listing while judging one exact 36520 event. Round 5 (5 Oct 2026): no
  // longer read or written — a price seen alone, without the shop's shipping
  // and pickup terms of the same moment, kept an honest order stuck when the
  // shop changed those terms before the 30933 was seen (order_terms_seen
  // replaces it). Kept so a rollback finds the table it expects.
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_listing_prices (
      order_event_id TEXT NOT NULL,
      item_a TEXT NOT NULL,
      price TEXT NOT NULL,
      listing_created_at INTEGER NOT NULL,
      seen_at INTEGER NOT NULL,
      PRIMARY KEY (order_event_id, item_a)
    );
  `);

  // Round 5 (5 Oct 2026), F3/F4: the merchant's terms under which ONE exact
  // 36520 event was correct to the cent — the shop's shipping fee,
  // free-shipping threshold and pickup offer, and every item's listing price
  // (prices_json: { "<item a>": "<price>" }). Keyed by the event id, never by
  // the order id: a buyer's replacement is another event and has its own row
  // only if IT matched the merchant's terms. Written once (INSERT … ON
  // CONFLICT DO NOTHING) by orderJoin.recomputeOrder, the first time this
  // mirror sees that event with every listing on sale, the shop known and
  // the order's own numbers equal to the ones those terms give. The verdict
  // tries these terms only when today's give amount_mismatch, and never for
  // an older-rules 'paid' (orderJoin.rejudgeLegacyPaidOrders): an honest
  // order then stays payable when the shop raises a price or the fee, drops
  // free shipping or turns pickup off before the 30933 is seen.
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_terms_seen (
      order_event_id TEXT PRIMARY KEY,
      shipping_fee TEXT NOT NULL,
      free_from TEXT,
      pickup INTEGER NOT NULL,
      unit_event_id TEXT,
      prices_json TEXT NOT NULL,
      total TEXT NOT NULL,
      seen_at INTEGER NOT NULL
    );
  `);

  // Round 5 (5 Oct 2026), F1: every event id a KIND 5 named in an `e` tag,
  // with the key that signed that KIND 5. A deletion that arrives before its
  // target still blocks it: when a 30901 or listing with this (author, id)
  // lands, liveSync writes a tombstone at its created_at and refuses it, so
  // neither it nor any older version of that address comes back. Only the
  // target's own author can match a row (author = the event's pubkey), so a
  // stranger's `e` names nothing.
  db.exec(`
    CREATE TABLE IF NOT EXISTS deleted_event_refs (
      author TEXT NOT NULL,
      event_id TEXT NOT NULL,
      deletion_created_at INTEGER NOT NULL,
      seen_at INTEGER NOT NULL,
      PRIMARY KEY (author, event_id)
    );
  `);
}
