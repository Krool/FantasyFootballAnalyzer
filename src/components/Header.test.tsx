import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { League } from '@/types';
import { Header } from './Header';

// Minimal league: Header only reads name/status/season off it, plus its
// existence, which is what decides the nav.
const LEAGUE = {
  id: 'l1',
  platform: 'sleeper',
  name: 'Test League',
  season: 2025,
  draftType: 'snake',
  teams: [],
  scoringType: 'half_ppr',
  totalTeams: 12,
  isLoaded: true,
} as unknown as League;

function renderAt(path: string, props: Partial<React.ComponentProps<typeof Header>> = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Header {...props} />
    </MemoryRouter>,
  );
}

// The league nav's links all redirect anyone without a real league, and its
// PDF button is a no-op with nothing to export. It used to render on the
// public tool landings, which visitors reach from search with no league.
describe('Header nav', () => {
  it('shows only the public routes on a tool landing with no league', () => {
    renderAt('/trade-analyzer');

    expect(screen.getByRole('link', { name: 'Rankings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Values' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Trades' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Awards' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export PDF/ })).not.toBeInTheDocument();
  });

  it('keeps guests off the league nav too', () => {
    renderAt('/trade-analyzer', { league: LEAGUE, isGuest: true });

    expect(screen.getByRole('link', { name: 'Rankings' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Waivers' })).not.toBeInTheDocument();
  });

  it('shows the league nav once a real league is connected', () => {
    renderAt('/trades', { league: LEAGUE, leagueName: 'Test League' });

    expect(screen.getByRole('link', { name: 'Trades' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Awards' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export PDF/ })).toBeInTheDocument();
  });

  it('keeps the focused nav on draft-prep routes even with a league', () => {
    renderAt('/rankings', { league: LEAGUE, leagueName: 'Test League' });

    expect(screen.getByRole('link', { name: 'Values' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Teams' })).not.toBeInTheDocument();
  });

  it('drops the header CTA where GuestBanner carries its own', () => {
    renderAt('/rankings', { league: LEAGUE, isGuest: true });
    expect(screen.queryByRole('button', { name: 'Connect your league' })).not.toBeInTheDocument();

    renderAt('/', { league: LEAGUE, isGuest: true });
    expect(screen.getByRole('button', { name: 'Connect your league' })).toBeInTheDocument();
  });
});
