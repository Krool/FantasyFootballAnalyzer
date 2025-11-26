import { TeamCard } from '@/components';
import type { League } from '@/types';
import styles from './TeamsPage.module.css';

interface TeamsPageProps {
  league: League;
}

export function TeamsPage({ league }: TeamsPageProps) {
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
            />
          ))}
        </div>
      </div>
    </div>
  );
}
