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
  // Present on the single-draft fetch. slot_to_roster_id seats each draft
  // slot; reversal_round >= 3 is Sleeper's third-round reversal.
  slot_to_roster_id?: Record<string, number | null> | null;
  // user_id -> draft slot. Set as soon as the order is drawn, so it names the
  // user's seat before a single pick exists.
  draft_order?: Record<string, number> | null;
  settings?: { rounds?: number; teams?: number; reversal_round?: number } | null;
}

export interface SleeperLivePick {
  player_id: string;
  roster_id: number | null;
  picked_by: string; // user id; empty string for unowned slots
  round: number;
  pick_no: number;
  draft_slot: number;
  is_keeper: boolean | null;
  // Sleeper repeats the drafted player's identity here, which is the only
  // thing we can name a pick by when its id isn't in the bundled pool.
  metadata?: {
    amount?: string;
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string;
  };
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

// A single draft by id. Sleeper lists mock drafts under neither the league
// nor the user, so a mock is only reachable this way - by the id in its URL.
export function getDraft(draftId: string): Promise<SleeperDraftStub> {
  return fetchJson(`/draft/${draftId}`);
}

// Accepts a full sleeper.com draft URL or a bare id.
export function parseDraftId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{6,}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/\/draft\/[a-z]+\/(\d{6,})/i);
  return match ? match[1] : null;
}
