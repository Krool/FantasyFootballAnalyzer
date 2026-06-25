// Builds the bundled draft pool JSON from the raw data exports in data/.
// Run with: npm run build:draft-data
// Optional: npm run build:draft-data -- --season=2027   (default: auto)
//
// Inputs:
//   data/raw/fp-rankings.<season>.json  (preferred rankings source, from npm run fetch:rankings)
//   data/FantasyPros_<season>_Draft_ALL_Rankings.csv  (fallback rankings when no fetched snapshot)
//   data/salary_cap_values.csv          (FantasyPros auction $ for the top ~178)
//   data/raw/espn-values.<season>.json  (optional: ESPN ADP + auction values)
//   data/raw/sleeper-adp.<season>.json  (optional: Sleeper ADP + projections)
//   data/raw/sleeper-players.json       (optional: injury/rookie/depth/ids)
// Outputs:
//   src/data/draftPool.<season>.json    (the pool data)
//   src/data/draftPool.ts               (regenerated indirection module the
//                                        app imports, so a season rollover
//                                        never requires touching app code)
//   data/raw/misses.<season>.json       (unmatched cross-source join report)
//
// Joins are by normalized name (team is a tiebreaker only). Salary rows that
// fail to match a ranking row abort the build (same-source data should match
// 100%); cross-source ESPN/Sleeper misses are only warned, since their player
// pools legitimately differ at the deep end.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalTeam, matchPlayer, normalizeName } from '../src/utils/playerNames';
import { currentDraftSeason } from './season';

const seasonArg = process.argv.find(a => a.startsWith('--season='));
const SEASON = seasonArg ? Number(seasonArg.split('=')[1]) : currentDraftSeason();
if (!Number.isInteger(SEASON) || SEASON < 2020 || SEASON > 2100) {
  console.error(`Bad season "${seasonArg}"`);
  process.exit(1);
}

// The FantasyPros salary cap cheat sheet baseline these values assume.
const BASELINE = { budget: 200, teams: 12, rounds: 14 };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rankingsPath = join(root, 'data', `FantasyPros_${SEASON}_Draft_ALL_Rankings.csv`);
const salaryPath = join(root, 'data', 'salary_cap_values.csv');
const outPath = join(root, 'src', 'data', `draftPool.${SEASON}.json`);
const indirectionPath = join(root, 'src', 'data', 'draftPool.ts');
const missesPath = join(root, 'data', 'raw', `misses.${SEASON}.json`);

interface PoolPlayer {
  id: string;
  name: string;
  team: string;
  pos: string;
  posRank: number;
  overallRank: number;
  // FantasyPros superflex (2QB) consensus overall rank; QBs sit far higher here.
  overallRankSF?: number;
  tier: number;
  bye: number | null;
  // FantasyPros auction $ at BASELINE; null below the salary sheet's cutoff.
  baseValue: number | null;
  // Expert disagreement band around the consensus rank.
  rankMin?: number;
  rankMax?: number;
  rankStd?: number;
  // Cross-source market data (absent when the source has no entry).
  espnAdp?: number;
  espnValue?: number; // live ESPN auction market price (their default league shape)
  sleeperAdp?: number; // half-PPR ADP
  sleeperAdpPpr?: number;
  sleeperAdpStd?: number;
  sleeperAdp2qb?: number; // 2QB/superflex ADP
  // Sleeper season-long projected points by scoring format.
  projPts?: number; // half-PPR
  projPtsPpr?: number;
  projPtsStd?: number;
  // From the Sleeper players dump.
  sleeperId?: string;
  // Dynasty consensus rank/tier (whole-roster value). Absent when the dynasty
  // snapshot is missing or the player isn't dynasty-ranked.
  dynastyRank?: number;
  dynastyTier?: number;
  injuryStatus?: string; // Questionable / Out / IR / PUP / Sus...
  injuryBodyPart?: string; // e.g. "Hamstring" — only when injuryStatus is set
  injuryNotes?: string; // Sleeper's latest injury blurb, often absent
  injuryStartDate?: string; // YYYY-MM-DD
  rookie?: boolean;
  depthChartOrder?: number;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some(f => f.trim() !== '')) rows.push(row);
  }
  return rows;
}

function readRows(path: string): string[][] {
  // Strip a UTF-8 byte order mark if present.
  const raw = readFileSync(path, 'utf8');
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return parseCsv(text).filter(r => !r[0].startsWith('#'));
}

