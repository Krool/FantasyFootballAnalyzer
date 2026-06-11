// Stack and handcuff detection. A "stack" is a QB plus a pass catcher on
// the same NFL team (their fantasy weeks correlate: every passing TD pays
// twice). A "handcuff" is the backup RB who inherits a starter's workload.

import type { PoolPlayer } from '@/types/draft';
import { canonicalTeam } from './playerNames';

export interface Stack {
  nflTeam: string;
  qb: PoolPlayer;
  catchers: PoolPlayer[];
}

const CATCHER_POS = new Set(['WR', 'TE']);

// QB + WR/TE groups on one fantasy roster.
export function findStacks(players: PoolPlayer[]): Stack[] {
  const byTeam = new Map<string, PoolPlayer[]>();
  for (const p of players) {
    const team = canonicalTeam(p.team);
    if (!team || team === 'FA') continue;
    const group = byTeam.get(team) ?? [];
    group.push(p);
    byTeam.set(team, group);
  }
  const stacks: Stack[] = [];
  for (const [nflTeam, group] of byTeam) {
    const qb = group.find(p => p.pos === 'QB');
    if (!qb) continue;
    const catchers = group
      .filter(p => CATCHER_POS.has(p.pos))
      .sort((a, b) => a.overallRank - b.overallRank);
    if (catchers.length > 0) stacks.push({ nflTeam, qb, catchers });
  }
  return stacks.sort((a, b) => a.qb.overallRank - b.qb.overallRank);
}

// The rostered player a candidate would complete a stack with: the QB when
// the candidate catches passes, the best same-team catcher when the
// candidate is a QB. Null when no stack forms.
export function stackPartner(candidate: PoolPlayer, roster: PoolPlayer[]): PoolPlayer | null {
  const team = canonicalTeam(candidate.team);
  if (!team || team === 'FA') return null;
  if (CATCHER_POS.has(candidate.pos)) {
    return roster.find(p => p.pos === 'QB' && canonicalTeam(p.team) === team) ?? null;
  }
  if (candidate.pos === 'QB') {
    const catchers = roster
      .filter(p => CATCHER_POS.has(p.pos) && canonicalTeam(p.team) === team)
      .sort((a, b) => a.overallRank - b.overallRank);
    return catchers[0] ?? null;
  }
  return null;
}

// The rostered RB a candidate RB would back up (or be backed up by). Depth
// chart order decides who the starter is when we have it; positional rank
// is the fallback.
export function handcuffPartner(candidate: PoolPlayer, roster: PoolPlayer[]): PoolPlayer | null {
  if (candidate.pos !== 'RB') return null;
  const team = canonicalTeam(candidate.team);
  if (!team || team === 'FA') return null;
  return roster.find(p => p.pos === 'RB' && p.id !== candidate.id && canonicalTeam(p.team) === team) ?? null;
}

// Pool-wide: is this RB the direct backup on his NFL team? Used to tag
// handcuffs on the NFL Teams board. Prefers Sleeper depth chart order;
// falls back to "second-best RB on the team by rank".
export function isHandcuff(player: PoolPlayer, teamPlayers: PoolPlayer[]): boolean {
  if (player.pos !== 'RB') return false;
  if (player.depthChartOrder !== undefined) return player.depthChartOrder === 2;
  const rbs = teamPlayers
    .filter(p => p.pos === 'RB')
    .sort((a, b) => a.posRank - b.posRank);
  return rbs.length >= 2 && rbs[1].id === player.id;
}
