import { describe, it, expect, vi, afterEach } from 'vitest';
import { safeLocalStorage, safeSessionStorage } from './safeStorage';

// Edge's strict tracking prevention makes the `window.localStorage` getter
// itself throw (Sentry 2026-09-02: "Access is denied for this document",
// thrown from App's first render). The wrappers must absorb that, not just a
// failing setItem.

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('safeLocalStorage', () => {
  it('reads and writes normally when storage works', () => {
    safeLocalStorage.setItem('k', 'v');
    expect(safeLocalStorage.getItem('k')).toBe('v');
    safeLocalStorage.removeItem('k');
    expect(safeLocalStorage.getItem('k')).toBeNull();
  });

  it('returns null and swallows writes when the storage getter throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Access is denied for this document.', 'SecurityError');
    });
    expect(safeLocalStorage.getItem('k')).toBeNull();
    expect(() => safeLocalStorage.setItem('k', 'v')).not.toThrow();
    expect(() => safeLocalStorage.removeItem('k')).not.toThrow();
  });

  it('swallows a quota failure on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => safeLocalStorage.setItem('k', 'v')).not.toThrow();
  });
});

describe('safeSessionStorage', () => {
  it('returns null when the storage getter throws', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Access is denied for this document.', 'SecurityError');
    });
    expect(safeSessionStorage.getItem('k')).toBeNull();
    expect(() => safeSessionStorage.setItem('k', 'v')).not.toThrow();
  });
});