function loadRawSnapshot<T>(name: string): T | null {
  const path = join(root, 'data', 'raw', name);
  if (!existsSync(path)) return null;
  return (JSON.parse(readFileSync(path, 'utf8')) as { data: T }).data;
}

// Stable player ids: rebuilding the pool after rankings move must not change
// a player's id, because saved Draft Room sessions persist these ids (the
// old `fp-<rank>` scheme silently remapped every logged pick after a daily
// refresh). Slug of name+pos; DSTs key on the franchise.
function playerId(name: string, pos: string, team: string): string {
  if (pos === 'DST') return `dst-${canonicalTeam(team).toLowerCase()}`;
  const slug = normalizeName(name).replace(/\s+/g, '-');
  return `${slug}-${pos.toLowerCase()}`;
}

// --- Rankings: fetched FantasyPros snapshot preferred, CSV export fallback ---
interface FpSnapshot {
  scoring: string;
  players: Array<{
    name: string; team: string; pos: string; posRank: number;
    rank: number; tier: number; bye: number | null;
    rankMin?: number | null; rankMax?: number | null; rankStd?: number | null;
  }>;
}

function playersFromSnapshot(snapshot: FpSnapshot): PoolPlayer[] {
  return snapshot.players.map(p => {
    const pos = p.pos.replace('/', '');
    return {
      id: playerId(p.name, pos, p.team),
      name: p.name,
      team: p.team,
      pos,
      posRank: p.posRank,
      overallRank: p.rank,
      tier: p.tier || 0,
      bye: p.bye,
      baseValue: null,
      ...(p.rankMin != null ? { rankMin: p.rankMin } : {}),
      ...(p.rankMax != null ? { rankMax: p.rankMax } : {}),
      ...(p.rankStd != null ? { rankStd: Math.round(p.rankStd * 10) / 10 } : {}),
    };
  });
}

function playersFromCsv(): PoolPlayer[] {
  const rankingRows = readRows(rankingsPath);
  const header = rankingRows[0].map(h => h.trim().toUpperCase());
  const col = (name: string) => {
    const idx = header.indexOf(name);
    if (idx === -1) throw new Error(`Rankings CSV is missing column "${name}"`);
    return idx;
  };
  const cols = {
    rank: col('RK'),
    tier: col('TIERS'),
    name: col('PLAYER NAME'),
    team: col('TEAM'),
    pos: col('POS'),
    bye: col('BYE WEEK'),
  };

  const result: PoolPlayer[] = [];
  for (const row of rankingRows.slice(1)) {
    const posRaw = row[cols.pos].trim();
    const posMatch = posRaw.match(/^([A-Z/]+)(\d+)$/);
    if (!posMatch) {
      console.warn(`Skipping row with unparseable POS "${posRaw}": ${row[cols.name]}`);
      continue;
    }
    const overallRank = Number(row[cols.rank]);
    const bye = Number(row[cols.bye]);
    const name = row[cols.name].trim();
    const team = row[cols.team].trim();
    const pos = posMatch[1].replace('/', '');
    result.push({
      id: playerId(name, pos, team),
      name,
      team,
      pos,
      posRank: Number(posMatch[2]),
      overallRank,
      tier: Number(row[cols.tier]) || 0,
      bye: Number.isFinite(bye) && bye > 0 ? bye : null,
      baseValue: null,
    });
  }
  return result;
}

const fpSnapshot = loadRawSnapshot<FpSnapshot>(`fp-rankings.${SEASON}.json`);
const players: PoolPlayer[] = fpSnapshot ? playersFromSnapshot(fpSnapshot) : playersFromCsv();
console.log(
  fpSnapshot
    ? `Rankings from fetched snapshot (${fpSnapshot.scoring} scoring), season ${SEASON}`
    : `Rankings from CSV export, season ${SEASON} (run npm run fetch:rankings for fresher data)`,
);

