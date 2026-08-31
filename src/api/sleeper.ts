import type { SleeperAPI, League, LeagueStatus, SeasonOption, Team, DraftPick, Transaction, Player, Trade, SeasonSummary, HeadToHeadRecord, RosterSlots, WeeklyMatchup } from '@/types';
import { loadLastConnection } from '@/utils/lastConnection';
import { logger } from '@/utils/logger';
import { decideTradeWinner } from '@/utils/tradeVerdict';
import {
  parseSleeperRosterPositions,
  calculateReplacementLevels,
  calculateReplacementPoints,
  calculateGamesPAR,
  type PositionStats,
} from '@/utils/par';

const BASE_URL = 'https://api.sleeper.app/v1';

// A matchup's real score: commissioner overrides (custom_points) supersede
// the computed points when set.
const matchupPoints = (m: SleeperAPI.Matchup): number => m.custom_points ?? m.points ?? 0;

// Sleeper playoff_round_type -> model union.
const PLAYOFF_ROUND_TYPES: Record<number, NonNullable<League['playoffRoundType']>> = {
  0: 'one_week',
  1: 'two_week_championship',
  2: 'two_week_rounds',
};

// Individual-defensive-player slots. Not modeled in RosterSlots; their
// presence flags the league so surfaces can say so honestly.
const SLEEPER_IDP_POSITIONS = new Set(['DL', 'LB', 'DB', 'IDP_FLEX']);

// Promise-based cache for player data to prevent race conditions
// Using a Promise cache ensures concurrent calls share the same request
let playerCachePromise: Promise<Record<string, SleeperAPI.Player>> | null = null;

async function fetchJSON<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`);
  if (!response.ok) {
    throw new Error(`Sleeper API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function getAllPlayers(): Promise<Record<string, SleeperAPI.Player>> {
  // If we already have a pending or completed promise, return it
  // This prevents multiple concurrent fetches of the same large file
  if (!playerCachePromise) {
    // This is a large file (~5MB), only fetch once per session
    playerCachePromise = fetchJSON<Record<string, SleeperAPI.Player>>('/players/nfl');
  }
  return playerCachePromise;
}

export async function getLeague(leagueId: string): Promise<SleeperAPI.League> {
  return fetchJSON<SleeperAPI.League>(`/league/${leagueId}`);
}

export async function getDraft(draftId: string): Promise<SleeperAPI.Draft> {
  return fetchJSON<SleeperAPI.Draft>(`/draft/${draftId}`);
}

// Username → that user's leagues, for the connect form's league finder.
// Returns null when no Sleeper user matches the username. Spans the current
// and previous seasons: each Sleeper season is its own league id, and during
// the offseason the league a user wants is usually last year's. The resolved
// user_id rides along so the caller can remember it: league rosters key
// owners by user_id, and it's the only stable identity Sleeper exposes
// (league users responses carry username as null).
export async function findLeaguesByUsername(
  username: string,
): Promise<{ userId: string; leagues: Array<{ id: string; name: string; season: string }> } | null> {
  const user = await fetchJSON<{ user_id?: string } | null>(
    `/user/${encodeURIComponent(username)}`,
  );
  if (!user?.user_id) return null;
  const year = new Date().getFullYear();
  const perSeason = await Promise.all(
    [year, year - 1].map(async (season) => {
      try {
        const leagues = await fetchJSON<SleeperAPI.League[] | null>(
          `/user/${user.user_id}/leagues/nfl/${season}`,
        );
        return leagues ?? [];
      } catch {
        // One missing season shouldn't sink the lookup.
        return [];
      }
    }),
  );
  return {
    userId: user.user_id,
    leagues: perSeason
      .flat()
      .map((l) => ({ id: l.league_id, name: l.name, season: l.season })),
  };
}

// Sleeper's league.status moves pre_draft → drafting → in_season → complete.
// Past-year leagues are always final regardless of what status says.
function toLeagueStatus(status: string, season: number, nflSeason: number): LeagueStatus {
  if (season < nflSeason) return 'final';
  if (status === 'complete') return 'final';
  if (status === 'pre_draft' || status === 'drafting') return 'preseason';
  return 'live';
}

// The earliest league in a chain terminates previous_league_id with null OR the
// string "0" (Sleeper is inconsistent). A real league id is a long numeric
// snowflake, never "0", so normalize both to undefined. Without this the season
// walks treat "0" as a valid id, fetch league "0", get a 404, and log a spurious
// warning ("getAvailableSeasons: stopped at 0") that only burns Sentry quota.
function prevLeagueId(id: string | null | undefined): string | undefined {
  return id && id !== '0' ? id : undefined;
}

// A renewed league points backward via previous_league_id; nothing points
// forward. To find the renewal, check league members' league lists for the
// next season and match the back-pointer. The first few members are enough:
// whoever renewed the league is in it.
export async function findSuccessorLeague(
  leagueId: string,
  season: number,
  // The forward walk in getAvailableSeasons chases successors that can
  // themselves be past seasons (an abandoned renewal keeps its stale status
  // forever); it passes the real NFL season so those still land on 'final'.
  // Direct callers probe season + 1 from the newest league, never the past,
  // so the default is right for them.
  nflSeason: number = season + 1,
): Promise<{ leagueId: string; season: number; name: string; status: LeagueStatus } | null> {
  let users: SleeperAPI.User[];
  try {
    users = await getLeagueUsers(leagueId);
  } catch (err) {
    logger.warn('[Sleeper] findSuccessorLeague: could not list league users:', err);
    return null;
  }
  const perMember = await Promise.all(
    users.slice(0, 3).map(async (user) => {
      try {
        const leagues = await fetchJSON<SleeperAPI.League[] | null>(
          `/user/${user.user_id}/leagues/nfl/${season + 1}`,
        );
        return leagues ?? [];
      } catch {
        // One member's list failing shouldn't sink the search.
        return [] as SleeperAPI.League[];
      }
    }),
  );
  const match = perMember.flat().find(l => l.previous_league_id === leagueId);
  if (!match) return null;
  const year = parseInt(match.season);
  return {
    leagueId: match.league_id,
    season: year,
    name: match.name,
    status: toLeagueStatus(match.status, year, nflSeason),
  };
}

