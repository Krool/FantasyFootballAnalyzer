import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { League } from '@/types';
import { POOL } from '@/data/draftPool';
import { DraftRoomPage } from './DraftRoomPage';

// jsdom ships no matchMedia, so useMediaQuery reports false and the page
// renders its desktop layout. Stub it to put the page on a phone.
function stubViewport(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query === '(max-width: 640px)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function makeLeague(overrides: Partial<League> = {}): League {
  return {
    id: '1240782642371104768',
    platform: 'sleeper',
    name: '415 Football Club',
    season: 2025,
    draftType: 'snake',
    teams: Array.from({ length: 12 }, (_, i) => ({
      id: `t${i + 1}`,
      name: `Team ${i + 1}`,
    })),
    scoringType: 'half_ppr',
    totalTeams: 12,
    isLoaded: true,
    status: 'final',
    ...overrides,
  };
}

describe('DraftRoomPage', () => {
  it('renders the setup phase for a completed Sleeper league', () => {
    render(
      <MemoryRouter>
        <DraftRoomPage league={makeLeague()} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Draft Room')).toBeInTheDocument();
    expect(screen.getByText(/Start.*Draft/)).toBeInTheDocument();
    // Teams seeded from the league
    expect(screen.getByDisplayValue('Team 1')).toBeInTheDocument();
  });

  it('renders for a league with no teams (falls back to placeholders)', () => {
    render(
      <MemoryRouter>
        <DraftRoomPage league={makeLeague({ teams: [], totalTeams: 10 })} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Draft Room')).toBeInTheDocument();
  });

  it('renders for an auction league without rosterSlots', () => {
    render(
      <MemoryRouter>
        <DraftRoomPage league={makeLeague({ draftType: 'auction', rosterSlots: undefined })} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Budget Per Team/i)).toBeInTheDocument();
  });
});

// A live draft on a phone is the most space-starved screen in the app: the
// masthead and the bar's control cluster used to push the board and the
// player sheet below the fold. Those controls now live in the sheet's
// settings pane, so the bar can be a single status line.
describe('DraftRoomPage phone focus mode', () => {
  afterEach(() => {
    stubViewport(false);
    document.body.classList.remove('draft-focus');
    vi.useRealTimers();
  });

  // Starts a draft with the AI off, so no sim timers fire mid-assertion.
  function startDraftOnPhone() {
    stubViewport(true);
    render(
      <MemoryRouter>
        <DraftRoomPage league={makeLeague()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByLabelText(/auto-pick the other teams/i));
    fireEvent.click(screen.getByText(/Start.*Draft/));
  }

  it('drops the masthead and moves the controls out of the status bar', () => {
    startDraftOnPhone();

    // The billboard is gone; the config line it carried reappears in settings.
    expect(screen.queryByRole('heading', { name: 'Draft Room' })).not.toBeInTheDocument();
    // Reset is destructive and rarely wanted mid-draft: one level down now.
    expect(screen.queryByText(/Reset Draft/i)).not.toBeInTheDocument();
    // The live status line survives - that's the whole point of the strip.
    expect(screen.getByText(/Pick 1\//i)).toBeInTheDocument();
  });

  it('reaches the moved controls through the settings tab', () => {
    startDraftOnPhone();

    fireEvent.click(screen.getByRole('button', { name: 'Draft settings' }));

    expect(screen.getByText(/Reset Draft/i)).toBeInTheDocument();
    // The config line the masthead used to carry.
    expect(screen.getByText(/415 Football Club · 2026 Snake/i)).toBeInTheDocument();
    // Focus mode hides the app nav, so settings has to carry the way out.
    expect(screen.getByRole('link', { name: /Rankings/i })).toBeInTheDocument();
  });

  it('carries a close button, since focus mode hides the app header', () => {
    startDraftOnPhone();
    expect(screen.getByRole('link', { name: /Leave the draft room/i })).toBeInTheDocument();
  });

  it('flags focus mode on the body so the app header and banner can hide', () => {
    expect(document.body).not.toHaveClass('draft-focus');
    startDraftOnPhone();
    expect(document.body).toHaveClass('draft-focus');
  });

  it('keeps the controls in the status bar on a desktop viewport', () => {
    stubViewport(false);
    render(
      <MemoryRouter>
        <DraftRoomPage league={makeLeague()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByLabelText(/auto-pick the other teams/i));
    fireEvent.click(screen.getByText(/Start.*Draft/));

    expect(screen.getByRole('heading', { name: 'Draft Room' })).toBeInTheDocument();
    expect(screen.getByText(/Reset Draft/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Draft settings' })).not.toBeInTheDocument();
  });
});

// On the phone the auction logger lives in the Log tab, so a tap that only
// selects a player is an invisible no-op (b8fa1c0). Queue-tab taps must land
// the user in the Log tab with the logger showing.
describe('DraftRoomPage phone auction nomination', () => {
  beforeEach(() => {
    // Earlier tests leave saved sessions behind; a resumed snake session
    // would shadow the fresh auction config these tests set up.
    localStorage.clear();
  });
  afterEach(() => {
    stubViewport(false);
    document.body.classList.remove('draft-focus');
  });

  // A live (not mock) auction draft on a phone.
  function startLiveAuctionOnPhone(overrides: Partial<League> = {}) {
    stubViewport(true);
    render(
      <MemoryRouter>
        <DraftRoomPage league={makeLeague({ draftType: 'auction', ...overrides })} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByLabelText(/auto-pick the other teams/i));
    fireEvent.click(screen.getByText(/Start.*Draft/));
  }

  function activeTab() {
    return screen
      .getAllByRole('button', { pressed: true })
      .map(b => b.textContent)
      .join(',');
  }

  // Log a sale from the Log tab: the logger already holds a selected player.
  function logSale(winnerId: string, price: string) {
    fireEvent.change(screen.getByLabelText('Won by'), { target: { value: winnerId } });
    fireEvent.change(screen.getByLabelText('Sale price'), { target: { value: price } });
    fireEvent.click(screen.getByText('Sold'));
  }

  function rowByPos(pos: RegExp) {
    const row = screen.getAllByRole('listitem').find(li => pos.test(li.textContent ?? ''));
    if (!row) throw new Error(`no player row matching ${pos}`);
    return row;
  }

  it('routes a Nomination Ideas tap into the Log tab with the sale logger up', () => {
    // Two teams so the nomination rotation returns to me after one
    // opponent sale; bait ideas need a filled position and my turn.
    startLiveAuctionOnPhone({
      teams: [
        { id: 't1', name: 'Team 1' },
        { id: 't2', name: 'Team 2' },
      ],
      totalTeams: 2,
    });

    // Fill both my RB slots (RB keeps real auction value even at 2 teams;
    // a "set" QB slot baits nothing since 2-team VOR prices QBs near $1),
    // with an opponent sale between each so the rotation returns to me.
    // My buys go through the row Nominate button - the flow under test.
    for (let i = 0; i < 2; i++) {
      fireEvent.click(within(rowByPos(/RB\d/)).getByText('Nominate'));
      logSale('t1', '10');
      fireEvent.click(screen.getByRole('button', { name: 'Players' }));
      fireEvent.click(rowByPos(/WR\d/));
      fireEvent.click(screen.getByRole('button', { name: 'Log' }));
      logSale('t2', '5');
      fireEvent.click(screen.getByRole('button', { name: 'Players' }));
    }

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    expect(screen.getByText('Nomination Ideas')).toBeInTheDocument();
    const [suggestion] = screen.getAllByTitle(/^Select .+ for the logger$/);
    const name = suggestion.title.replace(/^Select /, '').replace(/ for the logger$/, '');
    fireEvent.click(suggestion);

    // The tap used to select silently and stay on the Queue tab.
    expect(activeTab()).toContain('Log');
    expect(screen.queryByText('No player selected')).not.toBeInTheDocument();
    expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(screen.getByText(/Won By/)).toBeInTheDocument();
  });

  it('routes a queued-player tap into the Log tab too', () => {
    // The phone list has no queue toggle (queueing is a desktop-table
    // affordance), so seed the persisted queue the hook reads on mount.
    const player = POOL.players[0];
    localStorage.setItem(
      `ffa:draftQueue:v1:sleeper:1240782642371104768:${POOL.season}`,
      JSON.stringify([player.id]),
    );
    startLiveAuctionOnPhone();

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    fireEvent.click(screen.getByTitle(`Select ${player.name} for the pick logger`));

    expect(activeTab()).toContain('Log');
    expect(screen.queryByText('No player selected')).not.toBeInTheDocument();
    expect(screen.getByText(/Won By/)).toBeInTheDocument();
  });
});
