import type { DraftPick, DraftGrade, League } from '@/types';
import type { SeasonOutlook } from './seasonOutlook';

// Grading now considers draft position - early picks are judged on hitting,
// later picks are judged on finding value. This creates a sliding scale.
// For auction drafts, grading is based on $ spent vs value received.

export interface GradedPick extends DraftPick {
  grade: DraftGrade;
  positionRank: number;
  expectedRank: number;
  valueOverExpected: number;
  // Auction-specific fields
  auctionValueGrade?: string; // e.g., "Great Value", "Overpay"
  // Pre-season auction only (dollar mode): the consensus market price the
  // pick was graded against, and how much an overpay hurt on the blended
  // dollars-times-ratio scale (see auctionOverpayDamage). 0 when the pick
  // was not an eligible overpay.
  marketValue?: number;
  auctionDamage?: number;
  // Which yardstick produced the grade, so the table can explain it on hover
  // (explainGrade). Optional only so hand-built test picks stay valid.
  gradeBasis?: GradeBasis;
  // Live season, graded on results, and he has no points yet (held out,
  // suspended, started on IR). No verdict until he plays: the table shows
  // "Pending", and summaries, awards, and exports leave him out (isGraded).
  // At season's end everyone is graded, so a lost season still reads as one.
  pending?: boolean;
  // Live season with weekly projections: the season value he was ranked on
  // (points so far, missed weeks at replacement, projected rest of season).
  outlook?: SeasonOutlook;
}

// True for picks that carry a verdict: not a keeper, not pending.
export function isGraded(pick: GradedPick): boolean {
  return !pick.isKeeper && !pick.pending;
}

export type GradeBasis =
  | 'auction-results' // season finish vs his price rank at the position
  | 'auction-market' // pre-season: price paid vs consensus market dollars
  | 'auction-consensus' // pre-season, no market price: cost rank vs consensus rank
  | 'snake-results' // season finish vs draft order at his position
  | 'snake-board' // pre-season: pick vs the consensus overall board
  | 'snake-consensus'; // pre-season: draft order vs consensus rank at his position

export interface DraftGradeSummary {
  great: number;
  good: number;
  bad: number;
  terrible: number;
  averageValue: number;
  totalPicks: number;
}

// Calculate position rank based on season points
export function calculatePositionRanks(
  _picks: DraftPick[],
  allPicks: DraftPick[],
  // What to rank on; season points by default. Mid-season grading passes
  // the season outlook (points so far + projected rest of season).
  valueOf: (pick: DraftPick) => number = pick => pick.seasonPoints || 0,
): Map<string, number> {
  const rankMap = new Map<string, number>();

  // Group all players by position
  const byPosition = new Map<string, DraftPick[]>();
  allPicks.forEach(pick => {
    const pos = pick.player.position;
    const players = byPosition.get(pos) || [];
    players.push(pick);
    byPosition.set(pos, players);
  });

  // Sort each position by season points and assign ranks. A player with no
  // points yet ranks with the zeros at the bottom rather than going unranked:
  // the unranked sentinel (999) once leaked into value as -986.
  byPosition.forEach((players, position) => {
    const sorted = [...players]
      .sort((a, b) => valueOf(b) - valueOf(a));

    sorted.forEach((player, index) => {
      rankMap.set(`${position}-${player.player.id}`, index + 1);
    });
  });

  return rankMap;
}

// Calculate expected position rank based on when they were drafted
export function calculateExpectedRank(
  pick: DraftPick,
  allPicks: DraftPick[]
): number {
  const position = pick.player.position;

  // Count how many players of this position were drafted before this pick
  const positionPicksBefore = allPicks.filter(
    p => p.player.position === position && p.pickNumber < pick.pickNumber
  ).length;

  // Expected rank is based on draft order within position
  return positionPicksBefore + 1;
}

