import { useRef, useState, type ReactNode } from 'react';
import styles from './DraftSheet.module.css';

export type SheetSnap = 'peek' | 'half' | 'full';

export interface SheetTab {
  key: string;
  label: string;
}

interface DraftSheetProps {
  tabs: SheetTab[];
  active: string;
  onTabChange: (key: string) => void;
  children: ReactNode;
}

// Sleeper-style bottom sheet for the phone draft room. PEEK shows just the
// tab bar above the board, HALF splits the screen, FULL takes over. Dragging
// the header follows the finger and snaps to the nearest state on release;
// tapping anywhere on a peeked header opens HALF; tapping the already-active
// tab collapses back to PEEK; the chevron steps up (peek -> half -> full)
// and back down from full.
const SNAP_SHARE: Record<SheetSnap, number> = { peek: 0.075, half: 0.52, full: 0.94 };

export function DraftSheet({ tabs, active, onTabChange, children }: DraftSheetProps) {
  const [snap, setSnap] = useState<SheetSnap>('peek');
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  // The state above renders the height; this ref is the source of truth for
  // the snap decision. A fast flick fires move+end before React flushes
  // state, and deciding from stale state would snap the sheet back.
  const liveHeight = useRef<number | null>(null);

  const heightFor = (s: SheetSnap) => SNAP_SHARE[s] * window.innerHeight;

  const onTouchStart = (e: React.TouchEvent) => {
    drag.current = {
      startY: e.touches[0].clientY,
      startHeight: liveHeight.current ?? heightFor(snap),
    };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!drag.current) return;
    const pulled = drag.current.startY - e.touches[0].clientY;
    const next = Math.min(
      heightFor('full'),
      Math.max(heightFor('peek'), drag.current.startHeight + pulled),
    );
    liveHeight.current = next;
    setDragHeight(next);
  };

  const onTouchEnd = () => {
    if (!drag.current) return;
    const settled = liveHeight.current ?? heightFor(snap);
    drag.current = null;
    liveHeight.current = null;
    setDragHeight(null);
    const states: SheetSnap[] = ['peek', 'half', 'full'];
    setSnap(
      states.reduce(
        (best, s) => (Math.abs(heightFor(s) - settled) < Math.abs(heightFor(best) - settled) ? s : best),
        'peek' as SheetSnap,
      ),
    );
  };

  // Tapping the tab you're already on is the "minimize" gesture; any other
  // tap on a peeked sheet opens it, so a collapsed sheet is never a dead bar.
  const selectTab = (key: string) => {
    if (key === active && snap !== 'peek') {
      setSnap('peek');
      return;
    }
    onTabChange(key);
    if (snap === 'peek') setSnap('half');
  };

  return (
    <div
      className={styles.sheet}
      data-snap={snap}
      data-dragging={dragHeight !== null || undefined}
      style={dragHeight !== null ? { height: `${Math.round(dragHeight)}px` } : undefined}
    >
      <div
        className={styles.header}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClick={() => {
          if (snap === 'peek') setSnap('half');
        }}
      >
        <div className={styles.handle} aria-hidden="true" />
        <div className={styles.tabsRow}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              type="button"
              className={active === tab.key ? styles.tabOn : styles.tab}
              aria-pressed={active === tab.key}
              onClick={() => selectTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
          <button
            type="button"
            className={styles.snapBtn}
            aria-label={snap === 'full' ? 'Shrink panel' : 'Expand panel'}
            aria-expanded={snap !== 'peek'}
            onClick={() => setSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half')}
          >
            {snap === 'full' ? '⌄' : '⌃'}
          </button>
        </div>
      </div>
      {/* draft-sheet-body is a global hook: inner panes cap their own height
          against the page viewport, which must relax inside the sheet (the
          sheet body is the scroller here). See index.css. */}
      <div className={`${styles.body} draft-sheet-body`}>{children}</div>
    </div>
  );
}
