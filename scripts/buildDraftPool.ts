// Builds the bundled draft pool JSON from the raw data exports in data/.
// Run with: npm run build:draft-data
//
// Inputs:
//   data/raw/fp-rankings.2026.json      (preferred rankings source, from npm run fetch:rankings)
//   data/FantasyPros_2026_Draft_ALL_Rankings.csv  (fallback rankings when no fetched snapshot)
//   data/salary_cap_values.csv          (FantasyPros auction $ for the top ~178)
//   data/raw/espn-values.2026.json      (optional: ESPN ADP + auction values)
//   data/raw/sleeper-adp.2026.json      (optional: Sleeper ADP)
// Output:
//   src/data/draftPool.2026.json        (imported statically by the app)
//
// Joins are by normalized name (team is a tiebreaker only). Salary rows that
// fail to match a ranking row abort the build (same-source data should match
// 100%); cross-source ESPN/Sleeper misses are only warned, since their player
// pools legitimately differ at the deep end.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchPlayer } from '../src/utils/playerNames';

const SEASON = 2026;
// The FantasyPros salary cap cheat sheet baseline these values assume.
const BASELINE = { budget: 200, teams: 12, rounds: 14 };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rankingsPath = join(root, 'data', `FantasyPros_${SEASON}_Draft_ALL_Rankings.csv`);
const salaryPath = join(root, 'data', 'salary_cap_values.csv');
const outPath = join(root, 'src', 'data', `draftPool.${SEASON}.json`);

interface PoolPlayer {
  id: string;
  name: string;
  team: string;
  pos: string;
  posRank: number;
  overallRank: number;
  tier: number;
  bye: number | null;
  // FantasyPros auction $ at BASELINE; null below the salary sheet's cutoff.
  baseValue: number | null;
  // Cross-source market data (absent when the source has no entry).
  espnAdp?: number;
  espnValue?: number; // live ESPN auction market price (their default league shape)
  sleeperAdp?: number; // half-PPR ADP
  sleeperAdpPpr?: number;
  sleeperAdpStd?: number;
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

// --- Rankings: fetched FantasyPros snapshot preferred, CSV export fallback ---
interface FpSnapshot {
  scoring: string;
  players: Array<{
    name: string; team: string; pos: string; posRank: number;
    rank: number; tier: number; bye: number | null;
  }>;
}

function playersFromSnapshot(snapshot: FpSnapshot): PoolPlayer[] {
  return snapshot.players.map(p => ({
    id: `fp-${p.rank}`,
    name: p.name,
    team: p.team,
    pos: p.pos.replace('/', ''),
    posRank: p.posRank,
    overallRank: p.rank,
    tier: p.tier || 0,
    bye: p.bye,
    baseValue: null,
  }));
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
    result.push({
      id: `fp-${overallRank}`,
      name: row[cols.name].trim(),
      team: row[cols.team].trim(),
      pos: posMatch[1].replace('/', ''),
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
    ? `Rankings from fetched snapshot (${fpSnapshot.scoring} scoring)`
    : 'Rankings from CSV export (run npm run fetch:rankings for fresher data)',
);

// --- Salary values joined onto rankings ---
const salaryRows = readRows(salaryPath).slice(1); // skip header
const unmatched: string[] = [];
let matched = 0;
for (const row of salaryRows) {
  const [, name, team, value] = row.map(f => f.trim());
  const hit = matchPlayer({ name, team }, players);
  if (!hit) {
    unmatched.push(`${name} (${team}) $${value}`);
    continue;
  }
  hit.baseValue = Number(value);
  matched++;
}

if (unmatched.length > 0) {
  console.error(`FAILED: ${unmatched.length} salary row(s) did not match any ranking row:`);
  for (const line of unmatched) console.error(`  - ${line}`);
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
// from FantasyPros at the deep end.
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
        ? players.find(p => p.pos === 'DST' && p.team === row.team) ?? null
        : matchPlayer({ name: row.name, pos: row.pos, team: row.team }, players);
    if (!player) {
      misses.push(`${row.name} (${row.pos} ${row.team})`);
      continue;
    }
    apply(player, row);
    hits++;
  }
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
}
const sleeperSnapshot = loadRawSnapshot<{ players: SleeperRow[] }>(`sleeper-adp.${SEASON}.json`);
joinSource('Sleeper', sleeperSnapshot?.players, (player, row) => {
  if (row.adpHalfPpr !== null) player.sleeperAdp = Math.round(row.adpHalfPpr * 10) / 10;
  if (row.adpPpr !== null) player.sleeperAdpPpr = Math.round(row.adpPpr * 10) / 10;
  if (row.adpStd !== null) player.sleeperAdpStd = Math.round(row.adpStd * 10) / 10;
});

const out = {
  season: SEASON,
  generatedAt: new Date().toISOString(),
  baseline: BASELINE,
  players,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

const byPos = players.reduce<Record<string, number>>((acc, p) => {
  acc[p.pos] = (acc[p.pos] ?? 0) + 1;
  return acc;
}, {});
console.log(`Wrote ${outPath}`);
console.log(`  ${players.length} players (${Object.entries(byPos).map(([p, n]) => `${p}:${n}`).join(' ')})`);
console.log(`  ${matched}/${salaryRows.length} salary values matched`);
