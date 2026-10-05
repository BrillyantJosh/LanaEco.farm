import { describe, it, expect } from 'vitest';
import { formatPrice, formatQty, pluralForm } from './format';

const norm = (s: string) => s.replace(/ | /g, ' ');

describe('formatPrice', () => {
  it('formats EUR in the site language', () => {
    expect(norm(formatPrice('3.7', 'EUR', 'sl'))).toBe('3,70 €');
    expect(norm(formatPrice('3.7', 'EUR', 'en'))).toBe('€3.70');
    expect(norm(formatPrice('1234.5', 'EUR', 'sl'))).toMatch(/^1\.?234,50 €$/);
    expect(norm(formatPrice('16.94', 'eur', 'sl'))).toBe('16,94 €');
  });
  it('reads a comma decimal, keeps unknown currencies and unreadable prices', () => {
    expect(norm(formatPrice('3,18', 'EUR', 'sl'))).toBe('3,18 €');
    expect(norm(formatPrice('12', 'LANA', 'sl'))).toBe('12,00 LANA');
    expect(formatPrice('po dogovoru', 'EUR', 'sl')).toBe('po dogovoru EUR');
    expect(formatPrice('', 'EUR', 'sl')).toBe('');
    expect(norm(formatPrice('5', '', 'sl'))).toBe('5,00');
  });
});

describe('pluralForm', () => {
  it('Slovenian has four forms, English two', () => {
    expect([1, 2, 3, 4, 5, 11, 101, 102, 103, 1720].map(n => pluralForm('sl', n)))
      .toEqual(['one', 'two', 'few', 'few', 'other', 'other', 'one', 'two', 'few', 'other']);
    expect([0, 1, 2].map(n => pluralForm('en', n))).toEqual(['other', 'one', 'other']);
  });
});

describe('formatQty', () => {
  it('Slovenian count forms for pieces: 1 kos, 2 kosa, 3 kosi, 5 kosov', () => {
    expect([1, 2, 3, 4, 5, 22, 100, 101, 102].map(n => formatQty(n, 'piece', 'sl')))
      .toEqual(['1 kos', '2 kosa', '3 kosi', '4 kosi', '5 kosov', '22 kosov', '100 kosov', '101 kos', '102 kosa']);
    expect(formatQty(2, 'set', 'sl')).toBe('2 kompleta');
    expect(formatQty(5, 'portion', 'sl')).toBe('5 porcij');
  });
  it('measures do not change, English has one / other, unknown units are shown as published', () => {
    expect(formatQty(5, 'kg', 'sl')).toBe('5 kg');
    expect(formatQty(2, 'L', 'sl')).toBe('2 L');
    expect(formatQty(1, 'piece', 'en')).toBe('1 piece');
    expect(formatQty(22, 'piece', 'en')).toBe('22 pieces');
    expect(formatQty(3, 'šop', 'sl')).toBe('3 šop');
    expect(formatQty(7, '', 'sl')).toBe('7');
  });
});

describe('formatQty — accusative after a preposition ("Nastavi na …")', () => {
  it('only the forms that differ change: 3/4 kose, 1 osebo; the rest as the nominative', () => {
    expect([1, 2, 3, 4, 5, 103].map(n => formatQty(n, 'piece', 'sl', 'acc')))
      .toEqual(['1 kos', '2 kosa', '3 kose', '4 kose', '5 kosov', '103 kose']);
    expect(formatQty(3, 'set', 'sl', 'acc')).toBe('3 komplete');
    expect(formatQty(1, 'person', 'sl', 'acc')).toBe('1 osebo');
    expect(formatQty(3, 'person', 'sl', 'acc')).toBe('3 osebe');
    expect(formatQty(3, 'kg', 'sl', 'acc')).toBe('3 kg');
    expect(formatQty(3, 'piece', 'en', 'acc')).toBe('3 pieces');
    expect(formatQty(3, 'piece', 'sl')).toBe('3 kosi');
  });
});
