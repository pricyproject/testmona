import '@testing-library/jest-dom';

// Zustand's persist middleware accesses localStorage via a lazy getter.
// jsdom provides localStorage, but stub it explicitly to ensure it's
// available synchronously when modules are first loaded.
if (typeof window !== 'undefined') {
  const store: Record<string, string> = {};
  const mockStorage: Storage = {
    getItem: (key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => { delete store[k]; }); },
    get length() { return Object.keys(store).length; },
    key: (index) => Object.keys(store)[index] ?? null,
  };
  try {
    Object.defineProperty(window, 'localStorage', { value: mockStorage, writable: true, configurable: true });
  } catch {
    // jsdom may already have defined it — ignore if re-definition fails.
  }
}
