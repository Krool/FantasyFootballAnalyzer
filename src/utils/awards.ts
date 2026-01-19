/**
 * Fantasy Football Awards System
 *
 * Calculates various awards and superlatives for fantasy football leagues.
 * Awards are grouped into categories: Performance, Luck, Activity, Draft, Trades
 */

import type { League, Team, Trade } from '@/types';
import type { LuckMetrics } from './luck';

export interface Award {
  id: string;
  name: string;
  category: 'performance' | 'luck' | 'activity' | 'draft' | 'trades' | 'waivers';
  winner: {
    teamId: string;
    teamName: string;
    ownerName?: string;
  };
  value: number | string;
  description: string;
  detail?: string;
  icon?: string;
}

export interface AwardCalculationInput {
  league: League;
  luckMetrics?: LuckMetrics[];
}

/**
 * Calculate all awards for a league
 */
export function calculateAllAwards(input: AwardCalculationInput): Award[] {
  const { league, luckMetrics } = input;
  const awards: Award[] = [];

  // ============ PERFORMANCE AWARDS ============

  // Best Record
  const bestRecord = getBestRecord(league.teams);
  if (bestRecord) {
    awards.push({
      id: 'best_record',
      name: 'Best Record',
      category: 'performance',
      winner: { teamId: bestRecord.id, teamName: bestRecord.name, ownerName: bestRecord.ownerName },
      value: `${bestRecord.wins}-${bestRecord.losses}${bestRecord.ties ? `-${bestRecord.ties}` : ''}`,
      description: 'Best regular season record',
      icon: '🏆',
    });
  }

  // Most Points For
  const mostPointsFor = getMostPointsFor(league.teams);
  if (mostPointsFor && mostPointsFor.pointsFor !== undefined) {
    awards.push({
      id: 'most_points',
      name: 'Highest Scorer',
      category: 'performance',
      winner: { teamId: mostPointsFor.id, teamName: mostPointsFor.name, ownerName: mostPointsFor.ownerName },
      value: mostPointsFor.pointsFor.toFixed(1),
      description: 'Most total points scored',
      icon: '💯',
    });
  }

  // Worst Record
  const worstRecord = getWorstRecord(league.teams);
  if (worstRecord) {
    awards.push({
      id: 'worst_record',
      name: 'Basement Dweller',
      category: 'performance',
      winner: { teamId: worstRecord.id, teamName: worstRecord.name, ownerName: worstRecord.ownerName },
      value: `${worstRecord.wins}-${worstRecord.losses}${worstRecord.ties ? `-${worstRecord.ties}` : ''}`,
      description: 'Worst regular season record',
      icon: '🪣',
    });
  }

  // Most Points Against (Punching Bag)
  const mostPointsAgainst = getMostPointsAgainst(league.teams);
  if (mostPointsAgainst && mostPointsAgainst.pointsAgainst !== undefined) {
    awards.push({
      id: 'most_pa',
      name: 'Punching Bag',
      category: 'performance',
      winner: { teamId: mostPointsAgainst.id, teamName: mostPointsAgainst.name, ownerName: mostPointsAgainst.ownerName },
      value: mostPointsAgainst.pointsAgainst.toFixed(1),
      description: 'Most points scored against',
      icon: '🥊',
    });
  }

  // Least Points Against (Easy Street)
  const leastPointsAgainst = getLeastPointsAgainst(league.teams);
  if (leastPointsAgainst && leastPointsAgainst.pointsAgainst !== undefined) {
    awards.push({
      id: 'least_pa',
      name: 'Easy Street',
      category: 'performance',
      winner: { teamId: leastPointsAgainst.id, teamName: leastPointsAgainst.name, ownerName: leastPointsAgainst.ownerName },
      value: leastPointsAgainst.pointsAgainst.toFixed(1),
      description: 'Fewest points scored against',
      icon: '🛋️',
    });
  }

  // Lowest Scorer
  const lowestScorer = getLowestScorer(league.teams);
  if (lowestScorer && lowestScorer.pointsFor !== undefined) {
    awards.push({
      id: 'lowest_scorer',
      name: 'Offensive Struggles',
      category: 'performance',
      winner: { teamId: lowestScorer.id, teamName: lowestScorer.name, ownerName: lowestScorer.ownerName },
      value: lowestScorer.pointsFor.toFixed(1),
      description: 'Fewest total points scored',
      icon: '📉',
    });
  }

  // ============ LUCK AWARDS ============
  if (luckMetrics && luckMetrics.length > 0) {
    // Luckiest Team
    const luckiest = luckMetrics.reduce((best, curr) =>
      curr.luckScore > best.luckScore ? curr : best
    );
    if (luckiest.luckScore > 0) {
      awards.push({
        id: 'luckiest',
        name: 'Luckiest Team',
        category: 'luck',
        winner: { teamId: luckiest.teamId, teamName: luckiest.teamName },
        value: `+${luckiest.luckScore.toFixed(1)}`,
        description: 'Most wins above expected',
        detail: `${luckiest.actualWins}W vs ${luckiest.expectedWins.toFixed(1)} expected`,
        icon: '🍀',
      });
    }

    // Unluckiest Team
    const unluckiest = luckMetrics.reduce((worst, curr) =>
      curr.luckScore < worst.luckScore ? curr : worst
    );
    if (unluckiest.luckScore < 0) {
      awards.push({
        id: 'unluckiest',
        name: 'Unluckiest Team',
        category: 'luck',
        winner: { teamId: unluckiest.teamId, teamName: unluckiest.teamName },
        value: unluckiest.luckScore.toFixed(1),
        description: 'Most wins below expected',
        detail: `${unluckiest.actualWins}W vs ${unluckiest.expectedWins.toFixed(1)} expected`,
        icon: '💔',
      });
    }

    // Biggest Blowout
    const biggestBlowout = luckMetrics.reduce((best, curr) =>
      curr.biggestWin > best.biggestWin ? curr : best
    );
    if (biggestBlowout.biggestWin > 0) {
      awards.push({
        id: 'biggest_blowout',
        name: 'Biggest Blowout',
        category: 'luck',
        winner: { teamId: biggestBlowout.teamId, teamName: biggestBlowout.teamName },
        value: `+${biggestBlowout.biggestWin.toFixed(1)}`,
        description: 'Largest margin of victory',
        icon: '💪',
      });
    }

    // Narrowest Escape (smallest winning margin)
    let narrowestVictory: { team: LuckMetrics; margin: number; week: number } | undefined = undefined;
    for (const m of luckMetrics) {
      for (const score of m.weeklyScores) {
        if (score.won && score.margin > 0) {
          if (!narrowestVictory || score.margin < narrowestVictory.margin) {
            narrowestVictory = { team: m, margin: score.margin, week: score.week };
          }
        }
      }
    }
    if (narrowestVictory) {
      awards.push({
        id: 'narrowest_escape',
        name: 'Narrowest Escape',
        category: 'luck',
        winner: { teamId: narrowestVictory.team.teamId, teamName: narrowestVictory.team.teamName },
        value: `+${narrowestVictory.margin.toFixed(1)}`,
        description: 'Smallest winning margin',
        detail: `Week ${narrowestVictory.week}`,
        icon: '😅',
      });
    }

    // Heartbreak Award (smallest losing margin)
    let heartbreakLoss: { team: LuckMetrics; margin: number; week: number } | undefined = undefined;
    for (const m of luckMetrics) {
      for (const score of m.weeklyScores) {
        if (!score.won && !score.tied && score.margin < 0) {
          const absMargin = Math.abs(score.margin);
          if (!heartbreakLoss || absMargin < heartbreakLoss.margin) {
            heartbreakLoss = { team: m, margin: absMargin, week: score.week };
          }
        }
      }
    }
    if (heartbreakLoss) {
      awards.push({
        id: 'heartbreak',
        name: 'Heartbreak Award',
        category: 'luck',
        winner: { teamId: heartbreakLoss.team.teamId, teamName: heartbreakLoss.team.teamName },
        value: `-${heartbreakLoss.margin.toFixed(1)}`,
        description: 'Smallest losing margin',
        detail: `Week ${heartbreakLoss.week}`,
        icon: '💔',
      });
    }

    // Clutch Performer (best close game record, min 3 close games)
    const eligibleForClutch = luckMetrics.filter(m => m.closeWins + m.closeLosses >= 3);
    if (eligibleForClutch.length > 0) {
      const clutchTeam = eligibleForClutch.reduce((best, curr) =>
        curr.closeGamePct > best.closeGamePct ? curr : best
      );
      if (clutchTeam.closeGamePct > 0.5) {
        awards.push({
          id: 'clutch',
          name: 'Clutch Performer',
          category: 'luck',
          winner: { teamId: clutchTeam.teamId, teamName: clutchTeam.teamName },
          value: `${clutchTeam.closeWins}-${clutchTeam.closeLosses}`,
          description: 'Best record in close games',
          detail: `${(clutchTeam.closeGamePct * 100).toFixed(0)}% win rate`,
          icon: '🎯',
        });
      }
    }

    // All-Play Champion (best all-play record)
    const allPlayChamp = luckMetrics.reduce((best, curr) =>
      curr.allPlayWins > best.allPlayWins ? curr : best
    );
    if (allPlayChamp.allPlayWins > 0) {
      awards.push({
        id: 'allplay_champ',
        name: 'All-Play Champion',
        category: 'luck',
        winner: { teamId: allPlayChamp.teamId, teamName: allPlayChamp.teamName },
        value: `${allPlayChamp.allPlayWins}-${allPlayChamp.allPlayLosses}`,
        description: 'Best record vs entire league each week',
        detail: `${((allPlayChamp.allPlayWins / (allPlayChamp.allPlayWins + allPlayChamp.allPlayLosses)) * 100).toFixed(0)}% win rate`,
        icon: '👊',
      });
    }

    // All-Play Loser (worst all-play record)
    const allPlayLoser = luckMetrics.reduce((worst, curr) =>
      curr.allPlayWins < worst.allPlayWins ? curr : worst
    );
    awards.push({
      id: 'allplay_loser',
      name: 'All-Play Punching Bag',
      category: 'luck',
      winner: { teamId: allPlayLoser.teamId, teamName: allPlayLoser.teamName },
      value: `${allPlayLoser.allPlayWins}-${allPlayLoser.allPlayLosses}`,
      description: 'Worst record vs entire league each week',
      icon: '😵',
    });

    // Best Single Week Score
    let bestWeek: { team: LuckMetrics; score: number; week: number } | undefined;
    for (const m of luckMetrics) {
      for (const score of m.weeklyScores) {
        if (!bestWeek || score.pointsFor > bestWeek.score) {
          bestWeek = { team: m, score: score.pointsFor, week: score.week };
        }
      }
    }
    if (bestWeek) {
      awards.push({
        id: 'best_week',
        name: 'Weekly Explosion',
        category: 'luck',
        winner: { teamId: bestWeek.team.teamId, teamName: bestWeek.team.teamName },
        value: bestWeek.score.toFixed(1),
        description: 'Highest single-week score',
        detail: `Week ${bestWeek.week}`,
        icon: '🔥',
      });
    }

    // Worst Single Week Score
    let worstWeek: { team: LuckMetrics; score: number; week: number } | undefined;
    for (const m of luckMetrics) {
      for (const score of m.weeklyScores) {
        if (score.pointsFor > 0 && (!worstWeek || score.pointsFor < worstWeek.score)) {
          worstWeek = { team: m, score: score.pointsFor, week: score.week };
        }
      }
    }
    if (worstWeek) {
      awards.push({
        id: 'worst_week',
        name: 'Toilet Bowl',
        category: 'luck',
        winner: { teamId: worstWeek.team.teamId, teamName: worstWeek.team.teamName },
        value: worstWeek.score.toFixed(1),
        description: 'Lowest single-week score',
        detail: `Week ${worstWeek.week}`,
        icon: '🚽',
      });
    }

    // Mr. Consistent (lowest score variance)
    const teamVariances = luckMetrics.map(m => {
      const scores = m.weeklyScores.filter(s => s.pointsFor > 0).map(s => s.pointsFor);
      if (scores.length < 3) return { team: m, variance: Infinity };
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
      return { team: m, variance: Math.sqrt(variance) };
    }).filter(v => v.variance !== Infinity);

    if (teamVariances.length > 0) {
      const mostConsistent = teamVariances.reduce((best, curr) =>
        curr.variance < best.variance ? curr : best
      );
      awards.push({
        id: 'consistent',
        name: 'Mr. Consistent',
        category: 'luck',
        winner: { teamId: mostConsistent.team.teamId, teamName: mostConsistent.team.teamName },
        value: `±${mostConsistent.variance.toFixed(1)}`,
        description: 'Most consistent weekly scoring',
        icon: '📊',
      });

      // Boom or Bust (highest variance)
      const boomBust = teamVariances.reduce((worst, curr) =>
        curr.variance > worst.variance ? curr : worst
      );
      awards.push({
        id: 'boom_bust',
        name: 'Boom or Bust',
        category: 'luck',
        winner: { teamId: boomBust.team.teamId, teamName: boomBust.team.teamName },
        value: `±${boomBust.variance.toFixed(1)}`,
        description: 'Most volatile weekly scoring',
        icon: '🎢',
      });
    }

    // Weekly High Scorer Count
    const weeklyHighCounts = new Map<string, number>();
    const weeklyLowCounts = new Map<string, number>();
    const weekNumbers = new Set(luckMetrics.flatMap(m => m.weeklyScores.map(s => s.week)));

    for (const week of weekNumbers) {
      const weekScores = luckMetrics
        .map(m => ({ team: m, pts: m.weeklyScores.find(s => s.week === week)?.pointsFor || 0 }))
        .filter(w => w.pts > 0);

      if (weekScores.length === 0) continue;

      const highest = weekScores.reduce((max, curr) => curr.pts > max.pts ? curr : max);
      const lowest = weekScores.reduce((min, curr) => curr.pts < min.pts ? curr : min);

      weeklyHighCounts.set(highest.team.teamId, (weeklyHighCounts.get(highest.team.teamId) || 0) + 1);
      weeklyLowCounts.set(lowest.team.teamId, (weeklyLowCounts.get(lowest.team.teamId) || 0) + 1);
    }

    // Most Weekly Highs
    let mostHighs: { teamId: string; count: number } | undefined;
    weeklyHighCounts.forEach((count, teamId) => {
      if (!mostHighs || count > mostHighs.count) {
        mostHighs = { teamId, count };
      }
    });
    if (mostHighs && mostHighs.count >= 2) {
      const team = luckMetrics.find(m => m.teamId === mostHighs!.teamId);
      if (team) {
        awards.push({
          id: 'weekly_highs',
          name: 'Top Dog',
          category: 'luck',
          winner: { teamId: team.teamId, teamName: team.teamName },
          value: mostHighs.count,
          description: 'Most weeks as highest scorer',
          icon: '🐕',
        });
      }
    }

    // Most Weekly Lows
    let mostLows: { teamId: string; count: number } | undefined;
    weeklyLowCounts.forEach((count, teamId) => {
      if (!mostLows || count > mostLows.count) {
        mostLows = { teamId, count };
      }
    });
    if (mostLows && mostLows.count >= 2) {
      const team = luckMetrics.find(m => m.teamId === mostLows!.teamId);
      if (team) {
        awards.push({
          id: 'weekly_lows',
          name: 'Cellar Dweller',
          category: 'luck',
          winner: { teamId: team.teamId, teamName: team.teamName },
          value: mostLows.count,
          description: 'Most weeks as lowest scorer',
          icon: '📦',
        });
      }
    }
  }

  // ============ DRAFT AWARDS ============

  // Best Draft
  const bestDraft = getBestDraft(league.teams);
  if (bestDraft) {
    awards.push({
      id: 'best_draft',
      name: 'Best Draft',
      category: 'draft',
      winner: { teamId: bestDraft.team.id, teamName: bestDraft.team.name, ownerName: bestDraft.team.ownerName },
      value: `+${bestDraft.avgValue.toFixed(1)}`,
      description: 'Highest average draft value',
      detail: `${bestDraft.greatPicks} great picks`,
      icon: '🎯',
    });
  }

  // Worst Draft
  const worstDraft = getWorstDraft(league.teams);
  if (worstDraft) {
    awards.push({
      id: 'worst_draft',
      name: 'Worst Draft',
      category: 'draft',
      winner: { teamId: worstDraft.team.id, teamName: worstDraft.team.name, ownerName: worstDraft.team.ownerName },
      value: worstDraft.avgValue.toFixed(1),
      description: 'Lowest average draft value',
      detail: `${worstDraft.terriblePicks} terrible picks`,
      icon: '📉',
    });
  }

  // Draft Steal (single best pick)
  const draftSteal = getDraftSteal(league.teams);
  if (draftSteal) {
    awards.push({
      id: 'draft_steal',
      name: 'Draft Steal',
      category: 'draft',
      winner: { teamId: draftSteal.teamId, teamName: draftSteal.teamName },
      value: `+${draftSteal.value.toFixed(1)}`,
      description: 'Best single draft pick',
      detail: `${draftSteal.playerName} (Rd ${draftSteal.round})`,
      icon: '💎',
    });
  }

  // Draft Bust (single worst pick)
  const draftBust = getDraftBust(league.teams);
  if (draftBust) {
    awards.push({
      id: 'draft_bust',
      name: 'Draft Bust',
      category: 'draft',
      winner: { teamId: draftBust.teamId, teamName: draftBust.teamName },
      value: draftBust.value.toFixed(1),
      description: 'Worst single draft pick',
      detail: `${draftBust.playerName} (Rd ${draftBust.round})`,
      icon: '💣',
    });
  }

  // Late Round Hero (best pick from rounds 8+)
  const lateRoundHero = getLateRoundHero(league.teams);
  if (lateRoundHero) {
    awards.push({
      id: 'late_round_hero',
      name: 'Late Round Hero',
      category: 'draft',
      winner: { teamId: lateRoundHero.teamId, teamName: lateRoundHero.teamName },
      value: `+${lateRoundHero.value.toFixed(1)}`,
      description: 'Best pick from round 8+',
      detail: `${lateRoundHero.playerName} (Rd ${lateRoundHero.round})`,
      icon: '🦸',
    });
  }

  // ============ WAIVER AWARDS ============

  // Best Waiver Pickup
  const bestWaiver = getBestWaiverPickup(league.teams);
  if (bestWaiver) {
    awards.push({
      id: 'best_waiver',
      name: 'Best Waiver Pickup',
      category: 'waivers',
      winner: { teamId: bestWaiver.teamId, teamName: bestWaiver.teamName },
      value: bestWaiver.par.toFixed(1),
      description: 'Highest PAR from single pickup',
      detail: bestWaiver.playerName,
      icon: '💎',
    });
  }

  // Worst Waiver Pickup (min 2 games started)
  const worstWaiver = getWorstWaiverPickup(league.teams);
  if (worstWaiver) {
    awards.push({
      id: 'worst_waiver',
      name: 'Worst Waiver Pickup',
      category: 'waivers',
      winner: { teamId: worstWaiver.teamId, teamName: worstWaiver.teamName },
      value: worstWaiver.par.toFixed(1),
      description: 'Lowest PAR from single pickup',
      detail: worstWaiver.playerName,
      icon: '🗑️',
    });
  }

  // Waiver Wire King (most total PAR from waivers)
  const waiverKing = getWaiverWireKing(league.teams);
  if (waiverKing) {
    awards.push({
      id: 'waiver_king',
      name: 'Waiver Wire King',
      category: 'waivers',
      winner: { teamId: waiverKing.team.id, teamName: waiverKing.team.name, ownerName: waiverKing.team.ownerName },
      value: waiverKing.totalPAR.toFixed(1),
      description: 'Most PAR from waiver pickups',
      detail: `${waiverKing.pickupCount} pickups`,
      icon: '👑',
    });
  }

  // Waiver Wire Slacker (least PAR from waivers)
  const waiverSlacker = getWaiverWireSlacker(league.teams);
  if (waiverSlacker) {
    awards.push({
      id: 'waiver_slacker',
      name: 'Waiver Wire Slacker',
      category: 'waivers',
      winner: { teamId: waiverSlacker.team.id, teamName: waiverSlacker.team.name, ownerName: waiverSlacker.team.ownerName },
      value: waiverSlacker.totalPAR.toFixed(1),
      description: 'Least PAR from waiver pickups',
      detail: `${waiverSlacker.pickupCount} pickups`,
      icon: '😴',
    });
  }

  // ============ ACTIVITY AWARDS ============

  // Most Active
  const mostActive = getMostActive(league.teams);
  if (mostActive) {
    awards.push({
      id: 'most_active',
      name: 'Most Active',
      category: 'activity',
      winner: { teamId: mostActive.team.id, teamName: mostActive.team.name, ownerName: mostActive.team.ownerName },
      value: mostActive.transactionCount,
      description: 'Most transactions',
      icon: '🏃',
    });
  }

  // Least Active
  const leastActive = getLeastActive(league.teams);
  if (leastActive) {
    awards.push({
      id: 'least_active',
      name: 'Least Active',
      category: 'activity',
      winner: { teamId: leastActive.team.id, teamName: leastActive.team.name, ownerName: leastActive.team.ownerName },
      value: leastActive.transactionCount,
      description: 'Fewest transactions',
      icon: '🦥',
    });
  }

  // ============ TRADE AWARDS ============
  if (league.trades && league.trades.length > 0) {
    // Trade Shark (best net PAR from trades)
    const tradeShark = getTradeShark(league.teams, league.trades);
    if (tradeShark && tradeShark.netPAR > 0) {
      awards.push({
        id: 'trade_shark',
        name: 'Trade Shark',
        category: 'trades',
        winner: { teamId: tradeShark.team.id, teamName: tradeShark.team.name, ownerName: tradeShark.team.ownerName },
        value: `+${tradeShark.netPAR.toFixed(1)}`,
        description: 'Best net PAR from trades',
        detail: `${tradeShark.wins}W-${tradeShark.losses}L`,
        icon: '🦈',
      });
    }

    // Trade Victim (worst net PAR from trades)
    const tradeVictim = getTradeVictim(league.teams, league.trades);
    if (tradeVictim && tradeVictim.netPAR < 0) {
      awards.push({
        id: 'trade_victim',
        name: 'Trade Victim',
        category: 'trades',
        winner: { teamId: tradeVictim.team.id, teamName: tradeVictim.team.name, ownerName: tradeVictim.team.ownerName },
        value: tradeVictim.netPAR.toFixed(1),
        description: 'Worst net PAR from trades',
        detail: `${tradeVictim.wins}W-${tradeVictim.losses}L`,
        icon: '🎯',
      });
    }

    // Best Single Trade
    const bestTrade = getBestTrade(league.trades);
    if (bestTrade) {
      awards.push({
        id: 'best_trade',
        name: 'Best Trade',
        category: 'trades',
        winner: { teamId: bestTrade.teamId, teamName: bestTrade.teamName },
        value: `+${bestTrade.netPAR.toFixed(1)}`,
        description: 'Highest PAR gain from single trade',
        detail: `Week ${bestTrade.week}`,
        icon: '🤝',
      });
    }

    // Worst Single Trade
    const worstTrade = getWorstTrade(league.trades);
    if (worstTrade) {
      awards.push({
        id: 'worst_trade',
        name: 'Worst Trade',
        category: 'trades',
        winner: { teamId: worstTrade.teamId, teamName: worstTrade.teamName },
        value: worstTrade.netPAR.toFixed(1),
        description: 'Biggest PAR loss from single trade',
        detail: `Week ${worstTrade.week}`,
        icon: '🤦',
      });
    }

    // Trade Addict (most trades made)
    const tradeAddict = getTradeAddict(league.teams, league.trades);
    if (tradeAddict && tradeAddict.count >= 3) {
      awards.push({
        id: 'trade_addict',
        name: 'Trade Addict',
        category: 'trades',
        winner: { teamId: tradeAddict.team.id, teamName: tradeAddict.team.name, ownerName: tradeAddict.team.ownerName },
        value: tradeAddict.count,
        description: 'Most trades completed',
        icon: '🔄',
      });
    }
  }

  // Trade Avoider (no trades when others traded)
  if (league.trades && league.trades.length >= 2) {
    const tradeAvoiders = league.teams.filter(team => {
      const teamTrades = league.trades?.filter(t =>
        t.teams.some(tt => tt.teamId === team.id)
      ) || [];
      return teamTrades.length === 0;
    });
    if (tradeAvoiders.length > 0 && tradeAvoiders.length < league.teams.length) {
      awards.push({
        id: 'trade_avoider',
        name: 'Lone Wolf',
        category: 'trades',
        winner: { teamId: tradeAvoiders[0].id, teamName: tradeAvoiders[0].name, ownerName: tradeAvoiders[0].ownerName },
        value: '0',
        description: 'Made zero trades',
        icon: '🐺',
      });
    }
  }

  return awards;
}

