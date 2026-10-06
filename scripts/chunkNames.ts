// Safari content blockers (and the uBlock/AdGuard lists behind them) block
// requests by URL substring, and a built chunk's URL carries its module's
// name. src/utils/consensus.ts shipped as assets/consensus-<hash>.js, which
// the cookie-banner lists block as `consensu` (consensu.org is the IAB consent
// CDN), so every page importing it died in iOS Safari with blockers on while
// Chrome on the same phone loaded fine (owner-reported 2026-10-05). The
// filename is ours to choose, so never ship one a filter list can match.

// Substrings (case-insensitive) that common filter lists key on: consent
// managers, ad servers, trackers. Short ad-words only as whole name segments,
// so "loads" or "readme" never trip it.
const RISKY = /consen[st]|cookie|gdpr|ccpa|banner|advert|analytic|track|beacon|sponsor|popup|pixel|affiliate|doubleclick|(^|[-_.])ads?([-_.]|$)/i;

export function blockerSafeName(name: string): string {
  return RISKY.test(name) ? 'chunk' : name;
}
