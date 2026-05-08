/**
 * Admin routes — local moderation (per-portal block list).
 *
 * Auth: client sends `X-Admin-Hex` header with logged-in Nostr hex ID.
 * Server checks against ADMIN_HEXES whitelist.
 */

import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';

export const ADMIN_HEXES = [
  '16a970069d63ca1f739c4e3b9a5f34bca6a93ead182dbf1e438a801aa03f4ef3',
  '56e8670aa65491f8595dc3a71c94aa7445dcdca755ca5f77c07218498a362061',
];

interface AdminRequest extends Request {
  adminHex?: string;
}

function requireAdmin(req: AdminRequest, res: Response, next: NextFunction) {
  const headerVal = req.headers['x-admin-hex'];
  const adminHex = (
    Array.isArray(headerVal) ? headerVal[0] : headerVal || ''
  ).toLowerCase();
  if (!adminHex || !ADMIN_HEXES.includes(adminHex)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  req.adminHex = adminHex;
  next();
}

export function createAdminRouter(db: Database.Database): Router {
  const router = Router();

  // GET /api/admin/check?hex=... — public endpoint to check if a hex is admin
  router.get('/check', (req: Request, res: Response) => {
    const hex = String(req.query.hex || '').toLowerCase();
    res.json({ isAdmin: !!hex && ADMIN_HEXES.includes(hex) });
  });

  // GET /api/admin/me — admin-only sanity check
  router.get('/me', requireAdmin, (req: AdminRequest, res: Response) => {
    res.json({ hex: req.adminHex, isAdmin: true });
  });

  // GET /api/admin/units — all units with block + suspension + feature status
  router.get('/units', requireAdmin, (req: Request, res: Response) => {
    const rows = db
      .prepare(
        `
        SELECT
          u.parsed_json, u.unit_id, u.pubkey, u.event_created_at,
          gs.status AS suspension_status,
          gs.reason AS suspension_reason,
          gs.active_until AS suspension_active_until,
          (SELECT id FROM local_blocks lb
           WHERE lb.target_type='provider' AND lb.target_pubkey=u.pubkey AND lb.target_id IS NULL
           LIMIT 1) AS block_id,
          (SELECT id FROM local_blocks lb
           WHERE lb.target_type='unit' AND lb.target_pubkey=u.pubkey AND lb.target_id=u.unit_id
           LIMIT 1) AS unit_block_id,
          (SELECT id FROM local_features lf
           WHERE lf.target_type='unit' AND lf.target_pubkey=u.pubkey AND lf.target_id=u.unit_id AND lf.feature_type='top'
           LIMIT 1) AS top_feature_id,
          (SELECT id FROM local_features lf
           WHERE lf.target_type='unit' AND lf.target_pubkey=u.pubkey AND lf.target_id=u.unit_id AND lf.feature_type='new'
           LIMIT 1) AS new_feature_id
        FROM business_units u
        LEFT JOIN global_suspensions gs ON gs.unit_id = u.unit_id
        ORDER BY u.event_created_at DESC
      `
      )
      .all() as any[];
    const result = rows.map((r) => {
      let parsed: any = {};
      try { parsed = JSON.parse(r.parsed_json); } catch {}
      return {
        ...parsed,
        eventCreatedAt: r.event_created_at,
        globalSuspension: r.suspension_status === 'suspended'
          ? { reason: r.suspension_reason, activeUntil: r.suspension_active_until }
          : null,
        localBlockId: r.block_id || null,
        unitBlockId: r.unit_block_id || null,
        topFeatureId: r.top_feature_id || null,
        newFeatureId: r.new_feature_id || null,
      };
    });
    res.json(result);
  });

  // GET /api/admin/listings — all listings with block + suspension + feature status
  router.get('/listings', requireAdmin, (req: Request, res: Response) => {
    const rows = db
      .prepare(
        `
        SELECT
          l.parsed_json, l.unit_id, l.pubkey, l.listing_id, l.event_created_at,
          (SELECT id FROM local_blocks lb
           WHERE lb.target_type='listing' AND lb.target_pubkey=l.pubkey AND lb.target_id=l.listing_id
           LIMIT 1) AS listing_block_id,
          (SELECT id FROM local_blocks lb
           WHERE lb.target_type='provider' AND lb.target_pubkey=l.pubkey AND lb.target_id IS NULL
           LIMIT 1) AS provider_block_id,
          (SELECT id FROM local_features lf
           WHERE lf.target_type='listing' AND lf.target_pubkey=l.pubkey AND lf.target_id=l.listing_id AND lf.feature_type='top'
           LIMIT 1) AS top_feature_id,
          (SELECT id FROM local_features lf
           WHERE lf.target_type='listing' AND lf.target_pubkey=l.pubkey AND lf.target_id=l.listing_id AND lf.feature_type='new'
           LIMIT 1) AS new_feature_id,
          gs.status AS suspension_status
        FROM listings l
        LEFT JOIN global_suspensions gs ON gs.unit_id = l.unit_id
        ORDER BY l.event_created_at DESC
      `
      )
      .all() as any[];
    const result = rows.map((r) => {
      let parsed: any = {};
      try { parsed = JSON.parse(r.parsed_json); } catch {}
      return {
        ...parsed,
        eventCreatedAt: r.event_created_at,
        globallySuspended: r.suspension_status === 'suspended',
        localBlockId: r.listing_block_id || null,
        providerBlockId: r.provider_block_id || null,
        topFeatureId: r.top_feature_id || null,
        newFeatureId: r.new_feature_id || null,
      };
    });
    res.json(result);
  });

  // POST /api/admin/feature — set top/new feature on unit or listing
  router.post('/feature', requireAdmin, (req: AdminRequest, res: Response) => {
    const { target_type, target_pubkey, target_id, feature_type } = req.body || {};
    if (target_type !== 'unit' && target_type !== 'listing') {
      return res.status(400).json({ error: 'target_type must be unit or listing' });
    }
    if (feature_type !== 'top' && feature_type !== 'new') {
      return res.status(400).json({ error: 'feature_type must be top or new' });
    }
    if (!target_pubkey || !/^[0-9a-f]{64}$/i.test(target_pubkey)) {
      return res.status(400).json({ error: 'invalid target_pubkey' });
    }
    if (!target_id) {
      return res.status(400).json({ error: `target_id required for ${target_type} features` });
    }
    try {
      const result = db
        .prepare(
          `INSERT INTO local_features (target_type, target_pubkey, target_id, feature_type, featured_by_hex, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(target_type, target_pubkey, target_id, feature_type) DO UPDATE SET
             featured_by_hex = excluded.featured_by_hex,
             created_at = excluded.created_at
           RETURNING id`
        )
        .get(
          target_type,
          target_pubkey.toLowerCase(),
          target_id,
          feature_type,
          req.adminHex,
          Math.floor(Date.now() / 1000)
        ) as any;
      res.json({ ok: true, id: result?.id });
    } catch (error: any) {
      console.error('Feature insert failed:', error);
      res.status(500).json({ error: error.message || 'insert failed' });
    }
  });

  // DELETE /api/admin/feature/:id — remove feature
  router.delete('/feature/:id', requireAdmin, (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    db.prepare('DELETE FROM local_features WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // GET /api/admin/blocks — list all active local blocks
  router.get('/blocks', requireAdmin, (_req: Request, res: Response) => {
    const rows = db
      .prepare(
        `SELECT id, target_type, target_pubkey, target_id, blocked_by_hex, reason, created_at
         FROM local_blocks
         ORDER BY created_at DESC`
      )
      .all();
    res.json(rows);
  });

  // POST /api/admin/block — create a new block
  router.post('/block', requireAdmin, (req: AdminRequest, res: Response) => {
    const { target_type, target_pubkey, target_id, reason } = req.body || {};
    if (target_type !== 'provider' && target_type !== 'listing' && target_type !== 'unit') {
      return res.status(400).json({ error: 'target_type must be provider, unit, or listing' });
    }
    if (!target_pubkey || !/^[0-9a-f]{64}$/i.test(target_pubkey)) {
      return res.status(400).json({ error: 'invalid target_pubkey' });
    }
    if ((target_type === 'listing' || target_type === 'unit') && !target_id) {
      return res.status(400).json({ error: `target_id required for ${target_type} blocks` });
    }
    if (target_type === 'listing' && !target_id) {
      return res.status(400).json({ error: 'target_id required for listing blocks' });
    }
    try {
      const result = db
        .prepare(
          `INSERT INTO local_blocks (target_type, target_pubkey, target_id, blocked_by_hex, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(target_type, target_pubkey, target_id) DO UPDATE SET
             blocked_by_hex = excluded.blocked_by_hex,
             reason = excluded.reason,
             created_at = excluded.created_at
           RETURNING id`
        )
        .get(
          target_type,
          target_pubkey.toLowerCase(),
          // listing & unit blocks store target_id; provider blocks do not
          target_type === 'provider' ? null : target_id,
          req.adminHex,
          reason || null,
          Math.floor(Date.now() / 1000)
        ) as any;
      res.json({ ok: true, id: result?.id });
    } catch (error: any) {
      console.error('Block insert failed:', error);
      res.status(500).json({ error: error.message || 'insert failed' });
    }
  });

  // DELETE /api/admin/block/:id — remove a block
  router.delete('/block/:id', requireAdmin, (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    db.prepare('DELETE FROM local_blocks WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  return router;
}