// ============ HELPER FUNCTIONS ============

function getBestRecord(teams: Team[]): Team | undefined {
  return teams.reduce((best, curr) => {
    if (!best) return curr;
    const currWins = curr.wins || 0;
    const bestWins = best.wins || 0;
    if (currWins > bestWins) return curr;
    const currPF = curr.pointsFor || 0;
    const bestPF = best.pointsFor || 0;
    if (currWins === bestWins && currPF > bestPF) return curr;
    return best;
  }, undefined as Team | undefined);
}

function getMostPointsFor(teams: Team[]): Team | undefined {
  return teams.reduce((best, curr) => {
    const currPF = curr.pointsFor || 0;
    const bestPF = best?.pointsFor || 0;
    return !best || currPF > bestPF ? curr : best;
  }, undefined as Team | undefined);
}

function getWorstRecord(teams: Team[]): Team | undefined {
  return teams.reduce((worst, curr) => {
    if (!worst) return curr;
    const currWins = curr.wins || 0;
    const worstWins = worst.wins || 0;
    if (currWins < worstWins) return curr;
    const currPF = curr.pointsFor || 0;
    const worstPF = worst.pointsFor || 0;
    if (currWins === worstWins && currPF < worstPF) return curr;
    return worst;
  }, undefined as Team | undefined);
}

