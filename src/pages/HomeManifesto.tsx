import styles from './HomePage.module.css';

// Static manifesto block. Pure (no hooks or browser APIs) so the build-time
// prerender (scripts/prerender.tsx) can bake it into the first-byte HTML.
// Rendered below the league form on the live page; the prerender has no form,
// so it renders this straight after the hero.
export function HomeManifesto() {
  return (
    <aside className={styles.manifesto} aria-label="About this project">
      <span className={styles.manifestoKicker}>★ Completely Free & Open Source</span>
      <p className={styles.manifestoBody}>
        No accounts. No ads. No server keeps your league data, only anonymized
        error logs I use to fix bugs.
      </p>
      <p className={styles.manifestoBody}>
        Your credentials stay in your browser and are passed through to
        Sleeper, ESPN, or Yahoo to fetch your league. ESPN cookies clear when
        the tab closes; a Yahoo login is remembered on this device until you
        log out. Your last league ID is kept on this device so reconnecting
        is one click.
      </p>
      <a
        className={styles.manifestoLink}
        href="https://github.com/Krool/FantasyFootballAnalyzer"
        target="_blank"
        rel="noopener noreferrer"
      >
        View source on GitHub →
      </a>
    </aside>
  );
}
