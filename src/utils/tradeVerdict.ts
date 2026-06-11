import type { Trade } from '@/types';

// How a trade's PAR numbers were computed. Sleeper (weekly starts) and Yahoo
// (weekly player points) cover only the weeks after the trade; ESPN, and any
// platform whose weekly fetch failed, spans the whole season.
export type TradeVerdictBasis = 'post-trade' | 'full-season';

// One threshold per basis, in PAR. Post-trade PAR accrues over fewer weeks,
// so a smaller margin already signals a real win; full-season PAR runs much
// larger, so it needs a wider gap before calling a winner.
const WINNER_THRESHOLD: Record<TradeVerdictBasis, number> = {
  'post-trade': 5,
  'full-season': 20,
};

// Human-readable note for the UI so verdicts from different platforms are
// never silently compared on different math.
export const VERDICT_BASIS_NOTE: Record<TradeVerdictBasis, string> = {
  'post-trade': 'Verdicts compare points above replacement after the trade.',
  'full-season':
    'Verdicts compare full-season value; weekly data was not available for this league.',
};

export function decideTradeWinner(
  teams: Trade['teams'],
  basis: TradeVerdictBasis,
): { winner?: string; winnerMargin: number } {
  if (teams.length !== 2) return { winnerMargin: 0 };
  const [team1, team2] = teams;
  const diff = team1.netPAR - team2.netPAR;
  if (Math.abs(diff) <= WINNER_THRESHOLD[basis]) return { winnerMargin: 0 };
  return {
    winner: diff > 0 ? team1.teamId : team2.teamId,
    winnerMargin: Math.abs(diff),
  };
}
