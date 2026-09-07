// Web Storage that never throws. Edge's strict tracking prevention, a
// sandboxed iframe, and some in-app browsers make the `localStorage` GETTER
// itself throw ("Access is denied for this document", Sentry 2026-09-02),
// so even `typeof localStorage` guards don't help: the access has to sit
// inside a try. Every read degrades to "nothing stored" and every write to a
// no-op, which is the right behaviour for preferences and caches — the app
// must render, it just won't remember.

interface SafeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function wrap(pick: () => Storage): SafeStorage {
  return {
    getItem(key) {
      try {
        return pick().getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        pick().setItem(key, value);
      } catch {
        // Blocked or full: the value just won't persist.
      }
    },
    removeItem(key) {
      try {
        pick().removeItem(key);
      } catch {
        // Nothing to remove if we could never write.
      }
    },
  };
}

export const safeLocalStorage: SafeStorage = wrap(() => window.localStorage);
export const safeSessionStorage: SafeStorage = wrap(() => window.sessionStorage);
