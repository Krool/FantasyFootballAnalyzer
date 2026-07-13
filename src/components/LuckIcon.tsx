import type { LuckMetrics } from '@/utils/luck';
import { AWARD_ICONS } from '@/utils/awardIcons';
import styles from './LuckIcon.module.css';

// Inline sticker stamp for the luck extremes: the clover for very lucky, the
// broken heart for very unlucky. The middle ratings render nothing; the
// signed score and its color already carry "mildly lucky", and we only have
// sticker art for the extremes (the old 😊/😐/😔 emojis said little).
export function LuckIcon({ rating }: { rating: LuckMetrics['luckRating'] }) {
  if (rating !== 'very_lucky' && rating !== 'very_unlucky') return null;
  const veryLucky = rating === 'very_lucky';
  return (
    <img
      src={veryLucky ? AWARD_ICONS.luckiest : AWARD_ICONS.unluckiest}
      alt={veryLucky ? 'very lucky' : 'very unlucky'}
      className={styles.luckIcon}
    />
  );
}
