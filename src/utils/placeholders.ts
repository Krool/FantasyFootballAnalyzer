// Platform placeholder names for players we couldn't resolve. ESPN produces
// "Player 12345" (and "Player -16004" for DSTs); Yahoo produces dotted keys
// like "Player 449.p.12345". One predicate, used everywhere, so the two
// regex shapes that drifted apart across components can't drift again.

const ESPN_PLACEHOLDER = /^Player\s+-?\d+$/;
const YAHOO_PLACEHOLDER = /^Player\s+\d+\.[a-z]\.\d+$/i;

export function isPlaceholderPlayer(name: string): boolean {
  return ESPN_PLACEHOLDER.test(name) || YAHOO_PLACEHOLDER.test(name);
}
