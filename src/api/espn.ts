import type { ESPNAPI, League, Team, DraftPick, Transaction, Player } from '@/types';

const BASE_URL = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';

// ESPN position ID mapping
const POSITION_MAP: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'D/ST',
};

// ESPN team ID mapping
const TEAM_MAP: Record<number, string> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
  9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA',
  16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI',
  23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR',
  30: 'JAX', 33: 'BAL', 34: 'HOU', 0: 'FA',
};

interface FetchOptions {
  espnS2?: string;
  swid?: string;
}

async function fetchESPN<T>(
  season: number,
  leagueId: string,
  views: string[],
  options?: FetchOptions
): Promise<T> {
  const viewParams = views.map(v => `view=${v}`).join('&');
  const url = `${BASE_URL}/${season}/segments/0/leagues/${leagueId}?${viewParams}`;

  const headers: HeadersInit = {
    'Accept': 'application/json',
  };

  // For private leagues, we need cookies
  // Note: This only works in Node.js or with a CORS proxy
  // In browser, private leagues won't work without a backend
  if (options?.espnS2 && options?.swid) {
    headers['Cookie'] = `espn_s2=${options.espnS2}; SWID=${options.swid}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('ESPN: League is private. Please provide espn_s2 and SWID cookies.');
    }
    throw new Error(`ESPN API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function convertPlayer(espnPlayer: ESPNAPI.Player): Player {
  return {
    id: String(espnPlayer.id),
    platformId: String(espnPlayer.id),
    name: espnPlayer.fullName,
    position: POSITION_MAP[espnPlayer.defaultPositionId] || 'Unknown',
    team: TEAM_MAP[espnPlayer.proTeamId] || 'FA',
  };
}

function getSeasonPoints(player: ESPNAPI.Player, season: number): number | undefined {
  if (!player.stats) return undefined;

  // Find actual season stats (statSourceId = 0 for actual, 1 for projected)
  const seasonStats = player.stats.find(
    s => s.seasonId === season && s.scoringPeriodId === 0 && s.statSourceId === 0
  );

  return seasonStats?.appliedTotal;
}

export async function loadLeague(
  leagueId: string,
  season: number = new Date().getFullYear(),
  options?: FetchOptions
): Promise<League> {
  // Fetch all required data
  const leagueData = await fetchESPN<ESPNAPI.League>(
    season,
    leagueId,
    ['mTeam', 'mRoster', 'mSettings', 'mDraftDetail', 'mMatchup'],
    options
  );

  // Build member map
  const memberMap = new Map<string, ESPNAPI.Member>();
  leagueData.members?.forEach(member => memberMap.set(member.id, member));

  // Determine draft type
  const draftType = leagueData.settings.draftSettings?.type === 'AUCTION' ? 'auction' : 'snake';

  // Build draft picks map by team
  const teamDraftPicks = new Map<number, DraftPick[]>();
  if (leagueData.draftDetail?.picks) {
    leagueData.draftDetail.picks.forEach(pick => {
      // We need to get player info from rosters since draft picks only have playerId
      const team = leagueData.teams.find(t => t.id === pick.teamId);
      const rosterEntry = team?.roster?.entries.find(
        e => e.playerId === pick.playerId
      );

      let player: Player;
      let seasonPoints: number | undefined;

      if (rosterEntry?.playerPoolEntry?.player) {
        player = convertPlayer(rosterEntry.playerPoolEntry.player);
        seasonPoints = getSeasonPoints(rosterEntry.playerPoolEntry.player, season);
      } else {
        player = {
          id: String(pick.playerId),
          platformId: String(pick.playerId),
          name: `Player ${pick.playerId}`,
          position: 'Unknown',
          team: 'Unknown',
        };
      }

      const draftPick: DraftPick = {
        pickNumber: pick.overallPickNumber,
        round: pick.roundId,
        player,
        teamId: String(pick.teamId),
        teamName: '', // Will be set later
        auctionValue: pick.bidAmount,
        seasonPoints,
      };

      const picks = teamDraftPicks.get(pick.teamId) || [];
      picks.push(draftPick);
      teamDraftPicks.set(pick.teamId, picks);
    });
  }

  // Build teams
  const teams: Team[] = leagueData.teams.map(espnTeam => {
    const ownerIds = espnTeam.owners || [];
    const primaryOwner = ownerIds.length > 0 ? memberMap.get(ownerIds[0]) : undefined;
    const teamName = espnTeam.name || `Team ${espnTeam.id}`;

    // Get roster with season points
    const roster: Player[] = [];
    espnTeam.roster?.entries.forEach(entry => {
      if (entry.playerPoolEntry?.player) {
        const player = convertPlayer(entry.playerPoolEntry.player);
        roster.push(player);
      }
    });

    // Get draft picks for this team
    const draftPicksForTeam = (teamDraftPicks.get(espnTeam.id) || []).map(pick => ({
      ...pick,
      teamName,
    }));

    return {
      id: String(espnTeam.id),
      name: teamName,
      ownerName: primaryOwner?.displayName,
      roster,
      draftPicks: draftPicksForTeam,
      transactions: [], // TODO: Would need separate API call
      wins: espnTeam.record?.overall.wins || 0,
      losses: espnTeam.record?.overall.losses || 0,
      ties: espnTeam.record?.overall.ties || 0,
      pointsFor: espnTeam.record?.overall.pointsFor || 0,
      pointsAgainst: espnTeam.record?.overall.pointsAgainst || 0,
    };
  });

  // Determine scoring type (simplified check)
  let scoringType: League['scoringType'] = 'custom';
  const scoringItems = leagueData.settings.scoringSettings?.scoringItems || [];
  const receptionPoints = scoringItems.find(s => s.statId === 53)?.points || 0; // statId 53 = receptions
  if (receptionPoints === 1) {
    scoringType = 'ppr';
  } else if (receptionPoints === 0.5) {
    scoringType = 'half_ppr';
  } else if (receptionPoints === 0) {
    scoringType = 'standard';
  }

  return {
    id: leagueId,
    platform: 'espn',
    name: leagueData.settings.name,
    season,
    draftType,
    teams,
    scoringType,
    totalTeams: leagueData.teams.length,
    currentWeek: leagueData.status?.currentMatchupPeriod,
    isLoaded: true,
  };
}

// Fetch transactions for ESPN league
export async function loadTransactions(
  leagueId: string,
  season: number,
  options?: FetchOptions
): Promise<Transaction[]> {
  try {
    const data = await fetchESPN<{ transactions: ESPNAPI.Transaction[] }>(
      season,
      leagueId,
      ['mTransactions2'],
      options
    );

    if (!data.transactions) return [];

    return data.transactions
      .filter(tx => tx.status === 'EXECUTED' && (tx.type === 'WAIVER' || tx.type === 'FREEAGENT'))
      .map(tx => {
        const adds: Player[] = [];
        const drops: Player[] = [];

        tx.items.forEach(item => {
          const player: Player = {
            id: String(item.playerId),
            platformId: String(item.playerId),
            name: `Player ${item.playerId}`,
            position: 'Unknown',
            team: 'Unknown',
          };

          if (item.type === 'ADD') {
            adds.push(player);
          } else if (item.type === 'DROP') {
            drops.push(player);
          }
        });

        return {
          id: String(tx.id),
          type: tx.type === 'WAIVER' ? 'waiver' : 'free_agent',
          timestamp: 0, // ESPN doesn't provide timestamp easily
          week: tx.scoringPeriodId,
          teamId: String(tx.items[0]?.toTeamId || 0),
          teamName: '',
          adds,
          drops,
          waiverBudgetSpent: tx.bidAmount,
        };
      });
  } catch (error) {
    console.warn('Could not fetch ESPN transactions:', error);
    return [];
  }
}