export async function getLeagueUsers(leagueId: string): Promise<SleeperAPI.User[]> {
  return fetchJSON<SleeperAPI.User[]>(`/league/${leagueId}/users`);
}

export async function getLeagueRosters(leagueId: string): Promise<SleeperAPI.Roster[]> {
  return fetchJSON<SleeperAPI.Roster[]>(`/league/${leagueId}/rosters`);
}

export async function getDraftPicks(draftId: string): Promise<SleeperAPI.DraftPick[]> {
  return fetchJSON<SleeperAPI.DraftPick[]>(`/draft/${draftId}/picks`);
}

export async function getTransactions(leagueId: string, week: number): Promise<SleeperAPI.Transaction[]> {
  return fetchJSON<SleeperAPI.Transaction[]>(`/league/${leagueId}/transactions/${week}`);
}

export async function getMatchups(leagueId: string, week: number): Promise<SleeperAPI.Matchup[]> {
  return fetchJSON<SleeperAPI.Matchup[]>(`/league/${leagueId}/matchups/${week}`);
}

export async function getNFLState(): Promise<{ week: number; season: string; season_type: string }> {
  return fetchJSON('/state/nfl');
}

export async function getWinnersBracket(leagueId: string): Promise<SleeperAPI.BracketMatch[]> {
  return fetchJSON<SleeperAPI.BracketMatch[]>(`/league/${leagueId}/winners_bracket`);
}

export async function getSeasonStats(season: string, week?: number): Promise<SleeperAPI.SeasonStats> {
  const endpoint = week
    ? `/stats/nfl/regular/${season}/${week}`
    : `/stats/nfl/regular/${season}`;
  return fetchJSON<SleeperAPI.SeasonStats>(endpoint);
}

// Helper to convert Sleeper player to common format
function convertPlayer(playerId: string, players: Record<string, SleeperAPI.Player>): Player {
  const player = players[playerId];
  if (!player) {
    return {
      id: playerId,
      platformId: playerId,
      name: `Unknown (${playerId})`,
      position: 'Unknown',
      team: 'FA',
    };
  }
  return {
    id: playerId,
    platformId: playerId,
    name: player.full_name || `${player.first_name} ${player.last_name}`,
    position: player.position || 'Unknown',
    team: player.team || 'FA',
  };
}

/**
 * Helper to calculate points and PAR from matchup data after a given week
 * Used by both waiver processing and trade processing to avoid duplication
 */
interface PlayerMatchupStats {
  pointsSinceTransaction: number;
  gamesSinceTransaction: number;
  par: number;
}

function calculatePlayerPARFromMatchups(
  weekMap: Map<number, number> | undefined,
  transactionWeek: number,
  position: string,
  replacementPoints: Map<string, number>
): PlayerMatchupStats {
  let pointsSinceTransaction = 0;
  let gamesSinceTransaction = 0;

  if (weekMap) {
    // Count weeks on or after the transaction week
    weekMap.forEach((points, week) => {
      if (week >= transactionWeek) {
        pointsSinceTransaction += points;
        gamesSinceTransaction += 1;
      }
    });
  }

  // Calculate PAR for this player
  const par = calculateGamesPAR(
    pointsSinceTransaction,
    position,
    gamesSinceTransaction,
    replacementPoints
  );

  return {
    pointsSinceTransaction,
    gamesSinceTransaction,
    par,
  };
}

// Round-1 pick order as team ids (roster ids). slot_to_roster_id is the
// direct answer but is often null before the draft starts; fall back to
// draft_order (user_id -> slot) resolved through roster ownership. Returns
// undefined when the commissioner hasn't set an order yet.
function draftOrderTeamIds(
  draft: SleeperAPI.Draft,
  rosters: SleeperAPI.Roster[],
): string[] | undefined {
  const bySlot: Array<[slot: number, rosterId: number]> = [];
  if (draft.slot_to_roster_id) {
    for (const [slot, rosterId] of Object.entries(draft.slot_to_roster_id)) {
      if (rosterId != null) bySlot.push([Number(slot), rosterId]);
    }
  }
  // Branch on whether the map actually FILLED, not on whether it existed: a
  // pre-draft slot_to_roster_id can be an object of all-null values, and
  // taking its branch on key count alone starved the draft_order fallback of
  // exactly the case it exists for.
  if (bySlot.length === 0 && draft.draft_order) {
    for (const [userId, slot] of Object.entries(draft.draft_order)) {
      const roster = rosters.find(
        r => r.owner_id === userId || (r.co_owners ?? []).includes(userId),
      );
      if (roster) bySlot.push([slot, roster.roster_id]);
    }
  }
  if (bySlot.length === 0) return undefined;
  bySlot.sort((a, b) => a[0] - b[0]);
  // A co-owned roster can resolve twice from draft_order (owner and co-owner
  // both listed). Keep its earliest slot; a duplicated entry would silently
  // push some other team to the end of the order.
  const seen = new Set<number>();
  const order: string[] = [];
  for (const [, rosterId] of bySlot) {
    if (seen.has(rosterId)) continue;
    seen.add(rosterId);
    order.push(String(rosterId));
  }
  // A partial order (some rosters unresolved) would look authoritative while
  // seating the missing teams wrong; better to fall back to league order.
  return order.length === rosters.length ? order : undefined;
}

