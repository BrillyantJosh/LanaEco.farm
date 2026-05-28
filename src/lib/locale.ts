// Country normalisation + display labels.
//
// All listed variants (case-insensitive, trimmed) map to a single normalised
// country code. Add new countries by extending COUNTRY_VARIANTS + COUNTRY_LABELS.

const COUNTRY_VARIANTS: Record<string, string[]> = {
  si: ['SI', 'SL', 'SLO', 'SLOVENIA', 'SLOVENIJA'],
  uk: ['GB', 'UK', 'BRITAIN', 'ENGLAND', 'GREAT BRITAIN', 'UNITED KINGDOM'],
  it: ['IT', 'ITALY', 'ITALIA'],
  de: ['DE', 'GERMANY', 'DEUTSCHLAND', 'NEMCIJA', 'NEMČIJA'],
  at: ['AT', 'AUSTRIA', 'OSTERREICH', 'ÖSTERREICH', 'AVSTRIJA'],
  hr: ['HR', 'CROATIA', 'HRVATSKA', 'HRVASKA', 'HRVAŠKA'],
  hu: ['HU', 'HUNGARY', 'MAGYARORSZAG', 'MAGYARORSZÁG', 'MADZARSKA', 'MADŽARSKA'],
  fr: ['FR', 'FRANCE', 'FRANCIJA'],
  es: ['ES', 'SPAIN', 'ESPANA', 'ESPAÑA', 'SPANIJA', 'ŠPANIJA'],
  nl: ['NL', 'NETHERLANDS', 'HOLLAND', 'NIZOZEMSKA'],
  be: ['BE', 'BELGIUM', 'BELGIJA'],
  ch: ['CH', 'SWITZERLAND', 'SCHWEIZ', 'SVICA', 'ŠVICA'],
  pl: ['PL', 'POLAND', 'POLSKA', 'POLJSKA'],
  cz: ['CZ', 'CZECH', 'CZECH REPUBLIC', 'CESKA', 'ČEŠKA'],
  sk: ['SK', 'SLOVAKIA', 'SLOVENSKO', 'SLOVASKA', 'SLOVAŠKA'],
  rs: ['RS', 'SERBIA', 'SRBIJA'],
  ba: ['BA', 'BOSNIA', 'BOSNA', 'BOSNIA AND HERZEGOVINA', 'BOSNA IN HERCEGOVINA'],
  mk: ['MK', 'MACEDONIA', 'NORTH MACEDONIA', 'MAKEDONIJA', 'SEVERNA MAKEDONIJA'],
  us: ['US', 'USA', 'UNITED STATES', 'AMERICA', 'ZDA'],
};

const COUNTRY_LABELS: Record<string, { sl: string; en: string }> = {
  si: { sl: 'Slovenija', en: 'Slovenia' },
  uk: { sl: 'Velika Britanija', en: 'United Kingdom' },
  it: { sl: 'Italija', en: 'Italy' },
  de: { sl: 'Nemčija', en: 'Germany' },
  at: { sl: 'Avstrija', en: 'Austria' },
  hr: { sl: 'Hrvaška', en: 'Croatia' },
  hu: { sl: 'Madžarska', en: 'Hungary' },
  fr: { sl: 'Francija', en: 'France' },
  es: { sl: 'Španija', en: 'Spain' },
  nl: { sl: 'Nizozemska', en: 'Netherlands' },
  be: { sl: 'Belgija', en: 'Belgium' },
  ch: { sl: 'Švica', en: 'Switzerland' },
  pl: { sl: 'Poljska', en: 'Poland' },
  cz: { sl: 'Češka', en: 'Czech Republic' },
  sk: { sl: 'Slovaška', en: 'Slovakia' },
  rs: { sl: 'Srbija', en: 'Serbia' },
  ba: { sl: 'Bosna in Hercegovina', en: 'Bosnia and Herzegovina' },
  mk: { sl: 'Severna Makedonija', en: 'North Macedonia' },
  us: { sl: 'ZDA', en: 'United States' },
};

const COUNTRY_FLAGS: Record<string, string> = {
  si: '\u{1F1F8}\u{1F1EE}',
  uk: '\u{1F1EC}\u{1F1E7}',
  it: '\u{1F1EE}\u{1F1F9}',
  de: '\u{1F1E9}\u{1F1EA}',
  at: '\u{1F1E6}\u{1F1F9}',
  hr: '\u{1F1ED}\u{1F1F7}',
  hu: '\u{1F1ED}\u{1F1FA}',
  fr: '\u{1F1EB}\u{1F1F7}',
  es: '\u{1F1EA}\u{1F1F8}',
  nl: '\u{1F1F3}\u{1F1F1}',
  be: '\u{1F1E7}\u{1F1EA}',
  ch: '\u{1F1E8}\u{1F1ED}',
  pl: '\u{1F1F5}\u{1F1F1}',
  cz: '\u{1F1E8}\u{1F1FF}',
  sk: '\u{1F1F8}\u{1F1F0}',
  rs: '\u{1F1F7}\u{1F1F8}',
  ba: '\u{1F1E7}\u{1F1E6}',
  mk: '\u{1F1F2}\u{1F1F0}',
  us: '\u{1F1FA}\u{1F1F8}',
};

const VARIANTS_TO_CODE = new Map<string, string>();
for (const [code, variants] of Object.entries(COUNTRY_VARIANTS)) {
  for (const v of variants) VARIANTS_TO_CODE.set(v, code);
}

export type Locale = 'sl' | 'en';

/** Normalise any country string ("SI", "Slovenia", "slovenija", "SL") → "si". */
export function normalizeCountry(v: string | null | undefined): string | null {
  const s = (v || '').trim().toUpperCase();
  if (!s) return null;
  return VARIANTS_TO_CODE.get(s) || null;
}

/** Pick the first recognised country from a unit (country, falling back to receiverCountry). */
export function unitCountry(unit: {
  country?: string | null;
  receiverCountry?: string | null;
}): string | null {
  return normalizeCountry(unit.country) ?? normalizeCountry(unit.receiverCountry);
}

/** Localised display name for a country code (falls back to uppercased code). */
export function countryLabel(code: string, locale: Locale): string {
  return COUNTRY_LABELS[code]?.[locale] || code.toUpperCase();
}

/** LEGACY — kept for compatibility, no longer used for filtering. */
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

/** Emoji flag for a country code; falls back to globe emoji. */
export function countryFlag(code: string): string {
  return COUNTRY_FLAGS[code] || '\u{1F310}';
}