function getMostPointsAgainst(teams: Team[]): Team | undefined {
  return teams.reduce((most, curr) => {
    const currPA = curr.pointsAgainst || 0;
    const mostPA = most?.pointsAgainst || 0;
    return !most || currPA > mostPA ? curr : most;
  }, undefined as Team | undefined);
}

function getLeastPointsAgainst(teams: Team[]): Team | undefined {
  return teams.reduce((least, curr) => {
    const currPA = curr.pointsAgainst || 0;
    const leastPA = least?.pointsAgainst || Infinity;
    return !least || currPA < leastPA ? curr : least;
  }, undefined as Team | undefined);
}

function getLowestScorer(teams: Team[]): Team | undefined {
  return teams.reduce((lowest, curr) => {
    const currPF = curr.pointsFor || Infinity;
    const lowestPF = lowest?.pointsFor || Infinity;
    return !lowest || currPF < lowestPF ? curr : lowest;
  }, undefined as Team | undefined);
}

function getBestDraft(teams: Team[]): { team: Team; avgValue: number; greatPicks: number } | undefined {
  let best: { team: Team; avgValue: number; greatPicks: number } | undefined;

  teams.forEach(team => {
    const picks = team.draftPicks || [];
    if (picks.length === 0) return;

    const validPicks = picks.filter(p => p.valueOverExpected !== undefined);
    if (validPicks.length === 0) return;

    const avgValue = validPicks.reduce((sum, p) => sum + (p.valueOverExpected || 0), 0) / validPicks.length;
    const greatPicks = picks.filter(p => p.grade === 'great').length;

    if (!best || avgValue > best.avgValue) {
      best = { team, avgValue, greatPicks };
    }
  });

  return best;
}

