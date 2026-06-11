import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { League } from '@/types';
import { DraftRoomPage } from './DraftRoomPage';

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
