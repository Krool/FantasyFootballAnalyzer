import type { Trade } from '@/types';

// How a trade's PAR numbers were computed. Sleeper and ESPN (weekly lineup
// starts) and Yahoo (weekly player points) cover only the weeks after the
// trade. A trade with no known week, or whose weekly data failed to load,
// spans the whole season. The basis is per trade, so one league can mix both.
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
  'post-trade': 'Verdicts compare points above replacement after the trade',
  'full-season':
    'Verdicts compare full-season value; weekly data was not available for this league',
};

// Page subtitle note for a set of trades: the shared basis, or a split count
// when some trades fell back to full-season value.
export function verdictBasisSummary(trades: Trade[] | undefined): string | undefined {
  const bases = (trades ?? []).map(t => t.verdictBasis).filter((b): b is TradeVerdictBasis => !!b);
  if (bases.length === 0) return undefined;
  const fullSeason = bases.filter(b => b === 'full-season').length;
  if (fullSeason === 0) return VERDICT_BASIS_NOTE['post-trade'];
  if (fullSeason === bases.length) return VERDICT_BASIS_NOTE['full-season'];
  return `${VERDICT_BASIS_NOTE['post-trade']}; ${fullSeason} of ${bases.length} use full-season value (weekly data was missing for those)`;
}

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
