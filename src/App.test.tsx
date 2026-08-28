// The always-mounted shell's routing decisions: the ?league=sleeper:<id>
// share-link loader (and its no-retry loop guard), the guest-vs-data route
// guards, guest auto-enter on public draft-prep routes, the client half of
// Yahoo OAuth (CSRF state validation), and the share-param URL rewrite.
// Everything below App itself is stubbed: these tests pin who renders where,
// not what the pages draw.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App';
import type { League } from '@/types';

const h = vi.hoisted(() => {
  // A tiny external store so tests (and the load mock) can swap the league
  // mid-flight and the mocked useLeague re-renders App like the real hook.
  const listeners = new Set<() => void>();
  const store = {
    league: null as unknown,
    isLoading: false,
    version: 0,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => store.version,
    set(patch: { league?: unknown; isLoading?: boolean }) {
      Object.assign(store, patch);
      store.version += 1;
      listeners.forEach(fn => fn());
    },
  };
  return {
    store,
    loadMock: vi.fn(),
    enterGuestMock: vi.fn(),
    noop: () => {},
    saveTokens: vi.fn(),
    validateOAuthState: vi.fn(),
    clearOAuthState: vi.fn(),
    takeOAuthReturn: vi.fn(() => null),
  };
});

vi.mock('@/hooks/useLeague', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useLeague: () => {
      useSyncExternalStore(h.store.subscribe, h.store.getSnapshot);
      return {
        league: h.store.league as League | null,
        credentials: null,
        isLoading: h.store.isLoading,
        error: null,
        progress: null,
        load: h.loadMock,
        refresh: h.noop,
        clear: h.noop,
        enterGuest: h.enterGuestMock,
        updateGuest: h.noop,
        seasonFallbackNotice: null,
        dismissSeasonFallbackNotice: h.noop,
      };
    },
  };
});

vi.mock('@/hooks/useSounds', () => ({
  useSounds: () => ({ playLoadComplete: h.noop, playError: h.noop }),
}));

vi.mock('@/api/yahoo', async importOriginal => ({
  ...(await importOriginal<object>()),
  isAuthenticated: () => false,
  saveTokens: h.saveTokens,
  validateOAuthState: h.validateOAuthState,
  clearOAuthState: h.clearOAuthState,
  takeOAuthReturn: h.takeOAuthReturn,
}));

vi.mock('@/api/sleeper', async importOriginal => ({
  ...(await importOriginal<object>()),
  findSuccessorLeague: vi.fn(async () => null),
}));

vi.mock('@/utils/analytics', () => ({
  Analytics: { pageView: h.noop, connectAttempt: h.noop },
}));

// Chrome stubs: these tests pin routing, not chrome or page content.
vi.mock('@/components/Header', () => ({ Header: () => <div data-testid="header" /> }));
vi.mock('@/components/YearSelector', () => ({ YearSelector: () => null }));
vi.mock('@/components/SeasonLoadingOverlay', () => ({ SeasonLoadingOverlay: () => null }));
vi.mock('@/components/DraftPrepBanner', () => ({ DraftPrepBanner: () => null }));
vi.mock('@/components/GuestBanner', () => ({ GuestBanner: () => null }));
vi.mock('@/components/SeasonFallbackNotice', () => ({ SeasonFallbackNotice: () => null }));
vi.mock('@/pages/HomePage', () => ({ HomePage: () => <div data-testid="home-page" /> }));
// The lazy pages the routes below can reach (lazyPage resolves these mocks
// through the same dynamic import).
vi.mock('@/pages/AwardsPage', () => ({ AwardsPage: () => <div data-testid="awards-page" /> }));
vi.mock('@/pages/RankingsPage', () => ({ RankingsPage: () => <div data-testid="rankings-page" /> }));
vi.mock('@/pages/TrendsPage', () => ({ TrendsPage: () => <div data-testid="trends-page" /> }));
vi.mock('@/pages/DraftPage', () => ({ DraftPage: () => <div data-testid="draft-page" /> }));
vi.mock('@/pages/TeamsPage', () => ({ TeamsPage: () => <div data-testid="teams-page" /> }));

function sleeperLeague(id: string, overrides: Partial<League> = {}): League {
  return {
    id,
    platform: 'sleeper',
    name: 'Route Test League',
    season: 2025,
    teams: [],
    scoringType: 'half_ppr',
    totalTeams: 10,
    isLoaded: true,
    ...overrides,
  } as unknown as League;
}

function LocationSpy() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname + location.search}</div>;
}