function getWorstDraft(teams: Team[]): { team: Team; avgValue: number; terriblePicks: number } | undefined {
  let worst: { team: Team; avgValue: number; terriblePicks: number } | undefined;

  teams.forEach(team => {
    const picks = team.draftPicks || [];
    if (picks.length === 0) return;

    const validPicks = picks.filter(p => p.valueOverExpected !== undefined);
    if (validPicks.length === 0) return;

    const avgValue = validPicks.reduce((sum, p) => sum + (p.valueOverExpected || 0), 0) / validPicks.length;
    const terriblePicks = picks.filter(p => p.grade === 'terrible').length;

    if (!worst || avgValue < worst.avgValue) {
      worst = { team, avgValue, terriblePicks };
    }
  });

  return worst;
}

function getDraftSteal(teams: Team[]): { teamId: string; teamName: string; playerName: string; value: number; round: number } | undefined {
  let best: { teamId: string; teamName: string; playerName: string; value: number; round: number } | undefined;

  teams.forEach(team => {
    (team.draftPicks || []).forEach(pick => {
      const value = pick.valueOverExpected || 0;
      // Only consider picks with positive value (actual steals)
      if (value > 0 && (!best || value > best.value)) {
        best = {
          teamId: team.id,
          teamName: team.name,
          playerName: pick.player.name,
          value,
          round: pick.round,
        };
      }
    });
  });

  return best;
}

