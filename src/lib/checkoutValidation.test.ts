import { describe, it, expect } from 'vitest';
import {
  isValidEmail, isValidPhone, normalizeEmail, normalizePhone, validateCheckout, CHECKOUT_FIELD_ORDER,
  type CheckoutForm,
} from './checkoutValidation';

const EMPTY: CheckoutForm = { name: '', email: '', phone: '', line1: '', line2: '', city: '', postcode: '', country: '', note: '' };
const CONTACT: CheckoutForm = { ...EMPTY, name: 'Ana Kupec', email: 'ana@primer.si', phone: '040 123 456' };
const ADDRESS = { line1: 'Trubarjeva 7', city: 'Ljubljana', postcode: '1000', country: 'SI' };

describe('e-mail', () => {
  it('accepts a normal address, also with spaces around it (trimmed)', () => {
    expect(isValidEmail('ime@primer.si')).toBe(true);
    expect(isValidEmail('  ime@primer.si  ')).toBe(true);
    expect(normalizeEmail('  ime@primer.si  ')).toBe('ime@primer.si');
    expect(isValidEmail('Ime.Priimek+trgovina@sub.primer.com')).toBe(true);
  });
  it('rejects empty and malformed addresses', () => {
    for (const bad of ['', '   ', 'ime@', 'ime@primer', 'ime primer@x.si', 'a@b.c', '@primer.si', 'ime@@primer.si']) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
    expect(isValidEmail(`${'a'.repeat(250)}@x.si`)).toBe(false); // > 254
  });
});

describe('phone', () => {
  it('accepts the usual Slovenian and international forms', () => {
    for (const ok of ['+386 40 123 456', '040 123 456', '040-123-456', '01/234 56 78', '(01) 234 56 78', '+38640123456', '  040123456  ']) {
      expect(isValidPhone(ok), ok).toBe(true);
    }
    expect(normalizePhone('  040   123  456 ')).toBe('040 123 456');
  });
  it('rejects empty, letters, "++", fewer than 6 or more than 15 digits', () => {
    for (const bad of ['', '   ', '12345', 'abc 123 456', '040 123 456 int. 2', '++386 40 123', '1234567890123456', '+', '---']) {
      expect(isValidPhone(bad), bad).toBe(false);
    }
  });
});

describe('validateCheckout', () => {
  it('pickup: name, e-mail and phone are required; the address is not', () => {
    expect(validateCheckout(EMPTY, 'pickup')).toEqual({
      name: 'checkout.fieldRequired', email: 'checkout.emailRequired', phone: 'checkout.phoneRequired',
    });
    expect(validateCheckout(CONTACT, 'pickup')).toEqual({});
  });
  it('shipping: the same plus street, postcode, city and country', () => {
    expect(validateCheckout(CONTACT, 'shipping')).toEqual({
      line1: 'checkout.fieldRequired', city: 'checkout.fieldRequired', postcode: 'checkout.fieldRequired', country: 'checkout.fieldRequired',
    });
    expect(validateCheckout({ ...CONTACT, ...ADDRESS }, 'shipping')).toEqual({});
    expect(validateCheckout({ ...CONTACT, ...ADDRESS, line1: '   ' }, 'shipping')).toEqual({ line1: 'checkout.fieldRequired' });
  });
  it('a filled but wrong e-mail / phone gets the "not right" message, not "required"', () => {
    expect(validateCheckout({ ...CONTACT, email: 'ana@primer', phone: '12 34' }, 'pickup')).toEqual({
      email: 'checkout.emailInvalid', phone: 'checkout.phoneInvalid',
    });
  });
  it('field order follows the form (first invalid field gets the focus)', () => {
    expect(CHECKOUT_FIELD_ORDER).toEqual(['name', 'email', 'phone', 'line1', 'postcode', 'city', 'country']);
  });
});
