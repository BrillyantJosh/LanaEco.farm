/**
 * Who a shop is, and who may speak about it. Ported from lanaeco-shop
 * 74ba516 (25 Sep 2026) and f1d100d (27 Sep 2026).
 *
 * - A shop is (30901 signer, unit id). The unit id alone is not unique:
 *   anyone can sign a 30901 that reuses another shop's id.
 * - KIND 30902 (fee policy) and KIND 30903 (registration status) are the
 *   registrar's word about ONE shop. Only the processor or a trusted signer
 *   of the KIND 38888 may publish them, and their `a` tag names the shop
 *   (30901:<owner>:<unit id>).
 */

import type Database from 'better-sqlite3';
import { getTags, type NostrEvent } from './relaySync.js';

export const PROCESSOR_PUBKEY =
  '79730aba75d71584e8a4f9d0cc1173085e75590ce489760078d2bf6f5210d692';
const TRUSTED_GROUPS = ['LanaPaysUs', 'LanaPays', 'Processor', 'Brain'];
const HEX64_RE = /^[0-9a-f]{64}$/;

/** Map / set key for a shop: (signer, unit id). */
export function unitKey(pubkey: string, unitId: string | null | undefined): string {
  return `${String(pubkey || '').toLowerCase()}:${unitId ?? ''}`;
}

/**
 * A listing may name only its signer's own shop: `a` = 30901:<signer>:<unit id>.
 * No `a` tag names no shop, so it fails too.
 */
export function listingOwnsUnitRef(listingPubkey: string, unitRef: string | undefined): boolean {
  const refPubkey = String(unitRef?.split(':')[1] || '').toLowerCase();
  return !!refPubkey && refPubkey === String(listingPubkey || '').toLowerCase();
}

/**
 * Who may speak for the registry (KIND 30902 / 30903): the processor, or a
 * trusted signer (groups LanaPaysUs | LanaPays | Processor | Brain) of the
 * signature-verified KIND 38888. Nobody else, whatever relay forwards it.
 */
export function registrarSigners(db: Database.Database): Set<string> {
  const out = new Set<string>([PROCESSOR_PUBKEY]);
  try {
    const row = db.prepare('SELECT trusted_signers FROM kind_38888 ORDER BY id DESC LIMIT 1').get() as { trusted_signers: string | null } | undefined;
    const groups = row?.trusted_signers ? JSON.parse(row.trusted_signers) : {};
    if (groups && typeof groups === 'object') {
      for (const g of TRUSTED_GROUPS) {
        const list = (groups as Record<string, unknown>)[g];
        if (!Array.isArray(list)) continue;
        for (const h of list) {
          const hex = String(h || '').toLowerCase();
          if (HEX64_RE.test(hex)) out.add(hex);
        }
      }
    }
  } catch {}
  return out;
}

/**
 * The shop a registry event (30902 / 30903) rules on: the owner in its `a`
 * tag 30901:<owner>:<unit id>, for the unit id it carries. Null when there is
 * no such tag, it names another unit, or two of them disagree.
 */
export function registryOwner(ev: NostrEvent, unitId: string): string | null {
  let owner: string | null = null;
  for (const a of getTags(ev, 'a')) {
    const parts = String(a || '').split(':');
    if (parts[0] !== '30901') continue;
    const pk = parts[1] || '';
    if (!HEX64_RE.test(pk) || parts.slice(2).join(':') !== unitId) return null;
    if (owner && owner !== pk) return null;
    owner = pk;
  }
  return owner;
}
