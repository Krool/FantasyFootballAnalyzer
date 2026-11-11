import { LEGAL_CONTACT, type LegalPageContent } from './legalPages';
import styles from './LegalPage.module.css';

// The /privacy and /terms pages. Pure and hook-free, like ToolLanding, so the
// build-time prerender (scripts/prerender.tsx) bakes the same markup the live
// route renders and GitHub Pages serves a real HTTP-200 file on a direct URL.
// Plain anchors (not react-router Link) because the prerender renders this
// outside a Router. Copy lives in legalPages.ts.
export function LegalPage({ content }: { content: LegalPageContent }) {
  const base = import.meta.env.BASE_URL;
  const other = content.path === 'privacy'
    ? { href: `${base}terms`, label: 'Terms of use' }
    : { href: `${base}privacy`, label: 'Privacy' };
  return (
    <div className={styles.page}>
      <div className={`container ${styles.column}`}>
        <header className={styles.hero}>
          <span className={styles.kicker}>{content.kicker}</span>
          <h1 className={styles.heading}>{content.heading}</h1>
          <p className={styles.updated}>
            Last updated <time dateTime={content.updated}>{content.updated}</time>
          </p>
          <p className={styles.intro}>{content.intro}</p>
        </header>

        {content.sections.map(section => (
          <section key={section.h} className={styles.section}>
            <h2 className={styles.sectionTitle}>{section.h}</h2>
            {section.body.map((block, i) =>
              Array.isArray(block) ? (
                <ul key={i} className={styles.list}>
                  {block.map(item => <li key={item}>{item}</li>)}
                </ul>
              ) : (
                <p key={i} className={styles.para}>{block}</p>
              ),
            )}
            {section.links && (
              <ul className={styles.links}>
                {section.links.map(link => (
                  <li key={link.href}>
                    <a href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <p className={styles.para}>
          Questions: <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>
        </p>
        <p className={styles.footLinks}>
          <a href={other.href}>{other.label}</a>
          <a href={base}>Home</a>
        </p>
      </div>
    </div>
  );
}
