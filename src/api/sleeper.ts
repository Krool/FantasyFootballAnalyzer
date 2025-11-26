import type { SleeperAPI, League, Team, DraftPick, Transaction, Player, Trade, SeasonSummary, HeadToHeadRecord } from '@/types';

const BASE_URL = 'https://api.sleeper.app/v1';

// Cache for player data (it's a large file, fetch once)
let playerCache: Record<string, SleeperAPI.Player> | null = null;

async function fetchJSON<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`);
  if (!response.ok) {
    throw new Error(`Sleeper API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function getAllPlayers(): Promise<Record<string, SleeperAPI.Player>> {
  if (playerCache) return playerCache;

  // This is a large file (~5MB), only fetch once per session
  playerCache = await fetchJSON<Record<string, SleeperAPI.Player>>('/players/nfl');
  return playerCache;
}

export async function getLeague(leagueId: string): Promise<SleeperAPI.League> {
  return fetchJSON<SleeperAPI.League>(`/league/${leagueId}`);
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

  // Fetch draft picks if draft exists
  let draftPicks: SleeperAPI.DraftPick[] = [];
  if (leagueData.draft_id) {
    try {
      draftPicks = await getDraftPicks(leagueData.draft_id);
    } catch {
      console.warn('Could not fetch draft picks');
    }
  }

  // Fetch all transactions for the season
  const currentWeek = nflState.week || 18;
  const transactionPromises: Promise<SleeperAPI.Transaction[]>[] = [];
  for (let week = 1; week <= currentWeek; week++) {
    transactionPromises.push(getTransactions(leagueId, week).catch(() => []));
  }
  const allTransactions = (await Promise.all(transactionPromises)).flat();

  // Get season stats for player performance
  let seasonStats: SleeperAPI.SeasonStats = {};
  try {
    seasonStats = await getSeasonStats(leagueData.season);
  } catch {
    console.warn('Could not fetch season stats');
  }

  // Get matchups for each week to calculate points in started games
  const matchupPromises: Promise<SleeperAPI.Matchup[]>[] = [];
  for (let week = 1; week <= currentWeek; week++) {
    matchupPromises.push(getMatchups(leagueId, week).catch(() => []));
  }
  const allMatchups = await Promise.all(matchupPromises);

  // Build user map (owner_id -> user)
  const userMap = new Map<string, SleeperAPI.User>();
  users.forEach(user => userMap.set(user.user_id, user));

  // Build roster map (roster_id -> roster)
  const rosterMap = new Map<number, SleeperAPI.Roster>();
  rosters.forEach(roster => rosterMap.set(roster.roster_id, roster));

  // Build owner map (roster_id -> owner_id)
  const rosterOwnerMap = new Map<number, string>();
  rosters.forEach(roster => rosterOwnerMap.set(roster.roster_id, roster.owner_id));

  // Determine scoring type from settings
  const scoringSettings = leagueData.scoring_settings;
  let scoringType: League['scoringType'] = 'custom';
  if (scoringSettings.rec === 1) {
    scoringType = 'ppr';
  } else if (scoringSettings.rec === 0.5) {
    scoringType = 'half_ppr';
  } else if (scoringSettings.rec === 0) {
    scoringType = 'standard';
  }

  // Build a map of player starts by roster and week for waiver impact tracking
  // Key: `${rosterId}-${playerId}`, Value: Map<week, points>
  const playerStartsByRosterAndWeek = new Map<string, Map<number, number>>();
  allMatchups.forEach((weekMatchups, weekIndex) => {
    const week = weekIndex + 1;
    weekMatchups.forEach(matchup => {
      if (matchup.starters && matchup.starters_points) {
        matchup.starters.forEach((playerId, index) => {
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
      seasonPoints: seasonStats[pick.player_id]?.pts_ppr || seasonStats[pick.player_id]?.pts_half_ppr || seasonStats[pick.player_id]?.pts_std,
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

      const adds = tx.adds ? Object.keys(tx.adds).map(id => convertPlayer(id, players)) : [];
      const drops = tx.drops ? Object.keys(tx.drops).map(id => convertPlayer(id, players)) : [];

      // Calculate total points generated by added players in games started BY THIS TEAM AFTER the pickup
      // tx.leg is the week of the transaction - player can start from the following week
      const pickupWeek = tx.leg;
      let totalPointsGenerated = 0;
      let gamesStarted = 0;
      adds.forEach(player => {
        const key = `${primaryRosterId}-${player.platformId}`;
        const weekMap = playerStartsByRosterAndWeek.get(key);
        if (weekMap) {
          // Only count weeks AFTER the pickup week (player was picked up during week X, can start week X+1 or later)
          // But also count the pickup week if they started that week (mid-week pickups)
          weekMap.forEach((points, week) => {
            if (week >= pickupWeek) {
              totalPointsGenerated += points;
              gamesStarted += 1;
            }
          });
        }
      });

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
        gamesStarted,
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

      // Calculate points for each side - points scored BY THAT TEAM AFTER the trade
      const tradeWeek = tx.leg;
      const tradeTeams = rosterIds.map(rosterId => {
        const received = addsPerRoster.get(rosterId) || [];
        const sent = dropsPerRoster.get(rosterId) || [];

        let pointsGained = 0;
        let pointsLost = 0;

        // Points gained = points from received players started by this team after trade
        received.forEach(playerId => {
          const key = `${rosterId}-${playerId}`;
          const weekMap = playerStartsByRosterAndWeek.get(key);
          if (weekMap) {
            weekMap.forEach((points, week) => {
              if (week >= tradeWeek) {
                pointsGained += points;
              }
            });
          }
        });

        // Points lost = points from sent players started by the OTHER team after trade
        // Find the other roster ID(s) that received these players
        sent.forEach(playerId => {
          // Find which roster received this player
          rosterIds.forEach(otherRosterId => {
            if (otherRosterId !== rosterId) {
              const otherReceived = addsPerRoster.get(otherRosterId) || [];
              if (otherReceived.includes(playerId)) {
                const key = `${otherRosterId}-${playerId}`;
                const weekMap = playerStartsByRosterAndWeek.get(key);
                if (weekMap) {
                  weekMap.forEach((points, week) => {
                    if (week >= tradeWeek) {
                      pointsLost += points;
                    }
                  });
                }
              }
            }
          });
        });

        return {
          teamId: String(rosterId),
          teamName: '', // Will be set later
          playersReceived: received.map(id => convertPlayer(id, players)),
          playersSent: sent.map(id => convertPlayer(id, players)),
          pointsGained,
          pointsLost,
          netValue: pointsGained - pointsLost,
        };
      });

      // Determine winner
      let winner: string | undefined;
      let winnerMargin = 0;
      if (tradeTeams.length === 2) {
        const [team1, team2] = tradeTeams;
        const diff = team1.netValue - team2.netValue;
        if (Math.abs(diff) > 10) { // Margin threshold
          winner = diff > 0 ? team1.teamId : team2.teamId;
          winnerMargin = Math.abs(diff);
        }
      }

      const trade: Trade = {
        id: tx.transaction_id,
        timestamp: tx.created,
        week: tx.leg,
        status: 'completed',
        teams: tradeTeams,
        winner,
        winnerMargin,
      };

      allTrades.push(trade);
    });

  // Build team name map for trades
  const teamNameMap = new Map<string, string>();
  rosters.forEach(roster => {
    const owner = userMap.get(roster.owner_id);
    const teamName = owner?.display_name || owner?.username || `Team ${roster.roster_id}`;
    teamNameMap.set(String(roster.roster_id), teamName);
  });

  // Update trade team names
  const tradesWithNames = allTrades.map(trade => ({
    ...trade,
    teams: trade.teams.map(t => ({
      ...t,
      teamName: teamNameMap.get(t.teamId) || t.teamId,
    })),
  }));

  // Build teams
  const teams: Team[] = rosters.map(roster => {
    const owner = userMap.get(roster.owner_id);
    const teamName = owner?.display_name || owner?.username || `Team ${roster.roster_id}`;

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

  return {
    id: leagueId,
    platform: 'sleeper',
    name: leagueData.name,
    season: parseInt(leagueData.season),
    draftType: 'snake', // Sleeper primarily supports snake drafts
    teams,
    trades: tradesWithNames,
    scoringType,
    totalTeams: leagueData.total_rosters,
    currentWeek: nflState.week,
    isLoaded: true,
    previousLeagueId: (leagueData as SleeperAPI.League & { previous_league_id?: string }).previous_league_id,
  };
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

      // Build teams with standings
      const teamsWithStandings = rosters
        .map(roster => {
          const owner = userMap.get(roster.owner_id);
          return {
            id: String(roster.roster_id),
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
          if (a.wins !== b.wins) return b.wins - a.wins;
          return b.pointsFor - a.pointsFor;
        })
        .map((team, index) => ({ ...team, standing: index + 1 }));

      history.push({
        season: parseInt(leagueData.season),
        leagueId: currentLeagueId,
        leagueName: leagueData.name,
        teams: teamsWithStandings,
      });

      currentLeagueId = (leagueData as SleeperAPI.League & { previous_league_id?: string }).previous_league_id;
      seasonsLoaded++;
    } catch (error) {
      console.warn(`Could not load season for league ${currentLeagueId}:`, error);
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
        rosterToOwner.set(roster.roster_id, roster.owner_id);
        const owner = userMap.get(roster.owner_id);
        const name = owner?.display_name || owner?.username || `Team ${roster.roster_id}`;
        rosterToName.set(roster.roster_id, name);
        ownerIdToName.set(roster.owner_id, name);
      });

      // Find our team's roster ID for this season
      let ourRosterId: number | undefined;
      if (seasonsLoaded === 0) {
        // First season: use the provided teamId
        ourRosterId = parseInt(teamId);
        teamName = rosterToName.get(ourRosterId) || teamId;
      } else {
        // Subsequent seasons: find by matching owner ID
        const ourOwnerIdInFirstSeason = rosters.find(r => String(r.roster_id) === teamId)?.owner_id;
        if (ourOwnerIdInFirstSeason) {
          const roster = rosters.find(r => r.owner_id === ourOwnerIdInFirstSeason);
          ourRosterId = roster?.roster_id;
        }
      }

      if (!ourRosterId) {
        currentLeagueId = (leagueData as SleeperAPI.League & { previous_league_id?: string }).previous_league_id;
        seasonsLoaded++;
        continue;
      }

      // Load all matchups for the season
      const weekCount = 17; // Regular season weeks
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

          // Update record
          const ourScore = ourMatchup.points || 0;
          const oppScore = opponentMatchup.points || 0;
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

      currentLeagueId = (leagueData as SleeperAPI.League & { previous_league_id?: string }).previous_league_id;
      seasonsLoaded++;
    } catch (error) {
      console.warn(`Could not load matchups for league ${currentLeagueId}:`, error);
      break;
    }
  }

  return { records, teamName };
}
