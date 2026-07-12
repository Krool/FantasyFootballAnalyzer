import { POOL } from '@/data/draftPool';
import styles from './HomePage.module.css';

// Static hero. Kept free of hooks, browser APIs, and the league form so it can
// be server-rendered into the initial HTML at build time (see
// scripts/prerender.tsx) and crawlers see the real copy. The manifesto lives
// in HomeManifesto so the page can render it below the form. Single source of
// truth: HomePage and the prerender both render this.
//
// POOL is safe to use here: it's a static JSON import (no runtime fetch), and
// it's already in the homepage's eager bundle via GuestEntry -> guestLeague,
// so the board card below costs no extra bytes.

// Top of the bundled consensus board, refreshed daily by the rankings Action.
const TOP_OF_BOARD = [...POOL.players]
  .sort((a, b) => a.overallRank - b.overallRank)
  .slice(0, 5);

// Explicit locale + UTC so the prerendered HTML doesn't depend on the build
// machine's locale or timezone.
const UPDATED = new Date(POOL.generatedAt).toLocaleDateString('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function HomeHero() {
  // import.meta.env.BASE_URL ('/' on the custom-domain apex) in both the live
  // build and the SSR prerender, so these links resolve either way. Plain
  // anchors (not react-router Link) because HomeHero is rendered outside a
  // Router during prerender; a full navigation to the prerendered target is
  // fine. These are the homepage's only internal links to the public draft-prep
  // pages, so they pass crawl equity and give no-login visitors a way in.
  const base = import.meta.env.BASE_URL;
  return (
    <header className={styles.hero}>
      <div className={styles.heroGrid}>
        <div>
          <h1 className={styles.title}>Fantasy Football Analyzer</h1>
          <p className={styles.subtitle}>
            I built this to prep for my own drafts and review them after.
            Daily consensus rankings, mock drafts, a live draft room, trade
            verdicts, and league history for Sleeper, ESPN, and Yahoo leagues.
            Free, open source, no account. Enjoy.
          </p>
          <nav className={styles.heroLinks} aria-label="Start here">
            <a href={`${base}rankings`}>Draft Rankings</a>
            <a href={`${base}draft-room`}>Mock Draft</a>
            <span className={styles.heroLinksNote}>No login required</span>
          </nav>
        </div>

        <aside
          className={styles.board}
          aria-label={`Top of the ${POOL.season} draft board`}
        >
          <span className={styles.boardKicker}>
            ▌ Top of the {POOL.season} board
          </span>
          <ol className={styles.boardList}>
            {TOP_OF_BOARD.map(p => (
              <li key={p.id} className={styles.boardRow}>
                <span className={styles.boardRank}>{p.overallRank}</span>
                <span className={styles.boardName}>{p.name}</span>
                <span className={styles.boardMeta}>
                  {p.pos} · {p.team}
                </span>
                <span className={styles.boardValue}>${p.baseValue ?? 1}</span>
              </li>
            ))}
          </ol>
          <div className={styles.boardFoot}>
            <span>
              Updated {UPDATED} · ${POOL.baseline.budget} auction
            </span>
            <a href={`${base}rankings`}>Full board →</a>
          </div>
        </aside>
      </div>
    </header>
  );
}
