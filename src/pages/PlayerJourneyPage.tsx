import { useState, useMemo } from 'react';
import type { League, Player, DraftPick } from '@/types';
import styles from './PlayerJourneyPage.module.css';

interface PlayerJourneyPageProps {
  league: League;
}

interface PlayerJourneyEvent {
  type: 'drafted' | 'traded_to' | 'traded_from' | 'waiver_add' | 'waiver_drop' | 'fa_add' | 'fa_drop';
  timestamp: number;
  week?: number;
  teamId: string;
  teamName: string;
  details?: string;
}

interface PlayerWithJourney {
  player: Player;
  events: PlayerJourneyEvent[];
  draftPick?: DraftPick;
  currentTeam?: { id: string; name: string };
  totalSeasonPoints?: number;
}

export function PlayerJourneyPage({ league }: PlayerJourneyPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [positionFilter, setPositionFilter] = useState<string>('all');

  // Build comprehensive player map with journey data
  const playersWithJourneys = useMemo(() => {
    const playerMap = new Map<string, PlayerWithJourney>();

    // Helper to get or create player entry
    const getPlayer = (player: Player): PlayerWithJourney => {
      let entry = playerMap.get(player.id);
      if (!entry) {
        entry = {
          player,
          events: [],
          totalSeasonPoints: player.seasonPoints,
        };
        playerMap.set(player.id, entry);
      }
      return entry;
    };

    // 1. Process draft picks
    league.teams.forEach(team => {
      team.draftPicks?.forEach(pick => {
        const entry = getPlayer(pick.player);
        entry.draftPick = pick;
        entry.totalSeasonPoints = pick.seasonPoints || entry.totalSeasonPoints;
        entry.events.push({
          type: 'drafted',
          timestamp: 0, // Draft happens before season
          teamId: team.id,
          teamName: team.name,
          details: `Round ${pick.round}, Pick ${pick.pickNumber}${pick.auctionValue ? ` ($${pick.auctionValue})` : ''}`,
        });
      });
    });

    // 2. Process transactions (waivers/free agents)
    league.teams.forEach(team => {
      team.transactions?.forEach(tx => {
        if (tx.type === 'trade') return; // Handle trades separately

        tx.adds.forEach(player => {
          const entry = getPlayer(player);
          entry.events.push({
            type: tx.type === 'waiver' ? 'waiver_add' : 'fa_add',
            timestamp: tx.timestamp,
            week: tx.week,
            teamId: team.id,
            teamName: team.name,
            details: tx.waiverBudgetSpent ? `$${tx.waiverBudgetSpent} FAAB` : undefined,
          });
        });

        tx.drops.forEach(player => {
          const entry = getPlayer(player);
          entry.events.push({
            type: tx.type === 'waiver' ? 'waiver_drop' : 'fa_drop',
            timestamp: tx.timestamp,
            week: tx.week,
            teamId: team.id,
            teamName: team.name,
          });
        });
      });
    });

    // 3. Process trades
    league.trades?.forEach(trade => {
      trade.teams.forEach(team => {
        team.playersReceived.forEach(player => {
          const entry = getPlayer(player);
          entry.events.push({
            type: 'traded_to',
            timestamp: trade.timestamp,
            week: trade.week,
            teamId: team.teamId,
            teamName: team.teamName,
          });
        });

        team.playersSent.forEach(player => {
          const entry = getPlayer(player);
          entry.events.push({
            type: 'traded_from',
            timestamp: trade.timestamp,
            week: trade.week,
            teamId: team.teamId,
            teamName: team.teamName,
          });
        });
      });
    });

    // 4. Add players from current rosters (for those not in transactions)
    league.teams.forEach(team => {
      team.roster?.forEach(player => {
        const entry = getPlayer(player);
        entry.currentTeam = { id: team.id, name: team.name };
        if (player.seasonPoints !== undefined) {
          entry.totalSeasonPoints = player.seasonPoints;
        }
      });
    });

    // 5. Sort events by timestamp for each player
    playerMap.forEach(entry => {
      entry.events.sort((a, b) => a.timestamp - b.timestamp);
    });

    return Array.from(playerMap.values());
  }, [league]);

  // Get unique positions for filter
  const positions = useMemo(() => {
    const posSet = new Set<string>();
    playersWithJourneys.forEach(p => {
      if (p.player.position && p.player.position !== 'Unknown') {
        posSet.add(p.player.position);
      }
    });
    return Array.from(posSet).sort();
  }, [playersWithJourneys]);

  // Filter players based on search and position
  const filteredPlayers = useMemo(() => {
    return playersWithJourneys
      .filter(p => {
        // Filter out "Player XXXX" placeholder names
        if (p.player.name.match(/^Player\s+-?\d+$/)) return false;

        // Search filter
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          if (!p.player.name.toLowerCase().includes(query)) return false;
        }

        // Position filter
        if (positionFilter !== 'all' && p.player.position !== positionFilter) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Sort by season points descending
        const aPoints = a.totalSeasonPoints || 0;
        const bPoints = b.totalSeasonPoints || 0;
        return bPoints - aPoints;
      });
  }, [playersWithJourneys, searchQuery, positionFilter]);

  // Get selected player details
  const selectedPlayer = useMemo(() => {
    if (!selectedPlayerId) return null;
    return playersWithJourneys.find(p => p.player.id === selectedPlayerId) || null;
  }, [selectedPlayerId, playersWithJourneys]);

  const getEventIcon = (type: PlayerJourneyEvent['type']) => {
    switch (type) {
      case 'drafted': return '📋';
      case 'traded_to': return '↗️';
      case 'traded_from': return '↘️';
      case 'waiver_add': return '⬆️';
      case 'waiver_drop': return '⬇️';
      case 'fa_add': return '+';
      case 'fa_drop': return '-';
    }
  };

  const getEventLabel = (type: PlayerJourneyEvent['type']) => {
    switch (type) {
      case 'drafted': return 'Drafted by';
      case 'traded_to': return 'Traded to';
      case 'traded_from': return 'Traded from';
      case 'waiver_add': return 'Waiver claim by';
      case 'waiver_drop': return 'Dropped by';
      case 'fa_add': return 'FA pickup by';
      case 'fa_drop': return 'Released by';
    }
  };

  const getEventClass = (type: PlayerJourneyEvent['type']) => {
    switch (type) {
      case 'drafted': return styles.eventDrafted;
      case 'traded_to': return styles.eventTradeIn;
      case 'traded_from': return styles.eventTradeOut;
      case 'waiver_add':
      case 'fa_add': return styles.eventAdd;
      case 'waiver_drop':
      case 'fa_drop': return styles.eventDrop;
    }
  };

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>Player Journey</h1>
          <p className={styles.subtitle}>
            Track any player's path through {league.name}
          </p>
        </div>

        <div className={styles.controls}>
          <div className={styles.searchBox}>
            <input
              type="text"
              placeholder="Search players..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
              aria-label="Search players"
            />
          </div>
          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            className={styles.positionFilter}
            aria-label="Filter by position"
          >
            <option value="all">All Positions</option>
            {positions.map(pos => (
              <option key={pos} value={pos}>{pos}</option>
            ))}
          </select>
        </div>

        <div className={styles.content}>
          {/* Player List */}
          <div className={styles.playerList}>
            <div className={styles.listHeader}>
              <span className={styles.listTitle}>
                {filteredPlayers.length} Players
              </span>
            </div>
            <div className={styles.listItems}>
              {filteredPlayers.slice(0, 100).map(p => (
                <button
                  key={p.player.id}
                  className={`${styles.playerItem} ${selectedPlayerId === p.player.id ? styles.selected : ''}`}
                  onClick={() => setSelectedPlayerId(p.player.id)}
                >
                  <div className={styles.playerInfo}>
                    <span className={styles.playerName}>{p.player.name}</span>
                    <span className={styles.playerMeta}>
                      {p.player.position} - {p.player.team}
                    </span>
                  </div>
                  <div className={styles.playerStats}>
                    {p.totalSeasonPoints !== undefined && (
                      <span className={styles.points}>{p.totalSeasonPoints.toFixed(1)} pts</span>
                    )}
                    {p.events.length > 0 && (
                      <span className={styles.eventCount}>{p.events.length} events</span>
                    )}
                  </div>
                </button>
              ))}
              {filteredPlayers.length > 100 && (
                <div className={styles.moreResults}>
                  +{filteredPlayers.length - 100} more players (refine search)
                </div>
              )}
              {filteredPlayers.length === 0 && (
                <div className={styles.noResults}>
                  No players found matching your search.
                </div>
              )}
            </div>
          </div>

          {/* Player Detail */}
          <div className={styles.playerDetail}>
            {selectedPlayer ? (
              <>
                <div className={styles.detailHeader}>
                  <div className={styles.detailInfo}>
                    <h2 className={styles.detailName}>{selectedPlayer.player.name}</h2>
                    <span className={styles.detailMeta}>
                      {selectedPlayer.player.position} - {selectedPlayer.player.team}
                    </span>
                  </div>
                  {selectedPlayer.currentTeam && (
                    <div className={styles.currentTeam}>
                      <span className={styles.currentTeamLabel}>Current Team</span>
                      <span className={styles.currentTeamName}>{selectedPlayer.currentTeam.name}</span>
                    </div>
                  )}
                </div>

                {/* Stats Summary */}
                <div className={styles.statsSummary}>
                  {selectedPlayer.draftPick && (
                    <div className={styles.statCard}>
                      <span className={styles.statValue}>
                        {selectedPlayer.draftPick.round}.{String(selectedPlayer.draftPick.pickNumber % 12 || 12).padStart(2, '0')}
                      </span>
                      <span className={styles.statLabel}>Draft Pick</span>
                    </div>
                  )}
                  <div className={styles.statCard}>
                    <span className={styles.statValue}>
                      {selectedPlayer.totalSeasonPoints?.toFixed(1) || '-'}
                    </span>
                    <span className={styles.statLabel}>Season Pts</span>
                  </div>
                  <div className={styles.statCard}>
                    <span className={styles.statValue}>{selectedPlayer.events.length}</span>
                    <span className={styles.statLabel}>Transactions</span>
                  </div>
                </div>

                {/* Journey Timeline */}
                <div className={styles.timeline}>
                  <h3 className={styles.timelineTitle}>Journey Timeline</h3>
                  {selectedPlayer.events.length > 0 ? (
                    <div className={styles.events}>
                      {selectedPlayer.events.map((event, index) => (
                        <div
                          key={index}
                          className={`${styles.event} ${getEventClass(event.type)}`}
                        >
                          <span className={styles.eventIcon}>{getEventIcon(event.type)}</span>
                          <div className={styles.eventContent}>
                            <span className={styles.eventLabel}>
                              {getEventLabel(event.type)} <strong>{event.teamName}</strong>
                            </span>
                            {event.details && (
                              <span className={styles.eventDetails}>{event.details}</span>
                            )}
                            {event.week !== undefined && event.week > 0 && (
                              <span className={styles.eventTime}>Week {event.week}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.noEvents}>
                      No transaction history for this player.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className={styles.noSelection}>
                <p>Select a player to view their journey</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
