// The shareable top-10s built from a finished draft: biggest steals and
// reaches (vs market ADP for snake, vs sheet value for auction), the final
// scoreboard, and bye pile-ups. Pure functions over the TeamRecap[] that
// gradeDraftSession already produces, so any future draft source (a pasted
// Sleeper draft, a league draft) that can build TeamRecaps gets these free.
//
// Each list has a plain-text renderer meant for a league group chat: short
// lines, no markdown, pastes clean anywhere.

import type { PoolPlayer } from '@/types/draft';
import type { ScoringType } from '@/types';
import { marketAdp } from './consensus';
import { isSkillPos } from './draftRecap';
import type { RecapPickLine, TeamRecap } from './draftRecap';

export interface ShareMove {
  player: PoolPlayer;
  teamName: string;
  pickNumber: number;
  // Auction: what the team paid and what the sheet said he was worth.
  price: number | null;
  value: number | null;
  // Snake: the market ADP he was measured against.
  adp: number | null;
  // Signed edge. Snake: picks fallen past ADP (positive = steal).
  // Auction: sheet value minus price (positive = bargain).
  delta: number;
}

export interface ShareScoreRow {
  rank: number;
  teamName: string;
  grade: string;
  surplus: number;
  spent: number;
}

export interface ShareByeRow {
  teamId: string;
  teamName: string;
  week: number;
  count: number;
}

export interface ShareLists {
  draftType: 'snake' | 'auction';
  season: number;
  values: ShareMove[];
  reaches: ShareMove[];
  scoreboard: ShareScoreRow[];
  byes: ShareByeRow[];
}

export interface ShareListsOptions {
  draftType: 'snake' | 'auction';
  season: number;
  scoring: ScoringType;
  superflex: boolean;
  /** List length cap. Default 10. */
  limit?: number;
}

const FOOTER = 'fantasyfootballanalyzer.app';

// Keepers are auto-logged at their cost round / keeper price, not drafted
// decisions, so they'd top every list as fake steals. Hold them out.
function isKeeper(line: RecapPickLine): boolean {
  return line.pick.event.isKeeper === true;
}

export function buildShareLists(recaps: TeamRecap[], opts: ShareListsOptions): ShareLists {
  const limit = opts.limit ?? 10;
  const moves: ShareMove[] = [];

  for (const recap of recaps) {
    for (const line of recap.picks) {
      if (isKeeper(line)) continue;
      // K/DST drift off ADP in every draft; a kicker "falling 50 spots" is
      // noise, not a steal. Skill players only in the steal/reach lists.
      if (!isSkillPos(line.pick.player.pos)) continue;
      const base = {
        player: line.pick.player,
        teamName: recap.name,
        pickNumber: line.pick.pickNumber,
      };
      if (opts.draftType === 'auction') {
        if (line.price === null || line.delta === null) continue;
        moves.push({ ...base, price: line.price, value: line.value, adp: null, delta: line.delta });
      } else {
        const adp = marketAdp(line.pick.player, opts.scoring, opts.superflex);
        if (adp == null) continue;
        moves.push({
          ...base,
          price: null,
          value: null,
          adp,
          delta: line.pick.pickNumber - adp,
        });
      }
    }
  }

  const values = moves
    .filter(m => m.delta >= 1)
    .sort((a, b) => b.delta - a.delta || a.pickNumber - b.pickNumber)
    .slice(0, limit);
  const reaches = moves
    .filter(m => m.delta <= -1)
    .sort((a, b) => a.delta - b.delta || a.pickNumber - b.pickNumber)
    .slice(0, limit);

  // gradeDraftSession already returns recaps best score first.
  const scoreboard = recaps.map((r, i) => ({
    rank: i + 1,
    teamName: r.name,
    grade: r.grade,
    surplus: r.surplus,
    spent: r.spent,
  }));

  const byes = recaps
    .filter(r => r.byeWorstWeek !== null)
    .map(r => ({
      teamId: r.teamId,
      teamName: r.name,
      week: r.byeWorstWeek!.week,
      count: r.byeWorstWeek!.count,
    }))
    .sort((a, b) => b.count - a.count || a.week - b.week);

  return { draftType: opts.draftType, season: opts.season, values, reaches, scoreboard, byes };
}

export type ShareListKey = 'values' | 'reaches' | 'scoreboard' | 'byes';

// Headline per list, by draft type. The snake lists talk in picks and ADP;
// the auction lists talk in dollars.
export function shareListTitle(lists: ShareLists, key: ShareListKey): string {
  const auction = lists.draftType === 'auction';
  switch (key) {
    case 'values':
      return auction ? 'Best Bargains' : 'Biggest Steals';
    case 'reaches':
      return auction ? 'Biggest Overpays' : 'Biggest Reaches';
    case 'scoreboard':
      return 'Draft Scoreboard';
    case 'byes':
      return 'Bye Pile-Ups';
  }
}

function moveLine(m: ShareMove, rank: number, auction: boolean): string {
  const who = `${m.player.name} (${m.player.pos}, ${m.player.team})`;
  if (auction) {
    const edge =
      m.delta >= 0 ? `$${m.delta} under value` : `$${Math.abs(m.delta)} over value`;
    return `${rank}. ${who} · ${m.teamName} · $${m.price} (${edge})`;
  }
  const adp = Math.round(m.adp ?? 0);
  const edge =
    m.delta >= 0
      ? `fell ${Math.round(m.delta)}`
      : `${Math.round(Math.abs(m.delta))} early`;
  return `${rank}. ${who} · ${m.teamName} · pick ${m.pickNumber}, ADP ${adp} (${edge})`;
}

function scoreLine(row: ShareScoreRow, auction: boolean): string {
  const surplus = `${row.surplus >= 0 ? '+' : ''}${row.surplus} vs avg`;
  const spent = auction ? ` · $${row.spent}` : '';
  return `${row.rank}. ${row.teamName} · ${row.grade} · ${surplus}${spent}`;
}

function byeLine(row: ShareByeRow): string {
  return `${row.teamName} · ${row.count} skill starters on the week ${row.week} bye`;
}

// Title line + one line per row, no footer. Empty lists return [].
function listLines(lists: ShareLists, key: ShareListKey): string[] {
  const auction = lists.draftType === 'auction';
  let lines: string[];
  switch (key) {
    case 'values':
      lines = lists.values.map((m, i) => moveLine(m, i + 1, auction));
      break;
    case 'reaches':
      lines = lists.reaches.map((m, i) => moveLine(m, i + 1, auction));
      break;
    case 'scoreboard':
      lines = lists.scoreboard.map(r => scoreLine(r, auction));
      break;
    case 'byes':
      lines = lists.byes.map(byeLine);
      break;
  }
  if (lines.length === 0) return [];
  return [`${shareListTitle(lists, key)} · ${lists.season} draft`, ...lines];
}

// One list as chat-ready plain text. Empty lists return '' (the UI hides
// their copy button instead of copying a bare header).
export function shareListText(lists: ShareLists, key: ShareListKey): string {
  const lines = listLines(lists, key);
  return lines.length === 0 ? '' : [...lines, FOOTER].join('\n');
}

// Every non-empty list in one block, for the "copy everything" button.
export function shareAllText(lists: ShareLists): string {
  const keys: ShareListKey[] = ['scoreboard', 'values', 'reaches', 'byes'];
  const blocks = keys.map(key => listLines(lists, key)).filter(lines => lines.length > 0);
  if (blocks.length === 0) return '';
  return [...blocks.map(lines => lines.join('\n')), FOOTER].join('\n\n');
}
