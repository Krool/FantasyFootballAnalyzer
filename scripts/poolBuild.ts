// Pure helpers for scripts/buildDraftPool.ts.
//
// They live here, apart from the build script, because that script does its
// work at import time (reads snapshots, writes files, exits the process on a
// bad join), so nothing in it can be imported by a test. These three pieces are
// the ones worth pinning: the id scheme that saved Draft Room sessions depend
// on, the CSV reader that feeds the hand-maintained salary sheet, and the
// collision pass that keeps two players from claiming one id.

import { canonicalTeam, normalizeName } from '../src/utils/playerNames';

/** Minimum shape the id passes need; the build script's PoolPlayer satisfies it. */
export interface IdentifiablePlayer {
  id: string;
  name: string;
  team: string;
}

/**
 * Parse CSV text into rows, honouring quoted fields, escaped quotes, and both
 * line-ending conventions. Blank rows are dropped.
 */
export function parseCsv(text: string): string[][] {
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

// Stable player ids: rebuilding the pool after rankings move must not change
// a player's id, because saved Draft Room sessions persist these ids (the
// old `fp-<rank>` scheme silently remapped every logged pick after a daily
// refresh). Slug of name+pos; DSTs key on the franchise.
export function playerId(name: string, pos: string, team: string): string {
  if (pos === 'DST') return `dst-${canonicalTeam(team).toLowerCase()}`;
  const slug = normalizeName(name).replace(/\s+/g, '-');
  return `${slug}-${pos.toLowerCase()}`;
}

/**
 * Distinct players can share a normalized name+pos (it has happened: Lamar
 * Jackson, Mike Williams; and 3+ when deep rookies/FAs churn in preseason).
 * Suffix EVERY member of a colliding group with its franchise, in place.
 *
 * Returns the ids that are STILL duplicated afterwards — a true duplicate
 * (same name+pos+team) the caller must fail on rather than ship an unstable id.
 */
/**
 * FantasyPros occasionally lists one player twice while a transaction settles
 * (a lingering FA row next to the new-team row: Isaiah Williams FA + NYJ,
 * 2026-08). Name+pos joins cannot see that, but the Sleeper join can: two
 * rankings rows resolving to one Sleeper player id are one human. Returns one
 * group per duplicated id — the row to keep (franchise agrees with the Sleeper
 * dump, else the best rank) and the rows to drop. DSTs are skipped: their
 * Sleeper "id" is the team code, which never legitimately collides anyway.
 */
export function duplicateSleeperRows<
  T extends { name: string; team: string; pos: string; overallRank: number; sleeperId?: string },
>(players: T[], dumpTeamById: Map<string, string>): Array<{ keeper: T; dropped: T[] }> {
  const byId = new Map<string, T[]>();
  for (const player of players) {
    if (!player.sleeperId || player.pos === 'DST') continue;
    const group = byId.get(player.sleeperId);
    if (group) group.push(player);
    else byId.set(player.sleeperId, [player]);
  }
  const groups: Array<{ keeper: T; dropped: T[] }> = [];
  for (const group of byId.values()) {
    if (group.length < 2) continue;
    const dumpTeam = dumpTeamById.get(group[0].sleeperId!);
    const keeper =
      group.find(p => canonicalTeam(p.team) === dumpTeam) ??
      group.reduce((a, b) => (b.overallRank < a.overallRank ? b : a));
    groups.push({ keeper, dropped: group.filter(p => p !== keeper) });
  }
  return groups;
}

export function disambiguateIds(players: IdentifiablePlayer[]): string[] {
  const byBase = new Map<string, IdentifiablePlayer[]>();
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

  const seen = new Set<string>();
  const duplicated: string[] = [];
  for (const player of players) {
    if (seen.has(player.id)) duplicated.push(player.id);
    else seen.add(player.id);
  }
  return duplicated;
}
