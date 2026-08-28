// One-time backfill of src/data/adpHistory.<season>.json from the daily bot
// commits of the pool JSON already in git history, so the Trends page launches
// with a real week window instead of warming up for 7 days.
//
// Run with: npx tsx scripts/backfillAdpHistory.ts   (optional --season=YYYY)
//
// Read-only against git (git log / git show); writes only the two adpHistory
// files. Commit those two files ALONE — never let a locally rebuilt pool ride
// along (see the stale-pool warning in CLAUDE.md). Re-running recomputes from
// scratch with the same ordinal rules the daily build uses, so a later daily
// append continues seamlessly — but it reads only COMMITTED pool versions, so
// it discards any snapshot from an uncommitted local build, and folding
// unchanged days means N days can yield fewer than N snapshots.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolPlayer } from '../src/types/draft';
import {
  MAX_SNAPSHOTS, appendSnapshot, consensusBoards, detectSources, emptyHistory,
  historyIndirectionSource, serializeHistory,
} from './adpHistory';
import { currentDraftSeason } from './season';

const seasonArg = process.argv.find(a => a.startsWith('--season='));
const SEASON = seasonArg ? Number(seasonArg.split('=')[1]) : currentDraftSeason();

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const poolRelPath = `src/data/draftPool.${SEASON}.json`;

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Newest-first commit list for the pool file; keep the LAST build of each UTC
// day (the first row seen per day), then take the newest MAX_SNAPSHOTS days.
const log = git('log', '--format=%H %cI', '--', poolRelPath).trim();
if (!log) {
  console.error(`No commits found for ${poolRelPath}`);
  process.exit(1);
}
const byDay = new Map<string, string>();
for (const line of log.split('\n')) {
  const [sha, iso] = line.split(' ');
  const day = new Date(iso).toISOString().slice(0, 10);
  if (!byDay.has(day)) byDay.set(day, sha);
}
const days = [...byDay.keys()].sort().slice(-MAX_SNAPSHOTS);
console.log(`Backfilling from ${days.length} days: ${days[0]} .. ${days[days.length - 1]}`);

let history = emptyHistory(SEASON);
for (const day of days) {
  const sha = byDay.get(day)!;
  const pool = JSON.parse(git('show', `${sha}:${poolRelPath}`)) as {
    season: number;
    players: PoolPlayer[];
  };
  if (pool.season !== SEASON) {
    console.warn(`  ${day} (${sha.slice(0, 7)}): season ${pool.season}, skipped`);
    continue;
  }
  const { file, changed } = appendSnapshot(history, SEASON, {
    date: day,
    sources: detectSources(pool.players),
    boards: consensusBoards(pool.players),
  });
  history = file;
  console.log(`  ${day} (${sha.slice(0, 7)}): ${changed ? 'recorded' : 'board unchanged, folded'}`);
}

const historyPath = join(root, 'src', 'data', `adpHistory.${SEASON}.json`);
writeFileSync(historyPath, serializeHistory(history));
writeFileSync(join(root, 'src', 'data', 'adpHistory.ts'), historyIndirectionSource(SEASON));
console.log(`Wrote ${historyPath} (${history.snapshots.length} snapshots)`);
