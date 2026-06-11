import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PoolPlayer } from '@/types/draft';
import { inflateValue } from '@/utils/inflation';
import { roundForPick } from '@/utils/snakeOrder';
import { sleeperAdpFor } from '@/utils/consensus';
import {
  makePersonas,
  mulberry32,
  simAuctionResult,
  simNomination,
  simSnakePick,
} from '@/utils/draftSim';
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
  // One-shot feedback from the last resolution (e.g. "no eligible buyers"),
  // cleared when the next nomination goes up.
  notice: string | null;
  // The RNG seed this mock is running on; enter it in setup to replay.
  seed: number;
}

// Drives mock drafts: auto-picks for AI teams in snake, auto-nominates and
// settles bidding in auctions. No-ops entirely in live mode.
export function useDraftSim(room: UseDraftRoomReturn): UseDraftSimReturn {
  const { config, derived, scaledValues, inflation, logEvent, phase, scoring } = room;
  const [pending, setPending] = useState<PendingNomination | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Lazy init so the RNG isn't rebuilt (and discarded) on every render. A
  // configured seed makes the AI script reproducible across runs.
  const seedRef = useRef<number | null>(null);
  if (seedRef.current === null) {
    seedRef.current = config.simSeed ?? (Date.now() & 0xffffffff);
  }
  const rngRef = useRef<(() => number) | null>(null);
  if (rngRef.current === null) {
    rngRef.current = mulberry32(seedRef.current);
  }
  // A new draft start re-rolls (or re-applies) the seed; the user may have
  // typed one into setup after this hook first mounted.
  const prevPhaseRef = useRef(phase);
  if (prevPhaseRef.current === 'setup' && phase === 'drafting') {
    seedRef.current = config.simSeed ?? (Date.now() & 0xffffffff);
    rngRef.current = mulberry32(seedRef.current);
  }
  prevPhaseRef.current = phase;
  const rng = rngRef.current;

  // One temperament per AI team per mock; separate RNG stream so persona
  // rolls don't shift the pick script between snake and auction. Recomputed
  // when a draft starts (phase dep) so a typed-in seed applies.
  const personas = useMemo(
    () => makePersonas(config.teams.map(t => t.id), mulberry32((seedRef.current ?? 1) ^ 0x9e3779b9)),
    [config.teams, phase], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Market position for the league's scoring; the snake AI drafts off this.
  const adpOf = useCallback(
    (p: PoolPlayer) => sleeperAdpFor(p, scoring) ?? p.espnAdp,
    [scoring],
  );

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
      const player = simSnakePick(derived.available, scaledValues, team, round, totalRounds, rng, adpOf);
      if (player) logEvent({ kind: 'snake_pick', playerId: player.id, teamId });
    }, TICK_MS);
    return () => clearTimeout(timer);
  }, [active, config, isMyTurn, derived, scaledValues, logEvent, rng, adpOf]);

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
        rng,
        personas.get(nominatorId),
      );
      if (player) {
        setNotice(null);
        setPending({ nominatorId, player });
      }
    }, TICK_MS);
    return () => clearTimeout(timer);
  }, [active, config.draftType, pending, isMyTurn, derived, scaledValues, rng, personas]);

  const nominate = useCallback(
    (player: PoolPlayer) => {
      if (!active || pending) return;
      setNotice(null);
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
        rng,
        personas,
      );
      if (result.winnerId) {
        logEvent({
          kind: 'auction_sale',
          playerId: pending.player.id,
          nominatedById: pending.nominatorId,
          wonById: result.winnerId,
          price: result.price,
          expectedValue: expected,
        });
        setNotice(null);
      } else {
        // Nobody could legally roster him; without this the nomination just
        // vanishes and the user is left wondering what happened.
        setNotice(`No eligible buyers for ${pending.player.name}. He stays on the board.`);
      }
      setPending(null);
    },
    [pending, scaledValues, inflation.rate, derived.teams, derived.available, config.myTeamId, logEvent, rng, personas],
  );

  return {
    pending,
    awaitingMyNomination: active && config.draftType === 'auction' && !pending && isMyTurn,
    nominate,
    resolve,
    notice,
    seed: seedRef.current,
  };
}
