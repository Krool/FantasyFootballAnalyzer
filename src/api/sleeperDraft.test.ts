import { describe, it, expect, afterEach, vi } from 'vitest';
import { getLeagueDrafts, getLiveDraftPicks } from './sleeperDraft';

const LEAGUE_ID = 'L1';
const DRAFT_ID = 'D1';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as Response;
}

function errorResponse(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
    json: async () => ({ error: statusText }),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sleeperDraft getLeagueDrafts', () => {
  it('returns the parsed drafts for a league', async () => {
    const drafts = [
      { draft_id: DRAFT_ID, status: 'drafting', type: 'snake', season: '2026', start_time: 123 },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(drafts)));

    expect(await getLeagueDrafts(LEAGUE_ID)).toEqual(drafts);
  });

  it('rejects with a descriptive message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(404, 'Not Found')));

    await expect(getLeagueDrafts(LEAGUE_ID)).rejects.toThrow(
      `Sleeper 404 for /league/${LEAGUE_ID}/drafts`,
    );
  });
});

describe('sleeperDraft getLiveDraftPicks', () => {
  it('returns the parsed picks for a draft', async () => {
    const picks = [
      {
        player_id: 'p1',
        roster_id: 1,
        picked_by: 'u1',
        round: 1,
        pick_no: 1,
        is_keeper: null,
      },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(picks)));

    expect(await getLiveDraftPicks(DRAFT_ID)).toEqual(picks);
  });

  it('rejects with a descriptive message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(500, 'Internal Server Error')));

    await expect(getLiveDraftPicks(DRAFT_ID)).rejects.toThrow(
      `Sleeper 500 for /draft/${DRAFT_ID}/picks`,
    );
  });
});
