// Users paste the whole league URL at least as often as the bare ID (the
// connect form's hint text points them at the URL). Pull the ID out of the
// common shapes; anything unrecognized passes through so typing is never
// fought.
export function normalizeLeagueId(raw: string): string {
  const v = raw.trim();
  if (/^\d+$/.test(v)) return v;
  const fromPath = v.match(/leagues?\/(\d{4,20})/i); // sleeper.com/leagues/<id>/...
  if (fromPath) return fromPath[1];
  const fromQuery = v.match(/[?&]leagueId=(\d{4,20})/i); // fantasy.espn.com/...?leagueId=<id>
  if (fromQuery) return fromQuery[1];
  return raw;
}