// Load complete league data
export async function loadLeague(leagueId: string): Promise<League> {
  // Fetch all required data in parallel
  const [leagueData, users, rosters, nflState, players] = await Promise.all([
    getLeague(leagueId),
    getLeagueUsers(leagueId),
    getLeagueRosters(leagueId),
    getNFLState(),
    getAllPlayers(),
  ]);

  // Fetch draft picks and the draft object (for the real draft type) if a
  // draft exists. Sleeper's type is 'snake' | 'auction' | 'linear'; linear
  // collapses to snake (same board mechanics for our purposes).
  let draftPicks: SleeperAPI.DraftPick[] = [];
  let draftType: League['draftType'] = 'snake';
  // Sleeper carries the real pick order (linear / third-round reversal) and the
  // carryover model (settings.type: 0 redraft, 1 keeper, 2 dynasty). Preserve
  // both so the Draft Room can open already configured.
  let draftFormat: League['draftFormat'] = 'standard';
  let upcomingDraft: League['upcomingDraft'];
  let auctionBudget: number | undefined;
  if (leagueData.draft_id) {
    try {
      const [draft, picks] = await Promise.all([
        getDraft(leagueData.draft_id).catch(() => null),
        getDraftPicks(leagueData.draft_id),
      ]);
      if (draft && draft.status !== 'complete') {
        // The draft hasn't run yet: any picks on the board are keepers the
        // commissioner placed there, not last-season results. Feeding them
        // into teams[].draftPicks would poison keeper guessing (a team's
        // "draft history" collapses to its one keeper stub) and draft grades.
        //
        // "Hasn't run yet" is only literally true for pre_draft. A draft that
        // is drafting or paused ALSO lands here (its picks are this season's
        // in-flight results, not history), but its feed mixes real picks made
        // so far with the pre-placed stubs — treating them all as keepers
        // would invent a fake keeper per pick in a plain redraft league,
        // auto-enable the keeper section, and reserve those players out of
        // the pool. Sleeper flags genuine commish-placed stubs is_keeper, so
        // mid-draft only those count.
        upcomingDraft = {
          draftId: leagueData.draft_id,
          order: draftOrderTeamIds(draft, rosters),
          keepers: (draft.status === 'pre_draft'
            ? picks
            : picks.filter(pick => pick.is_keeper === true)
          ).map(pick => ({
            teamId: String(pick.roster_id),
            sleeperPlayerId: pick.player_id,
            round: pick.round,
          })),
        };
      } else {
        draftPicks = picks;
      }
      if (draft?.type === 'auction') {
        draftType = 'auction';
        // The real auction budget; the Draft Room seeds its (editable)
        // budget from this instead of assuming $200.
        auctionBudget = draft.settings?.budget || undefined;
      } else if (draft?.type === 'linear') {
        draftFormat = 'linear';
      } else if ((draft?.settings?.reversal_round ?? 0) >= 3) {
        draftFormat = '3rr';
      }
    } catch (error) {
      logger.warn('Could not fetch draft picks:', error instanceof Error ? error.message : error);
    }
  }
  const leagueType: League['leagueType'] =
    leagueData.settings?.type === 2 ? 'dynasty' : leagueData.settings?.type === 1 ? 'keeper' : 'redraft';

  // Fetch all transactions for the season (always fetch all 18 weeks + playoffs)
  // During offseason, nflState.week might be 0 or 1, so we use max of current week or 18
  const maxWeek = Math.max(nflState.week || 0, 18);
  const transactionPromises: Promise<SleeperAPI.Transaction[]>[] = [];
  for (let week = 1; week <= maxWeek; week++) {
    transactionPromises.push(getTransactions(leagueId, week).catch(() => []));
  }
  const allTransactions = (await Promise.all(transactionPromises)).flat();
  logger.debug(`[Sleeper] Fetched transactions for weeks 1-${maxWeek}, total: ${allTransactions.length}`);

  // Get season stats for player performance
  let seasonStats: SleeperAPI.SeasonStats = {};
  try {
    seasonStats = await getSeasonStats(leagueData.season);
  } catch (error) {
    logger.warn('Could not fetch season stats:', error instanceof Error ? error.message : error);
  }

  // Get matchups for each week to calculate points in started games
  const matchupPromises: Promise<SleeperAPI.Matchup[]>[] = [];
  for (let week = 1; week <= maxWeek; week++) {
    matchupPromises.push(getMatchups(leagueId, week).catch(() => []));
  }
  const allMatchups = await Promise.all(matchupPromises);

  // Build user map (owner_id -> user)
  const userMap = new Map<string, SleeperAPI.User>();
  users.forEach(user => userMap.set(user.user_id, user));

  // Build roster map (roster_id -> roster)
  const rosterMap = new Map<number, SleeperAPI.Roster>();
  rosters.forEach(roster => rosterMap.set(roster.roster_id, roster));

  // Build owner map (roster_id -> owner_id). Orphaned rosters have no owner.
  const rosterOwnerMap = new Map<number, string>();
  rosters.forEach(roster => {
    if (roster.owner_id) rosterOwnerMap.set(roster.roster_id, roster.owner_id);
  });

  // Determine scoring type from settings. A standard league may send rec: 0 OR
  // omit the key entirely; both mean "no reception scoring", so treat a missing
  // rec as standard rather than letting it fall through to 'custom'. A genuinely
  // unusual rec value (e.g. 0.75) still lands on 'custom'.
  const scoringSettings = leagueData.scoring_settings;
  const rec = scoringSettings?.rec;
  let scoringType: League['scoringType'];
  if (rec === 1) {
    scoringType = 'ppr';
  } else if (rec === 0.5) {
    scoringType = 'half_ppr';
  } else if (rec === 0 || rec == null) {
    scoringType = 'standard';
  } else {
    scoringType = 'custom';
  }

  // Parse roster slots for PAR calculation. IR size lives in settings
  // (reserve_slots), not roster_positions, so the parser always reads 0.
  const rosterSlots: RosterSlots = parseSleeperRosterPositions(leagueData.roster_positions || []);
  rosterSlots.IR = leagueData.settings?.reserve_slots ?? rosterSlots.IR;

  // Calculate replacement levels based on league settings
  const replacementLevels = calculateReplacementLevels(rosterSlots, leagueData.total_rosters);

  // Pick the stat column matching the league's scoring rules. Used for both
  // replacement points and draft-pick season points: grading a standard or
  // half-PPR league on full-PPR points over-ranks reception-heavy players.
  const pointsForScoring = (stats: { pts_ppr?: number; pts_half_ppr?: number; pts_std?: number } | undefined) =>
    scoringType === 'ppr'
      ? stats?.pts_ppr
      : scoringType === 'half_ppr'
        ? stats?.pts_half_ppr
        : stats?.pts_std;

  // Build position stats for all players to calculate replacement points
  const allPlayerStats: PositionStats[] = [];
  Object.entries(seasonStats).forEach(([playerId, stats]) => {
    const player = players[playerId];
    if (player && player.position) {
      const points = pointsForScoring(stats);

      if (points !== undefined) {
        allPlayerStats.push({
          playerId,
          position: player.position,
          seasonPoints: points,
        });
      }
    }
  });

  // Calculate replacement-level points for each position
  const replacementPoints = calculateReplacementPoints(allPlayerStats, replacementLevels);

  // Build a map of player starts by roster and week for waiver impact tracking
  // Key: `${rosterId}-${playerId}`, Value: Map<week, points>
  const playerStartsByRosterAndWeek = new Map<string, Map<number, number>>();
  allMatchups.forEach((weekMatchups, weekIndex) => {
    const week = weekIndex + 1;
    weekMatchups.forEach(matchup => {
      if (matchup.starters && matchup.starters_points) {
        matchup.starters.forEach((playerId, index) => {
          // Empty lineup slots come through as the string "0"; recording
          // them would fabricate a phantom "player" start every week.
          if (playerId === '0' || playerId === '') return;
          const points = matchup.starters_points[index] || 0;
          const key = `${matchup.roster_id}-${playerId}`;
          const weekMap = playerStartsByRosterAndWeek.get(key) || new Map<number, number>();
          weekMap.set(week, points);
          playerStartsByRosterAndWeek.set(key, weekMap);
        });
      }
    });
  });

  // Convert draft picks and group by team
  const teamDraftPicks = new Map<number, DraftPick[]>();
  draftPicks.forEach(pick => {
    const convertedPick: DraftPick = {
      pickNumber: pick.pick_no,
      round: pick.round,
      player: convertPlayer(pick.player_id, players),
      teamId: String(pick.roster_id),
      teamName: '', // Will be set later
      isKeeper: pick.is_keeper === true,
      // Auction sale price rides in pick metadata as a string.
      auctionValue: pick.metadata?.amount ? parseInt(pick.metadata.amount, 10) || undefined : undefined,
      // Left undefined, not 0, when the player has no fantasy points on record.
      // Sleeper publishes a full stats payload for the upcoming season before
      // Week 1 with rank fields but no pts_*, so coercing to 0 made a drafted-
      // but-unplayed season look like a played one where everybody scored
      // nothing — which collapses every position rank into array order and
      // grades the 1.01 "terrible". Downstream uses undefined as the "no
      // results yet" signal and grades against consensus instead.
      seasonPoints: pointsForScoring(seasonStats[pick.player_id]),
    };

    const picks = teamDraftPicks.get(pick.roster_id) || [];
    picks.push(convertedPick);
    teamDraftPicks.set(pick.roster_id, picks);
  });

  // Convert transactions and group by team
  const teamTransactions = new Map<number, Transaction[]>();
  const allTrades: Trade[] = [];

  allTransactions
    .filter(tx => tx.status === 'complete' && (tx.type === 'waiver' || tx.type === 'free_agent'))
    .forEach(tx => {
      const rosterIds = tx.roster_ids || [];
      const primaryRosterId = rosterIds[0];

      if (!primaryRosterId) return;

      const drops = tx.drops ? Object.keys(tx.drops).map(id => convertPlayer(id, players)) : [];

      // Calculate points generated by added players in games started BY THIS TEAM AFTER the pickup
      const pickupWeek = tx.leg;
      let totalPointsGenerated = 0;
      let totalGamesStarted = 0;
      let totalPAR = 0;

      const adds = tx.adds ? Object.keys(tx.adds).map(id => {
        const player = convertPlayer(id, players);
        const key = `${primaryRosterId}-${player.platformId}`;
        const weekMap = playerStartsByRosterAndWeek.get(key);

        // Use helper to calculate points and PAR from matchups
        const stats = calculatePlayerPARFromMatchups(
          weekMap,
          pickupWeek,
          player.position,
          replacementPoints
        );

        totalPointsGenerated += stats.pointsSinceTransaction;
        totalGamesStarted += stats.gamesSinceTransaction;
        totalPAR += stats.par;

        return {
          ...player,
          pointsSincePickup: Math.round(stats.pointsSinceTransaction * 10) / 10,
          gamesSincePickup: stats.gamesSinceTransaction,
          pointsAboveReplacement: Math.round(stats.par * 10) / 10,
        };
      }) : [];

      const transaction: Transaction = {
        id: tx.transaction_id,
        type: tx.type === 'waiver' ? 'waiver' : 'free_agent',
        timestamp: tx.created,
        week: tx.leg,
        teamId: String(primaryRosterId),
        teamName: '', // Will be set later
        adds,
        drops,
        waiverBudgetSpent: tx.settings?.waiver_bid,
        totalPointsGenerated,
        gamesStarted: totalGamesStarted,
        totalPAR: Math.round(totalPAR * 10) / 10,
      };

      rosterIds.forEach(rosterId => {
        const txs = teamTransactions.get(rosterId) || [];
        txs.push(transaction);
        teamTransactions.set(rosterId, txs);
      });
    });

  // Process trades
  allTransactions
    .filter(tx => tx.status === 'complete' && tx.type === 'trade')
    .forEach(tx => {
      const rosterIds = tx.roster_ids || [];
      if (rosterIds.length < 2) return;

      // Build adds/drops per roster
      const addsPerRoster = new Map<number, string[]>();
      const dropsPerRoster = new Map<number, string[]>();

      if (tx.adds) {
        Object.entries(tx.adds).forEach(([playerId, rosterId]) => {
          const list = addsPerRoster.get(rosterId) || [];
          list.push(playerId);
          addsPerRoster.set(rosterId, list);
        });
      }

      if (tx.drops) {
        Object.entries(tx.drops).forEach(([playerId, rosterId]) => {
          const list = dropsPerRoster.get(rosterId) || [];
          list.push(playerId);
          dropsPerRoster.set(rosterId, list);
        });
      }

      // Calculate points and PAR for each side - based on players started BY THAT TEAM AFTER the trade
      const tradeWeek = tx.leg;
      const tradeTeams = rosterIds.map(rosterId => {
        const received = addsPerRoster.get(rosterId) || [];
        const sent = dropsPerRoster.get(rosterId) || [];

        let pointsGained = 0;
        let pointsLost = 0;
        let parGained = 0;
        let parLost = 0;

        // Points/PAR gained = from received players started by this team after trade
        received.forEach(playerId => {
          const key = `${rosterId}-${playerId}`;
          const weekMap = playerStartsByRosterAndWeek.get(key);
          const player = players[playerId];

          const stats = calculatePlayerPARFromMatchups(
            weekMap,
            tradeWeek,
            player?.position || 'Unknown',
            replacementPoints
          );

          pointsGained += stats.pointsSinceTransaction;
          parGained += stats.par;
        });

        // Points/PAR lost = from sent players started by the OTHER team after trade
        sent.forEach(playerId => {
          rosterIds.forEach(otherRosterId => {
            if (otherRosterId !== rosterId) {
              const otherReceived = addsPerRoster.get(otherRosterId) || [];
              if (otherReceived.includes(playerId)) {
                const key = `${otherRosterId}-${playerId}`;
                const weekMap = playerStartsByRosterAndWeek.get(key);
                const player = players[playerId];

                const stats = calculatePlayerPARFromMatchups(
                  weekMap,
                  tradeWeek,
                  player?.position || 'Unknown',
                  replacementPoints
                );

                pointsLost += stats.pointsSinceTransaction;
                parLost += stats.par;
              }
            }
          });
        });

        return {
          teamId: String(rosterId),
          teamName: '', // Will be set later
          playersReceived: received.map(id => convertPlayer(id, players)),
          playersSent: sent.map(id => convertPlayer(id, players)),
          parGained: Math.round(parGained * 10) / 10,
          parLost: Math.round(parLost * 10) / 10,
          netPAR: Math.round((parGained - parLost) * 10) / 10,
          pointsGained,
          pointsLost,
          netValue: pointsGained - pointsLost,
        };
      });

      // Determine winner based on PAR (not raw points)
      const { winner, winnerMargin } = decideTradeWinner(tradeTeams, 'post-trade');

      const trade: Trade = {
        id: tx.transaction_id,
        timestamp: tx.created,
        week: tx.leg,
        status: 'completed',
        teams: tradeTeams,
        winner,
        winnerMargin,
        verdictBasis: 'post-trade',
      };

      allTrades.push(trade);
    });

  // Build team name map for trades
  const teamNameMap = new Map<string, string>();
  rosters.forEach(roster => {
    const owner = roster.owner_id ? userMap.get(roster.owner_id) : undefined;
    const teamName = owner?.display_name || owner?.username || `Team ${roster.roster_id}`;
    teamNameMap.set(String(roster.roster_id), teamName);
  });

  // Per-player weekly points for Player Journey stint scoring. All weeks,
  // not just regular season: a stint can run into the playoffs.
  const playerWeeklyPoints: Record<string, Record<number, number>> = {};
  allMatchups.forEach((weekMatchups, weekIndex) => {
    const week = weekIndex + 1;
    for (const matchup of weekMatchups) {
      for (const [playerId, points] of Object.entries(matchup.players_points ?? {})) {
        if (!points) continue;
        // Sleeper serves float32 artifacts (0.10000000149...); round to 2dp
        // so sums and displays stay clean.
        (playerWeeklyPoints[playerId] ??= {})[week] = Math.round(points * 100) / 100;
      }
    }
  });

  // Build weekly matchups for luck analysis. Regular season only: luck
  // metrics compare against regular-season records, so playoff weeks would
  // bias scores against playoff teams. Unplayed weeks (both sides zero)
  // are skipped too — a phantom 0-0 reads as an all-play tie for everyone.
  const playoffStart = leagueData.settings?.playoff_week_start || 15;
  const weeklyMatchups: WeeklyMatchup[] = [];
  allMatchups.forEach((weekMatchups, weekIndex) => {
    const week = weekIndex + 1;
    if (week >= playoffStart) return;
    // Group by matchup_id to pair opponents
    const matchupPairs = new Map<number, SleeperAPI.Matchup[]>();
    weekMatchups.forEach(matchup => {
      if (matchup.matchup_id) {
        const pair = matchupPairs.get(matchup.matchup_id) || [];
        pair.push(matchup);
        matchupPairs.set(matchup.matchup_id, pair);
      }
    });

    // Convert pairs to WeeklyMatchup format
    matchupPairs.forEach(pair => {
      if (pair.length === 2) {
        const p1 = matchupPoints(pair[0]);
        const p2 = matchupPoints(pair[1]);
        if (p1 === 0 && p2 === 0) return; // future/unplayed week
        weeklyMatchups.push({
          week,
          team1Id: String(pair[0].roster_id),
          team1Points: p1,
          team2Id: String(pair[1].roster_id),
          team2Points: p2,
        });
      }
    });
  });

  // Update trade team names
  const tradesWithNames = allTrades.map(trade => ({
    ...trade,
    teams: trade.teams.map(t => ({
      ...t,
      teamName: teamNameMap.get(t.teamId) || t.teamId,
    })),
  }));

  // Build teams. Sleeper has no auth, but the league finder remembers the
  // user_id its username lookup resolved; the roster owned by that user is
  // the connected user's own team. Matched on user_id, not names: league
  // users responses carry username as null, and display_name is freely
  // settable, so a name match can flag someone else's roster.
  const myUserId = loadLastConnection()?.sleeper?.userId ?? null;
  const teams: Team[] = rosters.map(roster => {
    const owner = roster.owner_id ? userMap.get(roster.owner_id) : undefined;
    const teamName = owner?.display_name || owner?.username || `Team ${roster.roster_id}`;
    // Owner plus co-managers: a co-managed roster is still the user's own.
    const ownerUserIds = [roster.owner_id, ...(roster.co_owners ?? [])].filter(
      (id): id is string => Boolean(id)
    );
    const isMyTeam = myUserId !== null && ownerUserIds.includes(myUserId);

    const draftPicksForTeam = (teamDraftPicks.get(roster.roster_id) || []).map(pick => ({
      ...pick,
      teamName,
    }));

    const transactionsForTeam = (teamTransactions.get(roster.roster_id) || []).map(tx => ({
      ...tx,
      teamName,
    }));

    // Get trades involving this team
    const teamTrades = tradesWithNames.filter(trade =>
      trade.teams.some(t => t.teamId === String(roster.roster_id))
    );

    return {
      id: String(roster.roster_id),
      name: teamName,
      ownerName: owner?.display_name || owner?.username,
      isMyTeam: isMyTeam || undefined,
      ownerUserIds,
      avatarUrl: owner?.avatar ? `https://sleepercdn.com/avatars/thumbs/${owner.avatar}` : undefined,
      roster: roster.players?.map(id => convertPlayer(id, players)) || [],
      draftPicks: draftPicksForTeam,
      transactions: transactionsForTeam,
      trades: teamTrades,
      wins: roster.settings?.wins || 0,
      losses: roster.settings?.losses || 0,
      ties: roster.settings?.ties || 0,
      pointsFor: (roster.settings?.fpts || 0) + (roster.settings?.fpts_decimal || 0) / 100,
      pointsAgainst: (roster.settings?.fpts_against || 0) + (roster.settings?.fpts_against_decimal || 0) / 100,
    };
  });

  const season = parseInt(leagueData.season);
  const nflSeason = parseInt(nflState.season);
  const status = toLeagueStatus(leagueData.status, season, nflSeason);

  return {
    id: leagueId,
    platform: 'sleeper',
    name: leagueData.name,
    season,
    draftType,
    teams,
    trades: tradesWithNames,
    matchups: weeklyMatchups,
    scoringType,
    totalTeams: leagueData.total_rosters,
    currentWeek: nflState.week,
    isLoaded: true,
    // Normalized: Sleeper's "0" chain terminator must not leak out as a
    // truthy "there is a prior season" signal.
    previousLeagueId: prevLeagueId(leagueData.previous_league_id),
    rosterSlots,
    leagueType,
    draftFormat,
    hasSuperflex: (leagueData.roster_positions || []).some(
      p => p === 'SUPER_FLEX' || p === 'SUPERFLEX',
    ),
    playerWeeklyPoints,
    status,
    loadedAt: Date.now(),
    upcomingDraft,
    hasMedianMatchup: leagueData.settings?.league_average_match === 1 || undefined,
    isBestBall: leagueData.settings?.best_ball === 1 || undefined,
    tePremiumPerReception:
      (scoringSettings?.bonus_rec_te ?? 0) > 0 ? scoringSettings.bonus_rec_te : undefined,
    passTdPoints: scoringSettings?.pass_td,
    auctionBudget,
    playoffStartWeek: playoffStart,
    playoffTeams: leagueData.settings?.playoff_teams,
    playoffRoundType:
      leagueData.settings?.playoff_round_type != null
        ? PLAYOFF_ROUND_TYPES[leagueData.settings.playoff_round_type]
        : undefined,
    hasIDP:
      (leagueData.roster_positions || []).some(p => SLEEPER_IDP_POSITIONS.has(p)) || undefined,
    scoringIsApproximate: scoringType === 'custom' || undefined,
  };
}