function renderApp(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App />
      <LocationSpy />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  h.store.league = null;
  h.store.isLoading = false;
  h.takeOAuthReturn.mockReturnValue(null);
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  // Default load: succeed and swap the store's league in, like the real hook.
  h.loadMock.mockImplementation(async ({ leagueId }: { leagueId: string }) => {
    const league = sleeperLeague(leagueId);
    h.store.set({ league });
    return league;
  });
  h.enterGuestMock.mockImplementation(() => {
    h.store.set({ league: sleeperLeague('guest', { isGuest: true } as Partial<League>) });
  });
});

describe('share links (?league=sleeper:<id>)', () => {
  it('loads the linked league and holds the deep link instead of bouncing home', async () => {
    renderApp('/awards?league=sleeper:999');
    // The guard shows a spinner while the load is in flight, then the page.
    expect(await screen.findByTestId('awards-page')).toBeTruthy();
    expect(h.loadMock).toHaveBeenCalledTimes(1);
    expect(h.loadMock).toHaveBeenCalledWith({ platform: 'sleeper', leagueId: '999' });
    expect(decodeURIComponent(screen.getByTestId('loc').textContent ?? '')).toBe(
      '/awards?league=sleeper:999',
    );
  });

  it('tries a failing share link once, then falls through to home without looping', async () => {
    // Like the real hook, a failed load still toggles isLoading, which is
    // the re-render that lets the guard resolve to the redirect.
    h.loadMock.mockImplementation(async () => {
      h.store.set({ isLoading: true });
      h.store.set({ isLoading: false });
      return null;
    });
    renderApp('/awards?league=sleeper:404404');
    // The failed load resolves the guard to the no-league redirect.
    expect(await screen.findByTestId('home-page')).toBeTruthy();
    // The attempted-id guard must hold across the re-renders: one try only.
    expect(h.loadMock).toHaveBeenCalledTimes(1);
  });

  it('restores the share param the in-app navigation dropped', async () => {
    h.store.league = sleeperLeague('55');
    renderApp('/awards');
    expect(await screen.findByTestId('awards-page')).toBeTruthy();
    // URLSearchParams percent-encodes the colon; decode before comparing.
    await waitFor(() =>
      expect(decodeURIComponent(screen.getByTestId('loc').textContent ?? '')).toBe(
        '/awards?league=sleeper:55',
      ),
    );
  });
});

describe('route guards', () => {
  it('bounces a guest from a data route to /rankings', async () => {
    h.store.league = sleeperLeague('guest', { isGuest: true } as Partial<League>);
    renderApp('/draft');
    expect(await screen.findByTestId('rankings-page')).toBeTruthy();
    expect(screen.getByTestId('loc').textContent).toBe('/rankings');
  });

  it('sends a visitor with no league from a data route home', async () => {
    renderApp('/teams');
    expect(await screen.findByTestId('home-page')).toBeTruthy();
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });

  it('auto-enters guest mode on the public /rankings instead of redirecting', async () => {
    renderApp('/rankings');
    expect(await screen.findByTestId('rankings-page')).toBeTruthy();
    expect(h.enterGuestMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('loc').textContent).toBe('/rankings');
  });

  it('auto-enters guest mode on the public /trends instead of redirecting', async () => {
    renderApp('/trends');
    expect(await screen.findByTestId('trends-page')).toBeTruthy();
    expect(h.enterGuestMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('loc').textContent).toBe('/trends');
  });

  it('redirects the old /shifts URL to /trends', async () => {
    renderApp('/shifts');
    expect(await screen.findByTestId('trends-page')).toBeTruthy();
    expect(screen.getByTestId('loc').textContent).toBe('/trends');
  });
});

describe('Yahoo OAuth return (/yahoo-success)', () => {
  const tokens = { access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'bearer' };
  const tokensHash = `#tokens=${encodeURIComponent(JSON.stringify(tokens))}`;

  it('rejects a tampered state without saving the tokens riding along', async () => {
    h.validateOAuthState.mockReturnValue(false);
    renderApp(`/yahoo-success?state=forged${tokensHash}`);
    expect(await screen.findByTestId('home-page')).toBeTruthy();
    expect(h.saveTokens).not.toHaveBeenCalled();
    expect(h.clearOAuthState).toHaveBeenCalled();
    // The stash is discarded so a later login can't replay it.
    expect(h.takeOAuthReturn).toHaveBeenCalled();
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });

  it('saves the fragment tokens on a valid state and lands home', async () => {
    h.validateOAuthState.mockReturnValue(true);
    renderApp(`/yahoo-success?state=good${tokensHash}`);
    expect(await screen.findByTestId('home-page')).toBeTruthy();
    expect(h.saveTokens).toHaveBeenCalledWith(tokens);
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });
});
