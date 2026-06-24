// Single source of truth for the per-position rankings landing pages
// (/rankings/qb .. /rankings/flex). Consumed by the live routes (src/App.tsx),
// the board heading (src/pages/RankingsPage.tsx), and the build-time prerender
// (scripts/prerender.tsx). vite.config.ts keeps its own RANKINGS_SLUGS list
// because the tsconfig project boundary (tsconfig.node.json is composite and
// lists only vite.config.ts) forbids it importing from src/; keep that list in
// sync with this one. Pure data, no imports, so the SSR prerender can load it.

export interface RankingsVariant {
  /** URL segment, lowercase (e.g. 'qb'). */
  slug: string;
  /** POOL player position code; 'FLEX' collapses RB/WR/TE. */
  pos: string;
  /** Long-form heading label (e.g. 'Quarterback'). */
  label: string;
}

export const RANKINGS_VARIANTS: RankingsVariant[] = [
  { slug: 'qb', pos: 'QB', label: 'Quarterback' },
  { slug: 'rb', pos: 'RB', label: 'Running Back' },
  { slug: 'wr', pos: 'WR', label: 'Wide Receiver' },
  { slug: 'te', pos: 'TE', label: 'Tight End' },
  { slug: 'k', pos: 'K', label: 'Kicker' },
  { slug: 'dst', pos: 'DST', label: 'Defense' },
  { slug: 'flex', pos: 'FLEX', label: 'Flex' },
];

/** Slug list for the sitemap and route generation. */
export const RANKINGS_SLUGS = RANKINGS_VARIANTS.map(v => v.slug);

// Map lookups (not plain-object indexing) so prototype-chain slugs like
// 'constructor' or '__proto__' resolve to undefined, not an inherited member.
const POS_BY_SLUG = new Map(RANKINGS_VARIANTS.map(v => [v.slug, v.pos]));
const LABEL_BY_POS = new Map(RANKINGS_VARIANTS.map(v => [v.pos, v.label]));

/** Position code for a URL slug, or undefined for an unknown slug. */
export function posForSlug(slug: string | undefined): string | undefined {
  return slug ? POS_BY_SLUG.get(slug.toLowerCase()) : undefined;
}

/** Long-form label for a position code; falls back to the code itself. */
export function labelForPos(pos: string): string {
  return LABEL_BY_POS.get(pos) ?? pos;
}

/** The flex filter collapses these three positions into one view. */
export const FLEX_POSITIONS = new Set(['RB', 'WR', 'TE']);
