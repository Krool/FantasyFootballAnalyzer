import styles from './HomePage.module.css';

// Static hero. Kept free of hooks, browser APIs, and the league form so it can
// be server-rendered into the initial HTML at build time (see
// scripts/prerender.tsx) and crawlers see the real copy. The manifesto lives
// in HomeManifesto so the page can render it below the form. Single source of
// truth: HomePage and the prerender both render this.
export function HomeHero() {
  return (
    <header className={styles.hero}>
      <h1 className={styles.title}>
        Fantasy
        <br />
        Football
        <br />
        Analyzer
      </h1>
      <p className={styles.subtitle}>
        Mock drafts, draft grades, a live draft room, trade verdicts,
        waiver receipts, luck scores, and a trophy case for your league.
        Bring your league ID. Settle the group chat.
      </p>
    </header>
  );
}
