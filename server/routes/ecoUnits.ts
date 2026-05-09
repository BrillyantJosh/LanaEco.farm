import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';

const DEFAULT_CASHBACK = 5;
// Categories this portal serves. Units (and their listings) outside this set
// are excluded from the public API. Edit per portal.
const PORTAL_CATEGORIES = new Set(['producer','eco farm','eco farming','farmer']);

/**
 * GET /api/eco-units — read from local SQLite (populated by heartbeat).
 * Filters out globally suspended and locally provider-blocked units.
 */
export function createEcoUnitsRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    try {
      const now = Math.floor(Date.now() / 1000);

      const rows = db
        .prepare(
          `
          SELECT
            u.parsed_json,
            u.unit_id,
            u.pubkey,
            fp.lana_discount_per,
            fp.status AS fee_status,
            gs.unit_id AS suspended_unit_id,
            gs.status AS suspension_status,
            gs.active_until AS suspension_active_until
          FROM business_units u
          LEFT JOIN fee_policies fp ON fp.unit_id = u.unit_id
          LEFT JOIN global_suspensions gs ON gs.unit_id = u.unit_id
        `
        )
        .all() as any[];

      // Build set of locally blocked providers (provider-wide blocks)
      const providerBlocks = new Set<string>();
      const unitBlocks = new Set<string>();
      const blockRows = db
        .prepare(
          `SELECT target_type, target_pubkey, target_id FROM local_blocks
           WHERE target_type IN ('provider', 'unit')`
        )
        .all() as any[];
      for (const b of blockRows) {
        if (b.target_type === 'provider') providerBlocks.add(b.target_pubkey);
        else if (b.target_type === 'unit' && b.target_id)
          unitBlocks.add(`${b.target_pubkey}:${b.target_id}`);
      }

      // Map unit-level features (top/new) keyed by `${pubkey}:${unit_id}`
      type Feat = { type: string; createdAt: number };
      const unitFeatures = new Map<string, Feat>();
      const featureRows = db
        .prepare(
          `SELECT target_pubkey, target_id, feature_type, created_at FROM local_features
           WHERE target_type = 'unit' AND target_id IS NOT NULL`
        )
        .all() as any[];
      for (const f of featureRows) unitFeatures.set(`${f.target_pubkey}:${f.target_id}`, { type: f.feature_type, createdAt: f.created_at || 0 });

      const units: any[] = [];
      for (const r of rows) {
        if (
          r.suspended_unit_id &&
          r.suspension_status === 'suspended' &&
          (!r.suspension_active_until || r.suspension_active_until > now)
        ) {
          continue;
        }
        if (providerBlocks.has(r.pubkey)) continue;
        if (unitBlocks.has(`${r.pubkey}:${r.unit_id}`)) continue;

        let parsed: any;
        try {
          parsed = JSON.parse(r.parsed_json);
        } catch {
          continue;
        }
        if (parsed.status && parsed.status !== 'active') continue;
        if (!parsed.name) continue;
        // Portal category filter — only show units that match this portal's categories
        if (!PORTAL_CATEGORIES.has(String(parsed.category || '').trim().toLowerCase())) continue;

        const cashback =
          r.fee_status === 'active' &&
          r.lana_discount_per > 0 &&
          r.lana_discount_per <= 20
            ? r.lana_discount_per
            : DEFAULT_CASHBACK;

        const unitFeat = unitFeatures.get(`${r.pubkey}:${r.unit_id}`) || null;
        units.push({
          ...parsed,
          cashbackPercent: cashback,
          featured: unitFeat?.type || null,
          featuredAt: unitFeat?.createdAt || 0,
        });
      }

      const categoryFilter = String(req.query.category || '');
      let result = units;
      if (categoryFilter) {
        const cats = categoryFilter
          .split(',')
          .map((c) => c.trim().toLowerCase());
        result = units.filter((u) =>
          cats.includes(String(u.category || '').toLowerCase())
        );
      }

      // Sort: TOP first, NEW second, feature-recency (most-recently-marked wins
      // among same TOP/NEW), then cashback desc, then alphabetical name
      const featureRank = (f: string | null) => (f === 'new' ? 0 : f === 'top' ? 1 : 2);
      result.sort((a, b) => {
        const fa = featureRank(a.featured);
        const fb = featureRank(b.featured);
        if (fa !== fb) return fa - fb;
        if (a.featured && b.featured) {
          const fta = a.featuredAt || 0;
          const ftb = b.featuredAt || 0;
          if (ftb !== fta) return ftb - fta;
        }
        const ca = a.cashbackPercent || DEFAULT_CASHBACK;
        const cb = b.cashbackPercent || DEFAULT_CASHBACK;
        if (cb !== ca) return cb - ca;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });

      res.json(result);
    } catch (error) {
      console.error('Failed to fetch eco units:', error);
      res.json([]);
    }
  });

  return router;
}
