/**
 * Heartbeat Engine for LanaEco.farm
 * Runs every 1 minute:
 * 1. Fetch KIND 38888 → system params (split, rates, relays)
 * Frequent refresh needed because exchange rates can change anytime.
 */

import Database from 'better-sqlite3';
import { fetchKind38888 } from './lib/nostr.js';

const HEARTBEAT_INTERVAL = 60 * 1000; // 1 minute

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

export async function runHeartbeat(db: Database.Database): Promise<void> {
  if (isRunning) {
    console.log('Heartbeat already running, skipping');
    return;
  }

  isRunning = true;
  const logId = db.prepare(
    "INSERT INTO heartbeat_logs (started_at) VALUES (datetime('now'))"
  ).run().lastInsertRowid;

  console.log('Heartbeat started');

  try {
    console.log('Fetching KIND 38888...');
    const systemParams = await fetchKind38888();

    if (!systemParams) {
      throw new Error('Failed to fetch KIND 38888 system parameters');
    }

    db.prepare(`
      INSERT INTO kind_38888 (event_id, split, exchange_rates, electrum_servers, relays, trusted_signers, version, valid_from, split_target_lana, split_started_at, split_ends_at, raw_event, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      systemParams.event_id,
      systemParams.split,
      JSON.stringify(systemParams.exchange_rates),
      JSON.stringify(systemParams.electrum_servers),
      JSON.stringify(systemParams.relays),
      JSON.stringify(systemParams.trusted_signers),
      systemParams.version,
      systemParams.valid_from,
      systemParams.split_target_lana || 0,
      systemParams.split_started_at || 0,
      systemParams.split_ends_at || 0,
      systemParams.raw_event
    );

    console.log(`KIND 38888: split=${systemParams.split}, EUR=${systemParams.exchange_rates.EUR}`);

    db.prepare(`
      UPDATE heartbeat_logs SET
        completed_at = datetime('now'),
        events_fetched = 1
      WHERE id = ?
    `).run(logId);

    console.log('Heartbeat completed successfully');

  } catch (error: any) {
    console.error('Heartbeat failed:', error);
    db.prepare(`
      UPDATE heartbeat_logs SET
        completed_at = datetime('now'),
        error = ?
      WHERE id = ?
    `).run(error.message || String(error), logId);
  } finally {
    isRunning = false;
  }
}

export function startHeartbeat(db: Database.Database): void {
  console.log('Starting heartbeat engine (interval: 1 min)');
  runHeartbeat(db);
  heartbeatTimer = setInterval(() => {
    runHeartbeat(db);
  }, HEARTBEAT_INTERVAL);
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log('Heartbeat stopped');
  }
}
