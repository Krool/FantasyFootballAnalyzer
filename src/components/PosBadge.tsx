import styles from './PosBadge.module.css';

interface PosBadgeProps {
  pos: string;
  // Optional position rank, rendered inside the badge ("RB12").
  posRank?: number;
  className?: string;
}

const KNOWN = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DST']);

// Position chip with the standard color coding (left bar + tinted text).
// Unknown positions (FLEX rows, platform oddities) render uncolored.
export function PosBadge({ pos, posRank, className }: PosBadgeProps) {
  const base = pos.toUpperCase().replace(/[^A-Z]/g, '');
  const known = KNOWN.has(base);
  return (
    <span
      className={`${styles.badge} ${known ? styles[base.toLowerCase()] : ''} ${className ?? ''}`}
    >
      {base}
      {posRank ? <span className={styles.rank}>{posRank}</span> : null}
    </span>
  );
}
