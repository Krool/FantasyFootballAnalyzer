import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { League, RosterSlots, ScoringType } from '@/types';
import type { DraftRoomTeam } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { leagueKeyFor } from '@/hooks/useDraftRoom';
import { useKeeperSourceTeams } from '@/hooks/useKeeperSource';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { SnakeFormat } from '@/utils/snakeOrder';
import { guessKeepers, keeperCandidates, resolveKeeperRounds } from '@/utils/keeperGuess';
import { loadDraftArchive, removeFromDraftArchive } from '@/utils/draftRoomCache';
import {
  deletePreset,
  loadPresets,
  savePreset,
  settingsFromConfig,
  type DraftPreset,
} from '@/utils/draftPresets';
import styles from './DraftSetup.module.css';

interface DraftSetupProps {
  room: UseDraftRoomReturn;
  league: League;
}

const SLOT_KEYS: Array<keyof RosterSlots> = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DST', 'BENCH'];

const SCORING_OPTIONS: Array<{ value: ScoringType; label: string }> = [
  { value: 'standard', label: 'Standard' },
  { value: 'half_ppr', label: 'Half PPR' },
  { value: 'ppr', label: 'Full PPR' },
];

const LEAGUE_TYPE_OPTIONS: Array<{ value: 'redraft' | 'keeper' | 'dynasty'; label: string; title: string }> = [
  { value: 'redraft', label: 'Redraft', title: 'Rosters reset every year' },
  { value: 'keeper', label: 'Keeper', title: 'Keep a few players each year at a cost' },
  { value: 'dynasty', label: 'Dynasty', title: 'Whole roster carries over; values use dynasty rankings' },
];

const SNAKE_FORMAT_OPTIONS: Array<{ value: SnakeFormat; label: string; title: string }> = [
  { value: 'standard', label: 'Snake', title: 'Order reverses every round' },
  { value: '3rr', label: '3RR', title: 'Third-round reversal: round 3 keeps round 2’s order (NFFC style)' },
  { value: 'linear', label: 'Linear', title: 'Same order every round (common for dynasty rookie drafts)' },
];

// Below this width the setup collapses into a scannable accordion: each
// section shows only its title and a one-line summary until tapped open, and
// the Start button sticks to the bottom of the viewport.
const MOBILE_QUERY = '(max-width: 700px)';

// A settings card whose body collapses behind its title. The header keeps a
// one-line summary of the current values so the page stays scannable while
// collapsed. Each card owns its open state from an initial default, so
// rotating a phone never slams open sections shut.
function CollapsibleSection({
  title,
  summary,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  summary?: string;
  count?: number;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <button
          type="button"
          className={styles.sectionToggle}
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          <span className={styles.sectionName}>
            {title}
            {count != null && <span className={styles.sectionCount}>{count}</span>}
          </span>
          {!open && summary && <span className={styles.sectionSummary}>{summary}</span>}
          <span className={styles.chevron} data-open={open || undefined} aria-hidden="true">
            ▾
          </span>
        </button>
      </h2>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </section>
  );
}

