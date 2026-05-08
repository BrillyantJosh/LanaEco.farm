import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';

const DEFAULT_CASHBACK = 5;

/**
 * GET /api/listings — read from local SQLite (populated by heartbeat).
 * Filters out:
 *   - listings whose unit is globally suspended (KIND 30903 with status='suspended' and not expired)
 *   - listings whose provider OR specific listing is locally blocked (admin moderation)
 *   - listings whose status != 'active'
 */
export function createListingsRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    try {
      const now = Math.floor(Date.now() / 1000);

      const rows = db
        .prepare(
          `
          SELECT
            l.parsed_json,
            l.unit_id,
            l.pubkey,
            l.listing_id,
            fp.lana_discount_per,
            fp.status AS fee_status,
            gs.unit_id AS suspended_unit_id,
            gs.status AS suspension_status,
            gs.active_until AS suspension_active_until
          FROM listings l
          LEFT JOIN fee_policies fp ON fp.unit_id = l.unit_id
          LEFT JOIN global_suspensions gs ON gs.unit_id = l.unit_id
          ORDER BY l.event_created_at DESC
        `
        )
        .all() as any[];

      // Build sets of locally blocked: provider-wide / unit-wide / specific-listing
      const providerBlocks = new Set<string>();
      const unitBlocks = new Set<string>();
      const listingBlocks = new Set<string>();
      const blockRows = db
        .prepare(
          `SELECT target_type, target_pubkey, target_id FROM local_blocks`
        )
        .all() as any[];
      for (const b of blockRows) {
        if (b.target_type === 'provider') {
          providerBlocks.add(b.target_pubkey);
        } else if (b.target_type === 'unit' && b.target_id) {
          unitBlocks.add(`${b.target_pubkey}:${b.target_id}`);
        } else if (b.target_type === 'listing' && b.target_id) {
          listingBlocks.add(`${b.target_pubkey}:${b.target_id}`);
        }
      }

      // Map features: unit-level (pubkey:unit_id) and listing-level (pubkey:listing_id)
      const unitFeatures = new Map<string, string>();
      const listingFeatures = new Map<string, string>();
      const featureRows = db
        .prepare(
          `SELECT target_type, target_pubkey, target_id, feature_type FROM local_features`
        )
        .all() as any[];
      for (const f of featureRows) {
        if (f.target_type === 'unit' && f.target_id) {
          unitFeatures.set(`${f.target_pubkey}:${f.target_id}`, f.feature_type);
        } else if (f.target_type === 'listing' && f.target_id) {
          listingFeatures.set(`${f.target_pubkey}:${f.target_id}`, f.feature_type);
        }
      }

      const listings: any[] = [];
      for (const r of rows) {
        // global suspension check
        if (
          r.suspended_unit_id &&
          r.suspension_status === 'suspended' &&
          (!r.suspension_active_until || r.suspension_active_until > now)
        ) {
          continue;
        }
        // local block check
        if (providerBlocks.has(r.pubkey)) continue;
        if (unitBlocks.has(`${r.pubkey}:${r.unit_id}`)) continue;
        if (listingBlocks.has(`${r.pubkey}:${r.listing_id}`)) continue;

        let parsed: any;
        try {
          parsed = JSON.parse(r.parsed_json);
        } catch {
          continue;
        }
        if (parsed.status && parsed.status !== 'active') continue;
        if (!parsed.title) continue;

        const cashback =
          r.fee_status === 'active' &&
          r.lana_discount_per > 0 &&
          r.lana_discount_per <= 20
            ? r.lana_discount_per
            : DEFAULT_CASHBACK;

        // Listing-level feature wins; otherwise inherit from the unit-level feature
        const listingFeat =
          listingFeatures.get(`${r.pubkey}:${r.listing_id}`) ||
          unitFeatures.get(`${r.pubkey}:${r.unit_id}`) ||
          null;

        listings.push({ ...parsed, cashbackPercent: cashback, featured: listingFeat });
      }

      res.json(applyFilters(listings, req.query));
    } catch (error) {
      console.error('Failed to fetch listings:', error);
      res.json([]);
    }
  });

  return router;
}

function applyFilters(listings: any[], query: any) {
  let result = [...listings];

  if (query.unit) {
    const unitRef = String(query.unit);
    result = result.filter(
      (l) =>
        (l.unitRef && l.unitRef.includes(unitRef)) ||
        l.unitRef?.split(':')[2] === unitRef
    );
  }

  if (query.type) {
    result = result.filter((l) => l.type === query.type);
  }

  if (query.t) {
    const t = String(query.t);
    result = result.filter((l) => Array.isArray(l.tags) && l.tags.includes(t));
  }

  if (query.eco) {
    const eco = String(query.eco);
    result = result.filter((l) => Array.isArray(l.eco) && l.eco.includes(eco));
  }

  if (query.search) {
    const s = String(query.search).toLowerCase();
    result = result.filter(
      (l) =>
        (l.title || '').toLowerCase().includes(s) ||
        (l.content || '').toLowerCase().includes(s) ||
        (Array.isArray(l.tags) && l.tags.some((t: string) => t.toLowerCase().includes(s)))
    );
  }

  // Sort: TOP first, NEW second, then by cashback desc, then by date desc
  const featureRank = (f: string | null | undefined) =>
    f === 'top' ? 0 : f === 'new' ? 1 : 2;
  result.sort((a, b) => {
    const fa = featureRank(a.featured);
    const fb = featureRank(b.featured);
    if (fa !== fb) return fa - fb;
    const ca = a.cashbackPercent || DEFAULT_CASHBACK;
    const cb = b.cashbackPercent || DEFAULT_CASHBACK;
    if (cb !== ca) return cb - ca;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  return result;
}
