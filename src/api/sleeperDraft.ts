// Minimal Sleeper draft endpoints for live draft sync. Deliberately
// separate from sleeper.ts (the full league loader): these two calls are
// polled every few seconds on draft day and carry no auth.

const BASE_URL = 'https://api.sleeper.app/v1';

export interface SleeperDraftStub {
  draft_id: string;
  status: 'pre_draft' | 'drafting' | 'paused' | 'complete';
  type: 'snake' | 'auction' | 'linear';
  season: string;
  start_time: number | null;
}

export interface SleeperLivePick {
  player_id: string;
  roster_id: number | null;
  picked_by: string; // user id; empty string for unowned slots
  round: number;
  pick_no: number;
  is_keeper: boolean | null;
  metadata?: { amount?: string };
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`Sleeper ${res.status} for ${path}`);
  return res.json();
}

export function getLeagueDrafts(leagueId: string): Promise<SleeperDraftStub[]> {
  return fetchJson(`/league/${leagueId}/drafts`);
}

export function getLiveDraftPicks(draftId: string): Promise<SleeperLivePick[]> {
  return fetchJson(`/draft/${draftId}/picks`);
}