function getDraftBust(teams: Team[]): { teamId: string; teamName: string; playerName: string; value: number; round: number } | undefined {
  let worst: { teamId: string; teamName: string; playerName: string; value: number; round: number } | undefined;

  teams.forEach(team => {
    (team.draftPicks || []).forEach(pick => {
      const value = pick.valueOverExpected || 0;
      // Only consider early picks (rounds 1-7) with negative value (actual busts)
      if (pick.round <= 7 && value < 0 && (!worst || value < worst.value)) {
        worst = {
          teamId: team.id,
          teamName: team.name,
          playerName: pick.player.name,
          value,
          round: pick.round,
        };
      }
    });
  });

  return worst;
}

function getLateRoundHero(teams: Team[]): { teamId: string; teamName: string; playerName: string; value: number; round: number } | undefined {
  let best: { teamId: string; teamName: string; playerName: string; value: number; round: number } | undefined;

  teams.forEach(team => {
    (team.draftPicks || []).forEach(pick => {
      // Only consider late picks (round 8+) with positive value
      if (pick.round >= 8) {
        const value = pick.valueOverExpected || 0;
        if (value > 0 && (!best || value > best.value)) {
          best = {
            teamId: team.id,
            teamName: team.name,
            playerName: pick.player.name,
            value,
            round: pick.round,
          };
        }
      }
    });
  });

  return best;
}