// Distinct players can share a normalized name+pos (it has happened: Lamar
// Jackson, Mike Williams; and 3+ when deep rookies/FAs churn in preseason).
// Group by base id, suffix EVERY member of a colliding group with its franchise,
// then assert the final id set is unique - so a true duplicate (same name+pos+
// team) bails loudly instead of silently shipping a duplicate/unstable id.
{
  const byBase = new Map<string, PoolPlayer[]>();
  for (const player of players) {
    const group = byBase.get(player.id);
    if (group) group.push(player);
    else byBase.set(player.id, [player]);
  }
  for (const group of byBase.values()) {
    if (group.length < 2) continue;
    for (const player of group) {
      player.id = `${player.id}-${canonicalTeam(player.team).toLowerCase()}`;
    }
  }
  const finalIds = new Map<string, PoolPlayer>();
  for (const player of players) {
    const clash = finalIds.get(player.id);
    if (clash) {
      console.error(`FAILED: id collision ${player.id} (${clash.name} vs ${player.name})`);
      process.exit(1);
    }
    finalIds.set(player.id, player);
  }
}

// When a hand-maintained salary row fails to match, point at the likely fix:
// ranking rows that share the surname. This catches the common drift modes
// (first name vs nickname like Kenneth -> Kenny, a suffix appearing or
// vanishing). Returns null when nothing is close.
function suggestMatch(name: string, candidates: PoolPlayer[]): string | null {
  const surname = normalizeName(name).split(' ').pop();
  if (!surname) return null;
  const near = candidates.filter(c => normalizeName(c.name).split(' ').includes(surname));
  if (near.length === 0) return null;
  return near.map(c => `'${c.name}' (${c.pos} ${c.team})`).join(', ');
}

// --- Salary values joined onto rankings ---
// The salary sheet is hand-kept against FantasyPros names, which drift over a
// season. A couple of stale rows must not blackhole the whole daily refresh:
// the position-curve reprojection just below rebuilds every dollar value from
// its position rank, so one missing salary point barely moves the board. So
// tolerate a few unmatched rows (recorded with a suggested fix in the misses
// report so we can mend them), and only abort when a miss is expensive enough
// to be a renamed star or when so many miss that the sheet or the export
// drifted structurally.
const SALARY_MISS_TOLERANCE = 5;
const SALARY_MISS_VALUE_FLOOR = 30; // a miss worth this much is a real asset, not deep-bench drift
const salaryRows = readRows(salaryPath).slice(1); // skip header
const salaryMisses: { line: string; value: number }[] = [];
let matched = 0;
for (const row of salaryRows) {
  const [, name, team, value] = row.map(f => f.trim());
  const hit = matchPlayer({ name, team }, players);
  if (!hit) {
    const suggestion = suggestMatch(name, players);
    salaryMisses.push({
      value: Number(value),
      line: `${name} (${team}) $${value}${suggestion ? ` -> did you mean ${suggestion}?` : ''}`,
    });
    continue;
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    // A non-numeric salary cell (a stray '$', a typo) would otherwise write NaN
    // into baseValue, which survives the `!== null` curve filter below and
    // poisons the position curve via the unstable NaN sort. Surface it as a
    // miss instead of shipping garbage prices on a green build.
    salaryMisses.push({ value: 0, line: `${name} (${team}) "${value}" is not a number` });
    continue;
  }
  hit.baseValue = numericValue;
  matched++;
}
console.log(
  `Salary: ${matched}/${salaryRows.length} matched${salaryMisses.length ? `, ${salaryMisses.length} unmatched` : ''}`,
);
for (const miss of salaryMisses) console.warn(`  unmatched salary row: ${miss.line}`);

const expensiveMiss = salaryMisses.find(m => m.value >= SALARY_MISS_VALUE_FLOOR);
if (expensiveMiss || salaryMisses.length > SALARY_MISS_TOLERANCE) {
  console.error(
    expensiveMiss
      ? `FAILED: an expensive salary row did not match (${expensiveMiss.line}). A miss worth $${expensiveMiss.value} is likely a renamed starter, not deep-bench drift.`
      : `FAILED: ${salaryMisses.length} salary rows did not match (tolerance ${SALARY_MISS_TOLERANCE}). This many misses means the sheet or the rankings export drifted structurally.`,
  );
  console.error('Fix the names in data/salary_cap_values.csv (or the matcher) and rerun.');
  process.exit(1);
}

