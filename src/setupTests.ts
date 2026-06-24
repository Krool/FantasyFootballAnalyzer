import '@testing-library/jest-dom';
import { afterEach } from 'vitest';

// jsdom has no layout engine; scrollTo logs "Not implemented" without this.
window.scrollTo = () => {};

// Web storage persists across tests within a worker (jsdom is reused), so a
// stray entry from one test can change another's behavior. Most storage-using
// suites already clear in their own beforeEach; this is the safety net for the
// ones that don't (e.g. components that read tokens via isAuthenticated()).
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
