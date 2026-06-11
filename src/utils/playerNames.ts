// Name matching across draft data sources (FantasyPros rankings, salary cap
// value exports, and later Yahoo/ESPN/Sleeper value files). Sources disagree
// on suffixes ("James Cook III" vs "James Cook"), punctuation ("A.J.",
// "D'Andre"), and casing. Team is never part of the match key because players
// change teams between export dates; it is only a tiebreaker when two
// different players normalize to the same name.

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

export function normalizeName(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/-/g, '')
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(' ');
}

// "RB12" -> "RB", "DST3" -> "DST", "D/ST" -> "DST"
export function basePosition(pos: string): string {
  return pos.toUpperCase().replace(/\//g, '').replace(/\d+$/, '');
}

export function matchKey(name: string, pos?: string): string {
  return pos ? `${normalizeName(name)}|${basePosition(pos)}` : normalizeName(name);
}

export interface NameCandidate {
  name: string;
  pos?: string;
  team?: string;
}

// Exact normalized-name match (plus position when both sides have one);
// team breaks ties only. Returns null on no match or unresolvable ambiguity
// so callers can fail loudly instead of joining the wrong player.
export function matchPlayer<T extends NameCandidate>(
  query: NameCandidate,
  candidates: T[],
): T | null {
  const queryName = normalizeName(query.name);
  let hits = candidates.filter(c => normalizeName(c.name) === queryName);
  if (query.pos) {
    const queryPos = basePosition(query.pos);
    const posHits = hits.filter(c => c.pos && basePosition(c.pos) === queryPos);
    if (posHits.length > 0) hits = posHits;
  }
  if (hits.length === 1) return hits[0];
  if (hits.length > 1 && query.team) {
    const teamHits = hits.filter(c => c.team === query.team);
    if (teamHits.length === 1) return teamHits[0];
  }
  return null;
}
