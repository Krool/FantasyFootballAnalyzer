import { useMemo, useState } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { normalizeName } from '@/utils/playerNames';
import styles from './NflTeams.module.css';

interface NflTeamsProps {
  room: UseDraftRoomReturn;
  selectedId: string | null;
  onSelect: (player: PoolPlayer) => void;
}

// The pool sliced by NFL team: every fantasy-relevant player on a roster in
// one card, drafted or not. This is the stacking and handcuff view (who
// catches passes from the QB you just bought, who inherits the backfield if
// your RB goes down) and shows where a teammate's draft position drags a
// player's value.
export function NflTeams({ room, selectedId, onSelect }: NflTeamsProps) {
  const { config, derived, pool } = room;
  const [query, setQuery] = useState('');
  const { playClick } = useSounds();

  // Who owns each drafted player, by pool player id.
  const ownerById = useMemo(() => {
    const names = new Map(config.teams.map(t => [t.id, t.name]));
    const owners = new Map<string, string>();
    for (const team of derived.teams.values()) {
      for (const { player } of team.picks) {
        owners.set(player.id, names.get(team.teamId) ?? '?');
      }
    }
    return owners;
  }, [config.teams, derived.teams]);

  const cards = useMemo(() => {
    const byTeam = new Map<string, PoolPlayer[]>();
    for (const p of pool.players) {
      const group = byTeam.get(p.team) ?? [];
      group.push(p);
      byTeam.set(p.team, group);
    }
    const q = normalizeName(query);
    const all = [...byTeam.entries()]
      .map(([team, players]) => ({
        team,
        players: players.sort((a, b) => a.overallRank - b.overallRank),
        bye: players.find(p => p.bye !== null)?.bye ?? null,
      }))
      .sort((a, b) => a.team.localeCompare(b.team));
    if (q === '') return all;
    return all.filter(
      c =>
        c.team.toLowerCase().includes(query.trim().toLowerCase()) ||
        c.players.some(p => normalizeName(p.name).includes(q)),
    );
  }, [pool.players, query]);

  return (
    <div className={styles.wrap}>
      <input
        className={styles.search}
        placeholder="Search by NFL team or player..."
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <div className={styles.grid}>
        {cards.map(({ team, players, bye }) => {
          const left = players.filter(
            p => !derived.draftedPlayerIds.has(p.id) && !derived.reservedPlayerIds.has(p.id),
          ).length;
          return (
            <div key={team} className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTeam}>{team || 'FA'}</span>
                <span className={styles.cardMeta}>
                  {bye !== null ? `Bye ${bye} · ` : ''}
                  {left} of {players.length} left
                </span>
              </div>
              <ul className={styles.list}>
                {players.map(p => {
                  const owner = ownerById.get(p.id);
                  const kept = derived.reservedPlayerIds.has(p.id);
                  const gone = owner !== undefined || kept;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={
                          gone
                            ? styles.playerGone
                            : p.id === selectedId
                              ? styles.playerOn
                              : styles.player
                        }
                        disabled={gone}
                        onClick={() => {
                          playClick();
                          onSelect(p);
                        }}
                        title={gone ? undefined : `Select ${p.name} for the pick logger`}
                      >
                        <span className={styles.playerPos}>
                          {p.pos}
                          {p.posRank}
                        </span>
                        <span className={styles.playerName}>{p.name}</span>
                        <span className={styles.playerNote}>
                          {owner ?? (kept ? 'keeper' : `#${p.overallRank}`)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {cards.length === 0 && <div className={styles.empty}>No NFL team or player matches.</div>}
      </div>
    </div>
  );
}
