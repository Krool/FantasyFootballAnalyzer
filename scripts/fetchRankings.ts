// Fetches 2026 draft rankings/ADP/auction values from FantasyPros, ESPN,
// and Sleeper into data/raw/*.json snapshots, which buildDraftPool.ts folds
// into the bundled pool. Run with: npm run fetch:rankings
// Optional: npm run fetch:rankings -- --scoring=PPR   (default HALF)
//
// Auth notes:
// - FantasyPros: uses the public API key FantasyPros ships in its own site
//   JS (every browser on their rankings page uses it). If it ever rotates,
//   re-extract from the rankings page bundle (search "x-api-key").
// - ESPN: leaguedefaults/3 (default PPR league) is fully public.
// - Sleeper: api.sleeper.com/projections is the endpoint Sleeper's own web
//   client uses; public, undocumented.
// - Yahoo (average_cost auction values) needs an OAuth token and is not
//   fetched here yet.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEASON = 2026;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = join(root, 'data', 'raw');

const scoringArg = process.argv.find(a => a.startsWith('--scoring='));
const FP_SCORING = (scoringArg?.split('=')[1] ?? 'HALF').toUpperCase(); // STD | HALF | PPR

// FantasyPros' own public browser key (see header note).
const FP_API_KEY = 'zjxN52G3lP4fORpHRftGI2mTU8cTwxVNvkjByM3j';

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

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
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
      pos_rank: string;
      rank_ecr: number;
      tier: number;
      player_bye_week: string | null;
    }>;
  };
  const players = json.players.map(p => ({
    name: p.player_name,
    team: p.player_team_id,
    pos: p.player_position_id,
    posRank: Number(p.pos_rank.replace(/^[A-Z]+/, '')) || 0,
    rank: p.rank_ecr,
    tier: p.tier,
    bye: p.player_bye_week ? Number(p.player_bye_week) || null : null,
  }));
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
  const players = json.players.map(({ player: p }) => ({
    name: p.fullName,
    pos: ESPN_POSITION_MAP[p.defaultPositionId] ?? 'UNK',
    team: ESPN_TEAM_MAP[p.proTeamId] ?? 'FA',
    adp: p.ownership?.averageDraftPosition ?? null,
    // Live market price from real ESPN auction drafts; editorial value as backup.
    auctionValueLive: p.ownership?.auctionValueAverage ?? null,
    auctionValueEditorial: p.draftRanksByRankType?.PPR?.auctionValue ?? null,
  }));
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
  // 999 is Sleeper's unranked sentinel.
  const ranked = json.filter(p => (p.stats?.adp_half_ppr ?? 999) < 999);
  const players = ranked.map(p => ({
    name: `${p.player.first_name} ${p.player.last_name}`,
    pos: p.player.position === 'DEF' ? 'DST' : p.player.position,
    team: p.team ?? 'FA',
    adpHalfPpr: p.stats.adp_half_ppr ?? null,
    adpPpr: p.stats.adp_ppr ?? null,
    adpStd: p.stats.adp_std ?? null,
    adp2qb: p.stats.adp_2qb ?? null,
  }));
  console.log(`Sleeper: ${players.length} players with ADP`);
  writeRaw(`sleeper-adp.${SEASON}.json`, { players });
}

mkdirSync(rawDir, { recursive: true });
const results = await Promise.allSettled([fetchFantasyPros(), fetchEspn(), fetchSleeper()]);
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
