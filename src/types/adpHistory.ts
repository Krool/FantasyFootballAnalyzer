// The rolling consensus-rank history behind the ADP Shifts page. The daily
// pool build appends one snapshot per day the board actually moved (see
// scripts/adpHistory.ts); the app reads it read-only through
// src/data/adpHistory.ts. Ranks are 1-based ordinals on the half-PPR 1QB
// consensus board (consensusAvg order), keyed by the stable player-id slug,
// capped to the draftable depth so the file stays small.

export interface AdpSnapshot {
  /** UTC build date, YYYY-MM-DD. */
  date: string;
  /** Which cross-source feeds were present in the build (blend coverage). */
  sources: string[];
  /** Player id slug -> consensus board ordinal (1..depth). */
  ranks: Record<string, number>;
}

export interface AdpHistoryFile {
  season: number;
  settings: {
    scoring: 'half_ppr';
    superflex: false;
    /** Ordinals past this depth are not recorded. */
    depth: number;
  };
  /** Oldest first, trimmed to the retention cap. */
  snapshots: AdpSnapshot[];
}