// Keeper guessing on a freshly renewed league: the new season's league has no
// draft yet, so "cost = last year's round minus escalation" and "must finish
// the season on the drafting team" have nothing to read. This is the minimal
// prior-season fetch for that (draft picks + final rosters; no transactions,
// matchups, or stats). Results are keyed by owner user_ids because roster ids
// are not stable across seasons; the caller grafts them onto the renewed
// league's teams by owner.
export interface KeeperSourceTeam {
  ownerUserIds: string[];
  draftPicks: DraftPick[];
  roster: Player[];
}

export async function loadKeeperSourceTeams(leagueId: string): Promise<KeeperSourceTeam[]> {
  const [leagueData, rosters, players] = await Promise.all([
    getLeague(leagueId),
    getLeagueRosters(leagueId),
    getAllPlayers(),
  ]);

  let picks: SleeperAPI.DraftPick[] = [];
  if (leagueData.draft_id) {
    try {
      picks = await getDraftPicks(leagueData.draft_id);
    } catch (error) {
      logger.warn(
        'Could not fetch prior-season draft picks:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  const picksByRoster = new Map<number, DraftPick[]>();
  picks.forEach(pick => {
    const converted: DraftPick = {
      pickNumber: pick.pick_no,
      round: pick.round,
      player: convertPlayer(pick.player_id, players),
      teamId: String(pick.roster_id),
      teamName: '',
      isKeeper: pick.is_keeper === true,
      auctionValue: pick.metadata?.amount ? parseInt(pick.metadata.amount, 10) || undefined : undefined,
    };
    const list = picksByRoster.get(pick.roster_id) || [];
    list.push(converted);
    picksByRoster.set(pick.roster_id, list);
  });

  return rosters.map(roster => ({
    ownerUserIds: [roster.owner_id, ...(roster.co_owners ?? [])].filter(
      (id): id is string => Boolean(id)
    ),
    draftPicks: picksByRoster.get(roster.roster_id) ?? [],
    roster: roster.players?.map(id => convertPlayer(id, players)) ?? [],
  }));
}

// Walk previous_league_id from `leagueId` to enumerate every reachable season.
// Each hop maps year → leagueId for the dropdown. Sequential because each
// response carries the pointer to the next one; capped at 15 to bound runtime
// for very long-running leagues.
export async function getAvailableSeasons(leagueId: string): Promise<SeasonOption[]> {
  const out: SeasonOption[] = [];
  let nflSeason = new Date().getFullYear();
  try {
    const nflState = await getNFLState();
    nflSeason = parseInt(nflState.season);
  } catch (err) {
    logger.warn('[Sleeper] getAvailableSeasons: NFL state lookup failed, using calendar year', err);
  }

  let id: string | undefined = leagueId;
  let hops = 0;
  while (id && hops < 15) {
    try {
      const data = await getLeague(id);
      const year = parseInt(data.season);
      out.push({
        year,
        leagueId: id,
        status: toLeagueStatus(data.status, year, nflSeason),
        leagueName: data.name,
      });
      id = prevLeagueId(data.previous_league_id);
      hops++;
    } catch (err) {
      logger.warn(`[Sleeper] getAvailableSeasons: stopped at ${id}:`, err);
      break;
    }
  }

  // The chain only points backward, so when the given league has been renewed
  // its newer seasons are invisible from here. Walk forward too, so the year
  // dropdown can offer the new season when the loaded league is last year's.
  // Only probe while the newest known season trails the NFL calendar: an
  // up-to-date league can't have a successor yet, and each probe costs up to
  // four requests.
  let forwardHops = 0;
  while (out.length > 0 && out[0].year < nflSeason && forwardHops < 3) {
    const newest = out[0];
    const next = await findSuccessorLeague(newest.leagueId, newest.year, nflSeason);
    if (!next) break;
    out.unshift({
      year: next.season,
      leagueId: next.leagueId,
      status: next.status,
      leagueName: next.name,
    });
    forwardHops++;
  }
  return out;
}

// Load historical seasons by following previous_league_id chain
export async function loadLeagueHistory(leagueId: string, maxSeasons: number = 5): Promise<SeasonSummary[]> {
  const history: SeasonSummary[] = [];
  let currentLeagueId: string | undefined = leagueId;
  let seasonsLoaded = 0;

  while (currentLeagueId && seasonsLoaded < maxSeasons) {
    try {
      const leagueData = await getLeague(currentLeagueId);
      const rosters = await getLeagueRosters(currentLeagueId);
      const users = await getLeagueUsers(currentLeagueId);

      // Build user map
      const userMap = new Map<string, SleeperAPI.User>();
      users.forEach(user => userMap.set(user.user_id, user));

      const isComplete = leagueData.status === 'complete';

      // Identify the actual playoff champion (not the regular-season leader).
      // Prefer the league metadata; fall back to the winners bracket. BOTH
      // paths gate on isComplete: "latest_league_winner" reads like "most
      // recent known winner", which on a renewed league can name LAST
      // season's champion (and roster ids are not stable across renewals),
      // so an in-progress season must never crown anyone from it.
      let championTeamId: string | undefined;
      const metaWinner = leagueData.metadata?.latest_league_winner_roster_id;
      if (isComplete && metaWinner) {
        championTeamId = String(metaWinner);
      } else if (isComplete) {
        try {
          const bracket = await getWinnersBracket(currentLeagueId);
          const championship = bracket.find(m => m.p === 1);
          if (championship?.w) {
            championTeamId = String(championship.w);
          }
        } catch (err) {
          logger.warn(`Could not load winners bracket for league ${currentLeagueId}:`, err);
        }
      }

      // Standings are regular-season order, but pin the actual champion to #1
      // so the History page can show the right trophy.
      const teamsWithStandings = rosters
        .map(roster => {
          const owner = roster.owner_id ? userMap.get(roster.owner_id) : undefined;
          return {
            id: String(roster.roster_id),
            // owner_id is stable across seasons even when roster IDs renumber
            // or team names change, so the all-time leaderboard keys off it.
            ownerId: roster.owner_id || undefined,
            name: owner?.display_name || owner?.username || `Team ${roster.roster_id}`,
            wins: roster.settings?.wins || 0,
            losses: roster.settings?.losses || 0,
            ties: roster.settings?.ties || 0,
            pointsFor: (roster.settings?.fpts || 0) + (roster.settings?.fpts_decimal || 0) / 100,
            pointsAgainst: (roster.settings?.fpts_against || 0) + (roster.settings?.fpts_against_decimal || 0) / 100,
            standing: 0,
          };
        })
        .sort((a, b) => {
          if (championTeamId) {
            if (a.id === championTeamId) return -1;
            if (b.id === championTeamId) return 1;
          }
          if (a.wins !== b.wins) return b.wins - a.wins;
          return b.pointsFor - a.pointsFor;
        })
        .map((team, index) => ({ ...team, standing: index + 1 }));

      history.push({
        season: parseInt(leagueData.season),
        leagueId: currentLeagueId,
        leagueName: leagueData.name,
        championTeamId,
        isComplete,
        teams: teamsWithStandings,
      });

      currentLeagueId = prevLeagueId(leagueData.previous_league_id);
      seasonsLoaded++;
    } catch (error) {
      logger.warn(`Could not load season for league ${currentLeagueId}:`, error);
      break;
    }
  }

  return history;
}

// Load head-to-head records for a specific team across seasons
export async function loadHeadToHeadRecords(
  leagueId: string,
  teamId: string,
  maxSeasons: number = 5
): Promise<{ records: Map<string, HeadToHeadRecord>; teamName: string }> {
  const records = new Map<string, HeadToHeadRecord>();
  let teamName = '';
  let currentLeagueId: string | undefined = leagueId;
  let seasonsLoaded = 0;

  // Map to track owner IDs across seasons (since roster IDs can change)
  const ownerIdToName = new Map<string, string>();
  // The selected team's OWNER, resolved once in the current season. Roster
  // ids shuffle between renewals; following the roster id into history
  // would mix different managers' games into one record.
  let ourOwnerId: string | undefined;

  while (currentLeagueId && seasonsLoaded < maxSeasons) {
    try {
      const leagueData = await getLeague(currentLeagueId);
      const rosters = await getLeagueRosters(currentLeagueId);
      const users = await getLeagueUsers(currentLeagueId);
      const season = parseInt(leagueData.season);

      // Build maps
      const userMap = new Map<string, SleeperAPI.User>();
      users.forEach(user => userMap.set(user.user_id, user));

      const rosterToOwner = new Map<number, string>();
      const rosterToName = new Map<number, string>();
      rosters.forEach(roster => {
        const owner = roster.owner_id ? userMap.get(roster.owner_id) : undefined;
        const name = owner?.display_name || owner?.username || `Team ${roster.roster_id}`;
        rosterToName.set(roster.roster_id, name);
        if (roster.owner_id) {
          rosterToOwner.set(roster.roster_id, roster.owner_id);
          ownerIdToName.set(roster.owner_id, name);
        }
      });

      // Find our team's roster ID for this season
      let ourRosterId: number | undefined;
      if (seasonsLoaded === 0) {
        // First season: use the provided teamId and remember its owner.
        ourRosterId = parseInt(teamId);
        ourOwnerId = rosterToOwner.get(ourRosterId);
        teamName = rosterToName.get(ourRosterId) || teamId;
      } else if (ourOwnerId) {
        // Prior seasons: same human, whatever roster id they had that year.
        ourRosterId = rosters.find(r => r.owner_id === ourOwnerId)?.roster_id;
      }

      if (!ourRosterId) {
        currentLeagueId = prevLeagueId(leagueData.previous_league_id);
        seasonsLoaded++;
        continue;
      }

      // Load regular-season matchups only; playoff games aren't "rivalry"
      // games in the H2H sense and skew the totals.
      const playoffStart = leagueData.settings?.playoff_week_start || 15;
      const weekCount = Math.min(17, playoffStart - 1);
      for (let week = 1; week <= weekCount; week++) {
        try {
          const matchups = await getMatchups(currentLeagueId, week);

          // Find our matchup
          const ourMatchup = matchups.find(m => m.roster_id === ourRosterId);
          if (!ourMatchup || ourMatchup.matchup_id === null) continue;

          // Find opponent
          const opponentMatchup = matchups.find(
            m => m.matchup_id === ourMatchup.matchup_id && m.roster_id !== ourRosterId
          );
          if (!opponentMatchup) continue;

          const opponentOwnerId = rosterToOwner.get(opponentMatchup.roster_id) || '';
          const opponentName = rosterToName.get(opponentMatchup.roster_id) || `Team ${opponentMatchup.roster_id}`;

          // Get or create record
          let record = records.get(opponentOwnerId);
          if (!record) {
            record = {
              opponentId: opponentOwnerId,
              opponentName,
              wins: 0,
              losses: 0,
              ties: 0,
              pointsFor: 0,
              pointsAgainst: 0,
              matchups: [],
            };
            records.set(opponentOwnerId, record);
          }

          // Update record. A 0-0 "matchup" is an unplayed week, not a tie.
          const ourScore = matchupPoints(ourMatchup);
          const oppScore = matchupPoints(opponentMatchup);
          if (ourScore === 0 && oppScore === 0) continue;
          const won = ourScore > oppScore;
          const tied = ourScore === oppScore;

          if (won) record.wins++;
          else if (tied) record.ties++;
          else record.losses++;

          record.pointsFor += ourScore;
          record.pointsAgainst += oppScore;
          record.matchups.push({
            season,
            week,
            teamScore: ourScore,
            opponentScore: oppScore,
            won,
          });

          // Update opponent name (may have changed over seasons)
          record.opponentName = ownerIdToName.get(opponentOwnerId) || record.opponentName;
        } catch {
          // Week might not exist
          continue;
        }
      }

      currentLeagueId = prevLeagueId(leagueData.previous_league_id);
      seasonsLoaded++;
    } catch (error) {
      logger.warn(`Could not load matchups for league ${currentLeagueId}:`, error);
      break;
    }
  }

  // Most recent first, matching the ESPN loader: the rivalry card shows the
  // top of this list as "Recent Matchups".
  for (const record of records.values()) {
    record.matchups.sort((a, b) => b.season - a.season || b.week - a.week);
  }

  return { records, teamName };
}