function getBestWaiverPickup(teams: Team[]): { teamId: string; teamName: string; playerName: string; par: number } | undefined {
  let best: { teamId: string; teamName: string; playerName: string; par: number } | undefined;

  teams.forEach(team => {
    (team.transactions || []).forEach(tx => {
      (tx.adds || []).forEach(player => {
        const par = (player as any).pointsAboveReplacement || 0;
        if (!best || par > best.par) {
          best = {
            teamId: team.id,
            teamName: team.name,
            playerName: player.name,
            par,
          };
        }
      });
    });
  });

  return best;
}

function getWorstWaiverPickup(teams: Team[]): { teamId: string; teamName: string; playerName: string; par: number } | undefined {
  let worst: { teamId: string; teamName: string; playerName: string; par: number } | undefined;

  teams.forEach(team => {
    (team.transactions || []).forEach(tx => {
      (tx.adds || []).forEach(player => {
        const games = (player as any).gamesSincePickup || 0;
        if (games < 2) return; // Skip players with less than 2 games

        const par = (player as any).pointsAboveReplacement || 0;
        if (!worst || par < worst.par) {
          worst = {
            teamId: team.id,
            teamName: team.name,
            playerName: player.name,
            par,
          };
        }
      });
    });
  });

  return worst;
}

function getWaiverWireKing(teams: Team[]): { team: Team; totalPAR: number; pickupCount: number } | undefined {
  let best: { team: Team; totalPAR: number; pickupCount: number } | undefined;

  teams.forEach(team => {
    const txs = team.transactions || [];
    const totalPAR = txs.reduce((sum, tx) => sum + ((tx as any).totalPAR || 0), 0);
    const pickupCount = txs.filter(tx => tx.adds && tx.adds.length > 0).length;

    if (!best || totalPAR > best.totalPAR) {
      best = { team, totalPAR, pickupCount };
    }
  });

  return best;
}

