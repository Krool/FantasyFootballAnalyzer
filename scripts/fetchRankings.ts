// Fetches draft rankings/ADP/auction values from FantasyPros, ESPN, and
// Sleeper into data/raw/*.json snapshots, which buildDraftPool.ts folds
// into the bundled pool. Run with: npm run fetch:rankings
// Optional: npm run fetch:rankings -- --scoring=PPR   (default HALF)
//           npm run fetch:rankings -- --season=2027   (default: auto)
//
// Auth notes:
// - FantasyPros: uses the public API key FantasyPros ships in its own site
//   JS (every browser on their rankings page uses it). If it ever rotates,
//   re-extract from the rankings page bundle (search "x-api-key").
// - ESPN: leaguedefaults/3 (default PPR league) is fully public.
// - Sleeper: api.sleeper.com/projections is the endpoint Sleeper's own web
//   client uses; public, undocumented. api.sleeper.app/v1/players/nfl is
//   the documented players dump (injury status, depth charts, experience).
// - Yahoo (average_cost auction values) needs an OAuth token and is not
//   fetched here yet.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentDraftSeason } from './season';

const seasonArg = process.argv.find(a => a.startsWith('--season='));
const SEASON = seasonArg ? Number(seasonArg.split('=')[1]) : currentDraftSeason();
if (!Number.isInteger(SEASON) || SEASON < 2020 || SEASON > 2100) {
  console.error(`Bad season "${seasonArg}"`);
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = join(root, 'data', 'raw');

const scoringArg = process.argv.find(a => a.startsWith('--scoring='));
const FP_SCORING = (scoringArg?.split('=')[1] ?? 'HALF').toUpperCase(); // STD | HALF | PPR

// FantasyPros' own public browser key (see header note).
const FP_API_KEY = 'zjxN52G3lP4fORpHRftGI2mTU8cTwxVNvkjByM3j';

// A truncated or empty source response must not silently gut the pool: the
// daily Action would commit and deploy it. These floors are well under the
// normal counts (FP ~500, ESPN 400, Sleeper ~250+) but catch a dead source.
const MIN_ROWS = { fp: 400, espn: 200, sleeper: 150, sleeperPlayers: 300 };

const ESPN_POSITION_MAP: Record<number, string> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST',
};
const ESPN_TEAM_MAP: Record<number, string> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
  9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA',
  16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI',
  23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR',
  30: 'JAC', 33: 'BAL', 34: 'HOU', 0: 'FA',
};

// Fetch with a timeout and two retries (1s/4s backoff): the daily Action
// shouldn't go red because one request hit a transient blip.
async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, attempt === 1 ? 1000 : 4000));
    }
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'FantasyFootballAnalyzer (github.com/Krool/FantasyFootballAnalyzer)', ...headers },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      console.warn(`Attempt ${attempt + 1} failed for ${url}: ${err}`);
    }
  }
  throw lastErr;
}

function assertMinRows(label: string, count: number, min: number): void {
  if (count < min) {
    throw new Error(
      `${label} returned only ${count} rows (sanity floor ${min}). ` +
      'Refusing to write a gutted snapshot; the previous one stays in place.',
    );
  }
}

function writeRaw(name: string, payload: unknown): void {
  const path = join(rawDir, name);
  writeFileSync(path, JSON.stringify({ season: SEASON, fetchedAt: new Date().toISOString(), data: payload }, null, 1) + '\n');
  console.log(`Wrote ${path}`);
}

async function fetchFantasyPros(): Promise<void> {
  const url = `https://api.fantasypros.com/v2/json/nfl/${SEASON}/consensus-rankings?type=draft&scoring=${FP_SCORING}&position=ALL&week=0`;
  const json = (await getJson(url, { 'x-api-key': FP_API_KEY })) as {
    players: Array<{
      player_name: string;
      player_team_id: string;
      player_position_id: string;
      pos_rank?: string | null;
      rank_ecr: number;
      tier: number;
      player_bye_week: string | null;
      rank_min?: string | number | null;
      rank_max?: string | number | null;
      rank_std?: string | number | null;
    }>;
  };
  if (!Array.isArray(json.players)) throw new Error('FantasyPros payload has no players array');
  const players = json.players.map(p => ({
    name: p.player_name,
    team: p.player_team_id,
    pos: p.player_position_id,
    // pos_rank is usually "RB12"; be defensive, a missing field on one row
    // must not kill the whole source.
    posRank: typeof p.pos_rank === 'string' ? Number(p.pos_rank.replace(/^[A-Z]+/, '')) || 0 : 0,
    rank: p.rank_ecr,
    tier: p.tier,
    bye: p.player_bye_week ? Number(p.player_bye_week) || null : null,
    // Expert disagreement bands: how far the optimists and pessimists sit
    // from consensus. Great "reach risk" signal.
    rankMin: p.rank_min != null ? Number(p.rank_min) || null : null,
    rankMax: p.rank_max != null ? Number(p.rank_max) || null : null,
    rankStd: p.rank_std != null ? Number(p.rank_std) || null : null,
  }));
  assertMinRows('FantasyPros', players.length, MIN_ROWS.fp);
  console.log(`FantasyPros: ${players.length} players (${FP_SCORING})`);
  writeRaw(`fp-rankings.${SEASON}.json`, { scoring: FP_SCORING, players });
}