// For auctions, nomination order is meaningless. Rank within position by cost
// descending instead: the most expensive RB is "expected RB1", next is RB2,
// and so on. Ties broken by pickNumber so ordering is deterministic.
export function calculateExpectedRanksByCost(allPicks: DraftPick[]): Map<string, number> {
  const rankMap = new Map<string, number>();
  const byPosition = new Map<string, DraftPick[]>();

  allPicks.forEach(pick => {
    const list = byPosition.get(pick.player.position) || [];
    list.push(pick);
    byPosition.set(pick.player.position, list);
  });

  byPosition.forEach(players => {
    const sorted = [...players].sort((a, b) => {
      const costDiff = (b.auctionValue || 0) - (a.auctionValue || 0);
      if (costDiff !== 0) return costDiff;
      return a.pickNumber - b.pickNumber;
    });
    sorted.forEach((pick, index) => {
      rankMap.set(`${pick.player.position}-${pick.player.id}`, index + 1);
    });
  });

  return rankMap;
}

// For auctions, a "round" is a cost tier: the top `totalTeams` most expensive
// players league-wide are round 1, the next batch round 2, and so on. Ties
// broken by pickNumber.
export function calculateAuctionRounds(
  allPicks: DraftPick[],
  totalTeams: number
): Map<string, number> {
  const roundMap = new Map<string, number>();
  if (totalTeams <= 0) return roundMap;

  const sorted = [...allPicks].sort((a, b) => {
    const costDiff = (b.auctionValue || 0) - (a.auctionValue || 0);
    if (costDiff !== 0) return costDiff;
    return a.pickNumber - b.pickNumber;
  });

  sorted.forEach((pick, index) => {
    roundMap.set(`${pick.teamId}-${pick.pickNumber}`, Math.floor(index / totalTeams) + 1);
  });

  return roundMap;
}

// Grading on results: where he finished at his position against where he was
// taken there (draft order for snake, price rank for auctions). The band
// scales with the slot: a quarter of it, at least 2 spots. Missing the 3rd
// RB's slot by 4 is a bust; missing the 22nd WR's by 4 is a fair outcome,
// and the old fixed cutoffs (an auction $15-39 player needed a top-5 finish
// for Great, past 15th was Terrible) graded a 14-team, 3-WR league's WR12 on
// a WR22 price as Bad (owner-reported, 2026-10-04). A top-3 finish at the
// position is always Great.
export function resultBand(expectedRank: number): number {
  return Math.max(2, expectedRank / 4);
}

export function gradeAgainstSlot(positionRank: number, expectedRank: number): DraftGrade {
  const band = resultBand(expectedRank);
  if (positionRank <= 3 || positionRank <= expectedRank - band) return 'great';
  if (positionRank <= expectedRank + band) return 'good';
  if (positionRank <= expectedRank + 3 * band) return 'bad';
  return 'terrible';
}

export function gradePick(
  _pick: DraftPick,
  positionRank: number,
  expectedRank: number,
): DraftGrade {
  return gradeAgainstSlot(positionRank, expectedRank);
}

// Grade a pick against the FantasyPros consensus (pre-season, no results yet).
//
// gradePick's thresholds are tuned for season outcomes, where a player can
// finish 20 spots off where he was drafted and "beat expectation by 2" is a
// real result. Consensus deltas are far tighter â€” across a full 12-team draft
// the median is 0 and the middle half lands between -2 and +1 â€” so reusing
// those bands calls every on-market pick "bad". These bands are cut from that
// distribution: meeting the market is fine, beating it by a tier is the win,
// and only a genuine reach grades out badly.
export function gradeConsensusPick(valueOverExpected: number): DraftGrade {
  if (valueOverExpected >= 4) return 'great'; // he fell a full tier past the market
  if (valueOverExpected >= -1) return 'good'; // at market, give or take a spot
  if (valueOverExpected >= -5) return 'bad'; // a reach, but a survivable one
  return 'terrible'; // nobody else had him within five spots at his position
}

// Consensus grading on the OVERALL board: the delta is slots on the draft
// board, so the bands are rounds, not positional places. Expressed in picks
// per round so an 8-team and a 16-team league grade on the same yardstick -
// "he fell a round" is the same event in both, but a very different number.
export function gradeConsensusBoardPick(
  valueOverExpected: number,
  picksPerRound: number,
): DraftGrade {
  const round = picksPerRound > 0 ? picksPerRound : 12;
  if (valueOverExpected >= round) return 'great'; // fell a full round past the market
  if (valueOverExpected >= -round / 2) return 'good'; // within half a round of his slot
  if (valueOverExpected >= -round * 2) return 'bad'; // a reach of a round or two
  return 'terrible'; // taken more than two rounds before the board had him
}

