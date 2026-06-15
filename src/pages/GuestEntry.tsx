import { useState } from 'react';
import {
  DEFAULT_GUEST_SETTINGS,
  GUEST_TEAM_OPTIONS,
  type GuestScoring,
  type GuestSettings,
} from '@/utils/guestLeague';
import type { DraftType } from '@/types';
import { useSounds } from '@/hooks/useSounds';
import styles from './GuestEntry.module.css';

export type GuestDest = 'rankings' | 'draft-room';

interface GuestEntryProps {
  onStart: (settings: GuestSettings, dest: GuestDest) => void;
}

const SCORING_OPTIONS: Array<{ value: GuestScoring; label: string }> = [
  { value: 'standard', label: 'Standard' },
  { value: 'half_ppr', label: 'Half PPR' },
  { value: 'ppr', label: 'PPR' },
];

const DRAFT_OPTIONS: Array<{ value: DraftType; label: string }> = [
  { value: 'snake', label: 'Snake' },
  { value: 'auction', label: 'Auction' },
];

// No-login entry point on the home page: pick league shape, then jump straight
// into Rankings or a mock Draft Room. Presentational and stateful only for the
// settings; the parent owns entering guest mode and navigating.
export function GuestEntry({ onStart }: GuestEntryProps) {
  const [settings, setSettings] = useState<GuestSettings>(DEFAULT_GUEST_SETTINGS);
  const { playFilter, playClick } = useSounds();

  // Changing a setting reuses the same chirp the Rankings filter chips play.
  const patch = (p: Partial<GuestSettings>) => {
    playFilter();
    setSettings(s => ({ ...s, ...p }));
  };

  const start = (dest: GuestDest) => {
    playClick();
    onStart(settings, dest);
  };

  return (
    <section className={styles.guest} aria-label="Try without logging in">
      <span className={styles.kicker}>▌ NO LOGIN · GUEST MODE</span>
      <h2 className={styles.title}>Just exploring?</h2>
      <p className={styles.blurb}>
        Open the rankings or run a mock draft with no account. Set it up to
        match your league. You can change any of this later, and connect a real
        league when you want team names, grades, and history.
      </p>

      <div className={styles.controls}>
        <div className={styles.field}>
          <span className={styles.label}>Scoring</span>
          <div className={styles.segmented} role="group" aria-label="Scoring">
            {SCORING_OPTIONS.map(o => (
              <button
                key={o.value}
                type="button"
                className={settings.scoringType === o.value ? styles.segOn : styles.seg}
                onClick={() => patch({ scoringType: o.value })}
                aria-pressed={settings.scoringType === o.value}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Draft</span>
          <div className={styles.segmented} role="group" aria-label="Draft type">
            {DRAFT_OPTIONS.map(o => (
              <button
                key={o.value}
                type="button"
                className={settings.draftType === o.value ? styles.segOn : styles.seg}
                onClick={() => patch({ draftType: o.value })}
                aria-pressed={settings.draftType === o.value}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="guest-teams">Teams</label>
          <select
            id="guest-teams"
            className={styles.select}
            value={settings.totalTeams}
            onChange={e => patch({ totalTeams: Number(e.target.value) })}
          >
            {GUEST_TEAM_OPTIONS.map(n => (
              <option key={n} value={n}>{n} teams</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Superflex</span>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={settings.hasSuperflex}
              onChange={e => patch({ hasSuperflex: e.target.checked })}
            />
            <span className={styles.toggleText}>2QB / SF</span>
          </label>
        </div>
      </div>

      <div className={styles.buttons}>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => start('rankings')}
        >
          View rankings
        </button>
        <button
          type="button"
          className={styles.primary}
          onClick={() => start('draft-room')}
        >
          Start mock draft
        </button>
      </div>
    </section>
  );
}
