import { describe, it, expect } from 'vitest';
import { nominationStats } from './nominationAnalysis';
import type { DraftPick, Player, Team } from '@/types';

const player = (id: string): Player => ({ id, platformId: id, name: id, position: 'RB', team: 'FA' });

const pick = (
  n: number,
  wonBy: string,
  nominatedBy: string | undefined,
  cost: number,
  isKeeper = false,
): DraftPick => ({
  pickNumber: n,
  round: 1,
  player: player(`p${n}`),
  teamId: wonBy,
  teamName: wonBy,
  auctionValue: cost,
  nominatedByTeamId: nominatedBy,
  isKeeper,
});

const teamsOf = (picks: DraftPick[]): Team[] =>
  (['t1', 't2'] as const).map(id => ({
    id,
    name: id === 't1' ? 'Sharks' : 'Jets',
    draftPicks: picks.filter(p => p.teamId === id),
  })) as unknown as Team[];

describe('nominationStats', () => {
  it('returns null when no pick carries a nominator (Sleeper, Yahoo)', () => {
    expect(nominationStats(teamsOf([pick(1, 't1', undefined, 10)]))).toBeNull();
  });

  it('returns null when coverage is sparse (a stray field on a few picks)', () => {
    const picks = [
      pick(1, 't1', 't1', 10),
      pick(2, 't2', undefined, 5),
      pick(3, 't2', undefined, 5),
    ];
    expect(nominationStats(teamsOf(picks))).toBeNull();
  });

  it('computes own-win rate and the dollars extracted from the room', () => {
    const picks = [
      pick(1, 't1', 't1', 40), // t1 nominated, t1 won: spent on own
      pick(2, 't2', 't1', 25), // t1 nominated, t2 won: extracted
      pick(3, 't1', 't2', 15), // t2 nominated, t1 won: extracted for t2
      pick(4, 't2', 't2', 1), // t2 nominated, t2 won
    ];
    const stats = nominationStats(teamsOf(picks))!;
    const t1 = stats.find(s => s.teamId === 't1')!;
    expect(t1.teamName).toBe('Sharks');
    expect(t1.nominations).toBe(2);
    expect(t1.wonOwn).toBe(1);
    expect(t1.winRate).toBe(0.5);
    expect(t1.spentOnOwn).toBe(40);
    expect(t1.extracted).toBe(25);
    const t2 = stats.find(s => s.teamId === 't2')!;
    expect(t2.winRate).toBe(0.5);
    expect(t2.extracted).toBe(15);
  });

  it('sorts by win rate, then by nomination volume', () => {
    const picks = [
      pick(1, 't1', 't1', 10),
      pick(2, 't1', 't1', 10),
      pick(3, 't2', 't2', 5),
      pick(4, 't1', 't2', 5), // t2 loses one: 50%
    ];
    const stats = nominationStats(teamsOf(picks))!;
    expect(stats[0].teamId).toBe('t1');
    expect(stats[1].teamId).toBe('t2');
  });

  it('ignores keeper slots: assigned, not nominated', () => {
    const picks = [
      pick(1, 't1', 't1', 40, true), // keeper riding a nominator field
      pick(2, 't1', 't1', 10),
      pick(3, 't2', 't1', 5),
    ];
    const stats = nominationStats(teamsOf(picks))!;
    const t1 = stats.find(s => s.teamId === 't1')!;
    expect(t1.nominations).toBe(2);
    expect(t1.spentOnOwn).toBe(10);
  });

  it('labels a nominator the roster list no longer carries by id', () => {
    const picks = [
      pick(1, 't1', 'ghost', 10),
      pick(2, 't2', 'ghost', 5),
    ];
    const stats = nominationStats(teamsOf(picks))!;
    expect(stats[0].teamId).toBe('ghost');
    expect(stats[0].teamName).toBe('ghost');
    expect(stats[0].extracted).toBe(15);
  });
});
