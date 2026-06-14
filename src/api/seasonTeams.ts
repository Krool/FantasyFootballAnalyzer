// Season-accurate NFL teams for past-season leagues.
//
// Yahoo, ESPN and Sleeper all report a player's CURRENT NFL team in their
// player metadata (Yahoo's `editorial_team_abbr`, Sleeper's `/players/nfl`
// map, ESPN's proTeamId). Their STATS are season-scoped, but the team badge
// is "live", so a 2024 league shows Cooper Kupp on SEA instead of his 2024
// LAR, Stefon Diggs on NE instead of HOU, and so on.
//
// Sleeper's season stats endpoint carries the real season team alongside the
// player's name and position, going back to 2017 with open CORS. We join by
// normalized name + position (the same matcher the draft pipeline uses) and
// rewrite the team for past seasons only. The current season is left alone:
// there the live team is the correct one.

import type { League, Player } from '@/types';
import { matchKey, normalizeName, basePosition, canonicalTeam } from '@/utils/playerNames';
import { logger } from '@/utils/logger';

const SLEEPER_STATS_HOST = 'https://api.sleeper.com';

// Sentinel for a normalized name shared by two or more distinct players (e.g.
// Josh Allen QB vs the IDP linebacker). Such names are resolved by the
// name+position map instead of guessing on name alone.
const AMBIGUOUS = Symbol('ambiguous');

interface SeasonTeamMaps {
  byNamePos: Map<string, string>;
  byName: Map<string, string | typeof AMBIGUOUS>;
}

interface SleeperSeasonRow {
  player_id?: string;
  team?: string | null;
  player?: {
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
    position?: string | null;
  } | null;
}

// One in-flight/settled fetch per season, shared across all callers.
const cache = new Map<number, Promise<SeasonTeamMaps | null>>();

async function fetchSeasonTeamMaps(season: number): Promise<SeasonTeamMaps | null> {
  try {
    const res = await fetch(`${SLEEPER_STATS_HOST}/stats/nfl/${season}?season_type=regular`);
    if (!res.ok) {
      throw new Error(`Sleeper season stats ${season}: ${res.status} ${res.statusText}`);
    }
    const rows = (await res.json()) as SleeperSeasonRow[];
    if (!Array.isArray(rows)) return null;

    const byNamePos = new Map<string, string>();
    const byName = new Map<string, string | typeof AMBIGUOUS>();

    for (const row of rows) {
      const team = canonicalTeam(row.team ?? '');
      const p = row.player;
      if (!team || !p) continue;
      const name =
        p.full_name?.trim() ||
        [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
      if (!name) continue;
      const pos = p.position ?? undefined;

      // Defenses carry the team as their identity and never change history;
      // skip them so a name-only collision can't rewrite one.
      if (pos && basePosition(pos) === 'DEF') continue;

      const key = matchKey(name, pos);
      if (!byNamePos.has(key)) byNamePos.set(key, team);

      const nameKey = normalizeName(name);
      const existing = byName.get(nameKey);
      if (existing === undefined) {
        byName.set(nameKey, team);
      } else if (existing !== team) {
        // Same normalized name, different team -> two players. Don't trust
        // a name-only match for this name.
        byName.set(nameKey, AMBIGUOUS);
      }
    }

    return { byNamePos, byName };
  } catch (e) {
    logger.error('Failed to load season teams from Sleeper:', e);
    return null;
  }
}

// Resolves the season-accurate team for one player, or null when there's no
// confident match (player never recorded a stat, or an ambiguous name with no
// position to disambiguate). DEF/DST are never rewritten.
function lookupTeam(maps: SeasonTeamMaps, player: Player): string | null {
  if (!player.name) return null;
  const pos = player.position;
  if (pos && basePosition(pos) === 'DEF') return null;

  const exact = maps.byNamePos.get(matchKey(player.name, pos));
  if (exact) return exact;

  const byName = maps.byName.get(normalizeName(player.name));
  if (byName && byName !== AMBIGUOUS) return byName;
  return null;
}

// Walks every player reference in a fully built league and rewrites the team
// in place. Done in one pass over the common shape so all platforms and all
// surfaces (rosters, draft, waivers, trades) stay consistent.
function rewriteLeagueTeams(league: League, maps: SeasonTeamMaps): void {
  const apply = (player: Player | undefined | null) => {
    if (!player) return;
    const team = lookupTeam(maps, player);
    if (team) player.team = team;
  };
  const applyAll = (players: Player[] | undefined | null) => {
    if (players) for (const p of players) apply(p);
  };

  const applyTrades = (trades: League['trades']) => {
    if (!trades) return;
    for (const trade of trades) {
      for (const side of trade.teams) {
        applyAll(side.playersReceived);
        applyAll(side.playersSent);
      }
    }
  };

  for (const team of league.teams) {
    applyAll(team.roster);
    if (team.draftPicks) for (const pick of team.draftPicks) apply(pick.player);
    if (team.transactions) {
      for (const tx of team.transactions) {
        applyAll(tx.adds);
        applyAll(tx.drops);
      }
    }
    applyTrades(team.trades);
  }
  applyTrades(league.trades);
}

/**
 * Correct NFL team badges on a past-season league so they reflect where each
 * player actually was that year, not their current team. No-op for the
 * current/future season (the platform's live team is right) and a safe no-op
 * if the Sleeper lookup fails. Mutates `league` in place and returns it.
 */
export async function applySeasonTeams(league: League): Promise<League> {
  const season = league.season;
  if (!Number.isFinite(season) || season >= new Date().getFullYear()) {
    return league;
  }

  let promise = cache.get(season);
  if (!promise) {
    promise = fetchSeasonTeamMaps(season);
    cache.set(season, promise);
  }
  const maps = await promise;
  if (maps) rewriteLeagueTeams(league, maps);
  return league;
}
