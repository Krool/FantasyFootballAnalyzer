import { useEffect, useMemo, useRef, useState } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { NflTeamLabel } from '@/components';
import { marketAdp } from '@/utils/consensus';
import { inflateValue } from '@/utils/inflation';
import type { StarterPos } from '@/utils/draftEngine';
import { STARTER_POSITIONS } from '@/utils/draftEngine';
import styles from './TierBoard.module.css';

// How long a just-drafted row lingers, fading out, before it actually drops
// from the DOM. Matches AvailablePlayers' ghost timing.
const LEAVE_MS = 350;

interface TierBoardProps {
  room: UseDraftRoomReturn;
  selectedId: string | null;
  onSelect: (player: PoolPlayer) => void;
}

// Drafts are won at tier breaks, not at ranks: the gap between the last
// player of a tier and the first of the next is the cost of waiting. This
// view stacks the remaining players per position by tier so a thinning tier
// is visible at a glance.
const PER_POSITION = 30;

export function TierBoard({ room, selectedId, onSelect }: TierBoardProps) {
  const { config, derived, scaledValues, inflation, scoring } = room;
  const isAuction = config.draftType === 'auction';
  const { playClick } = useSounds();

  // A just-drafted player briefly stays rendered (in his own ghost row) so
  // the row can fade out instead of vanishing the instant the pick logs.
  const prevAvailableRef = useRef<Map<string, PoolPlayer>>(new Map());
  const [leaving, setLeaving] = useState<Map<string, PoolPlayer>>(new Map());
  const leaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const prev = prevAvailableRef.current;
    const current = new Map(derived.available.map(p => [p.id, p]));
    if (prev.size > 0) {
      for (const [id, player] of prev) {
        if (current.has(id) || !derived.draftedPlayerIds.has(id)) continue;
        setLeaving(l => new Map(l).set(id, player));
        const timer = setTimeout(() => {
          setLeaving(l => {
            const next = new Map(l);
            next.delete(id);
            return next;
          });
          leaveTimers.current.delete(id);
        }, LEAVE_MS);
        leaveTimers.current.set(id, timer);
      }
    }
    prevAvailableRef.current = current;
  }, [derived.available, derived.draftedPlayerIds]);

  useEffect(() => {
    const timers = leaveTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  const columns = useMemo(() => {
    return STARTER_POSITIONS.map(pos => {
      const players = derived.available.filter(p => p.pos === pos).slice(0, PER_POSITION);
      const tiers = new Map<number, PoolPlayer[]>();
      for (const p of players) {
        const group = tiers.get(p.tier) ?? [];
        group.push(p);
        tiers.set(p.tier, group);
      }
      const leavingHere = [...leaving.values()].filter(p => p.pos === pos);
      return {
        pos,
        players,
        tiers: [...tiers.entries()].sort((a, b) => a[0] - b[0]),
        leaving: leavingHere,
      };
    });
  }, [derived.available, leaving]);

  const superflex = config.rosterSlots.SUPERFLEX > 0;
  const detail = (p: PoolPlayer) => {
    if (isAuction) return `$${inflateValue(scaledValues.get(p.id) ?? 1, inflation.rate)}`;
    const adp = marketAdp(p, scoring, superflex);
    return adp !== undefined ? `ADP ${Math.round(adp)}` : `#${p.overallRank}`;
  };

  return (
    <div className={styles.board}>
      {columns.map(({ pos, players, tiers, leaving: leavingHere }) => (
        <div key={pos} className={styles.column}>
          <div className={styles.columnHeader}>
            <span className={styles.columnPos}>{pos}</span>
            <span className={styles.columnMeta}>
              {players.length === PER_POSITION ? `top ${PER_POSITION}` : `${players.length} left`} ·{' '}
              {derived.positionalDemand[pos as StarterPos]} need
            </span>
          </div>
          {tiers.map(([tier, group]) => (
            <div key={tier} className={styles.tierGroup}>
              <div
                className={group.length === 1 ? styles.tierLabelHot : styles.tierLabel}
                // Tier heat tokens from index.css; tier 0 (missing data)
                // and 5+ keep the dim default.
                style={
                  group.length > 1 && tier >= 1 && tier <= 4
                    ? { color: `var(--tier-${tier})` }
                    : undefined
                }
              >
                Tier {tier} · {group.length === 1 ? 'last one' : `${group.length} left`}
              </div>
              {group.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={p.id === selectedId ? styles.playerOn : styles.player}
                  onClick={() => {
                    playClick();
                    onSelect(p);
                  }}
                  title={`Select ${p.name} for the pick logger`}
                >
                  <span className={styles.playerName}>{p.name}</span>
                  <span className={styles.playerMeta}>
                    <NflTeamLabel team={p.team} /> · {detail(p)}
                  </span>
                </button>
              ))}
            </div>
          ))}
          {players.length === 0 && <div className={styles.empty}>Position drained.</div>}
          {leavingHere.length > 0 && (
            <div className={styles.tierGroup}>
              {leavingHere.map(p => (
                <div key={p.id} className={styles.playerLeaving} aria-hidden="true">
                  <span className={styles.playerName}>{p.name}</span>
                  <span className={styles.playerMeta}>Drafted</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
