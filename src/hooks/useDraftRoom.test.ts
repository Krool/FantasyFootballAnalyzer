// Live-draft-day code: a reducer bug here corrupts a real draft log. These
// tests drive the hook through renderHook because the reducer is private.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraftRoom, leagueKeyFor } from './useDraftRoom';
import { POOL } from '@/data/draftPool';
import { loadDraftArchive } from '@/utils/draftRoomCache';
import type { League } from '@/types';

function makeLeague(): League {
  return {
    id: 'test-league',
    platform: 'sleeper',
    name: 'Test League',
    season: POOL.season - 1,
    draftType: 'snake',
    teams: [
      { id: 't1', name: 'Alpha', wins: 0, losses: 0, ties: 0 },
      { id: 't2', name: 'Bravo', wins: 0, losses: 0, ties: 0 },
    ] as League['teams'],
    scoringType: 'half_ppr',
    totalTeams: 2,
    isLoaded: true,
  };
}

// Tiny rosters keep total picks manageable: 2 bench slots = 2 rounds, and
// bench-only means any position is legal (the top of the pool is all
// RB/WR, which a 1-QB/1-bench roster would reject on the second pick).
const TINY_SLOTS = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 2, IR: 0 };

beforeEach(() => {
  localStorage.clear();
});

describe('useDraftRoom', () => {
  it('starts in setup with a config derived from the league', () => {
    const { result } = renderHook(() => useDraftRoom(makeLeague()));
    expect(result.current.phase).toBe('setup');
    expect(result.current.config.teams.map(t => t.name)).toEqual(['Alpha', 'Bravo']);
    expect(result.current.config.season).toBe(POOL.season);
  });

  it('preselects the team the platform marked as the user\'s own', () => {
    const league = makeLeague();
    league.teams[1].isMyTeam = true;
    const { result } = renderHook(() => useDraftRoom(league));
    expect(result.current.config.myTeamId).toBe('t2');
  });

  it('falls back to the first team when no team is marked as mine', () => {
    const { result } = renderHook(() => useDraftRoom(makeLeague()));
    expect(result.current.config.myTeamId).toBe('t1');
  });

  it('seats teams in the upcoming draft\'s pick order when the platform set one', () => {
    const league = makeLeague();
    league.upcomingDraft = { draftId: 'd1', order: ['t2', 't1'], keepers: [] };
    const { result } = renderHook(() => useDraftRoom(league));
    expect(result.current.config.teams.map(t => t.id)).toEqual(['t2', 't1']);
  });

  it('appends teams the platform order does not mention, in league order', () => {
    const league = makeLeague();
    league.teams = [
      ...league.teams,
      { id: 't3', name: 'Charlie', wins: 0, losses: 0, ties: 0 } as League['teams'][number],
    ];
    league.upcomingDraft = { draftId: 'd1', order: ['t3'], keepers: [] };
    const { result } = renderHook(() => useDraftRoom(league));
    expect(result.current.config.teams.map(t => t.id)).toEqual(['t3', 't1', 't2']);
  });

  it('seeds the auction budget from the league when the platform exposed it', () => {
    const league = makeLeague();
    league.draftType = 'auction';
    league.auctionBudget = 300;
    const { result } = renderHook(() => useDraftRoom(league));
    expect(result.current.config.budget).toBe(300);
  });

  it("prices an ESPN league's room off the ESPN market, everyone else off consensus", () => {
    const espn = makeLeague();
    espn.platform = 'espn';
    expect(renderHook(() => useDraftRoom(espn)).result.current.config.valueSource).toBe('espn');
    const yahoo = makeLeague();
    yahoo.platform = 'yahoo';
    expect(renderHook(() => useDraftRoom(yahoo)).result.current.config.valueSource).toBe('yahoo');
    expect(renderHook(() => useDraftRoom(makeLeague())).result.current.config.valueSource).toBe('consensus');
    const guest = makeLeague();
    guest.platform = 'espn';
    guest.isGuest = true;
    expect(renderHook(() => useDraftRoom(guest)).result.current.config.valueSource).toBe('consensus');
  });

  it('defaults the budget to $200 when the platform did not expose one', () => {
    const { result } = renderHook(() => useDraftRoom(makeLeague()));
    expect(result.current.config.budget).toBe(200);
  });

  it('auto-enables the TE premium toggle when the league pays a TE bonus', () => {
    const league = makeLeague();
    league.tePremiumPerReception = 0.5;
    const { result } = renderHook(() => useDraftRoom(league));
    expect(result.current.config.tePremium).toBe(true);
  });

  it('leaves the TE premium toggle off without a detected bonus', () => {
    const { result } = renderHook(() => useDraftRoom(makeLeague()));
    expect(result.current.config.tePremium).toBeFalsy();
  });

  it('refuses to start with zero rounds or a sub-$1/slot auction budget', () => {
    const { result } = renderHook(() => useDraftRoom(makeLeague()));
    act(() => {
      result.current.updateConfig({
        rosterSlots: { ...TINY_SLOTS, QB: 0, BENCH: 0 },
      });
    });
    act(() => result.current.start());
    expect(result.current.phase).toBe('setup');

    act(() => {
      result.current.updateConfig({
        draftType: 'auction',
        rosterSlots: TINY_SLOTS,
        budget: 1, // 2 rounds need at least $2
      });
    });
    act(() => result.current.start());
    expect(result.current.phase).toBe('setup');

    act(() => result.current.updateConfig({ budget: 200 }));
    act(() => result.current.start());
    expect(result.current.phase).toBe('drafting');
  });

  it('logs picks, enforces validation, and completes at total picks', () => {
    const { result } = renderHook(() => useDraftRoom(makeLeague()));
    act(() => result.current.updateConfig({ rosterSlots: TINY_SLOTS }));
    act(() => result.current.start());

    const [p1, p2, p3, p4] = POOL.players;
    let error: string | null = null;

    act(() => {
      error = result.current.logEvent({ kind: 'snake_pick', playerId: p1.id, teamId: 't1' });
    });
    expect(error).toBeNull();

    // Drafting the same player twice is rejected.
    act(() => {
      error = result.current.logEvent({ kind: 'snake_pick', playerId: p1.id, teamId: 't2' });
    });
    expect(error).not.toBeNull();
    expect(result.current.events).toHaveLength(1);

    act(() => {
      result.current.logEvent({ kind: 'snake_pick', playerId: p2.id, teamId: 't2' });
    });
    act(() => {
      result.current.logEvent({ kind: 'snake_pick', playerId: p3.id, teamId: 't2' });
    });
    act(() => {
      result.current.logEvent({ kind: 'snake_pick', playerId: p4.id, teamId: 't1' });
    });

    expect(result.current.phase).toBe('complete');
    expect(result.current.derived.pickCount).toBe(4);
  });

  it('the reducer drops events validated against a stale board (racing timers)', () => {
    const { result } = renderHook(() => useDraftRoom(makeLeague()));
    act(() => result.current.updateConfig({ rosterSlots: TINY_SLOTS }));
    act(() => result.current.start());

    const [p1, p2] = POOL.players;
    // Three calls through one render's closure, like a mock AI timer firing
    // just before its cleanup: each pre-validates against the same pre-pick
    // board and passes, so only the reducer can stop the log from corrupting.
    // One duplicated or off-turn event shifts the snake turn math for every
    // later pick and eventually deadlocks the mock (a full team on the clock).
    act(() => {
      const log = result.current.logEvent;
      log({ kind: 'snake_pick', playerId: p1.id, teamId: 't1' });
      log({ kind: 'snake_pick', playerId: p1.id, teamId: 't1' }); // duplicate player
      log({ kind: 'snake_pick', playerId: p2.id, teamId: 't1' }); // off-turn: t2 is up
    });
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toMatchObject({ playerId: p1.id, teamId: 't1' });
    expect(result.current.derived.onTheClockId).toBe('t2');
  });

  it('logEvents ingests a batch with distinct seqs and validates against the mid-batch board', () => {
    const { result } = renderHook(() => useDraftRoom(makeLeague()));
    act(() => result.current.updateConfig({ rosterSlots: TINY_SLOTS }));
    act(() => result.current.start());

    const [p1, p2] = POOL.players;

    // A batch that repeats a player must be rejected at the SECOND entry:
    // per-event validation against the pre-batch board would let it through.
    let rejection: { index: number; error: string } | null = null;
    act(() => {
      rejection = result.current.logEvents([
        { kind: 'snake_pick', playerId: p1.id, teamId: 't1' },
        { kind: 'snake_pick', playerId: p1.id, teamId: 't2' },
      ]);
    });
    expect(rejection).toEqual({ index: 1, error: expect.stringMatching(/already been drafted/i) });
    // The valid prefix (the first pick) landed.
    expect(result.current.events).toHaveLength(1);

    act(() => {
      rejection = result.current.logEvents([{ kind: 'snake_pick', playerId: p2.id, teamId: 't2' }]);
    });
    expect(rejection).toBeNull();

    // Batched events carry consecutive, unique seqs (they persist and drive
    // spark dedup), even though both dispatches shared one render's closure.
    expect(result.current.events.map(e => e.seq)).toEqual([0, 1]);
  });

  it('undo pops the last event and reopens a completed draft', () => {
    const { result } = renderHook(() => useDraftRoom(makeLeague()));
    act(() => result.current.updateConfig({ rosterSlots: TINY_SLOTS }));
    act(() => result.current.start());
    const ids = POOL.players.slice(0, 4).map(p => p.id);
    const order = ['t1', 't2', 't2', 't1'];
    ids.forEach((id, i) => {
      act(() => {
        result.current.logEvent({ kind: 'snake_pick', playerId: id, teamId: order[i] });
      });
    });
    expect(result.current.phase).toBe('complete');

    act(() => result.current.undo());
    expect(result.current.phase).toBe('drafting');
    expect(result.current.events).toHaveLength(3);
  });

  it('persists the session and resumes it', () => {
    const league = makeLeague();
    const first = renderHook(() => useDraftRoom(league));
    act(() => first.result.current.updateConfig({ rosterSlots: TINY_SLOTS }));
    act(() => first.result.current.start());
    act(() => {
      first.result.current.logEvent({
        kind: 'snake_pick',
        playerId: POOL.players[0].id,
        teamId: 't1',
      });
    });
    first.unmount();

    const second = renderHook(() => useDraftRoom(league));
    expect(second.result.current.resumable).not.toBeNull();
    act(() => second.result.current.resume());
    expect(second.result.current.phase).toBe('drafting');
    expect(second.result.current.events).toHaveLength(1);
  });

  it('drops a saved session whose player ids the pool no longer knows', () => {
    const league = makeLeague();
    const key = `ffa:draftroom:v1:${leagueKeyFor(league)}`;
    localStorage.setItem(
      key,
      JSON.stringify({
        config: { leagueKey: leagueKeyFor(league), teams: [], rosterSlots: TINY_SLOTS },
        events: [{ kind: 'snake_pick', seq: 0, ts: 1, playerId: 'fp-12', teamId: 't1' }],
        phase: 'drafting',
        savedAt: 1,
      }),
    );
    const { result } = renderHook(() => useDraftRoom(league));
    expect(result.current.resumable).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('archives a completed draft and reset does not destroy the archive', () => {
    const league = makeLeague();
    const { result } = renderHook(() => useDraftRoom(league));
    act(() => result.current.updateConfig({ rosterSlots: TINY_SLOTS }));
    act(() => result.current.start());
    const ids = POOL.players.slice(0, 4).map(p => p.id);
    const order = ['t1', 't2', 't2', 't1'];
    ids.forEach((id, i) => {
      act(() => {
        result.current.logEvent({ kind: 'snake_pick', playerId: id, teamId: order[i] });
      });
    });
    expect(result.current.phase).toBe('complete');
    expect(loadDraftArchive(leagueKeyFor(league))).toHaveLength(1);

    act(() => result.current.reset());
    expect(result.current.phase).toBe('setup');
    expect(loadDraftArchive(leagueKeyFor(league))).toHaveLength(1);
  });

  it('auto-logs keeper picks when the draft reaches their round', () => {
    const league = makeLeague();
    const { result } = renderHook(() => useDraftRoom(league));
    const keeperPlayer = POOL.players[5];
    act(() => {
      result.current.updateConfig({
        rosterSlots: TINY_SLOTS,
        keepers: [{ teamId: 't1', playerId: keeperPlayer.id, costRound: 1 }],
      });
    });
    act(() => result.current.start());

    // t1 opens round 1; their keeper consumes the pick automatically.
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toMatchObject({
      kind: 'snake_pick',
      playerId: keeperPlayer.id,
      teamId: 't1',
      isKeeper: true,
    });
  });

  it('auto-logs MULTIPLE keepers for one team, each at its own round', () => {
    // The auto-log matches one keeper per (team, round); two keepers with
    // distinct rounds must both land as the draft reaches them. This is the
    // multi-keeper path the single-keeper test above never touches.
    const league = makeLeague();
    const { result } = renderHook(() => useDraftRoom(league));
    const [keeperA, keeperB] = [POOL.players[5], POOL.players[6]];
    act(() => {
      result.current.updateConfig({
        rosterSlots: TINY_SLOTS, // 2 rounds
        keepers: [
          { teamId: 't1', playerId: keeperA.id, costRound: 1 },
          { teamId: 't1', playerId: keeperB.id, costRound: 2 },
        ],
      });
    });
    act(() => result.current.start());

    // Pick 1 (t1, round 1): keeper A logs itself.
    expect(result.current.events).toHaveLength(1);
    // t2 makes picks 2 and 3 (the snake turn)...
    act(() => {
      result.current.logEvent({ kind: 'snake_pick', playerId: POOL.players[0].id, teamId: 't2' });
    });
    act(() => {
      result.current.logEvent({ kind: 'snake_pick', playerId: POOL.players[1].id, teamId: 't2' });
    });
    // ...and pick 4 (t1, round 2) is keeper B, logged automatically.
    expect(result.current.phase).toBe('complete');
    const t1Picks = result.current.derived.teams.get('t1')!.picks;
    expect(t1Picks.map(p => p.player.id).sort()).toEqual([keeperA.id, keeperB.id].sort());
    expect(t1Picks.every(p => p.event.isKeeper)).toBe(true);
    expect(result.current.derived.reservedPlayerIds.size).toBe(0);
  });

  it('refuses to start with a keeper setup the draft cannot honor', () => {
    const league = makeLeague();
    const { result } = renderHook(() => useDraftRoom(league));
    const [keeperA, keeperB] = [POOL.players[5], POOL.players[6]];

    // Snake: two keepers on one team sharing a cost round would leave the
    // second reserved forever (the auto-log matches one per team+round).
    act(() => {
      result.current.updateConfig({
        rosterSlots: TINY_SLOTS,
        keepers: [
          { teamId: 't1', playerId: keeperA.id, costRound: 1 },
          { teamId: 't1', playerId: keeperB.id, costRound: 1 },
        ],
      });
    });
    act(() => result.current.start());
    expect(result.current.phase).toBe('setup');

    // Auction: keeper prices the budget cannot cover would be silently
    // repriced by the auto-log clamp.
    act(() => {
      result.current.updateConfig({
        draftType: 'auction',
        budget: 200,
        keepers: [
          { teamId: 't1', playerId: keeperA.id, costRound: 1, keeperPrice: 150 },
          { teamId: 't1', playerId: keeperB.id, costRound: 1, keeperPrice: 60 },
        ],
      });
    });
    act(() => result.current.start());
    expect(result.current.phase).toBe('setup');

    // Prices that fit (150 + 50 = 200 across both roster spots) start fine.
    act(() => {
      result.current.updateConfig({
        keepers: [
          { teamId: 't1', playerId: keeperA.id, costRound: 1, keeperPrice: 150 },
          { teamId: 't1', playerId: keeperB.id, costRound: 1, keeperPrice: 50 },
        ],
      });
    });
    act(() => result.current.start());
    expect(result.current.phase).toBe('drafting');
  });
});