// The salary sheet is a frozen snapshot while rankings refresh daily, so the
// two drift apart (a player can be valued like a top-5 pick while ranked
// 13th). Reconcile them: extract each position's dollar curve from the sheet
// (the Nth-priced RB's value, etc.) and re-apply it to the CURRENT rankings,
// so the auction board always agrees with the snake board by construction.
// Per-player market nuance comes from the live ESPN values instead.
const positionCurves = new Map<string, number[]>();
for (const player of players) {
  if (player.baseValue === null) continue;
  const curve = positionCurves.get(player.pos) ?? [];
  curve.push(player.baseValue);
  positionCurves.set(player.pos, curve);
}
for (const curve of positionCurves.values()) curve.sort((a, b) => b - a);
for (const player of players) {
  const curve = positionCurves.get(player.pos);
  player.baseValue = curve?.[player.posRank - 1] ?? null;
}
console.log(
  'Reprojected salary curves onto current rankings:',
  [...positionCurves.entries()].map(([pos, c]) => `${pos}:${c.length}`).join(' '),
);

// --- Cross-source market data (optional snapshots) ---
// Misses here are warned, not fatal: ESPN/Sleeper pools legitimately differ
// from FantasyPros at the deep end. The full miss list lands in
// data/raw/misses.<season>.json so join drift is visible in the repo, not
// just in CI logs nobody reads.
const missReport: Record<string, string[]> = {
  // Salary join ran above; carry any tolerated drift into the same report so it
  // lands in misses.<season>.json next to the cross-source misses, where it is
  // diffable in the repo instead of buried in a CI log.
  Salary: salaryMisses.map(m => m.line),
};

function joinSource<T extends { name: string; pos: string; team: string }>(
  label: string,
  rows: T[] | undefined,
  apply: (player: PoolPlayer, row: T) => void,
): void {
  if (!rows) return;
  let hits = 0;
  const misses: string[] = [];
  for (const row of rows) {
    const player =
      row.pos === 'DST'
        ? players.find(p => p.pos === 'DST' && canonicalTeam(p.team) === canonicalTeam(row.team)) ?? null
        : matchPlayer({ name: row.name, pos: row.pos, team: row.team }, players);
    if (!player) {
      misses.push(`${row.name} (${row.pos} ${row.team})`);
      continue;
    }
    apply(player, row);
    hits++;
  }
  missReport[label] = misses;
  console.log(`${label}: ${hits}/${rows.length} matched${misses.length ? `, ${misses.length} unmatched` : ''}`);
  for (const miss of misses.slice(0, 8)) console.log(`  unmatched: ${miss}`);
  if (misses.length > 8) console.log(`  ... and ${misses.length - 8} more`);
}

interface EspnRow {
  name: string; pos: string; team: string;
  adp: number | null; auctionValueLive: number | null; auctionValueEditorial: number | null;
}
const espnSnapshot = loadRawSnapshot<{ players: EspnRow[] }>(`espn-values.${SEASON}.json`);
joinSource('ESPN', espnSnapshot?.players, (player, row) => {
  if (row.adp !== null) player.espnAdp = Math.round(row.adp * 10) / 10;
  const value = row.auctionValueLive ?? row.auctionValueEditorial;
  if (value !== null && value > 0) player.espnValue = Math.round(value);
});

interface SleeperRow {
  name: string; pos: string; team: string;
  adpHalfPpr: number | null; adpPpr: number | null; adpStd: number | null; adp2qb: number | null;
  ptsHalfPpr?: number | null; ptsPpr?: number | null; ptsStd?: number | null;
}
const sleeperSnapshot = loadRawSnapshot<{ players: SleeperRow[] }>(`sleeper-adp.${SEASON}.json`);
joinSource('Sleeper', sleeperSnapshot?.players, (player, row) => {
  if (row.adpHalfPpr !== null) player.sleeperAdp = Math.round(row.adpHalfPpr * 10) / 10;
  if (row.adpPpr !== null) player.sleeperAdpPpr = Math.round(row.adpPpr * 10) / 10;
  if (row.adpStd !== null) player.sleeperAdpStd = Math.round(row.adpStd * 10) / 10;
  if (row.adp2qb !== null) player.sleeperAdp2qb = Math.round(row.adp2qb * 10) / 10;
  if (row.ptsHalfPpr != null && row.ptsHalfPpr > 0) player.projPts = Math.round(row.ptsHalfPpr * 10) / 10;
  if (row.ptsPpr != null && row.ptsPpr > 0) player.projPtsPpr = Math.round(row.ptsPpr * 10) / 10;
  if (row.ptsStd != null && row.ptsStd > 0) player.projPtsStd = Math.round(row.ptsStd * 10) / 10;
});

