// Sleeper pads unranked players with 999 and then averages, so a player drafted
// in only a few mocks lands at 600-700 (Buffalo Bills: 683.5 half PPR vs 215.7
// PPR). Real ADP density is a flat ~25 players per 25 picks through ~400, then
// the padded rows pile up, so anything at or past this cap is a placeholder.
export const SLEEPER_ADP_CAP = 400;

export function cleanSleeperAdp(v: number | null | undefined): number | null {
  return typeof v === 'number' && v < SLEEPER_ADP_CAP ? v : null;
}
