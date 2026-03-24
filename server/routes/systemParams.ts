import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';

export function createSystemParamsRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const row = db.prepare(
      'SELECT * FROM kind_38888 ORDER BY id DESC LIMIT 1'
    ).get() as any;

    if (!row) {
      res.json({ status: 'pending', message: 'System parameters not yet loaded' });
      return;
    }

    res.json({
      event_id: row.event_id,
      split: row.split,
      exchange_rates: JSON.parse(row.exchange_rates || '{}'),
      electrum_servers: JSON.parse(row.electrum_servers || '[]'),
      relays: JSON.parse(row.relays || '[]'),
      trusted_signers: JSON.parse(row.trusted_signers || '{}'),
      version: row.version,
      valid_from: row.valid_from,
      split_target_lana: row.split_target_lana,
      split_started_at: row.split_started_at,
      split_ends_at: row.split_ends_at,
      updated_at: row.updated_at
    });
  });

  return router;
}
