// TrendsPage rendering against a fixture history: rows join to the pool,
// direction styling and labels, headshot fallback, and the pre-history empty
// state. Data files are mocked so the test never depends on the live pool.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { League } from '@/types';

const h = vi.hoisted(() => ({
  pool: {
    season: 2026,
    generatedAt: '2026-08-27T11:23:00.000Z',
    baseline: { budget: 200, teams: 12, rounds: 14 },
    players: [
      {
        id: 'riser-rb', name: 'Rise Guy', team: 'KC', pos: 'RB', posRank: 3,
        overallRank: 10, tier: 1, bye: 10, baseValue: null, sleeperId: '1234',
      },
      {
        id: 'faller-wr', name: 'Fall Guy', team: 'DAL', pos: 'WR', posRank: 8,
        overallRank: 20, tier: 2, bye: 7, baseValue: null,
      },
      {
        id: 'quiet-qb', name: 'Quiet Guy', team: 'BUF', pos: 'QB', posRank: 1,
        overallRank: 30, tier: 3, bye: 12, baseValue: null,
      },
    ],
  },
  history: {
    season: 2026,
    settings: { formats: ['half_ppr', 'ppr', 'standard', 'superflex'], depth: 300 },
    snapshots: [
      // The superflex board holds still while half PPR moves, so the format
      // chips have observable behavior.
      {
        date: '2026-08-20',
        sources: ['fantasypros'],
        boards: {
          half_ppr: { 'riser-rb': 30, 'faller-wr': 10, 'quiet-qb': 30 },
          ppr: { 'riser-rb': 30, 'faller-wr': 10, 'quiet-qb': 30 },
          standard: { 'riser-rb': 30, 'faller-wr': 10, 'quiet-qb': 30 },
          superflex: { 'riser-rb': 30, 'faller-wr': 10, 'quiet-qb': 5 },
        },
      },
      {
        date: '2026-08-26',
        sources: ['fantasypros'],
        boards: {
          half_ppr: { 'riser-rb': 22, 'faller-wr': 14, 'quiet-qb': 30 },
          ppr: { 'riser-rb': 22, 'faller-wr': 14, 'quiet-qb': 30 },
          standard: { 'riser-rb': 22, 'faller-wr': 14, 'quiet-qb': 30 },
          superflex: { 'riser-rb': 30, 'faller-wr': 10, 'quiet-qb': 5 },
        },
      },
      {
        date: '2026-08-27',
        sources: ['fantasypros'],
        boards: {
          half_ppr: { 'riser-rb': 8, 'faller-wr': 18, 'quiet-qb': 30 },
          ppr: { 'riser-rb': 8, 'faller-wr': 18, 'quiet-qb': 30 },
          standard: { 'riser-rb': 8, 'faller-wr': 18, 'quiet-qb': 30 },
          superflex: { 'riser-rb': 30, 'faller-wr': 10, 'quiet-qb': 5 },
        },
      },
    ],
  },
}));

vi.mock('@/data/draftPool', () => ({ POOL: h.pool }));
vi.mock('@/data/adpHistory', () => ({ ADP_HISTORY: h.history }));
vi.mock('@/hooks/useSounds', () => ({
  useSounds: () => ({ playFilter: () => {} }),
}));

import { TrendsPage } from './TrendsPage';

const guestLeague = { name: 'Guest League', isGuest: true } as unknown as League;

describe('TrendsPage', () => {
  it('renders both windows with movers joined to the pool', () => {
    render(<TrendsPage league={guestLeague} />);
    expect(screen.getByRole('heading', { name: /ADP Trends/i })).toBeTruthy();
    // Day window vs 8/26: riser +14, faller -4. Week window vs 8/20: +22 / -8.
    expect(screen.getByRole('heading', { name: /Last Day/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Last Week/i })).toBeTruthy();
    expect(screen.getAllByText('Rise Guy')).toHaveLength(2);
    expect(screen.getAllByText('Fall Guy')).toHaveLength(2);
    expect(screen.getByText(/▲ 14/)).toBeTruthy();
    expect(screen.getByText(/▼ 4/)).toBeTruthy();
    expect(screen.getByText(/▲ 22/)).toBeTruthy();
    expect(screen.getByText(/▼ 8/)).toBeTruthy();
    // The unmoved player never appears as a mover.
    expect(screen.queryByText('Quiet Guy')).toBeNull();
  });

  it('labels each window with the span it actually compared', () => {
    render(<TrendsPage league={guestLeague} />);
    expect(screen.getByText(/Aug 26 → Aug 27/)).toBeTruthy();
    expect(screen.getByText(/Aug 20 → Aug 27/)).toBeTruthy();
    // The board's own date, not the pool build stamp.
    expect(screen.getByText(/Board as of Aug 27/)).toBeTruthy();
  });

  it('collapses to one window when day and week share a baseline', () => {
    const snapshots = h.history.snapshots;
    h.history.snapshots = snapshots.slice(-2); // only 08-26 and 08-27 remain
    try {
      render(<TrendsPage league={guestLeague} />);
      expect(screen.getByRole('heading', { name: /Last Day/i })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: /Last Week/i })).toBeNull();
    } finally {
      h.history.snapshots = snapshots;
    }
  });

  it('switches boards when a format chip is picked', () => {
    render(<TrendsPage league={guestLeague} />);
    // Half PPR (the default) shows the movers.
    expect(screen.getAllByText('Rise Guy').length).toBeGreaterThan(0);
    // The superflex board held still all week: no movers in either window.
    fireEvent.click(screen.getByRole('button', { name: 'Superflex' }));
    expect(screen.queryByText('Rise Guy')).toBeNull();
    expect(screen.getAllByText(/Nothing rose/).length).toBeGreaterThan(0);
    // And back.
    fireEvent.click(screen.getByRole('button', { name: 'Half PPR' }));
    expect(screen.getAllByText('Rise Guy').length).toBeGreaterThan(0);
  });

  it('falls back to an initials chip when there is no headshot', () => {
    render(<TrendsPage league={guestLeague} />);
    // Fall Guy has no sleeperId: initials chip immediately.
    expect(screen.getAllByText('FG').length).toBeGreaterThan(0);
    // Rise Guy has one; simulate the CDN 404 and the chip takes over.
    const img = document.querySelector('img[src*="1234"]')!;
    expect(img).toBeTruthy();
    fireEvent.error(img);
    expect(screen.getAllByText('RG').length).toBeGreaterThan(0);
  });

  it('shows the warming-up empty state with fewer than two snapshots', () => {
    const snapshots = h.history.snapshots;
    h.history.snapshots = snapshots.slice(-1);
    try {
      render(<TrendsPage league={guestLeague} />);
      expect(
        screen.getAllByText(/Movement shows up after the next daily rankings update/i),
      ).toHaveLength(2);
    } finally {
      h.history.snapshots = snapshots;
    }
  });
});