export function DraftSetup({ room, league }: DraftSetupProps) {
  const { config, updateConfig, start, resumable, resume, reset, resumeSession } = room;
  const meGroup = useId();
  const [archive, setArchive] = useState(() => loadDraftArchive(leagueKeyFor(league)));
  const [presets, setPresets] = useState<DraftPreset[]>(() => loadPresets());
  const [presetName, setPresetName] = useState('');
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const sectionOpen = !isMobile;

  const keepersPerTeam = config.keepersPerTeam ?? 1;
  const escalation = config.keeperEscalation ?? 1;
  const isAuction = config.draftType === 'auction';
  const leagueType = config.leagueType ?? 'redraft';
  const isDynasty = leagueType === 'dynasty';
  const isRookieDraft = isDynasty && config.dynastyMode === 'rookie';

  const setLeagueType = (lt: 'redraft' | 'keeper' | 'dynasty') => {
    updateConfig(lt === 'dynasty' ? { leagueType: lt } : { leagueType: lt, dynastyMode: 'startup' });
  };

  // A rookie draft is a linear snake over first-year players with no keepers,
  // so picking it locks those settings.
  const setDynastyMode = (mode: 'startup' | 'rookie') => {
    updateConfig(
      mode === 'rookie'
        ? { dynastyMode: mode, draftType: 'snake', snakeFormat: 'linear', keepers: undefined }
        : { dynastyMode: mode },
    );
  };

  // Keeper guesses come from last season's draft results, valued against
  // this year's rankings (and escalated by the league's keeper rule). On a
  // freshly renewed league the hook fetches those results from the previous
  // season's league, since the loaded one has no draft yet.
  const keeperTeams = useKeeperSourceTeams(league);
  const candidatesByTeam = useMemo(
    () => keeperCandidates(keeperTeams, room.pool.players, config.teams.length, config.rounds, escalation),
    [keeperTeams, room.pool.players, config.teams.length, config.rounds, escalation],
  );
  const anyKeeperCandidates = [...candidatesByTeam.values()].some(c => c.length > 0);
  const keepersOn = config.keepers !== undefined;

  const teamKeeperIds = (teamId: string) =>
    (config.keepers ?? []).filter(k => k.teamId === teamId).map(k => k.playerId);

  const toggleKeepers = (on: boolean) => {
    updateConfig({
      keepers: on
        ? guessKeepers(keeperTeams, room.pool.players, config.teams.length, config.rounds, keepersPerTeam, escalation)
        : undefined,
    });
  };

  // Rebuild one team's keepers from a list of chosen player ids, re-resolving
  // snake cost-round collisions and carrying each keeper's auction price.
  const rebuildTeamKeepers = (teamId: string, playerIds: string[]) => {
    const others = (config.keepers ?? []).filter(k => k.teamId !== teamId);
    const cands = playerIds
      .filter(Boolean)
      .map(pid => candidatesByTeam.get(teamId)?.find(c => c.player.id === pid))
      .filter((c): c is NonNullable<typeof c> => !!c);
    updateConfig({ keepers: [...others, ...resolveKeeperRounds(cands)] });
  };

  const setTeamKeeperAt = (teamId: string, index: number, playerId: string) => {
    const ids = teamKeeperIds(teamId);
    const slots = Array.from({ length: keepersPerTeam }, (_, i) => ids[i] ?? '');
    slots[index] = playerId;
    rebuildTeamKeepers(teamId, slots);
  };

  const setKeeperPrice = (teamId: string, playerId: string, price: number) => {
    updateConfig({
      keepers: (config.keepers ?? []).map(k =>
        k.teamId === teamId && k.playerId === playerId ? { ...k, keeperPrice: Math.max(1, price) } : k,
      ),
    });
  };

  const setKeepersPerTeam = (n: number) => {
    const next = Math.max(1, Math.min(config.rounds, n));
    updateConfig({ keepersPerTeam: next });
    if (keepersOn) {
      updateConfig({
        keepers: guessKeepers(keeperTeams, room.pool.players, config.teams.length, config.rounds, next, escalation),
      });
    }
  };

  const setEscalation = (n: number) => {
    updateConfig({ keeperEscalation: n });
    if (keepersOn) {
      updateConfig({
        keepers: guessKeepers(keeperTeams, room.pool.players, config.teams.length, config.rounds, keepersPerTeam, n),
      });
    }
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

  const saveCurrentPreset = () => {
    if (!presetName.trim()) return;
    setPresets(savePreset(presetName, settingsFromConfig(config)));
    setPresetName('');
  };
  const applyPreset = (preset: DraftPreset) => updateConfig(preset.settings);
  const removePreset = (name: string) => setPresets(deletePreset(name));

  // A one-line confirmation of the headline settings, so the user can see at a
  // glance what they're about to start without re-reading every section.
  const scoringLabel = SCORING_OPTIONS.find(o => o.value === config.scoring)?.label ?? 'Custom';
  const formatLabel = SNAKE_FORMAT_OPTIONS.find(o => o.value === (config.snakeFormat ?? 'standard'))?.label ?? 'Snake';
  const summary = [
    `${config.teams.length}-team`,
    scoringLabel + (config.tePremium ? ' +TEP' : ''),
    isAuction ? `$${config.budget} auction` : `${formatLabel}`,
    config.rosterSlots.SUPERFLEX > 0 ? 'Superflex' : null,
    leagueType !== 'redraft' ? leagueType : null,
    isRookieDraft ? 'rookie draft' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // One-line recaps shown in each collapsed section header so the whole setup
  // reads at a glance on a phone without expanding anything.
  const myTeam = config.teams.find(t => t.id === config.myTeamId);
  const formatSummary = [
    LEAGUE_TYPE_OPTIONS.find(o => o.value === leagueType)?.label,
    isRookieDraft ? 'Rookie' : isAuction ? `$${config.budget} auction` : formatLabel,
    config.mode === 'live' ? 'Live log' : 'Mock',
  ]
    .filter(Boolean)
    .join(' · ');
  const scoringSummary = [scoringLabel, config.tePremium ? 'TEP' : null, config.sixPtPassTd ? '6pt TD' : null]
    .filter(Boolean)
    .join(' · ');
  const rosterSummary = `${config.rounds} spots${config.rosterSlots.SUPERFLEX > 0 ? ' · Superflex' : ''}`;
  const keeperSummary = keepersOn ? `On · ${keepersPerTeam}/team` : 'Off';
  const teamsSummary = myTeam ? `${myTeam.name} is you` : 'Pick your team';

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
      {league.hasSuperflex && config.rosterSlots.SUPERFLEX === 0 && (
        <div className={styles.warnBox}>
          <strong>Superflex league detected.</strong> Set a SUPERFLEX slot in
          Roster below so QBs get priced for superflex demand. Without it this
          room values QBs off 1QB rankings, which badly underprices them: top
          QBs go for first-round picks / $40+ in superflex.
        </div>
      )}
      {isDynasty && (
        <div className={styles.warnBox}>
          <strong>Dynasty mode.</strong>{' '}
          {isRookieDraft
            ? 'Rookie draft: the board is rookies only, in linear order. Set rounds to your rookie-draft length below.'
            : 'The board is ordered by dynasty value (whole-roster, not this-year-only). ADP and projection figures are still redraft, so lean on the dynasty order.'}
        </div>
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

      <div className={styles.columns}>
        <div className={styles.column}>
          <CollapsibleSection title="Format" summary={formatSummary} defaultOpen={sectionOpen}>
            <div className={styles.formatRow}>
              <div className={styles.field}>
                <span className={styles.label}>League Type</span>
                <div className={styles.toggle}>
                  {LEAGUE_TYPE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={leagueType === opt.value ? styles.toggleOn : styles.toggleOff}
                      onClick={() => setLeagueType(opt.value)}
                      title={opt.title}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {isDynasty && (
                <div className={styles.field}>
                  <span className={styles.label}>Dynasty Draft</span>
                  <div className={styles.toggle}>
                    <button
                      type="button"
                      className={config.dynastyMode !== 'rookie' ? styles.toggleOn : styles.toggleOff}
                      aria-pressed={config.dynastyMode !== 'rookie'}
                      onClick={() => setDynastyMode('startup')}
                      title="Initial draft of the whole pool, ordered by dynasty value"
                    >
                      Startup
                    </button>
                    <button
                      type="button"
                      className={config.dynastyMode === 'rookie' ? styles.toggleOn : styles.toggleOff}
                      aria-pressed={config.dynastyMode === 'rookie'}
                      onClick={() => setDynastyMode('rookie')}
                      title="Annual rookies-only draft, linear order"
                    >
                      Rookie
                    </button>
                  </div>
                </div>
              )}
              {!isRookieDraft && (
              <div className={styles.field}>
                <span className={styles.label}>Draft Type</span>
                <div className={styles.toggle}>
                  <button
                    type="button"
                    className={config.draftType === 'auction' ? styles.toggleOn : styles.toggleOff}
                    aria-pressed={config.draftType === 'auction'}
                    onClick={() => updateConfig({ draftType: 'auction' })}
                  >
                    Auction
                  </button>
                  <button
                    type="button"
                    className={config.draftType === 'snake' ? styles.toggleOn : styles.toggleOff}
                    aria-pressed={config.draftType === 'snake'}
                    onClick={() => updateConfig({ draftType: 'snake' })}
                  >
                    Snake
                  </button>
                </div>
              </div>
              )}
              {config.draftType === 'auction' && (
                <div className={styles.field}>
                  <span className={styles.label}>Budget Per Team</span>
                  <input
                    type="number"
                    className={styles.input}
                    aria-label="Budget per team"
                    min={config.rounds}
                    value={config.budget}
                    onChange={e => updateConfig({ budget: Number(e.target.value) || 0 })}
                  />
                </div>
              )}
              {config.draftType === 'snake' && !isRookieDraft && (
                <div className={styles.field}>
                  <span className={styles.label}>Pick Order</span>
                  <div className={styles.toggle}>
                    {SNAKE_FORMAT_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        className={
                          (config.snakeFormat ?? 'standard') === opt.value
                            ? styles.toggleOn
                            : styles.toggleOff
                        }
                        aria-pressed={(config.snakeFormat ?? 'standard') === opt.value}
                        onClick={() => updateConfig({ snakeFormat: opt.value })}
                        title={opt.title}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* The mode choice, framed by what it does: auto-pick on is the
                mock practice draft, off is the live follow-along where every
                team's pick is logged by hand (with optional Sleeper sync on a
                connected Sleeper league). Live logging needs no league data,
                just team names, so guests get the choice too. */}
            <label className={styles.keeperToggle}>
              <input
                type="checkbox"
                checked={config.mode === 'mock'}
                onChange={e => updateConfig({ mode: e.target.checked ? 'mock' : 'live' })}
              />
              Auto-pick the other teams (mock draft)
            </label>
            <p className={styles.hint}>
              {config.mode === 'mock'
                ? 'The other teams draft automatically so you can practice.'
                : league.platform === 'sleeper' && !league.isGuest
                  ? 'Follow along with your real draft: log every pick and price by hand, or turn on Live Sync in the room to pull Sleeper picks automatically.'
                  : `Follow along with your real draft: log every team's pick and price as it happens in your league's draft window.${league.isGuest ? ' Set the real team names under Teams.' : ''}`}
            </p>
            {config.mode === 'mock' && config.draftType === 'auction' && (
              <label className={styles.keeperToggle}>
                <input
                  type="checkbox"
                  checked={!!config.liveBidding}
                  onChange={e => updateConfig({ liveBidding: e.target.checked })}
                />
                Live bidding: bids are called one at a time so you can price-enforce,
                instead of submitting one sealed max bid
              </label>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Scoring" summary={scoringSummary} defaultOpen={sectionOpen}>
            <div className={styles.field}>
              <span className={styles.label}>Reception Points</span>
              <div className={styles.toggle}>
                {SCORING_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className={config.scoring === opt.value ? styles.toggleOn : styles.toggleOff}
                    onClick={() => updateConfig({ scoring: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <label className={styles.keeperToggle}>
              <input
                type="checkbox"
                checked={!!config.tePremium}
                onChange={e => updateConfig({ tePremium: e.target.checked })}
              />
              TE premium (extra points per TE reception)
            </label>
            <label className={styles.keeperToggle}>
              <input
                type="checkbox"
                checked={!!config.sixPtPassTd}
                onChange={e => updateConfig({ sixPtPassTd: e.target.checked })}
              />
              6-point passing TDs
            </label>
            <p className={styles.hint}>
              Drives player values and the mock AI's market. TE premium and 6pt
              passing TDs are estimated from preset projections, not per-play
              scoring, so treat their bumps as approximate.
            </p>
          </CollapsibleSection>

          <CollapsibleSection title="Roster" summary={rosterSummary} defaultOpen={sectionOpen}>
            <div className={styles.slotGrid}>
              {SLOT_KEYS.map(key => (
                <div key={key} className={styles.field}>
                  <span className={styles.label}>{key}</span>
                  <input
                    type="number"
                    className={styles.input}
                    aria-label={`${key} roster slots`}
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
          </CollapsibleSection>

          {!isDynasty && anyKeeperCandidates && (
            <CollapsibleSection title="Keepers" summary={keeperSummary} defaultOpen={sectionOpen}>
              <label className={styles.keeperToggle}>
                <input
                  type="checkbox"
                  checked={keepersOn}
                  onChange={e => toggleKeepers(e.target.checked)}
                />
                {isAuction
                  ? 'Each team keeps players at a set price, charged before the auction'
                  : 'Each team keeps players, costing a draft pick earlier than last season'}
              </label>
              {keepersOn && (
                <>
                  <div className={styles.formatRow}>
                    <div className={styles.field}>
                      <span className={styles.label}>Keepers Per Team</span>
                      <input
                        type="number"
                        className={styles.input}
                        aria-label="Keepers per team"
                        min={1}
                        max={config.rounds}
                        value={keepersPerTeam}
                        onChange={e => setKeepersPerTeam(Number(e.target.value) || 1)}
                      />
                    </div>
                    {!isAuction && (
                      <div className={styles.field}>
                        <span className={styles.label}>Rounds Earlier</span>
                        <input
                          type="number"
                          className={styles.input}
                          aria-label="Rounds earlier"
                          min={0}
                          max={config.rounds}
                          value={escalation}
                          onChange={e => setEscalation(Number(e.target.value) || 0)}
                          title="How many rounds earlier than last season a keeper costs (0 = same round)"
                        />
                      </div>
                    )}
                  </div>
                  <p className={styles.hint}>
                    {isAuction
                      ? 'Kept players come off the board and are charged to their team when the draft starts. Prices default to last year plus $5; edit any.'
                      : 'Guesses pick the biggest gap between the player and what his cost round normally buys. Fix any we got wrong; kept players come off the board and consume that round’s pick.'}
                  </p>
                  <div className={styles.keeperList}>
                    {config.teams.map(team => {
                      const candidates = candidatesByTeam.get(team.id) ?? [];
                      if (candidates.length === 0) {
                        return (
                          <div key={team.id} className={styles.keeperRow}>
                            <span className={styles.keeperTeam}>{team.name}</span>
                            <span className={styles.keeperNone}>no eligible players</span>
                          </div>
                        );
                      }
                      const ids = teamKeeperIds(team.id);
                      return (
                        <div key={team.id} className={styles.keeperRow}>
                          <span className={styles.keeperTeam}>{team.name}</span>
                          <div className={styles.keeperSlots}>
                            {Array.from({ length: keepersPerTeam }, (_, i) => {
                              const selectedId = ids[i] ?? '';
                              const chosenElsewhere = new Set(ids.filter((_, j) => j !== i));
                              const kept = config.keepers?.find(
                                k => k.teamId === team.id && k.playerId === selectedId,
                              );
                              return (
                                <div key={i} className={styles.keeperSlot}>
                                  <select
                                    className={styles.keeperSelect}
                                    aria-label={`Keeper ${i + 1} for ${team.name}`}
                                    value={selectedId}
                                    onChange={e => setTeamKeeperAt(team.id, i, e.target.value)}
                                  >
                                    <option value="">No keeper</option>
                                    {candidates
                                      .filter(c => !chosenElsewhere.has(c.player.id))
                                      .slice(0, 12)
                                      .map(c => (
                                        <option key={c.player.id} value={c.player.id}>
                                          {c.player.name} ({c.player.pos}){' '}
                                          {isAuction
                                            ? c.lastPrice != null
                                              ? `last $${c.lastPrice}`
                                              : 'no prior price'
                                            : `keeps R${c.costRound}, exp R${c.expertRound}, mkt R${c.marketRound}`}
                                          {c.keptLastYear ? ', kept last year' : ''}
                                        </option>
                                      ))}
                                  </select>
                                  {isAuction && selectedId && (
                                    <input
                                      type="number"
                                      className={styles.keeperPrice}
                                      aria-label={`Keeper ${i + 1} price for ${team.name}`}
                                      min={1}
                                      value={kept?.keeperPrice ?? 1}
                                      onChange={e =>
                                        setKeeperPrice(team.id, selectedId, Number(e.target.value) || 1)
                                      }
                                      title="Keeper price charged before the auction"
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CollapsibleSection>
          )}
        </div>

        <div className={styles.column}>
          <CollapsibleSection
            title="Teams"
            count={config.teams.length}
            summary={teamsSummary}
            defaultOpen={sectionOpen}
          >
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
                    aria-label={`Team ${i + 1} name`}
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
          </CollapsibleSection>
        </div>
      </div>

      <CollapsibleSection title="Presets" count={presets.length || undefined} defaultOpen={sectionOpen}>
        <p className={styles.hint}>
          Save these settings (scoring, roster, format, budget) to reuse on any league or mock.
          Teams and keepers are not stored.
        </p>
        <div className={styles.presetSave}>
          <input
            className={styles.input}
            aria-label="Preset name"
            placeholder="Name this setup"
            value={presetName}
            onChange={e => setPresetName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') saveCurrentPreset();
            }}
          />
          <button type="button" className={styles.btn} onClick={saveCurrentPreset} disabled={!presetName.trim()}>
            Save
          </button>
        </div>
        {presets.length > 0 && (
          <div className={styles.keeperList}>
            {presets.map(preset => (
              <div key={preset.name} className={styles.teamRow}>
                <span className={styles.archiveLabel}>{preset.name}</span>
                <div className={styles.teamButtons}>
                  <button type="button" className={styles.btn} onClick={() => applyPreset(preset)}>
                    Load
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => removePreset(preset.name)}
                    aria-label={`Delete preset ${preset.name}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {archive.length > 0 && (
        <CollapsibleSection title="Past Drafts" count={archive.length} defaultOpen={sectionOpen}>
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
        </CollapsibleSection>
      )}

      <div className={styles.startRow}>
        <div className={styles.summary} title="What you're about to start">
          {summary}
        </div>
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
    </div>
  );
}
