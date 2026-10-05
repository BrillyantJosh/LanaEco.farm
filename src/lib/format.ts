/** Number formatting for the storefront (site language, not browser locale). */

type Loc = 'sl' | 'en';

const INTL_LOCALE: Record<Loc, string> = { sl: 'sl-SI', en: 'en-GB' };

/**
 * '3.7' + 'EUR' → '3,70 €' (sl) / '€3.70' (en). Merchants publish prices as
 * strings; a comma decimal ('3,18') is read too. A currency Intl does not
 * know as ISO 4217 (e.g. LANA) is printed after the number; an unreadable
 * price is shown exactly as published.
 */
export function formatPrice(price: string | number | null | undefined, currency: string | null | undefined, locale: Loc): string {
  const raw = String(price ?? '').trim();
  const cur = String(currency ?? '').trim().toUpperCase();
  if (!raw) return '';
  const num = /^\d+(?:[.,]\d+)?$/.test(raw) ? Number(raw.replace(',', '.')) : NaN;
  if (!Number.isFinite(num)) return cur ? `${raw} ${cur}` : raw;
  const loc = INTL_LOCALE[locale] || INTL_LOCALE.sl;
  if (/^[A-Z]{3}$/.test(cur)) {
    try {
      return new Intl.NumberFormat(loc, { style: 'currency', currency: cur }).format(num);
    } catch { /* not a currency Intl accepts: fall through */ }
  }
  const plain = new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
  return cur ? `${plain} ${cur}` : plain;
}

/**
 * Slovenian has four count forms (1 izdelek, 2 izdelka, 3 izdelki,
 * 5 izdelkov; 101 behaves like 1). English: one / other.
 */
export function pluralForm(locale: Loc, count: number): 'one' | 'two' | 'few' | 'other' {
  const n = Math.abs(Math.trunc(count));
  if (locale === 'sl') {
    const r = n % 100;
    if (r === 1) return 'one';
    if (r === 2) return 'two';
    if (r === 3 || r === 4) return 'few';
    return 'other';
  }
  return n === 1 ? 'one' : 'other';
}

/**
 * Count forms of the stock units merchants publish (translations.ts has the
 * singular as lunit.*). sl: one / two / few / other; en: one / other.
 * Measures (kg, g, L) are symbols and never change.
 */
const UNIT_FORMS: Record<Loc, Record<string, string[]>> = {
  sl: {
    piece: ['kos', 'kosa', 'kosi', 'kosov'],
    set: ['komplet', 'kompleta', 'kompleti', 'kompletov'],
    month: ['mesec', 'meseca', 'meseci', 'mesecev'],
    visit: ['obisk', 'obiska', 'obiski', 'obiskov'],
    person: ['oseba', 'osebi', 'osebe', 'oseb'],
    portion: ['porcija', 'porciji', 'porcije', 'porcij'],
  },
  en: {
    piece: ['piece', 'pieces'],
    set: ['set', 'sets'],
    month: ['month', 'months'],
    visit: ['visit', 'visits'],
    person: ['person', 'people'],
    portion: ['portion', 'portions'],
  },
};

/**
 * Slovene ACCUSATIVE forms where they differ from the nominative ones above
 * ("Nastavi na 3 kose", "na 1 osebo") — after a preposition such as "na".
 * Same index order; an absent entry falls back to the nominative.
 */
const UNIT_FORMS_ACC: Partial<Record<Loc, Record<string, Array<string | undefined>>>> = {
  sl: {
    piece: [undefined, undefined, 'kose'],
    set: [undefined, undefined, 'komplete'],
    month: [undefined, undefined, 'mesece'],
    visit: [undefined, undefined, 'obiske'],
    person: ['osebo'],
    portion: ['porcijo'],
  },
};

const FORM_INDEX: Record<Loc, Record<ReturnType<typeof pluralForm>, number>> = {
  sl: { one: 0, two: 1, few: 2, other: 3 },
  en: { one: 0, two: 1, few: 1, other: 1 },
};

/**
 * 22 + 'piece' → '22 kosov' (sl) / '22 pieces' (en); '5 kg'; an unknown unit
 * as published. `grammaticalCase: 'acc'` gives the Slovene accusative for
 * text after a preposition: 'Nastavi na 3 kose' (nominative: '3 kosi').
 */
export function formatQty(count: number, unit: string | null | undefined, locale: Loc, grammaticalCase: 'nom' | 'acc' = 'nom'): string {
  const u = String(unit ?? '').trim();
  if (!u) return String(count);
  const forms = UNIT_FORMS[locale]?.[u];
  if (!forms) return `${count} ${u}`;
  const idx = FORM_INDEX[locale][pluralForm(locale, count)];
  const acc = grammaticalCase === 'acc' ? UNIT_FORMS_ACC[locale]?.[u]?.[idx] : undefined;
  return `${count} ${acc ?? forms[idx]}`;
}
