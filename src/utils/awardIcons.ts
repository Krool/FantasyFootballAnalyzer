// Maps award ids (see src/utils/awards.ts) to their sticker icons, sliced
// from the sprite sheets in data/award-sheets/ by scripts/sliceAwardIcons.ts.
// Unluckiest Team and the Heartbreak Award share the broken heart on purpose
// (they shared the 💔 emoji before). Awards without an entry fall back to
// their emoji.

import bestRecord from '@/images/awards/best_record.png';
import mostPoints from '@/images/awards/most_points.png';
import worstRecord from '@/images/awards/worst_record.png';
import mostPa from '@/images/awards/most_pa.png';
import leastPa from '@/images/awards/least_pa.png';
import lowestScorer from '@/images/awards/lowest_scorer.png';
import luckiest from '@/images/awards/luckiest.png';
import brokenHeart from '@/images/awards/broken_heart.png';
import biggestBlowout from '@/images/awards/biggest_blowout.png';
import narrowestEscape from '@/images/awards/narrowest_escape.png';
import clutch from '@/images/awards/clutch.png';
import allplayChamp from '@/images/awards/allplay_champ.png';
import allplayLoser from '@/images/awards/allplay_loser.png';
import bestWeek from '@/images/awards/best_week.png';
import worstWeek from '@/images/awards/worst_week.png';
import consistent from '@/images/awards/consistent.png';
import boomBust from '@/images/awards/boom_bust.png';
import weeklyHighs from '@/images/awards/weekly_highs.png';
import weeklyLows from '@/images/awards/weekly_lows.png';
import bestDraft from '@/images/awards/best_draft.png';
import worstDraft from '@/images/awards/worst_draft.png';
import draftSteal from '@/images/awards/draft_steal.png';
import draftBust from '@/images/awards/draft_bust.png';
import lateRoundHero from '@/images/awards/late_round_hero.png';
import bestWaiver from '@/images/awards/best_waiver.png';
import worstWaiver from '@/images/awards/worst_waiver.png';
import waiverKing from '@/images/awards/waiver_king.png';
import waiverSlacker from '@/images/awards/waiver_slacker.png';
import mostActive from '@/images/awards/most_active.png';
import leastActive from '@/images/awards/least_active.png';
import tradeShark from '@/images/awards/trade_shark.png';
import tradeVictim from '@/images/awards/trade_victim.png';
import bestTrade from '@/images/awards/best_trade.png';
import worstTrade from '@/images/awards/worst_trade.png';
import tradeAddict from '@/images/awards/trade_addict.png';
import tradeAvoider from '@/images/awards/trade_avoider.png';

export const AWARD_ICONS: Record<string, string> = {
  best_record: bestRecord,
  most_points: mostPoints,
  worst_record: worstRecord,
  most_pa: mostPa,
  least_pa: leastPa,
  lowest_scorer: lowestScorer,
  luckiest,
  unluckiest: brokenHeart,
  biggest_blowout: biggestBlowout,
  narrowest_escape: narrowestEscape,
  heartbreak: brokenHeart,
  clutch,
  allplay_champ: allplayChamp,
  allplay_loser: allplayLoser,
  best_week: bestWeek,
  worst_week: worstWeek,
  consistent,
  boom_bust: boomBust,
  weekly_highs: weeklyHighs,
  weekly_lows: weeklyLows,
  best_draft: bestDraft,
  worst_draft: worstDraft,
  draft_steal: draftSteal,
  draft_bust: draftBust,
  late_round_hero: lateRoundHero,
  best_waiver: bestWaiver,
  worst_waiver: worstWaiver,
  waiver_king: waiverKing,
  waiver_slacker: waiverSlacker,
  most_active: mostActive,
  least_active: leastActive,
  trade_shark: tradeShark,
  trade_victim: tradeVictim,
  best_trade: bestTrade,
  worst_trade: worstTrade,
  trade_addict: tradeAddict,
  trade_avoider: tradeAvoider,
};

export function awardIconSrc(awardId: string): string | undefined {
  return AWARD_ICONS[awardId];
}

// Resolves null when the award has no icon or it fails to load (never
// rejects), so canvas/PDF callers can fall back to the emoji.
export function loadAwardIcon(awardId: string): Promise<HTMLImageElement | null> {
  const src = AWARD_ICONS[awardId];
  if (!src) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
