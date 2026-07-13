import { useState } from 'react';
import { useSounds } from '@/hooks/useSounds';
import styles from './DraftPrepBanner.module.css';

interface DraftPrepBannerProps {
  // The bundled pool's season: the draft being prepped.
  draftSeason: number;
  // The loaded league's (older) season.
  leagueSeason: number;
  // Jumps to draft prep: switches the league to the draft season when the
  // platform has it (same as picking it in the year dropdown), then opens
  // the Draft Room. Resolves once navigation has happened.
  onOpen: () => Promise<void>;
}

// Shown on league pages while an older season is loaded and a newer pool is
// bundled: the "your 2025 league is on screen but the 2026 draft is what you
// came to prep" bridge, one click instead of finding the year dropdown.
export function DraftPrepBanner({ draftSeason, leagueSeason, onOpen }: DraftPrepBannerProps) {
  const { playClick } = useSounds();
  const [busy, setBusy] = useState(false);

  return (
    <div className={styles.banner} role="status">
      <div className={`container ${styles.inner}`}>
        <p className={styles.text}>
          <span className={styles.tag}>{draftSeason} draft prep</span>
          You're viewing the {leagueSeason} season. The {draftSeason} rankings are loaded
          and ready for mock drafts and draft-day prep.
        </p>
        <button
          type="button"
          className={styles.open}
          disabled={busy}
          onClick={async () => {
            playClick();
            setBusy(true);
            try {
              await onOpen();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? `Loading ${draftSeason}...` : `Open ${draftSeason} Draft Room`}
        </button>
      </div>
    </div>
  );
}
