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
// - Yahoo ADP comes via FantasyPros' ADP board (source id 236), not Yahoo
//   directly, so it needs no OAuth. Yahoo's auction market (average_cost)
//   comes from pub-api-ro.fantasysports.yahoo.com, the READ-ONLY public host
//   of the Fantasy API: no OAuth, no app approval (found 2026-09-02; the
//   OAuth host 403s unapproved apps, this one does not).

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
const MIN_ROWS = { fp: 400, espn: 200, sleeper: 150, sleeperPlayers: 300, yahoo: 150, yahooValues: 100 };

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

// Dynasty consensus ranks (whole-roster value, not this-year-only). Rookies
// are ranked among veterans here, which is what a dynasty startup board needs;
// a rookie-only draft just filters to the rookies. Lower row floor than
// redraft: dynasty lists are shorter. Non-fatal on its own — a missing dynasty
// snapshot just means dynasty mode falls back to redraft order.
async function fetchFantasyProsDynasty(): Promise<void> {
  const url = `https://api.fantasypros.com/v2/json/nfl/${SEASON}/consensus-rankings?type=dynasty&scoring=${FP_SCORING}&position=ALL&week=0`;
  const json = (await getJson(url, { 'x-api-key': FP_API_KEY })) as {
    players: Array<{
      player_name: string;
      player_team_id: string;
      player_position_id: string;
      rank_ecr: number;
      tier: number;
    }>;
  };
  if (!Array.isArray(json.players)) throw new Error('FantasyPros dynasty payload has no players array');
  const players = json.players.map(p => ({
    name: p.player_name,
    team: p.player_team_id,
    pos: p.player_position_id,
    rank: p.rank_ecr,
    tier: p.tier,
  }));
  assertMinRows('FantasyPros dynasty', players.length, 150);
  console.log(`FantasyPros dynasty: ${players.length} players (${FP_SCORING})`);
  writeRaw(`fp-dynasty.${SEASON}.json`, { scoring: FP_SCORING, players });
}

// Superflex (2QB) consensus ranking. FantasyPros exposes it as position=OP
// ("offensive player": QB+RB+WR+TE in one list), where QBs rank far higher
// than on the standard 1QB board. Folded in as overallRankSF so the consensus
// blend can price QBs for superflex demand. Non-fatal on its own: a missing
// snapshot just means superflex leagues fall back to the 1QB overall rank.
async function fetchFantasyProsSuperflex(): Promise<void> {
  const url = `https://api.fantasypros.com/v2/json/nfl/${SEASON}/consensus-rankings?type=draft&scoring=${FP_SCORING}&position=OP&week=0`;
  const json = (await getJson(url, { 'x-api-key': FP_API_KEY })) as {
    players: Array<{
      player_name: string;
      player_team_id: string;
      player_position_id: string;
      rank_ecr: number;
    }>;
  };
  if (!Array.isArray(json.players)) throw new Error('FantasyPros superflex payload has no players array');
  const players = json.players.map(p => ({
    name: p.player_name,
    team: p.player_team_id,
    pos: p.player_position_id,
    rank: p.rank_ecr,
  }));
  assertMinRows('FantasyPros superflex', players.length, MIN_ROWS.fp);
  console.log(`FantasyPros superflex: ${players.length} players (${FP_SCORING})`);
  writeRaw(`fp-superflex.${SEASON}.json`, { scoring: FP_SCORING, players });
}

// Yahoo ADP, by way of FantasyPros. Yahoo's own draft-analysis endpoint needs
// an OAuth token (see the auth note at the top), but FantasyPros carries Yahoo
// as one of the three sources behind its ADP board, and the same public FP key
// can isolate it: type=adp with filters=<sourceId>. The three ids on that board
// are 236 (Yahoo! Sports), 439 (RTSports), 4350 (Sleeper); we only want Yahoo,
// since Sleeper ADP already comes straight from Sleeper.
//
// Caveat that shapes the field name: a single-source response returns a dense
// 1..N ordering in rank_ave, not a decimal ADP, so this is a Yahoo ADP *rank*.
// It lives on the same "how early is he gone" scale as overallRank, which is
// what the consensus blend needs, but it is not the raw average pick and must
// not be labelled as one.
//
// Non-fatal on its own: a missing snapshot just drops the Yahoo column.
const FP_ADP_SOURCE_YAHOO = 236;

