import { useState } from 'react';
import { nflLogoUrl, nflTeamInfo } from '@/data/nflTeams';
import styles from './NflTeamLabel.module.css';

interface NflTeamLabelProps {
  team: string | null | undefined;
  // xs: 14px logo for dense table rows; sm: 18px for headers/cards.
  size?: 'xs' | 'sm';
  // Hide the abbreviation and show only the logo (for very dense columns).
  logoOnly?: boolean;
  className?: string;
}

// NFL team identity chip: tiny logo + abbreviation, with a plain text
// fallback for free agents and image failures. Logos idle in grayscale so
// 32 brand palettes don't shout over the app's own.
export function NflTeamLabel({ team, size = 'xs', logoOnly = false, className }: NflTeamLabelProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const info = nflTeamInfo(team);
  const url = nflLogoUrl(team);

  if (!info || !url) {
    // Free agent / unknown: keep the text so columns stay aligned.
    const text = (team ?? '').trim() || 'FA';
    return <span className={`${styles.label} ${styles[size]} ${className ?? ''}`}>{text}</span>;
  }

  return (
    <span className={`${styles.label} ${styles[size]} ${className ?? ''}`} title={info.name}>
      {!imgFailed && (
        <img
          src={url}
          alt=""
          loading="lazy"
          className={styles.logo}
          onError={() => setImgFailed(true)}
        />
      )}
      {(!logoOnly || imgFailed) && <span className={styles.abbr}>{info.abbr}</span>}
    </span>
  );
}