function getWaiverWireSlacker(teams: Team[]): { team: Team; totalPAR: number; pickupCount: number } | undefined {
  let worst: { team: Team; totalPAR: number; pickupCount: number } | undefined;

  teams.forEach(team => {
    const txs = team.transactions || [];
    const totalPAR = txs.reduce((sum, tx) => sum + ((tx as any).totalPAR || 0), 0);
    const pickupCount = txs.filter(tx => tx.adds && tx.adds.length > 0).length;

    if (!worst || totalPAR < worst.totalPAR) {
      worst = { team, totalPAR, pickupCount };
    }
  });

  return worst;
}

function getMostActive(teams: Team[]): { team: Team; transactionCount: number } | undefined {
  let best: { team: Team; transactionCount: number } | undefined;

  teams.forEach(team => {
    const count = (team.transactions || []).length + (team.trades || []).length;
    if (!best || count > best.transactionCount) {
      best = { team, transactionCount: count };
    }
  });

  return best;
}

function getLeastActive(teams: Team[]): { team: Team; transactionCount: number } | undefined {
  let worst: { team: Team; transactionCount: number } | undefined;

  teams.forEach(team => {
    const count = (team.transactions || []).length + (team.trades || []).length;
    if (!worst || count < worst.transactionCount) {
      worst = { team, transactionCount: count };
    }
  });

  return worst;
}

