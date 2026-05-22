// Country normalisation for locale-based filtering.
//
// Recognises both ISO codes and common name variants; case- and
// whitespace-insensitive. Returns null for anything unrecognised — callers
// treat null as "hide" (strict mode).
//
// To extend support for a new country in the future, add its variants to
// the appropriate Set below and (optionally) extend CountryCode + Locale.

const SI_VARIANTS = new Set([
  'SI', 'SL', 'SLO', 'SLOVENIA', 'SLOVENIJA',
]);

const UK_VARIANTS = new Set([
  'GB', 'UK', 'BRITAIN', 'ENGLAND', 'GREAT BRITAIN', 'UNITED KINGDOM',
]);

export type Locale = 'sl' | 'en';
export type CountryCode = 'si' | 'uk' | null;

export function normalizeCountry(v: string | null | undefined): CountryCode {
  const s = (v || '').trim().toUpperCase();
  if (!s) return null;
  if (SI_VARIANTS.has(s)) return 'si';
  if (UK_VARIANTS.has(s)) return 'uk';
  return null;
}

/** Pick the first recognised country from a unit (country, falling back to receiverCountry). */
export function unitCountry(unit: {
  country?: string | null;
  receiverCountry?: string | null;
}): CountryCode {
  return normalizeCountry(unit.country) ?? normalizeCountry(unit.receiverCountry);
}

/** Strict locale match: SL→SI only, EN→UK only, unknown→false. */
export function unitMatchesLocale(
  unit: { country?: string | null; receiverCountry?: string | null },
  locale: Locale,
): boolean {
  const c = unitCountry(unit);
  if (c === null) return false;
  return locale === 'sl' ? c === 'si' : c === 'uk';
}

/** Extract unit_id from a Nostr `unitRef` like "30901:<pubkey>:<unit_id>". */
export function unitIdFromRef(unitRef: string | null | undefined): string | null {
  if (!unitRef) return null;
  const parts = unitRef.split(':');
  return parts[2] || null;
}
