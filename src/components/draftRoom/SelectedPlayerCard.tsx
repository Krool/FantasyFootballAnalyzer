import { useState } from 'react';
import type { PoolPlayer } from '@/types/draft';
import { NflTeamLabel, PosBadge } from '@/components';
import { playerHeadshotUrl } from '@/data/nflTeams';
import { injuryAbbrev } from '@/utils/injury';
import styles from './Logger.module.css';

interface SelectedPlayerCardProps {
  player: PoolPlayer | null;
  // Extra meta after the team (e.g. "Exp $24"). Rank/tier render by default.
  detail?: string;
}

// The "who's on the block / about to be picked" card shared by all three
// loggers: headshot, position, team logo, and the identity confirmation a
// fast room needs (two players named Lamb problem).
export function SelectedPlayerCard({ player, detail }: SelectedPlayerCardProps) {
  const [imgFailed, setImgFailed] = useState(false);

  if (!player) {
    return (
      <div className={styles.clock}>
        <span className={styles.clockKicker}>No player selected</span>
        <span className={styles.clockTeam}>Pick a player from the board</span>
      </div>
    );
  }

  const headshot = playerHeadshotUrl(player.sleeperId);

  return (
    <div className={`${styles.clockMine} ${styles.playerCard}`}>
      {headshot && !imgFailed && (
        <img
          src={headshot}
          alt=""
          className={styles.headshot}
          onError={() => setImgFailed(true)}
        />
      )}
      <div className={styles.playerCardBody}>
        <span className={styles.clockKicker}>
          <PosBadge pos={player.pos} posRank={player.posRank} />{' '}
          <NflTeamLabel team={player.team} /> ·{' '}
          {detail ?? `#${player.overallRank} · Tier ${player.tier}`}
          {player.injuryStatus && (
            <span className={styles.cardInjury} title={player.injuryStatus}>
              {' '}{injuryAbbrev(player.injuryStatus)}
            </span>
          )}
        </span>
        <span className={styles.clockTeam}>{player.name}</span>
      </div>
    </div>
  );
}
