// The rolling consensus-rank history behind the ADP Trends page. The daily
// pool build appends one snapshot per day the board actually moved (see
// scripts/adpHistory.ts); the app reads it read-only through
// src/data/adpHistory.ts. Each snapshot carries one board per supported
// format: 1-based ordinals in consensusAvg order for that format, keyed by
// the stable player-id slug, capped to the draftable depth.

// The formats a snapshot records. Scoring variants differ through Sleeper's
// per-scoring ADP; superflex swaps in the FantasyPros SF rank and Sleeper 2QB
// ADP (and is scoring-independent, since the 2QB market is one board).
export const TREND_FORMATS = ['half_ppr', 'ppr', 'standard', 'superflex'] as const;
export type TrendFormat = (typeof TREND_FORMATS)[number];

export interface AdpSnapshot {
  /** UTC build date, YYYY-MM-DD. */
  date: string;
  /** Which cross-source feeds were present in the build (blend coverage). */
  sources: string[];
  /** Per-format: player id slug -> consensus board ordinal (1..depth). */
  boards: Record<TrendFormat, Record<string, number>>;
}

export interface AdpHistoryFile {
  season: number;
  settings: {
    formats: readonly TrendFormat[];
    /** Ordinals past this depth are not recorded. */
    depth: number;
  };
  /** Oldest first, trimmed to the retention cap. */
  snapshots: AdpSnapshot[];
}