function getTradeShark(teams: Team[], trades: Trade[]): { team: Team; netPAR: number; wins: number; losses: number } | undefined {
  const teamStats = new Map<string, { netPAR: number; wins: number; losses: number }>();

  // Initialize stats for all teams
  teams.forEach(team => {
    teamStats.set(team.id, { netPAR: 0, wins: 0, losses: 0 });
  });

  // Calculate trade performance
  trades.forEach(trade => {
    trade.teams.forEach(tradeTeam => {
      const stats = teamStats.get(tradeTeam.teamId);
      if (stats) {
        stats.netPAR += tradeTeam.netPAR || 0;
        if (trade.winner === tradeTeam.teamId) {
          stats.wins++;
        } else if (trade.winner && trade.winner !== tradeTeam.teamId) {
          stats.losses++;
        }
      }
    });
  });

  // Find best trader
  let best: { team: Team; netPAR: number; wins: number; losses: number } | undefined;
  teams.forEach(team => {
    const stats = teamStats.get(team.id);
    if (stats && (!best || stats.netPAR > best.netPAR)) {
      best = { team, ...stats };
    }
  });

  return best;
}

function getBestTrade(trades: Trade[]): { teamId: string; teamName: string; netPAR: number; week: number } | undefined {
  let best: { teamId: string; teamName: string; netPAR: number; week: number } | undefined;

  trades.forEach(trade => {
    trade.teams.forEach(tradeTeam => {
      const netPAR = tradeTeam.netPAR || 0;
      if (!best || netPAR > best.netPAR) {
        best = {
          teamId: tradeTeam.teamId,
          teamName: tradeTeam.teamName,
          netPAR,
          week: trade.week,
        };
      }
    });
  });

  return best;
}

function getWorstTrade(trades: Trade[]): { teamId: string; teamName: string; netPAR: number; week: number } | undefined {
  let worst: { teamId: string; teamName: string; netPAR: number; week: number } | undefined;

  trades.forEach(trade => {
    trade.teams.forEach(tradeTeam => {
      const netPAR = tradeTeam.netPAR || 0;
      if (!worst || netPAR < worst.netPAR) {
        worst = {
          teamId: tradeTeam.teamId,
          teamName: tradeTeam.teamName,
          netPAR,
          week: trade.week,
        };
      }
    });
  });

  return worst;
}

function getTradeVictim(teams: Team[], trades: Trade[]): { team: Team; netPAR: number; wins: number; losses: number } | undefined {
  const teamStats = new Map<string, { netPAR: number; wins: number; losses: number }>();

  teams.forEach(team => {
    teamStats.set(team.id, { netPAR: 0, wins: 0, losses: 0 });
  });

  trades.forEach(trade => {
    trade.teams.forEach(tradeTeam => {
      const stats = teamStats.get(tradeTeam.teamId);
      if (stats) {
        stats.netPAR += tradeTeam.netPAR || 0;
        if (trade.winner === tradeTeam.teamId) {
          stats.wins++;
        } else if (trade.winner && trade.winner !== tradeTeam.teamId) {
          stats.losses++;
        }
      }
    });
  });

  let worst: { team: Team; netPAR: number; wins: number; losses: number } | undefined;
  teams.forEach(team => {
    const stats = teamStats.get(team.id);
    if (stats && (!worst || stats.netPAR < worst.netPAR)) {
      worst = { team, ...stats };
    }
  });

  return worst;
}

function getTradeAddict(teams: Team[], trades: Trade[]): { team: Team; count: number } | undefined {
  const tradeCounts = new Map<string, number>();

  trades.forEach(trade => {
    trade.teams.forEach(tradeTeam => {
      tradeCounts.set(tradeTeam.teamId, (tradeCounts.get(tradeTeam.teamId) || 0) + 1);
    });
  });

  let most: { team: Team; count: number } | undefined;
  teams.forEach(team => {
    const count = tradeCounts.get(team.id) || 0;
    if (!most || count > most.count) {
      most = { team, count };
    }
  });

  return most;
}

/**
 * Group awards by category
 */
export function groupAwardsByCategory(awards: Award[]): Map<string, Award[]> {
  const grouped = new Map<string, Award[]>();

  awards.forEach(award => {
    const existing = grouped.get(award.category) || [];
    existing.push(award);
    grouped.set(award.category, existing);
  });

  return grouped;
}

/**
 * Get award display name for category
 */
export function getCategoryDisplayName(category: string): string {
  switch (category) {
    case 'performance': return 'Performance';
    case 'luck': return 'Luck & Close Games';
    case 'activity': return 'Activity';
    case 'draft': return 'Draft';
    case 'trades': return 'Trades';
    case 'waivers': return 'Waiver Wire';
    default: return category;
  }
}
