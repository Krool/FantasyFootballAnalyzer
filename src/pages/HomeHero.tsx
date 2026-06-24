import styles from './HomePage.module.css';

// Static hero. Kept free of hooks, browser APIs, and the league form so it can
// be server-rendered into the initial HTML at build time (see
// scripts/prerender.tsx) and crawlers see the real copy. The manifesto lives
// in HomeManifesto so the page can render it below the form. Single source of
// truth: HomePage and the prerender both render this.
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
      <nav className={styles.heroLinks} aria-label="Start here">
        <a href={`${base}rankings`}>Draft Rankings</a>
        <a href={`${base}draft-room`}>Mock Draft</a>
        <span className={styles.heroLinksNote}>No login required</span>
      </nav>
    </header>
  );
}
