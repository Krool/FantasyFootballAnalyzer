import { useMemo } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { NflTeamLabel } from '@/components';
import { sleeperAdpFor } from '@/utils/consensus';
import { inflateValue } from '@/utils/inflation';
import type { StarterPos } from '@/utils/draftEngine';
import { STARTER_POSITIONS } from '@/utils/draftEngine';
import styles from './TierBoard.module.css';

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

  const columns = useMemo(() => {
    return STARTER_POSITIONS.map(pos => {
      const players = derived.available.filter(p => p.pos === pos).slice(0, PER_POSITION);
      const tiers = new Map<number, PoolPlayer[]>();
      for (const p of players) {
        const group = tiers.get(p.tier) ?? [];
        group.push(p);
        tiers.set(p.tier, group);
      }
      return { pos, players, tiers: [...tiers.entries()].sort((a, b) => a[0] - b[0]) };
    });
  }, [derived.available]);

  const superflex = config.rosterSlots.SUPERFLEX > 0;
  const detail = (p: PoolPlayer) => {
    if (isAuction) return `$${inflateValue(scaledValues.get(p.id) ?? 1, inflation.rate)}`;
    const adp = sleeperAdpFor(p, scoring, superflex) ?? p.espnAdp;
    return adp !== undefined ? `ADP ${Math.round(adp)}` : `#${p.overallRank}`;
  };

  return (
    <div className={styles.board}>
      {columns.map(({ pos, players, tiers }) => (
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
        </div>
      ))}
    </div>
  );
}