async function fetchEspn(): Promise<void> {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leaguedefaults/3?view=kona_player_info`;
  const filter = { players: { limit: 400, sortAdp: { sortAsc: true, sortPriority: 1 } } };
  const json = (await getJson(url, {
    'X-Fantasy-Filter': JSON.stringify(filter),
    Accept: 'application/json',
  })) as {
    players: Array<{
      player: {
        fullName: string;
        defaultPositionId: number;
        proTeamId: number;
        ownership?: { averageDraftPosition?: number; auctionValueAverage?: number };
        draftRanksByRankType?: { PPR?: { auctionValue?: number } };
      };
    }>;
  };
  if (!Array.isArray(json.players)) throw new Error('ESPN payload has no players array');
  const players = json.players.map(({ player: p }) => ({
    name: p.fullName,
    pos: ESPN_POSITION_MAP[p.defaultPositionId] ?? 'UNK',
    team: ESPN_TEAM_MAP[p.proTeamId] ?? 'FA',
    adp: p.ownership?.averageDraftPosition ?? null,
    // Live market price from real ESPN auction drafts; editorial value as backup.
    auctionValueLive: p.ownership?.auctionValueAverage ?? null,
    auctionValueEditorial: p.draftRanksByRankType?.PPR?.auctionValue ?? null,
  }));
  assertMinRows('ESPN', players.length, MIN_ROWS.espn);
  const withValues = players.filter(p => (p.auctionValueLive ?? 0) > 0).length;
  console.log(`ESPN: ${players.length} players, ${withValues} with live auction values`);
  writeRaw(`espn-values.${SEASON}.json`, { players });
}

async function fetchSleeper(): Promise<void> {
  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p => `position[]=${p}`).join('&');
  const url = `https://api.sleeper.com/projections/nfl/${SEASON}?season_type=regular&${positions}&order_by=adp_half_ppr`;
  const json = (await getJson(url)) as Array<{
    team: string | null;
    player: { first_name: string; last_name: string; position: string };
    stats: Record<string, number | undefined>;
  }>;
  if (!Array.isArray(json)) throw new Error('Sleeper payload is not an array');
  // 999 is Sleeper's unranked sentinel. K/DST never get ADP from Sleeper, so
  // keep any row with season-long projected points too — that's how kicker
  // and defense projections make it into the pool.
  const ranked = json.filter(
    p => (p.stats?.adp_half_ppr ?? 999) < 999 || (p.stats?.pts_half_ppr ?? 0) > 0,
  );
  const players = ranked.map(p => ({
    name: `${p.player.first_name} ${p.player.last_name}`,
    pos: p.player.position === 'DEF' ? 'DST' : p.player.position,
    team: p.team ?? 'FA',
    adpHalfPpr: (p.stats.adp_half_ppr ?? 999) < 999 ? p.stats.adp_half_ppr : null,
    adpPpr: (p.stats.adp_ppr ?? 999) < 999 ? p.stats.adp_ppr : null,
    adpStd: (p.stats.adp_std ?? 999) < 999 ? p.stats.adp_std : null,
    adp2qb: (p.stats.adp_2qb ?? 999) < 999 ? p.stats.adp_2qb : null,
    // Season-long projected points: the cheapest projections on the internet,
    // already in this payload.
    ptsHalfPpr: p.stats.pts_half_ppr ?? null,
    ptsPpr: p.stats.pts_ppr ?? null,
    ptsStd: p.stats.pts_std ?? null,
  }));
  assertMinRows('Sleeper', players.length, MIN_ROWS.sleeper);
  console.log(`Sleeper: ${players.length} players with ADP or projections`);
  writeRaw(`sleeper-adp.${SEASON}.json`, { players });
}

// The full players dump is ~5MB of mostly-inactive players; trim to the
// fantasy-relevant slice before committing it as a snapshot.
async function fetchSleeperPlayers(): Promise<void> {
  const url = 'https://api.sleeper.app/v1/players/nfl';
  const json = (await getJson(url)) as Record<string, {
    first_name?: string;
    last_name?: string;
    position?: string | null;
    team?: string | null;
    status?: string | null;
    injury_status?: string | null;
    injury_body_part?: string | null;
    injury_notes?: string | null;
    injury_start_date?: string | null;
    years_exp?: number | null;
    depth_chart_order?: number | null;
    full_name?: string;
  }>;
  const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
  const players = Object.entries(json)
    .filter(([, p]) => p.position && POSITIONS.has(p.position) && p.team)
    .map(([id, p]) => ({
      sleeperId: id,
      name: p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
      pos: p.position === 'DEF' ? 'DST' : p.position!,
      team: p.team!,
      status: p.status ?? null,
      injuryStatus: p.injury_status ?? null,
      injuryBodyPart: p.injury_body_part ?? null,
      injuryNotes: p.injury_notes ?? null,
      injuryStartDate: p.injury_start_date ?? null,
      yearsExp: p.years_exp ?? null,
      depthChartOrder: p.depth_chart_order ?? null,
    }));
  assertMinRows('Sleeper players', players.length, MIN_ROWS.sleeperPlayers);
  console.log(`Sleeper players: ${players.length} rostered fantasy-position players`);
  writeRaw('sleeper-players.json', { players });
}

mkdirSync(rawDir, { recursive: true });
console.log(`Fetching for season ${SEASON}`);
const results = await Promise.allSettled([
  fetchFantasyPros(),
  fetchEspn(),
  fetchSleeper(),
  fetchSleeperPlayers(),
]);
let failed = false;
for (const r of results) {
  if (r.status === 'rejected') {
    failed = true;
    console.error('FAILED:', r.reason);
  }
}
if (failed) {
  console.error('One or more sources failed; existing snapshots (if any) were left untouched.');
  process.exit(1);
}
console.log('Done. Now run: npm run build:draft-data');
