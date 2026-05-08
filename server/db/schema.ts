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
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS global_suspensions (
      unit_id TEXT PRIMARY KEY,
      event_id TEXT,
      event_created_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      active_until INTEGER,
      raw_event TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
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
  `);
}