// Auction results: the same yardstick, with his price rank at the position
// (most expensive RB = RB1) as the slot. The label is the auction word.
const AUCTION_RESULT_LABEL: Record<DraftGrade, string> = {
  great: 'Steal',
  good: 'Fair',
  bad: 'Overpay',
  terrible: 'Bust',
};

export function gradeAuctionPick(
  positionRank: number,
  priceRank: number,
): { grade: DraftGrade; auctionValueGrade: string } {
  const grade = gradeAgainstSlot(positionRank, priceRank);
  return { grade, auctionValueGrade: AUCTION_RESULT_LABEL[grade] };
}

// Grade all picks in a league.
//
// `positionRanksOverride` swaps the "how good did he turn out" input. Left off,
// that's season points, which needs a season. Before Week 1 the caller passes
// FantasyPros consensus ranks (utils/consensusGrade.ts) so a finished draft is
// gradeable at the table instead of scoring every pick against a zeroed stat
// line.
// Pre-season auction grading judges a pick RELATIVE to what the player
// costs, not on raw dollars. Raw dollars called Gibbs at $75 against a $65
// market "Terrible" while $8 for a $1 flier was only a "Slight Overpay"
// (owner-reported, 2026-09-02). A pure ratio over-corrects the other way:
// market floors at $1, so a $3 flier would be a 200% overpay and half the
// room grades Terrible. So the ratio is softened: delta / (market + $10 at
// a $200 budget). The constant absorbs the $1 tail (a $3 flier scores
// -0.18) while big-ticket misses still read as a share of the player's
// price (Gibbs scores -0.13, $20 for a $5 player scores -1.0).
export const AUCTION_RATIO_SOFTENER = 10;

// Signed: positive is a bargain, negative an overpay. `delta` is market
// price minus price paid, in league dollars.
export function auctionRelativeDelta(delta: number, market: number, budget: number = 200): number {
  const scale = budget > 0 ? budget / 200 : 1;
  return delta / (Math.max(1, market) + AUCTION_RATIO_SOFTENER * scale);
}

// Bands on the softened ratio. Five labels over four grade colors, so the
// board reads as a gradient instead of a wall of "Good" (owner, 2026-09-02:
// the first cut had Fair Price spanning 20% under to 15% over and nearly
// every pick landed in it). Steals cut in a touch lower than overpays:
// prices are sticky at the top, so $10 under on a $65 player is a win.
export function gradeAuctionDollarDelta(
  delta: number,
  market: number,
  budget: number = 200,
): { grade: DraftGrade; auctionValueGrade: string } {
  const r = auctionRelativeDelta(delta, market, budget);
  if (r >= 0.12) return { grade: 'great', auctionValueGrade: 'Steal' };
  if (r >= -0.1) return { grade: 'good', auctionValueGrade: 'Fair Price' };
  if (r >= -0.25) return { grade: 'bad', auctionValueGrade: 'Slight Overpay' };
  if (r >= -0.45) return { grade: 'bad', auctionValueGrade: 'Overpay' };
  return { grade: 'terrible', auctionValueGrade: 'Big Overpay' };
}

// "$75 vs $65 market (15% over)" for tooltips. Market floors at $1, so the
// percent on a $1 player is honest about how silly the flier was.
export function describeAuctionMarket(paid: number, market: number): string {
  const m = Math.max(1, market);
  const pct = Math.round((Math.abs(paid - m) / m) * 100);
  const vs = paid > m ? ` (${pct}% over)` : paid < m ? ` (${pct}% under)` : '';
  return `$${paid} vs $${m} market${vs}`;
}

