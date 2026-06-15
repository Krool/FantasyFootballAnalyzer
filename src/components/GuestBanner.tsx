import { useSounds } from '@/hooks/useSounds';
import styles from './GuestBanner.module.css';

interface GuestBannerProps {
  // Clears guest mode and lands on the home connect form.
  onConnect: () => void;
}

// Shown on guest pages (Rankings, Draft Room) to set expectations: the data
// pages, real team names, and season switching all need a real connection.
export function GuestBanner({ onConnect }: GuestBannerProps) {
  const { playClick } = useSounds();
  return (
    <div className={styles.banner} role="status">
      <div className={`container ${styles.inner}`}>
        <p className={styles.text}>
          <span className={styles.tag}>Guest mode</span>
          Rankings and mock drafts only. Connect your league for real team
          names, draft grades, trades, awards, and history. Switching seasons
          needs a login.
        </p>
        <button
          type="button"
          className={styles.connect}
          onClick={() => { playClick(); onConnect(); }}
        >
          Connect your league
        </button>
      </div>
    </div>
  );
}
