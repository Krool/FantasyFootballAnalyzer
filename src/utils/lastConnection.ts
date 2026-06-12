import type { Platform } from '@/types';
import { logger } from './logger';

// Remembers how the user last connected so the form comes prefilled on the
// next visit. Only public identifiers live here: platform, league ids, the
// ESPN season, and the Sleeper username. Credentials never do; espn_s2/SWID
// stay in sessionStorage (espnCredentials.ts) and Yahoo tokens keep their own
// localStorage keys (api/yahoo.ts), so the home page privacy copy holds.
const KEY = 'ffa:lastconn:v1';

const PLATFORMS: readonly Platform[] = ['sleeper', 'espn', 'yahoo'];

export interface LastConnection {
  platform: Platform;
  // userId is the Sleeper user_id the username lookup resolved; it's what
  // my-team detection matches rosters against (names aren't stable).
  sleeper?: { leagueId?: string; username?: string; userId?: string };
  espn?: { leagueId: string; season: number };
  yahoo?: { leagueId: string };
}

export function loadLastConnection(): LastConnection | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return sanitize(JSON.parse(raw));
  } catch (err) {
    logger.warn('[lastConnection] Failed to read:', err);
    return null;
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

// Anything can write to localStorage, so rebuild the record field by field:
// a malformed value (a numeric league id, a truncated object) drops out here
// instead of crashing the form's .trim() calls on first render.
function sanitize(parsed: unknown): LastConnection | null {
  const p = asRecord(parsed);
  if (!p || !PLATFORMS.includes(p.platform as Platform)) return null;
  const out: LastConnection = { platform: p.platform as Platform };
  const sleeper = asRecord(p.sleeper);
  if (sleeper) {
    out.sleeper = {};
    if (typeof sleeper.leagueId === 'string') out.sleeper.leagueId = sleeper.leagueId;
    if (typeof sleeper.username === 'string') out.sleeper.username = sleeper.username;
    if (typeof sleeper.userId === 'string') out.sleeper.userId = sleeper.userId;
  }
  const espn = asRecord(p.espn);
  if (espn && typeof espn.leagueId === 'string' && typeof espn.season === 'number') {
    out.espn = { leagueId: espn.leagueId, season: espn.season };
  }
  const yahoo = asRecord(p.yahoo);
  if (yahoo && typeof yahoo.leagueId === 'string') {
    out.yahoo = { leagueId: yahoo.leagueId };
  }
  return out;
}

function save(next: LastConnection): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (err) {
    logger.warn('[lastConnection] Failed to persist:', err);
  }
}

// Call after a league load succeeds, with the loaded league's own values
// (not the form's), so a mistyped id is never remembered.
export function rememberConnection(
  platform: Platform,
  leagueId: string,
  season: number,
): void {
  const prev = loadLastConnection();
  const next: LastConnection = { ...prev, platform };
  if (platform === 'sleeper') {
    next.sleeper = { ...prev?.sleeper, leagueId };
  } else if (platform === 'espn') {
    next.espn = { leagueId, season };
  } else {
    next.yahoo = { leagueId };
  }
  save(next);
}

// Call after a username lookup succeeds, with the user_id it resolved.
// Leaves the rest of the record (including the last platform) alone:
// looking up leagues isn't connecting.
export function rememberSleeperUsername(username: string, userId: string): void {
  const prev = loadLastConnection();
  const next: LastConnection = {
    ...prev,
    platform: prev?.platform ?? 'sleeper',
    sleeper: { ...prev?.sleeper, username, userId },
  };
  save(next);
}
