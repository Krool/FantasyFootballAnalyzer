import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Team } from '@/types';
import { POOL } from '@/data/draftPool';
import { DraftTable } from './DraftTable';

// Real pool players, so consensus ranks and projections are the ones the page
// actually renders. Picked for a wide consensus spread at one position.
const rbs = POOL.players
  .filter(p => p.pos === 'RB' && p.sleeperId && p.overallRank != null)
  .sort((a, b) => a.overallRank! - b.overallRank!);
const [best, second, third] = rbs;

// The shape this guards: a keeper comes off the board at the round he costs,
// so a top-ranked back kept late looks like the draft's biggest steal.
const KEPT_LATE = best;
const DRAFTED_EARLY = second;
const DRAFTED_LATE = third;

const teams: Team[] = [
  {
    id: 't1',
    name: 'Keepers',
    draftPicks: [
      {
        pickNumber: 1,
        round: 1,
        player: { id: DRAFTED_EARLY.sleeperId!, platformId: DRAFTED_EARLY.sleeperId!, name: DRAFTED_EARLY.name, position: 'RB', team: DRAFTED_EARLY.team },
        teamId: 't1',
        teamName: 'Keepers',
      },
      {
        pickNumber: 150,
        round: 13,
        player: { id: KEPT_LATE.sleeperId!, platformId: KEPT_LATE.sleeperId!, name: KEPT_LATE.name, position: 'RB', team: KEPT_LATE.team },
        teamId: 't1',
        teamName: 'Keepers',
        isKeeper: true,
      },
    ],
  },
  {
    id: 't2',
    name: 'Drafters',
    draftPicks: [
      {
        pickNumber: 2,
        round: 1,
        player: { id: DRAFTED_LATE.sleeperId!, platformId: DRAFTED_LATE.sleeperId!, name: DRAFTED_LATE.name, position: 'RB', team: DRAFTED_LATE.team },
        teamId: 't2',
        teamName: 'Drafters',
      },
    ],
  },
] as unknown as Team[];

function renderTable() {
  return render(
    <MemoryRouter>
      <DraftTable teams={teams} totalTeams={2} draftType="snake" scoringType="ppr" />
    </MemoryRouter>,
  );
}

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest('tr')!;
}

describe('DraftTable keeper handling', () => {
  it('gives a kept player no reach-or-steal verdict', () => {
    renderTable();
    const row = rowFor(KEPT_LATE.name);
    expect(within(row).getByText('Keeper')).toBeInTheDocument();
    expect(within(row).queryByText(/Great|Good|Bad|Terrible/)).not.toBeInTheDocument();
    // The value column reads as "no judgment", not as a large positive edge.
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('still grades the players who were actually drafted', () => {
    renderTable();
    const row = rowFor(DRAFTED_EARLY.name);
    expect(within(row).queryByText('Keeper')).not.toBeInTheDocument();
    expect(within(row).getByText(/Great|Good|Bad|Terrible/)).toBeInTheDocument();
  });

  it('leaves the keeper out of the grade tally', () => {
    renderTable();
    // Two drafted picks; the keeper must not be counted among them.
    const badges = ['Great', 'Good', 'Bad', 'Terrible'].map(g => {
      const el = screen.getByText(new RegExp(`^\\d+ ${g}$`));
      return parseInt(el.textContent!, 10);
    });
    expect(badges.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('keeps a late keeper off the top when sorting by value', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: /Sort by Value/i }));

    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map(r => r.textContent ?? '');
    // Whichever direction the sort runs, the kept player parks behind the
    // real picks instead of leading the steal list.
    expect(names[names.length - 1]).toContain(KEPT_LATE.name);

    fireEvent.click(screen.getByRole('button', { name: /Sort by Value/i }));
    const flipped = screen
      .getAllByRole('row')
      .slice(1)
      .map(r => r.textContent ?? '');
    expect(flipped[flipped.length - 1]).toContain(KEPT_LATE.name);
  });

  it('still shows the keeper his row, rank, and projection', () => {
    renderTable();
    const row = rowFor(KEPT_LATE.name);
    expect(within(row).getByText('RB1')).toBeInTheDocument();
  });
});
