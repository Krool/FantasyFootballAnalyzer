// Pick suggestions for snake drafts: a transparent heuristic, not a black
// box. Each candidate starts from his sheet value (dollars capture
// top-heaviness far better than rank gaps do) and gets nudged by the three
// things a drafter actually weighs between picks: does he fill a starting
// slot, is a tier about to break, and has he fallen past his market price.
// Every nudge becomes a human-readable reason so the panel can show its work.

import type { RosterSlots } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import type { StarterPos, TeamDraftState } from './draftEngine';
import { STARTER_POSITIONS } from './draftEngine';
import { marketAdp } from './consensus';
import { handcuffPartner, stackPartner } from './stacks';
import type { ScoringType } from './valueScaling';

const FLEX_ELIGIBLE = new Set<string>(['RB', 'WR', 'TE']);
const SUPERFLEX_ELIGIBLE = new Set<string>(['QB', 'RB', 'WR', 'TE']);
// Suggestions come from the top of the board; deeper players are never the
// right pick while 40 better ones sit there.
const CANDIDATE_DEPTH = 40;

export interface PickSuggestion {
  player: PoolPlayer;
  score: number;
  reasons: string[];
}

export interface SuggestOptions {
  // Events logged so far; the pick being made is pickCount + 1.
  pickCount: number;
  teamCount: number;
  scoring: ScoringType;
  // How many teams still need a starter at each position (tier-break urgency
  // only matters when someone else wants the tier too).
  positionalDemand: Record<StarterPos, number>;
  // 1-based number of the user's pick after this one, when known (snake).
  // Candidates whose ADP falls inside the gap get a "won't last" reason.
  nextPickNumber?: number | null;
  // Simulated probability each player is taken before the user's next pick
  // (utils/survival.ts). When present it replaces the raw ADP "won't last"
  // heuristic: the sims know who picks in between and what they need.
  takenOdds?: Map<string, number>;
  // Pre-draft target/avoid lists (player ids).
  starred?: Set<string>;
  avoided?: Set<string>;
  // The user's reserved keepers not yet auto-logged: they're roster for
  // stack/handcuff/bye purposes long before their cost round arrives.
  keeperPlayers?: PoolPlayer[];
}

