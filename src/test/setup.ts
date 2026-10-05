import "@testing-library/jest-dom";

// Server tests opt into the node environment (`// @vitest-environment node`),
// where there is no `window` — the shims below only make sense under jsdom.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });

  // Node ≥ 22 ships an experimental `localStorage` global that, without
  // `--localstorage-file`, is an object with no methods — and it shadows
  // jsdom's real Storage. Install an in-memory Storage when that happens.
  const ls = (globalThis as any).localStorage;
  if (!ls || typeof ls.clear !== "function") {
    const store = new Map<string, string>();
    const memoryStorage: Storage = {
      get length() { return store.size; },
      clear: () => { store.clear(); },
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      removeItem: (k: string) => { store.delete(k); },
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
    };
    for (const target of [globalThis, window] as any[]) {
      try {
        Object.defineProperty(target, "localStorage", { value: memoryStorage, configurable: true, writable: true });
      } catch {}
    }
  }
}
