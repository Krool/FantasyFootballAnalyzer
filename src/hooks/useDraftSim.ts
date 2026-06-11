import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoolPlayer } from '@/types/draft';
import { inflateValue } from '@/utils/inflation';
import { roundForPick } from '@/utils/snakeOrder';
import { mulberry32, simAuctionResult, simNomination, simSnakePick } from '@/utils/draftSim';
import type { UseDraftRoomReturn } from './useDraftRoom';

const TICK_MS = 900;

export interface PendingNomination {
  nominatorId: string;
  player: PoolPlayer;
}

export interface UseDraftSimReturn {
  // Auction mock: the nomination currently up for bidding.
  pending: PendingNomination | null;
  // Auction mock: it's the user's turn to nominate and nothing is pending.
  awaitingMyNomination: boolean;
  nominate: (player: PoolPlayer) => void;
  // Run the bidding for the pending nomination. 0 = pass.
  resolve: (myMaxBid: number) => void;
}

// Drives mock drafts: auto-picks for AI teams in snake, auto-nominates and
// settles bidding in auctions. No-ops entirely in live mode.
export function useDraftSim(room: UseDraftRoomReturn): UseDraftSimReturn {
  const { config, derived, scaledValues, inflation, logEvent, phase } = room;
  const [pending, setPending] = useState<PendingNomination | null>(null);
  const rngRef = useRef<() => number>(mulberry32(Date.now() & 0xffffffff));

  const active = phase === 'drafting' && config.mode === 'mock';
  const isMyTurn = derived.onTheClockId === config.myTeamId;

  // Drop a stale pending nomination if its player got drafted (e.g. undo
  // shenanigans) or the draft left mock/drafting state.
  useEffect(() => {
    if (!active && pending) setPending(null);
    if (pending && derived.draftedPlayerIds.has(pending.player.id)) setPending(null);
  }, [active, pending, derived.draftedPlayerIds]);

  // Snake: auto-pick for AI teams on a timer; the user picks via the logger.
  useEffect(() => {
    if (!active || config.draftType !== 'snake' || isMyTurn || !derived.onTheClockId) return;
    const teamId = derived.onTheClockId;
    const timer = setTimeout(() => {
      const team = derived.teams.get(teamId);
      if (!team) return;
      const round = roundForPick(derived.pickCount, config.teams.length);
      const totalRounds = config.rounds;
      const player = simSnakePick(derived.available, scaledValues, team, round, totalRounds, rngRef.current);
      if (player) logEvent({ kind: 'snake_pick', playerId: player.id, teamId });
    }, TICK_MS);
    return () => clearTimeout(timer);
  }, [active, config, isMyTurn, derived, scaledValues, logEvent]);

  // Auction: AI nominator puts a player up after a beat. The user's own
  // nominations come through nominate().
  useEffect(() => {
    if (!active || config.draftType !== 'auction' || pending || isMyTurn || !derived.onTheClockId) return;
    const nominatorId = derived.onTheClockId;
    const timer = setTimeout(() => {
      const nominator = derived.teams.get(nominatorId);
      if (!nominator) return;
      const player = simNomination(
        derived.available,
        scaledValues,
        nominator,
        [...derived.teams.values()],
        rngRef.current,
      );
      if (player) setPending({ nominatorId, player });
    }, TICK_MS);
    return () => clearTimeout(timer);
  }, [active, config.draftType, pending, isMyTurn, derived, scaledValues]);

  const nominate = useCallback(
    (player: PoolPlayer) => {
      if (!active || pending) return;
      setPending({ nominatorId: config.myTeamId, player });
    },
    [active, pending, config.myTeamId],
  );

  const resolve = useCallback(
    (myMaxBid: number) => {
      if (!pending) return;
      // AI willingness tracks the room, not the sheet: when sales have run
      // hot the remaining players cost more, and vice versa.
      const expected = inflateValue(scaledValues.get(pending.player.id) ?? 1, inflation.rate);
      const result = simAuctionResult(
        pending.player,
        expected,
        [...derived.teams.values()],
        derived.available,
        config.myTeamId,
        myMaxBid,
        rngRef.current,
      );
      if (result.winnerId) {
        logEvent({
          kind: 'auction_sale',
          playerId: pending.player.id,
          nominatedById: pending.nominatorId,
          wonById: result.winnerId,
          price: result.price,
        });
      }
      setPending(null);
    },
    [pending, scaledValues, inflation.rate, derived.teams, derived.available, config.myTeamId, logEvent],
  );

  return {
    pending,
    awaitingMyNomination: active && config.draftType === 'auction' && !pending && isMyTurn,
    nominate,
    resolve,
  };
}