async function fetchYahooAdp(): Promise<void> {
  const url = `https://api.fantasypros.com/v2/json/nfl/${SEASON}/consensus-rankings?type=adp&scoring=${FP_SCORING}&position=ALL&week=0&filters=${FP_ADP_SOURCE_YAHOO}`;
  const json = (await getJson(url, { 'x-api-key': FP_API_KEY })) as {
    players: Array<{
      player_name: string;
      player_team_id: string;
      player_position_id: string;
      rank_ave?: string | number | null;
      rank_ecr?: number | null;
    }>;
  };
  if (!Array.isArray(json.players)) throw new Error('Yahoo ADP payload has no players array');
  const players = json.players
    .map(p => ({
      name: p.player_name,
      team: p.player_team_id,
      pos: p.player_position_id,
      rank: Number(p.rank_ave ?? p.rank_ecr) || null,
    }))
    .filter((p): p is { name: string; team: string; pos: string; rank: number } => p.rank != null);
  assertMinRows('Yahoo ADP', players.length, MIN_ROWS.yahoo);
  console.log(`Yahoo ADP: ${players.length} players (${FP_SCORING}, via FantasyPros source ${FP_ADP_SOURCE_YAHOO})`);
  writeRaw(`yahoo-adp.${SEASON}.json`, { scoring: FP_SCORING, source: FP_ADP_SOURCE_YAHOO, players });
}

// Yahoo's own auction market: average_cost (and true average_pick) per
// player from the public read-only API host, sorted by Yahoo's actual rank
// and paged 25 at a time. Yahoo prices ~300 players; a page whose rows are
// all "-" ends the walk. Non-fatal like the ADP feed: losing it drops the
// Yahoo dollar column and the Draft Room's "Yahoo market" values.
const YAHOO_PAGE = 25;
const YAHOO_MAX_PAGES = 20;

async function fetchYahooValues(): Promise<void> {
  type Row = { name: string; team: string; pos: string; avgPick: number | null; avgCost: number | null };
  const players: Row[] = [];
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  for (let page = 0; page < YAHOO_MAX_PAGES; page++) {
    const start = page * YAHOO_PAGE;
    const url = `https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/game/nfl/players;sort=AR;start=${start};count=${YAHOO_PAGE}/draft_analysis?format=json`;
    const json = (await getJson(url, { Accept: 'application/json' })) as {
      fantasy_content?: { game?: Array<{ players?: Record<string, { player?: unknown[] }> }> };
    };
    const bucket = json.fantasy_content?.game?.[1]?.players;
    if (!bucket) throw new Error(`Yahoo draft analysis page ${page}: no players bucket`);
    let pricedOnPage = 0;
    for (const [key, entry] of Object.entries(bucket)) {
      if (key === 'count' || !Array.isArray(entry.player)) continue;
      // player[0] is an array of one-key objects (name, team, position...);
      // player[1] is { draft_analysis: [one-key objects] }.
      const meta = Object.assign({}, ...(entry.player[0] as object[]).filter(x => x && typeof x === 'object')) as {
        name?: { full?: string }; editorial_team_abbr?: string; display_position?: string;
      };
      const da = Object.assign(
        {},
        ...(((entry.player[1] as { draft_analysis?: object[] })?.draft_analysis ?? []).filter(x => x && typeof x === 'object')),
      ) as { average_pick?: string; average_cost?: string };
      const name = meta.name?.full;
      if (!name) continue;
      // Yahoo lists multi-eligible players as "WR,RB"; the first is primary.
      const pos = (meta.display_position ?? '').split(',')[0].trim().toUpperCase();
      const avgCost = num(da.average_cost);
      if (avgCost !== null) pricedOnPage++;
      players.push({
        name,
        team: (meta.editorial_team_abbr ?? 'FA').toUpperCase(),
        pos: pos === 'DEF' ? 'DST' : pos,
        avgPick: num(da.average_pick),
        avgCost,
      });
    }
    if (pricedOnPage === 0) break;
  }
  const priced = players.filter(p => p.avgCost !== null).length;
  assertMinRows('Yahoo values', priced, MIN_ROWS.yahooValues);
  console.log(`Yahoo values: ${priced} priced players of ${players.length} rows (public read-only API)`);
  writeRaw(`yahoo-values.${SEASON}.json`, { players: players.filter(p => p.avgCost !== null || p.avgPick !== null) });
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
// Required sources gate the run; dynasty is optional (its loss only disables
// dynasty ordering, so it must never red the daily Action).
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

const optional = await Promise.allSettled([
  fetchFantasyProsDynasty(),
  fetchFantasyProsSuperflex(),
  fetchYahooAdp(),
  fetchYahooValues(),
]);
if (optional[0].status === 'rejected') {
  console.warn('Dynasty rankings unavailable (non-fatal):', optional[0].reason);
}
if (optional[1].status === 'rejected') {
  console.warn('Superflex rankings unavailable (non-fatal):', optional[1].reason);
}
if (optional[2].status === 'rejected') {
  console.warn('Yahoo ADP unavailable (non-fatal):', optional[2].reason);
}
if (optional[3].status === 'rejected') {
  console.warn('Yahoo values unavailable (non-fatal):', optional[3].reason);
}

if (failed) {
  console.error('One or more required sources failed; existing snapshots (if any) were left untouched.');
  process.exit(1);
}
console.log('Done. Now run: npm run build:draft-data');