// How much an overpay actually hurt, for ranking the worst picks of a
// draft: dollars lost, weighted up by how far over the player's price it
// was. Pure dollars puts every $10 miss on a star at the top; pure ratio
// fills the list with $8 fliers on $1 players. Multiplying the two puts
// $8-for-$1 about level with $75-for-$65 and well below $20-for-$5, and a
// floor of $5 lost (at a $200 budget) keeps $3 fliers off the list
// entirely. 0 for anything that isn't an eligible overpay.
export const AUCTION_DAMAGE_FLOOR = 5;

export function auctionOverpayDamage(delta: number, market: number, budget: number = 200): number {
  const scale = budget > 0 ? budget / 200 : 1;
  if (delta > -AUCTION_DAMAGE_FLOOR * scale) return 0;
  const lost = -delta;
  return lost * (1 + Math.abs(auctionRelativeDelta(delta, market, budget)));
}

export function gradeAllPicks(
  league: League,
  positionRanksOverride?: Map<string, number>,
  // Pre-season auctions only: consensus market price in league dollars per
  // `${position}-${playerId}`. Present, the value column and grades switch
  // from rank deltas to dollar deltas (market minus paid) - a $3 overpay on
  // a $4 flier stops grading like a $20 torching just because half the
  // league went for $1-3 and rank space is packed there (owner-reported,
  // 2026-09-01: Deebo at $4/-12/Terrible next to a real $20 overpay).
  auctionMarketOverride?: Map<string, number>,
  // Snake consensus mode: where the consensus board would have taken each
  // player in THIS draft (see consensusBoardSlots). Present, value and grade
  // become board slot minus actual pick - a cross-positional reach/steal -
  // instead of a within-position comparison that cannot see the round.
  consensusBoardOverride?: Map<string, number>,
  // Live season, results mode: rank on season outlook instead of points so
  // far (seasonOutlook.ts). Keyed `${position}-${playerId}`.
  seasonOutlook?: Map<string, SeasonOutlook>,
): GradedPick[] {
  // Collect all draft picks from all teams
  const allPicks = league.teams.flatMap(team => team.draftPicks || []);

  if (allPicks.length === 0) {
    return [];
  }

  // Calculate position ranks
  const outlookFor = (pick: DraftPick) =>
    positionRanksOverride ? undefined : seasonOutlook?.get(`${pick.player.position}-${pick.player.id}`);
  const positionRanks =
    positionRanksOverride ??
    calculatePositionRanks(
      allPicks,
      allPicks,
      seasonOutlook ? pick => outlookFor(pick)?.total ?? pick.seasonPoints ?? 0 : undefined,
    );

  // Detect if this is an auction draft
  const isAuction = league.draftType === 'auction' || allPicks.some(p => p.auctionValue !== undefined && p.auctionValue > 0);

  // For auctions, expected rank and round come from cost, not nomination order.
  const auctionExpectedRanks = isAuction ? calculateExpectedRanksByCost(allPicks) : null;
  const auctionRounds = isAuction
    ? calculateAuctionRounds(allPicks, league.totalTeams || league.teams.length || 0)
    : null;

  // Grade each pick
  const graded = allPicks.map((pick): GradedPick => {
    const positionRank = positionRanks.get(`${pick.player.position}-${pick.player.id}`) || 999;
    const expectedRank = auctionExpectedRanks
      ? auctionExpectedRanks.get(`${pick.player.position}-${pick.player.id}`) || 999
      : calculateExpectedRank(pick, allPicks);
    const valueOverExpected = expectedRank - positionRank;

    if (isAuction) {
      // Pre-season (consensus override): gradeAuctionPick's bands ask "did a
      // $1 player FINISH top-10?", a season-results question. Fed consensus
      // ranks instead, a bargain can almost never rank that high, so every
      // $1 steal graded Bad while its value column said +20 (owner-reported,
      // 2026-08-31, first live auction report). Before Week 1, grade in
      // DOLLARS against the consensus market price when the caller supplied
      // one (a player the pool can't match falls back to a $1 market - an
      // unrankable flier is a $1 player by definition), and only failing
      // that from the cost-rank comparison.
      const auctionRound = auctionRounds?.get(`${pick.teamId}-${pick.pickNumber}`);
      if (positionRanksOverride && auctionMarketOverride) {
        const market =
          auctionMarketOverride.get(`${pick.player.position}-${pick.player.id}`) ?? 1;
        const delta = Math.round(market - (pick.auctionValue ?? 0));
        const budget = league.auctionBudget ?? 200;
        return {
          ...pick,
          round: auctionRound ?? pick.round,
          ...gradeAuctionDollarDelta(delta, market, budget),
          positionRank,
          expectedRank,
          valueOverExpected: delta,
          marketValue: market,
          auctionDamage: auctionOverpayDamage(delta, market, budget),
          gradeBasis: 'auction-market',
        };
      }
      const { grade, auctionValueGrade } = positionRanksOverride
        ? {
            grade: gradeConsensusPick(valueOverExpected),
            auctionValueGrade:
              valueOverExpected >= 4 ? 'Steal'
              : valueOverExpected >= -1 ? 'Fair Price'
              : valueOverExpected >= -5 ? 'Slight Overpay'
              : 'Overpay',
          }
        : gradeAuctionPick(positionRank, expectedRank);
      return {
        ...pick,
        round: auctionRound ?? pick.round,
        grade,
        positionRank,
        expectedRank,
        valueOverExpected,
        auctionValueGrade,
        gradeBasis: positionRanksOverride ? 'auction-consensus' : 'auction-results',
      };
    }

    // Consensus mode ranks by market opinion, not by what happened, so it gets
    // its own bands (see gradeConsensusPick / gradeConsensusBoardPick).
    // positionRank stays positional either way: it is the "Consensus" column
    // ("RB5"), which is still the useful thing to read off a row.
    const boardSlot = consensusBoardOverride?.get(
      `${pick.player.position}-${pick.player.id}`,
    );
    if (positionRanksOverride && boardSlot !== undefined) {
      // Positive means he fell to you, matching the positional convention
      // (expectedRank - positionRank): the market had him at slot 20 and you
      // got him at 34, that is +14 of value. A reach is negative.
      const boardValue = pick.pickNumber - boardSlot;
      return {
        ...pick,
        grade: gradeConsensusBoardPick(
          boardValue,
          league.totalTeams || league.teams.length || 0,
        ),
        positionRank,
        expectedRank: boardSlot,
        valueOverExpected: boardValue,
        gradeBasis: 'snake-board',
      };
    }
    const grade = positionRanksOverride
      ? gradeConsensusPick(valueOverExpected)
      : gradePick(pick, positionRank, expectedRank);

    return {
      ...pick,
      grade,
      positionRank,
      expectedRank,
      valueOverExpected,
      gradeBasis: positionRanksOverride ? 'snake-consensus' : 'snake-results',
    };
  });

  // Mid-season, a player with no points yet has not had his chance: held out,
  // suspended, or starting on IR, he may still pay off (owner, 2026-10-04).
  // Hold the verdict, and zero his value so nothing downstream sums a bust.
  if (positionRanksOverride) return graded;
  return graded.map(pick => {
    const outlook = outlookFor(pick);
    // A projection judges him on what he is expected to add (Jacobs back
    // from the exempt list, an IR rookie's return); only a live pick with
    // neither points nor a projection waits.
    if (outlook) return { ...pick, outlook };
    if (league.status !== 'live' || (pick.seasonPoints ?? 0) > 0) return pick;
    return { ...pick, pending: true, valueOverExpected: 0 };
  });
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

// Live: "Season outlook 328: 12.4 in 1 game + 2 weeks without a game at
// replacement (20.1) + 295.3 projected over the last 14 weeks (1 projected
// out, at replacement)." Final: "Season value 250: 220.0 in 15 games + 2
// weeks without a game (bye or missed) at replacement (20.0)."
export function describeOutlook(o: SeasonOutlook): string {
  const f = (n: number) => n.toFixed(1);
  const parts = [
    o.games !== undefined
      ? `${f(o.soFar)} in ${o.games} game${o.games === 1 ? '' : 's'}`
      : `${f(o.soFar)} ${o.final ? 'scored' : 'so far'}`,
  ];
  if (o.missedWeeks > 0) {
    const what = o.byeKnown
      ? `missed game${o.missedWeeks === 1 ? '' : 's'}`
      : `week${o.missedWeeks === 1 ? '' : 's'} without a game (bye or missed)`;
    parts.push(`${o.missedWeeks} ${what} at replacement (${f(o.missedPoints)})`);
  }
  if (o.remainingWeeks > 0 && o.basis !== 'none') {
    const out = o.seasonEnding
      ? ' (out for the season: 0)'
      : o.outWeeks > 0
        ? ` (${o.outWeeks} week${o.outWeeks === 1 ? '' : 's'} projected out: 0)`
        : '';
    const rest = {
      projection: `${f(o.projectedPoints)} projected for the rest of the season${out}`,
      'season-projection': `${f(o.projectedPoints)} from his season projection for the rest of the season${out}`,
      pace: `${f(o.projectedPoints)} at his points per game for the rest of the season${out} (no projection)`,
    }[o.basis];
    parts.push(rest);
  }
  const injury = o.injury ? ` ${o.injury}.` : '';
  return `${o.final ? 'Season value' : 'Season outlook'} ${o.total.toFixed(0)}: ${parts.join(' + ')}.${injury}`;
}

// One line on the Grade column header: what the grades in this table measure.
export function describeGradeBasis(
  basis: GradeBasis | undefined,
  outlook?: 'live' | 'final',
): string {
  if (outlook && (basis === 'auction-results' || basis === 'snake-results')) {
    return outlook === 'live'
      ? 'Season in progress: ranked on points so far, missed games at replacement, and projected points for the rest of the season (zero for weeks he is projected out; injury report included). Hover a grade for the math.'
      : 'Ranked on points scored plus a replacement-level starter for each week without a game, so points per game counts too. Hover a grade for the math.';
  }
  switch (basis) {
    case 'auction-results':
      return 'Where he finished at his position versus where his price ranked him there. Hover a grade for the math.';
    case 'auction-market':
      return 'Price paid versus the consensus market price. Hover a grade for the math.';
    case 'auction-consensus':
      return 'How he ranked on price at his position versus the consensus rank. Hover a grade for the math.';
    case 'snake-results':
      return 'Where he finished at his position versus where he was drafted at it. Hover a grade for the math.';
    case 'snake-board':
      return 'Where he was taken versus where the consensus board had him. Hover a grade for the math.';
    case 'snake-consensus':
      return 'Where he was drafted at his position versus the consensus rank. Hover a grade for the math.';
    default:
      return 'Hover a grade for the math.';
  }
}

// The grade badge's hover text: this pick's numbers, then the bands it was
// judged on. Mirrors the thresholds in gradePick, gradeAuctionPick,
// gradeAuctionDollarDelta and the consensus graders above; change them
// together.
export function explainGrade(
  pick: GradedPick,
  opts: { budget?: number; picksPerRound?: number } = {},
): string {
  if (pick.pending) {
    return 'No points yet (held out, suspended, or on IR). He gets a grade once he plays, or at season end.';
  }
  const pos = pick.player.position;
  const ranked = pick.positionRank < 999;
  const finish = ranked ? `${pos}${pick.positionRank}` : 'no points yet';
  const finishVerb = pick.outlook && !pick.outlook.final ? 'on track for' : 'finished';
  const outlookLine = pick.outlook ? ` ${describeOutlook(pick.outlook)}` : '';
  const vs = ranked ? ` (${signed(pick.valueOverExpected)})` : '';

  switch (pick.gradeBasis) {
    case 'snake-results':
    case 'auction-results': {
      const slot = `${pos}${pick.expectedRank}`;
      const head =
        pick.gradeBasis === 'auction-results'
          ? `Paid $${pick.auctionValue ?? 0}, the price of a ${slot}; ${finishVerb} ${finish}${vs}.${outlookLine}`
          : `Drafted as the ${slot}; ${finishVerb} ${finish}${vs}.${outlookLine}`;
      const band = resultBand(pick.expectedRank);
      const b = Number.isInteger(band) ? String(band) : band.toFixed(1);
      return `${head} Judged against his ${slot} slot, give or take ${b} spots: ${b}+ better (or a top-3 finish) Great, within ${b} Good, up to ${Number((band * 3).toFixed(1))} worse Bad, worse Terrible.`;
    }
    case 'auction-market': {
      const market = describeAuctionMarket(pick.auctionValue ?? 0, pick.marketValue ?? 1);
      return `${pick.auctionValueGrade ?? ''}: ${market}. Judged on the overpay as a share of his price (cheap players get a $10 cushion): 12%+ under Great, within 10% Good, up to 25% over Fair, up to 45% over Bad, more Terrible.`;
    }
    case 'auction-consensus':
      return `The ${ordinal(pick.expectedRank)} priciest ${pos}, consensus ${finish}${vs}. 4+ spots better Great, within 1 Good, up to 5 worse Bad, more Terrible.`;
    case 'snake-board': {
      const round = opts.picksPerRound && opts.picksPerRound > 0 ? opts.picksPerRound : 12;
      return `Taken at pick ${pick.pickNumber}; the consensus board had him at ${pick.expectedRank} (${signed(pick.valueOverExpected)}). A round is ${round} picks: fell a round or more Great, within half a round Good, up to two rounds early Bad, earlier Terrible.`;
    }
    case 'snake-consensus':
      return `Drafted as the ${ordinal(pick.expectedRank)} ${pos}, consensus ${finish}${vs}. 4+ spots better Great, within 1 Good, up to 5 worse Bad, more Terrible.`;
    default:
      return '';
  }
}

// Calculate draft grade summary for a team
export function calculateDraftSummary(picks: GradedPick[]): DraftGradeSummary {
  const summary: DraftGradeSummary = {
    great: 0,
    good: 0,
    bad: 0,
    terrible: 0,
    averageValue: 0,
    totalPicks: picks.length,
  };

  const graded = picks.filter(p => !p.pending);
  summary.totalPicks = graded.length;
  if (graded.length === 0) return summary;

  let totalValue = 0;

  graded.forEach(pick => {
    summary[pick.grade]++;
    totalValue += pick.valueOverExpected;
  });

  summary.averageValue = totalValue / graded.length;

  return summary;
}

// Get color class for a grade
export function getGradeColorClass(grade: DraftGrade): string {
  switch (grade) {
    case 'great':
      return 'grade-great';
    case 'good':
      return 'grade-good';
    case 'bad':
      return 'grade-bad';
    case 'terrible':
      return 'grade-terrible';
    default:
      return '';
  }
}

// Get display text for a grade
// Dollar-mode badge word for the five market bands. The grade colors stay
// four-wide (great/good/bad/terrible feed every summary), but the badge gets
// a Fair step between Good and Bad so a 15% reach on a star reads as the
// middle ground it is, not a Bad (owner, 2026-09-02). Short words only: the
// column has no horizontal room for "Slight Overpay".
export function auctionBadgeWord(auctionValueGrade: string | undefined, grade: DraftGrade): { word: string; cls: string } {
  switch (auctionValueGrade) {
    case 'Steal': return { word: 'Great', cls: 'great' };
    case 'Fair Price': return { word: 'Good', cls: 'good' };
    case 'Slight Overpay': return { word: 'Fair', cls: 'fair' };
    case 'Overpay': return { word: 'Bad', cls: 'bad' };
    case 'Big Overpay': return { word: 'Terrible', cls: 'terrible' };
    default: return { word: getGradeDisplayText(grade), cls: grade };
  }
}

export function getGradeDisplayText(grade: DraftGrade): string {
  return grade.charAt(0).toUpperCase() + grade.slice(1);
}

// Format value over expected with sign
export function formatValueOverExpected(value: number, dollars = false): string {
  if (dollars) {
    if (value > 0) return `+$${value.toFixed(0)}`;
    if (value < 0) return `-$${Math.abs(value).toFixed(0)}`;
    return '$0';
  }
  if (value > 0) {
    return `+${value.toFixed(0)}`;
  }
  return value.toFixed(0);
}
