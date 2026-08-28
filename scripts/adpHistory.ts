// Pure helpers for the rolling consensus-rank history that feeds the ADP
// Trends page. buildDraftPool.ts calls these after the pool is joined;
// backfillAdpHistory.ts reuses them against historical pool versions read
// from git. No filesystem access here so both callers (and the tests) share
// exactly one implementation of the ordinal and append rules.

import { consensusAvg } from '../src/utils/consensus';
import type { PoolPlayer } from '../src/types/draft';
import { TREND_FORMATS } from '../src/types/adpHistory';
import type { AdpHistoryFile, AdpSnapshot, TrendFormat } from '../src/types/adpHistory';
import type { ScoringType } from '../src/utils/valueScaling';

// Movement past the draftable range is join noise (the sites' boards run out
// at different depths), the same reason the Values cards cap at consensus 150.
export const HISTORY_DEPTH = 300;
// Enough retained days to always find a >=7-day-old baseline for the weekly
// window even when quiet days record no snapshot.
export const MAX_SNAPSHOTS = 10;

export function emptyHistory(season: number): AdpHistoryFile {
  return {
    season,
    settings: { formats: TREND_FORMATS, depth: HISTORY_DEPTH },
    snapshots: [],
  };
}

// consensusAvg's (scoring, superflex) arguments for each stored format. The
// superflex board is scoring-independent: with superflex on, consensusAvg
// reads the FantasyPros SF rank and Sleeper's 2QB ADP, one market regardless
// of reception scoring.
const FORMAT_ARGS: Record<TrendFormat, [ScoringType, boolean]> = {
  half_ppr: ['half_ppr', false],
  ppr: ['ppr', false],
  standard: ['standard', false],
  superflex: ['half_ppr', true],
};

// One format's consensus board as 1-based ordinals, capped at HISTORY_DEPTH.
// Ordinals (not the raw average) so the unit is literally "spots on the
// board" and a 0.3 wobble in the average never renders as movement. Ties
// break by FantasyPros rank then id, so the order is deterministic run to run.
export function consensusOrdinals(
  players: PoolPlayer[],
  format: TrendFormat = 'half_ppr',
): Record<string, number> {
  const [scoring, superflex] = FORMAT_ARGS[format];
  const sorted = players
    .filter(p => Number.isFinite(consensusAvg(p, scoring, superflex)))
    .sort((a, b) => {
      const diff = consensusAvg(a, scoring, superflex) - consensusAvg(b, scoring, superflex);
      if (diff !== 0) return diff;
      if (a.overallRank !== b.overallRank) return a.overallRank - b.overallRank;
      return a.id < b.id ? -1 : 1;
    })
    .slice(0, HISTORY_DEPTH);
  const ranks: Record<string, number> = {};
  sorted.forEach((p, i) => { ranks[p.id] = i + 1; });
  return ranks;
}

// Every format's board for one day's snapshot.
export function consensusBoards(players: PoolPlayer[]): AdpSnapshot['boards'] {
  return Object.fromEntries(
    TREND_FORMATS.map(f => [f, consensusOrdinals(players, f)]),
  ) as AdpSnapshot['boards'];
}

// Which cross-source feeds actually contributed to this pool, derived from the
// joined data itself so the backfill (which has only the pool JSON, not the
// raw snapshots) reports the same thing the daily build does. FantasyPros is
// the base source and is always present.
export function detectSources(players: PoolPlayer[]): string[] {
  const sources = ['fantasypros'];
  if (players.some(p => p.espnAdp != null)) sources.push('espn');
  if (players.some(p => p.sleeperAdp != null)) sources.push('sleeper');
  if (players.some(p => p.yahooAdpRank != null)) sources.push('yahoo');
  return sources;
}

function sameRanks(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(k => b[k] === a[k]);
}

function sameBoards(a: AdpSnapshot['boards'], b: AdpSnapshot['boards']): boolean {
  return TREND_FORMATS.every(f => sameRanks(a[f] ?? {}, b[f] ?? {}));
}

// Append (or fold in) one day's snapshot. Rules:
//   - A season mismatch starts the history over (rollover).
//   - Unchanged ranks record nothing: the history only moves when the board
//     moved, which keeps the daily workflow's "no real change" guard intact
//     and makes windows compare against the last actual change.
//   - A second build on the same date replaces that date's snapshot — and if
//     that replacement makes the day a no-op against the day before (the
//     board reverted), the day is dropped instead of stored, so "Last Day"
//     never compares two identical snapshots.
//   - A snapshot dated BEFORE the newest is refused: the windows assume
//     date-ordered snapshots, and the only way to produce one is a backwards
//     clock or a stale manual run, neither worth recording.
//   - Retention trims to the newest MAX_SNAPSHOTS.
// Returns the (possibly new) file and whether the caller needs to write it.
export function appendSnapshot(
  existing: AdpHistoryFile | null,
  season: number,
  snapshot: AdpSnapshot,
): { file: AdpHistoryFile; changed: boolean } {
  const base = existing && existing.season === season ? existing : emptyHistory(season);
  const snapshots = [...base.snapshots];
  const newest = snapshots[snapshots.length - 1];

  if (newest && snapshot.date < newest.date) {
    return { file: base, changed: false };
  }
  if (newest && newest.date !== snapshot.date && sameBoards(newest.boards, snapshot.boards)) {
    return { file: base, changed: false };
  }
  if (newest && newest.date === snapshot.date) {
    const previous = snapshots[snapshots.length - 2];
    if (previous && sameBoards(previous.boards, snapshot.boards)) {
      snapshots.pop();
    } else {
      snapshots[snapshots.length - 1] = snapshot;
    }
  } else {
    snapshots.push(snapshot);
  }
  return {
    file: { ...base, snapshots: snapshots.slice(-MAX_SNAPSHOTS) },
    changed: true,
  };
}

// One line per BOARD (not per rank entry, not one giant line per snapshot):
// a day's change diffs as four changed lines in the repo, and the file stays
// a fraction of the size full pretty-printing would make it.
export function serializeHistory(file: AdpHistoryFile): string {
  const snapshotBlocks = file.snapshots
    .map(s => {
      const boardLines = TREND_FORMATS.map(
        f => `      "${f}": ${JSON.stringify(s.boards[f] ?? {})}`,
      ).join(',\n');
      return (
        `    {"date": ${JSON.stringify(s.date)}, "sources": ${JSON.stringify(s.sources)}, "boards": {\n` +
        `${boardLines}\n    }}`
      );
    })
    .join(',\n');
  return (
    `{\n  "season": ${file.season},\n  "settings": ${JSON.stringify(file.settings)},\n` +
    `  "snapshots": [\n${snapshotBlocks}\n  ]\n}\n`
  );
}

// The generated indirection module (mirrors src/data/draftPool.ts) so app code
// never hardcodes the season in an import path.
export function historyIndirectionSource(season: number): string {
  return [
    '// GENERATED by scripts/buildDraftPool.ts — do not edit by hand.',
    '// The app imports the ADP history through this module so a season',
    '// rollover only changes generated files.',
    `import historyJson from './adpHistory.${season}.json';`,
    "import type { AdpHistoryFile } from '@/types/adpHistory';",
    '',
    '// Through unknown: TS infers a union of literal rank objects from the JSON',
    '// (one shape per snapshot), which never unifies with Record<string, number>.',
    'export const ADP_HISTORY = historyJson as unknown as AdpHistoryFile;',
    '',
  ].join('\n');
}
