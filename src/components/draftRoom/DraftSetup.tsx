import { useId, useMemo, useState } from 'react';
import type { League, RosterSlots } from '@/types';
import type { DraftRoomTeam, KeeperAssignment } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { leagueKeyFor } from '@/hooks/useDraftRoom';
import { guessKeepers, keeperCandidates } from '@/utils/keeperGuess';
import { loadDraftArchive, removeFromDraftArchive } from '@/utils/draftRoomCache';
import styles from './DraftSetup.module.css';

interface DraftSetupProps {
  room: UseDraftRoomReturn;
  league: League;
}

const SLOT_KEYS: Array<keyof RosterSlots> = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST', 'BENCH'];

export function DraftSetup({ room, league }: DraftSetupProps) {
  const { config, updateConfig, start, resumable, resume, reset, resumeSession } = room;
  const meGroup = useId();
  const [archive, setArchive] = useState(() => loadDraftArchive(leagueKeyFor(league)));

  // Keeper guesses come from last season's draft results, valued against
  // this year's rankings.
  const candidatesByTeam = useMemo(
    () => keeperCandidates(league.teams, room.pool.players, config.teams.length, config.rounds),
    [league.teams, room.pool.players, config.teams.length, config.rounds],
  );
  const anyKeeperCandidates = [...candidatesByTeam.values()].some(c => c.length > 0);
  const keepersOn = config.keepers !== undefined;

  const toggleKeepers = (on: boolean) => {
    updateConfig({
      keepers: on
        ? guessKeepers(league.teams, room.pool.players, config.teams.length, config.rounds)
        : undefined,
    });
  };

  const setTeamKeeper = (teamId: string, playerId: string) => {
    const others = (config.keepers ?? []).filter(k => k.teamId !== teamId);
    if (playerId === '') {
      updateConfig({ keepers: others });
      return;
    }
    const candidate = candidatesByTeam.get(teamId)?.find(c => c.player.id === playerId);
    if (!candidate) return;
    const next: KeeperAssignment = { teamId, playerId, costRound: candidate.costRound };
    updateConfig({ keepers: [...others, next] });
  };

  const setTeams = (teams: DraftRoomTeam[]) => updateConfig({ teams });

  const moveTeam = (index: number, delta: number) => {
    const next = [...config.teams];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setTeams(next);
  };

  const removeTeam = (index: number) => {
    const removed = config.teams[index];
    const teams = config.teams.filter((_, i) => i !== index);
    const patch: Parameters<typeof updateConfig>[0] = { teams };
    if (removed.id === config.myTeamId && teams.length > 0) patch.myTeamId = teams[0].id;
    updateConfig(patch);
  };

  const addTeam = () => {
    const id = `team-${Date.now()}`;
    setTeams([...config.teams, { id, name: `Team ${config.teams.length + 1}` }]);
  };

  const setSlot = (key: keyof RosterSlots, value: number) => {
    updateConfig({ rosterSlots: { ...config.rosterSlots, [key]: Math.max(0, value) } });
  };

  const savedAt = resumable ? new Date(resumable.savedAt) : null;

  // Mirrors the reducer's START guards so the button can explain itself
  // instead of silently doing nothing.
  const startBlocked =
    config.teams.length < 2 ? 'Add at least two teams.'
    : !config.myTeamId ? 'Mark which team is yours.'
    : config.rounds < 1 ? 'Add at least one roster spot.'
    : config.draftType === 'auction' && config.budget < config.rounds
      ? `Budget must cover $1 per roster spot (at least $${config.rounds}).`
    : null;

  return (
    <div className={styles.setup}>
      {league.hasSuperflex && (
        <div className={styles.warnBox}>
          <strong>Superflex league detected.</strong> This room prices QBs off
          1QB rankings, which badly underprices them in superflex: top QBs go
          for first-round picks / $40+ there. Treat every QB value and
          suggestion here as a floor, not a target.
        </div>
      )}
      {config.draftType === 'auction' && anyKeeperCandidates && (
        <p className={styles.hint}>
          Keeper support is snake-only for now. For an auction keeper league,
          log each kept player as a sale at their keeper price once the draft
          starts.
        </p>
      )}
      {resumable && (
        <div className={styles.resume}>
          <div className={styles.resumeText}>
            <span className={styles.resumeKicker}>Saved draft found</span>
            <span className={styles.resumeDetail}>
              {resumable.events.length} picks logged
              {savedAt ? `, saved ${savedAt.toLocaleString()}` : ''}
            </span>
          </div>
          <div className={styles.resumeActions}>
            <button type="button" className={styles.btnPrimary} onClick={resume}>
              Resume Draft
            </button>
            <button type="button" className={styles.btn} onClick={reset}>
              Discard
            </button>
          </div>
        </div>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Format</h2>
        <div className={styles.formatRow}>
          <div className={styles.field}>
            <span className={styles.label}>Draft Type</span>
            <div className={styles.toggle}>
              <button
                type="button"
                className={config.draftType === 'auction' ? styles.toggleOn : styles.toggleOff}
                onClick={() => updateConfig({ draftType: 'auction' })}
              >
                Auction
              </button>
              <button
                type="button"
                className={config.draftType === 'snake' ? styles.toggleOn : styles.toggleOff}
                onClick={() => updateConfig({ draftType: 'snake' })}
              >
                Snake
              </button>
            </div>
          </div>
          {config.draftType === 'auction' && (
            <div className={styles.field}>
              <span className={styles.label}>Budget Per Team</span>
              <input
                type="number"
                className={styles.input}
                min={config.rounds}
                value={config.budget}
                onChange={e => updateConfig({ budget: Number(e.target.value) || 0 })}
              />
            </div>
          )}
          <div className={styles.field}>
            <span className={styles.label}>Mode</span>
            <div className={styles.toggle}>
              <button
                type="button"
                className={config.mode === 'live' ? styles.toggleOn : styles.toggleOff}
                onClick={() => updateConfig({ mode: 'live' })}
              >
                Live
              </button>
              <button
                type="button"
                className={config.mode === 'mock' ? styles.toggleOn : styles.toggleOff}
                onClick={() => updateConfig({ mode: 'mock' })}
              >
                Mock
              </button>
            </div>
          </div>
        </div>
        {config.mode === 'mock' && (
          <>
            <p className={styles.hint}>
              Mock mode: the other teams draft automatically so you can practice.
            </p>
            <div className={styles.field}>
              <span className={styles.label}>Sim Seed (optional)</span>
              <input
                type="number"
                className={styles.input}
                placeholder="random"
                value={config.simSeed ?? ''}
                onChange={e =>
                  updateConfig({
                    simSeed: e.target.value === '' ? undefined : Number(e.target.value) || undefined,
                  })
                }
                title="Same seed = the AI repeats the exact same picks and bids, so you can replay a mock with a different strategy"
              />
            </div>
          </>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Teams <span className={styles.sectionCount}>{config.teams.length}</span>
        </h2>
        <p className={styles.hint}>
          {config.draftType === 'auction'
            ? 'Order sets the nomination rotation.'
            : 'Order sets the round 1 pick order.'}{' '}
          Mark which team is yours.
        </p>
        <div className={styles.teamList}>
          {config.teams.map((team, i) => (
            <div key={team.id} className={styles.teamRow}>
              <span className={styles.teamIndex}>{String(i + 1).padStart(2, '0')}</span>
              <input
                className={styles.input}
                value={team.name}
                onChange={e =>
                  setTeams(config.teams.map(t => (t.id === team.id ? { ...t, name: e.target.value } : t)))
                }
              />
              <label className={styles.meLabel}>
                <input
                  type="radio"
                  name={meGroup}
                  checked={config.myTeamId === team.id}
                  onChange={() => updateConfig({ myTeamId: team.id })}
                />
                Me
              </label>
              <div className={styles.teamButtons}>
                <button type="button" className={styles.iconBtn} onClick={() => moveTeam(i, -1)} aria-label={`Move ${team.name} up`}>
                  ▲
                </button>
                <button type="button" className={styles.iconBtn} onClick={() => moveTeam(i, 1)} aria-label={`Move ${team.name} down`}>
                  ▼
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => removeTeam(i)}
                  disabled={config.teams.length <= 2}
                  aria-label={`Remove ${team.name}`}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" className={styles.btn} onClick={addTeam}>
          + Add Team
        </button>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Roster</h2>
        <div className={styles.slotGrid}>
          {SLOT_KEYS.map(key => (
            <div key={key} className={styles.field}>
              <span className={styles.label}>{key}</span>
              <input
                type="number"
                className={styles.input}
                min={0}
                value={config.rosterSlots[key]}
                onChange={e => setSlot(key, Number(e.target.value) || 0)}
              />
            </div>
          ))}
        </div>
        <p className={styles.hint}>
          {config.rounds} draftable spots per team, {config.teams.length * config.rounds} total
          picks. IR slots are not drafted.
        </p>
      </section>

      {config.draftType === 'snake' && anyKeeperCandidates && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Keepers</h2>
          <label className={styles.keeperToggle}>
            <input
              type="checkbox"
              checked={keepersOn}
              onChange={e => toggleKeepers(e.target.checked)}
            />
            Each team keeps one player, costing one round earlier than last season
          </label>
          {keepersOn && (
            <>
              <p className={styles.hint}>
                Guesses pick the biggest gap between the player and what his cost round
                normally buys, weighted toward the top of the board. Fix any we got wrong;
                kept players come off the board and consume that round's pick.
              </p>
              <div className={styles.keeperList}>
                {config.teams.map(team => {
                  const candidates = candidatesByTeam.get(team.id) ?? [];
                  const current = config.keepers?.find(k => k.teamId === team.id);
                  if (candidates.length === 0) {
                    return (
                      <div key={team.id} className={styles.keeperRow}>
                        <span className={styles.keeperTeam}>{team.name}</span>
                        <span className={styles.keeperNone}>no eligible players</span>
                      </div>
                    );
                  }
                  return (
                    <div key={team.id} className={styles.keeperRow}>
                      <span className={styles.keeperTeam}>{team.name}</span>
                      <select
                        className={styles.keeperSelect}
                        value={current?.playerId ?? ''}
                        onChange={e => setTeamKeeper(team.id, e.target.value)}
                      >
                        <option value="">No keeper</option>
                        {candidates.slice(0, 10).map(c => (
                          <option key={c.player.id} value={c.player.id}>
                            {c.player.name} ({c.player.pos}) keeps R{c.costRound}, expert R
                            {c.expertRound}, market R{c.marketRound},{' '}
                            {c.surplus >= 0 ? '+' : ''}${Math.round(c.surplus)}
                            {c.keptLastYear ? ', kept last year' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      )}

      <div className={styles.startRow}>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={start}
          disabled={startBlocked !== null}
        >
          Start {config.mode === 'mock' ? 'Mock ' : ''}Draft
        </button>
        {startBlocked && <p className={styles.hint}>{startBlocked}</p>}
      </div>

      {archive.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Past Drafts <span className={styles.sectionCount}>{archive.length}</span>
          </h2>
          <p className={styles.hint}>
            Every completed draft is kept here. Open one to revisit its recap and pick log.
          </p>
          <div className={styles.teamList}>
            {archive.map(session => (
              <div key={session.savedAt} className={styles.teamRow}>
                <span className={styles.teamIndex}>
                  {session.config.draftType === 'auction' ? '$' : 'S'}
                </span>
                <span className={styles.archiveLabel}>
                  {new Date(session.savedAt).toLocaleString()} ·{' '}
                  {session.config.mode === 'mock' ? 'mock' : 'live'} ·{' '}
                  {session.events.length} picks
                </span>
                <div className={styles.teamButtons}>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={() => resumeSession(session)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => {
                      removeFromDraftArchive(leagueKeyFor(league), session.savedAt);
                      setArchive(loadDraftArchive(leagueKeyFor(league)));
                    }}
                    aria-label="Delete this archived draft"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