export function suggestPicks(
  available: PoolPlayer[],
  team: TeamDraftState,
  rosterSlots: RosterSlots,
  scaledValues: Map<string, number>,
  opts: SuggestOptions,
  count = 3,
): PickSuggestion[] {
  const starterTotal = STARTER_POSITIONS.reduce((sum, pos) => sum + team.starterNeeds[pos], 0);
  // K/DST have near-zero value over replacement: only suggest them once the
  // roster is down to its last fills.
  const lateFill = team.openSlots <= starterTotal + 1;
  const flexOpen = team.slotsFilled.FLEX < rosterSlots.FLEX;
  // Superflex adds a QB-eligible flex, so a "spare" QB (beyond the QB slots)
  // is a starter, not bench depth, while the SUPERFLEX slot is open.
  const superflexOpen = team.slotsFilled.SUPERFLEX < rosterSlots.SUPERFLEX;
  const currentPick = opts.pickCount + 1;

  const tierLeft = new Map<string, number>();
  for (const p of available) {
    const key = `${p.pos}|${p.tier}`;
    tierLeft.set(key, (tierLeft.get(key) ?? 0) + 1);
  }

  // Reserved keepers count as roster: a keeper RB wants his cuff and a
  // keeper QB wants his catchers well before the cost round logs the pick.
  const roster = [...team.picks.map(pick => pick.player), ...(opts.keeperPlayers ?? [])];
  // Skill-position starters already sharing a bye week; a third is a
  // self-inflicted zero.
  const byeCounts = new Map<number, number>();
  for (const p of roster) {
    if (p.bye === null || p.pos === 'K' || p.pos === 'DST') continue;
    byeCounts.set(p.bye, (byeCounts.get(p.bye) ?? 0) + 1);
  }

  const suggestions: PickSuggestion[] = [];
  for (const p of available.slice(0, CANDIDATE_DEPTH)) {
    const pos = p.pos as StarterPos;
    if (!STARTER_POSITIONS.includes(pos)) continue;
    if (team.fullAt[pos]) continue;
    const needed = team.starterNeeds[pos] > 0;
    if ((pos === 'K' || pos === 'DST') && (!needed || !lateFill)) continue;

    const value = scaledValues.get(p.id) ?? 1;
    const reasons: string[] = [];
    let score = value;
    // Whether this player could enter the starting lineup today: a needed
    // starter, or eligible for an open FLEX/SUPERFLEX. Urgency (tier breaks,
    // gone-by-next-pick odds) only applies to these players; scarcity at a
    // position you can't start is someone else's problem.
    let startable = true;
    // Spare-player ladder (extra K/DST never get this far: excluded above):
    // needed starter 1.25 > open-flex RB/WR 1.1 > bench RB/WR 0.8 >
    // spare TE 0.7 > backup QB 0.5. A flex TE is almost always a downgrade
    // on a flex RB/WR, so a second TE doesn't earn the FLEX bonus.
    if (needed) {
      score *= 1.25;
      reasons.push(`fills your ${pos} starter slot`);
    } else if (p.pos !== 'TE' && FLEX_ELIGIBLE.has(p.pos) && flexOpen) {
      score *= 1.1;
      reasons.push('FLEX-eligible');
    } else if (SUPERFLEX_ELIGIBLE.has(p.pos) && superflexOpen) {
      score *= 1.1;
      reasons.push('SUPERFLEX-eligible');
    } else if (p.pos === 'QB') {
      // A spare QB with no open QB/SUPERFLEX slot can never start alongside
      // the QB1 (he is not FLEX-eligible), so he's pure insurance. Cut him
      // harder than ordinary bench depth or a fallen QB1's big sheet value
      // outranks players who would actually play.
      score *= 0.5;
      startable = false;
      reasons.push('backup QB');
    } else if (p.pos === 'TE') {
      score *= 0.7;
      startable = false;
      reasons.push('spare TE');
    } else {
      score *= 0.8;
      startable = false;
      reasons.push('bench depth');
    }

    if (startable && tierLeft.get(`${p.pos}|${p.tier}`) === 1) {
      // Worth more when other teams still need the position: the tier will
      // not survive until your next pick.
      score += opts.positionalDemand[pos] > 1 ? 4 : 2;
      reasons.push(`last Tier ${p.tier} ${pos}`);
    }

    const adp = marketAdp(p, opts.scoring, rosterSlots.SUPERFLEX > 0);
    if (adp !== undefined) {
      const fall = currentPick - adp;
      if (fall >= opts.teamCount / 2) {
        score += Math.min(8, fall * 0.25);
        reasons.push(`${Math.round(fall)} picks past ADP`);
      }
    }
    // The actual between-picks question: will he still be there when it
    // comes back around? Simulated odds when available; raw ADP otherwise.
    // Only for startable players: "he'll be gone" is no reason to draft
    // someone who couldn't play for you anyway. The discount side matters as
    // much as the boost: a player the sheet loves but the room takes rounds
    // later (expert rank 68, market ADP 136) should read "can wait", not
    // jump the queue over players who won't survive the gap.
    if (startable && opts.nextPickNumber) {
      const gone = opts.takenOdds?.get(p.id);
      if (gone !== undefined) {
        if (gone >= 0.5) {
          score += 1 + 3 * gone;
          reasons.push(`${Math.round(gone * 100)}% gone by your next pick (#${opts.nextPickNumber})`);
        } else if (gone <= 0.35) {
          score *= 0.75;
          reasons.push(
            `${Math.round((1 - gone) * 100)}% chance he lasts to your next pick (#${opts.nextPickNumber}), can wait`,
          );
        }
      } else if (adp !== undefined) {
        if (adp < opts.nextPickNumber) {
          score += 2;
          reasons.push(`likely gone before your next pick (#${opts.nextPickNumber})`);
        } else if (adp >= opts.nextPickNumber + opts.teamCount) {
          score *= 0.75;
          reasons.push(`market takes him after your next pick (ADP ${Math.round(adp)}), can wait`);
        }
      }
    }

    if (opts.starred?.has(p.id)) {
      score += 3;
      reasons.push('on your target list');
    }
    if (opts.avoided?.has(p.id)) {
      score -= 10;
      reasons.push('on your avoid list');
    }

    // Correlation bonuses: completing a QB/catcher stack, or (late) cuffing
    // a rostered RB. Small nudges — they break ties, not rankings.
    const partner = stackPartner(p, roster);
    if (partner) {
      score += 3;
      reasons.push(`stacks with your ${partner.pos === 'QB' ? 'QB ' : ''}${partner.name}`);
    }
    if (lateFill) {
      const cuffed = handcuffPartner(p, roster);
      if (cuffed && cuffed.posRank < p.posRank) {
        score += 2;
        reasons.push(`handcuffs your RB ${cuffed.name}`);
      }
    }

    // Bye pile-up penalty: warn before the third same-week skill starter.
    if (p.bye !== null && p.pos !== 'K' && p.pos !== 'DST' && (byeCounts.get(p.bye) ?? 0) >= 2) {
      score -= 2;
      reasons.push(`third week-${p.bye} bye`);
    }

    suggestions.push({ player: p, score, reasons });
  }

  suggestions.sort((a, b) => b.score - a.score || a.player.overallRank - b.player.overallRank);
  return suggestions.slice(0, count);
}
