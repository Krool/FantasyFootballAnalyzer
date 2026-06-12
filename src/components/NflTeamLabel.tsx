import { useState, type CSSProperties } from 'react';
import { nflAccentColor, nflLogoUrl, nflTeamInfo } from '@/data/nflTeams';
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
// fallback for free agents and image failures. Logos render in full color
// and the abbreviation tints toward the team's brand color (softened with
// --bone so dark palettes stay readable on ink).
export function NflTeamLabel({ team, size = 'xs', logoOnly = false, className }: NflTeamLabelProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const info = nflTeamInfo(team);
  const url = nflLogoUrl(team);
  const accent = nflAccentColor(team);

  if (!info || !url) {
    // Free agent / unknown: keep the text so columns stay aligned.
    const text = (team ?? '').trim() || 'FA';
    return <span className={`${styles.label} ${styles[size]} ${className ?? ''}`}>{text}</span>;
  }

  return (
    <span
      className={`${styles.label} ${styles[size]} ${className ?? ''}`}
      title={info.name}
      style={accent ? ({ '--team-accent': accent } as CSSProperties) : undefined}
    >
      {!imgFailed && (
        <img
          src={url}
          alt=""
          loading="lazy"
          className={styles.logo}
          onError={() => setImgFailed(true)}
        />
      )}
      {(!logoOnly || imgFailed) && (
        <span className={accent ? `${styles.abbr} ${styles.abbrTinted}` : styles.abbr}>
          {info.abbr}
        </span>
      )}
    </span>
  );
}
