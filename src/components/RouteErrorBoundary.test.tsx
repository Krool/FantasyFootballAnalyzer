import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteErrorBoundary } from './RouteErrorBoundary';

// The boundary logs the caught error; silence the side effects so the suite
// output stays clean and we don't hit Sentry.
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/utils/sentry', () => ({ captureError: vi.fn() }));

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

function renderWithError(message: string) {
  // React logs caught render errors to console.error; mute for this render.
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <RouteErrorBoundary resetKey="/rankings">
      <Boom message={message} />
    </RouteErrorBoundary>,
  );
  spy.mockRestore();
}

describe('RouteErrorBoundary chunk-failure detection', () => {
  // Each browser phrases a stale-chunk dynamic-import 404 differently. All of
  // them must surface the "deployed while you were here" copy and a Reload
  // button, not the dead-end "Try Again" retry.
  const chunkMessages = [
    // Chrome / V8
    'Failed to fetch dynamically imported module: https://x/assets/RankingsPage-abc.js',
    // Firefox (the wording that originally slipped past the regex)
    'error loading dynamically imported module: https://x/assets/RankingsPage-abc.js',
    // Safari / WebKit
    'Importing a module script failed.',
    // webpack-era chunk loading
    'Loading chunk 42 failed.',
  ];

  it.each(chunkMessages)('treats %s as a redeploy and offers Reload', (message) => {
    renderWithError(message);
    expect(screen.getByText(/a new version of the app was deployed/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy();
  });

  it('shows a retryable error for a normal render crash', () => {
    renderWithError('Cannot read properties of undefined (reading "id")');
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(screen.queryByText(/a new version of the app was deployed/i)).toBeNull();
  });
});
