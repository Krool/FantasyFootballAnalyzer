import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { League } from '@/types';
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