interface DynastyRow {
  name: string; pos: string; team: string; rank: number; tier: number;
}
const dynastySnapshot = loadRawSnapshot<{ players: DynastyRow[] }>(`fp-dynasty.${SEASON}.json`);
joinSource('Dynasty', dynastySnapshot?.players, (player, row) => {
  if (Number.isFinite(row.rank)) player.dynastyRank = row.rank;
  if (Number.isFinite(row.tier) && row.tier > 0) player.dynastyTier = row.tier;
});

interface SuperflexRow {
  name: string; pos: string; team: string; rank: number;
}
const superflexSnapshot = loadRawSnapshot<{ players: SuperflexRow[] }>(`fp-superflex.${SEASON}.json`);
// The OP (superflex) board is offense-only (QB/RB/WR/TE), so K and DST never
// get an overallRankSF and fall back to their 1QB overallRank in the superflex
// consensus. Both sit deep on the offensive and 1QB boards alike, so the mixed
// scale only nudges the very bottom of the order.
joinSource('Superflex', superflexSnapshot?.players, (player, row) => {
  if (Number.isFinite(row.rank)) player.overallRankSF = row.rank;
});

interface SleeperPlayerRow {
  sleeperId: string; name: string; pos: string; team: string;
  status: string | null; injuryStatus: string | null;
  injuryBodyPart?: string | null; injuryNotes?: string | null;
  injuryStartDate?: string | null;
  yearsExp: number | null; depthChartOrder: number | null;
}
const sleeperPlayers = loadRawSnapshot<{ players: SleeperPlayerRow[] }>('sleeper-players.json');
if (sleeperPlayers) {
  // Reverse join (pool -> dump) so a miss means "pool player not in the
  // dump", which is the interesting direction here.
  let hits = 0;
  const misses: string[] = [];
  for (const player of players) {
    if (player.pos === 'DST') continue; // dump models DSTs differently; skip
    const row = matchPlayer(
      { name: player.name, pos: player.pos, team: player.team },
      sleeperPlayers.players,
    );
    if (!row) {
      misses.push(`${player.name} (${player.pos} ${player.team})`);
      continue;
    }
    player.sleeperId = row.sleeperId;
    if (row.injuryStatus) {
      player.injuryStatus = row.injuryStatus;
      // Detail fields only mean anything alongside a status.
      if (row.injuryBodyPart) player.injuryBodyPart = row.injuryBodyPart;
      if (row.injuryNotes) player.injuryNotes = row.injuryNotes;
      if (row.injuryStartDate) player.injuryStartDate = row.injuryStartDate;
    }
    if (row.yearsExp === 0) player.rookie = true;
    if (row.depthChartOrder != null) player.depthChartOrder = row.depthChartOrder;
    hits++;
  }
  missReport['SleeperPlayers'] = misses;
  console.log(`Sleeper players: ${hits} enriched${misses.length ? `, ${misses.length} pool players not in dump` : ''}`);
}

const out = {
  season: SEASON,
  generatedAt: new Date().toISOString(),
  baseline: BASELINE,
  players,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
writeFileSync(missesPath, JSON.stringify(missReport, null, 2) + '\n');

// Regenerate the indirection module so app code never hardcodes the season.
writeFileSync(
  indirectionPath,
  [
    '// GENERATED by scripts/buildDraftPool.ts — do not edit by hand.',
    '// The app imports the current draft pool through this module so a season',
    '// rollover only changes generated files.',
    `import poolJson from './draftPool.${SEASON}.json';`,
    "import type { DraftPoolFile } from '@/types/draft';",
    '',
    'export const POOL = poolJson as DraftPoolFile;',
    '',
  ].join('\n'),
);

const byPos = players.reduce<Record<string, number>>((acc, p) => {
  acc[p.pos] = (acc[p.pos] ?? 0) + 1;
  return acc;
}, {});
console.log(`Wrote ${outPath}`);
console.log(`Wrote ${indirectionPath} (season ${SEASON})`);
console.log(`  ${players.length} players (${Object.entries(byPos).map(([p, n]) => `${p}:${n}`).join(' ')})`);
console.log(`  ${matched}/${salaryRows.length} salary values matched`);
