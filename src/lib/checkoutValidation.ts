/**
 * Checkout form rules (lanaeco.shop). The seller needs a way to reach the
 * buyer to confirm the order and arrange delivery or pickup, so name,
 * e-mail and phone are required in BOTH modes; the address only when
 * shipping.
 *
 * This is the only place the rule can live: the contact data travels only
 * inside the NIP-44 KIND 36522 to the unit owner, so neither this portal's
 * server nor the broker can see (or check) it. At protocol level e-mail and
 * phone stay optional (SPEC §4) — the rule is this portal's, not the
 * protocol's.
 */
import type { TranslationKey } from '@/i18n/translations';

export type Fulfillment = 'shipping' | 'pickup';

export interface CheckoutForm {
  name: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  postcode: string;
  country: string;
  note: string;
}

export type CheckoutField = 'name' | 'email' | 'phone' | 'line1' | 'postcode' | 'city' | 'country';
export type CheckoutErrors = Partial<Record<CheckoutField, TranslationKey>>;

/** The order the fields appear in on the page: the first invalid one gets the focus. */
export const CHECKOUT_FIELD_ORDER: readonly CheckoutField[] = ['name', 'email', 'phone', 'line1', 'postcode', 'city', 'country'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Digits with the usual separators: "+386 40 123 456", "040-123-456", "01/234 56 78", "(01) 234 56 78". */
const PHONE_RE = /^\+?[\d(][\d ()/.-]*$/;

export function normalizeEmail(s: string): string {
  return String(s ?? '').trim();
}

export function isValidEmail(s: string): boolean {
  const v = normalizeEmail(s);
  return v.length > 0 && v.length <= 254 && EMAIL_RE.test(v);
}

export function normalizePhone(s: string): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ');
}

/** 6 to 15 digits (E.164 maximum); no letters, so "int. 2" is not accepted. */
export function isValidPhone(s: string): boolean {
  const v = normalizePhone(s);
  if (!PHONE_RE.test(v)) return false;
  const digits = v.replace(/\D/g, '').length;
  return digits >= 6 && digits <= 15;
}

export function validateCheckout(form: CheckoutForm, fulfillment: Fulfillment): CheckoutErrors {
  const errors: CheckoutErrors = {};
  if (!form.name.trim()) errors.name = 'checkout.fieldRequired';

  const email = normalizeEmail(form.email);
  if (!email) errors.email = 'checkout.emailRequired';
  else if (!isValidEmail(email)) errors.email = 'checkout.emailInvalid';

  const phone = normalizePhone(form.phone);
  if (!phone) errors.phone = 'checkout.phoneRequired';
  else if (!isValidPhone(phone)) errors.phone = 'checkout.phoneInvalid';

  if (fulfillment === 'shipping') {
    for (const f of ['line1', 'postcode', 'city', 'country'] as const) {
      if (!form[f].trim()) errors[f] = 'checkout.fieldRequired';
    }
  }
  return errors;
}
