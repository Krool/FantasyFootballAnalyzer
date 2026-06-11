import { describe, it, expect } from 'vitest';
import type { Trade } from '@/types';
import { decideTradeWinner } from './tradeVerdict';

function makeTeams(netPAR1: number, netPAR2: number): Trade['teams'] {
  const base = {
    teamName: '',
    playersReceived: [],
    playersSent: [],
    parGained: 0,
    parLost: 0,
    pointsGained: 0,
    pointsLost: 0,
    netValue: 0,
  };
  return [
    { ...base, teamId: 'A', netPAR: netPAR1 },
    { ...base, teamId: 'B', netPAR: netPAR2 },
  ];
}

describe('decideTradeWinner', () => {
  it('calls a post-trade winner above the 5 PAR margin', () => {
    const verdict = decideTradeWinner(makeTeams(8, 1), 'post-trade');
    expect(verdict.winner).toBe('A');
    expect(verdict.winnerMargin).toBe(7);
  });

  it('calls no post-trade winner at or below the margin', () => {
    const verdict = decideTradeWinner(makeTeams(4, -1), 'post-trade');
    expect(verdict.winner).toBeUndefined();
    expect(verdict.winnerMargin).toBe(0);
  });

  it('requires the wider 20 PAR margin on full-season numbers', () => {
    // The same 7 PAR gap that wins post-trade is a fair trade season-wide.
    expect(decideTradeWinner(makeTeams(8, 1), 'full-season').winner).toBeUndefined();
    expect(decideTradeWinner(makeTeams(30, 5), 'full-season').winner).toBe('A');
  });

  it('picks the other side when the gap is negative', () => {
    const verdict = decideTradeWinner(makeTeams(-10, 3), 'post-trade');
    expect(verdict.winner).toBe('B');
    expect(verdict.winnerMargin).toBe(13);
  });

  it('never calls a winner for 3+ team trades', () => {
    const teams = [...makeTeams(50, 0), { ...makeTeams(0, 0)[0], teamId: 'C' }];
    expect(decideTradeWinner(teams, 'full-season')).toEqual({ winnerMargin: 0 });
  });
});
