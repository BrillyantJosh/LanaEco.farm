/**
 * The cart as React state: one store for the whole page, kept in this
 * browser's localStorage (`lana_shop_cart_v1`) and followed across tabs via
 * the window 'storage' event.
 *
 * A module-level store (useSyncExternalStore) rather than a context provider:
 * every component that shows or changes the cart — header badge, the "+" on
 * a tile, the product page, the cart and checkout pages — reads the same
 * store without having to sit under a provider, so nothing renders a wrong
 * count because it was mounted outside one.
 *
 * Storage can be missing or throw (private window, blocked site data): the
 * cart then lives in memory for this page view and every read/write is
 * wrapped, so the shop keeps working.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  CART_STORAGE_KEY, addLine, emptyCart, groupByShop, lineKey, parseCart, quantityInCart, removeLines,
  serializeCart, setQty, updateLimits, type AddResult, type CartDisplay, type CartLineInput, type CartState,
} from '@/lib/cart';

let memory: CartState | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  // window.localStorage explicitly: under vitest/jsdom on Node ≥ 22 a bare
  // `localStorage` can resolve to Node's experimental (methodless) global.
  try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; } catch { return null; }
}

function read(): CartState {
  if (memory) return memory;
  let raw: string | null = null;
  try { raw = storage()?.getItem(CART_STORAGE_KEY) ?? null; } catch { raw = null; }
  memory = parseCart(raw);
  return memory;
}

function notify(): void {
  for (const fn of Array.from(listeners)) fn();
}

function commit(next: CartState): void {
  if (next === memory) return;
  memory = next;
  try { storage()?.setItem(CART_STORAGE_KEY, serializeCart(next)); } catch { /* memory only */ }
  notify();
}

function onStorage(e: StorageEvent): void {
  if (e.key !== null && e.key !== CART_STORAGE_KEY) return;
  memory = parseCart(e.key === null ? null : e.newValue);
  notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

const serverSnapshot = emptyCart();

/** Imperative access (checkout success, tests). */
export const cartStore = {
  get: read,
  add(input: CartLineInput): AddResult {
    const r = addLine(read(), input);
    commit(r.state);
    return r;
  },
  setQty(key: string, qty: number): void { commit(setQty(read(), key, qty)); },
  updateLimits(key: string, limits: Partial<Pick<CartDisplay, 'availableQty' | 'maxOrder' | 'minOrder'>>): void {
    commit(updateLimits(read(), key, limits));
  },
  remove(key: string): void { commit(removeLines(read(), [key])); },
  removeLines(keys: string[]): void { commit(removeLines(read(), keys)); },
  /** Tests only: forget the in-memory copy so the next read comes from storage. */
  resetForTests(): void { memory = null; notify(); },
};

export function useCart() {
  const state = useSyncExternalStore(subscribe, read, () => serverSnapshot);
  const groups = useMemo(() => groupByShop(state), [state]);
  const inCart = useCallback((k: { pubkey: string; listingId: string }) => quantityInCart(state, lineKey(k)), [state]);
  return {
    state,
    lines: state.lines,
    /** different products in the cart (kg and kos do not add up, so never Σ qty) */
    count: state.lines.length,
    groups,
    inCart,
    add: cartStore.add,
    setQty: cartStore.setQty,
    updateLimits: cartStore.updateLimits,
    remove: cartStore.remove,
    removeLines: cartStore.removeLines,
  };
}
