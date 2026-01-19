import { useMemo } from 'react';
import { TeamCard } from '@/components';
import type { League } from '@/types';
import { calculateLuckMetrics, type LuckMetrics, type MatchupData } from '@/utils/luck';
import styles from './TeamsPage.module.css';

interface TeamsPageProps {
  league: League;
}

export function TeamsPage({ league }: TeamsPageProps) {
  // Calculate luck metrics
  const luckByTeam = useMemo((): Map<string, LuckMetrics> => {
    if (!league.matchups || league.matchups.length === 0) {
      return new Map();
    }

    const matchupData: MatchupData[] = league.matchups.map(m => ({
      week: m.week,
      team1Id: m.team1Id,
      team1Points: m.team1Points,
      team2Id: m.team2Id,
      team2Points: m.team2Points,
    }));

    const teams = league.teams.map(t => ({
      id: t.id,
      name: t.name,
      wins: t.wins || 0,
      losses: t.losses || 0,
      ties: t.ties || 0,
      pointsFor: t.pointsFor || 0,
    }));

    const metrics = calculateLuckMetrics(matchupData, teams);
    const map = new Map<string, LuckMetrics>();
    metrics.forEach(m => map.set(m.teamId, m));
    return map;
  }, [league.matchups, league.teams]);

  // Sort teams by record (wins desc, then points for desc)
  const sortedTeams = [...league.teams].sort((a, b) => {
    const aWins = a.wins || 0;
    const bWins = b.wins || 0;
    if (aWins !== bWins) return bWins - aWins;

    const aPoints = a.pointsFor || 0;
    const bPoints = b.pointsFor || 0;
    return bPoints - aPoints;
  });

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>Teams Overview</h1>
          <p className={styles.subtitle}>
            {league.totalTeams} teams in {league.name}
          </p>
        </div>

        <div className={styles.grid}>
          {sortedTeams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              allTeams={league.teams}
              totalTeams={league.totalTeams}
              luckMetrics={luckByTeam.get(team.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
