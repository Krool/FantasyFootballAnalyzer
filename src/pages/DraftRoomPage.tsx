import { useEffect, useMemo, useRef, useState } from 'react';
import type { League } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import { useDraftRoom } from '@/hooks/useDraftRoom';
import { useDraftSim } from '@/hooks/useDraftSim';
import { useLiveDraftSync } from '@/hooks/useLiveDraftSync';
import { useSounds } from '@/hooks/useSounds';
import { useYahooValues } from '@/hooks/useYahooValues';
import { AuctionLogger } from '@/components/draftRoom/AuctionLogger';
import { AvailablePlayers } from '@/components/draftRoom/AvailablePlayers';
import { DraftRecap } from '@/components/draftRoom/DraftRecap';
import { DraftSetup } from '@/components/draftRoom/DraftSetup';
import { LeagueNeeds } from '@/components/draftRoom/LeagueNeeds';
import { MockBidPanel } from '@/components/draftRoom/MockBidPanel';
import { MyTeamPanel } from '@/components/draftRoom/MyTeamPanel';
import { NflTeams } from '@/components/draftRoom/NflTeams';
import { NominationPanel } from '@/components/draftRoom/NominationPanel';
import { PickLog } from '@/components/draftRoom/PickLog';
import { PickStrip } from '@/components/draftRoom/PickStrip';
import { SnakeLogger } from '@/components/draftRoom/SnakeLogger';
import { SuggestionsPanel } from '@/components/draftRoom/SuggestionsPanel';
import { TeamBoard } from '@/components/draftRoom/TeamBoard';
import { TierBoard } from '@/components/draftRoom/TierBoard';
import { detectRun, tierAlerts } from '@/utils/draftAlerts';
import { fullPositions } from '@/utils/draftEngine';
import { nextPickFor } from '@/utils/snakeOrder';
import styles from './DraftRoomPage.module.css';

// Elapsed time since the last logged pick, ticking once a second. Helps
// pace a live room ("we've been on this nomination for two minutes").
function PickTimer({ lastEventTs }: { lastEventTs: number | null }) {
  const [, force] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => force(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  if (lastEventTs === null) return null;
  const secs = Math.max(0, Math.floor((Date.now() - lastEventTs) / 1000));
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, '0');
  return (
    <span title="Time since the last logged pick">
      ⏱ {mm}:{ss}
    </span>
  );
}

type BoardTab = 'board' | 'tiers' | 'nfl';

const BOARD_TABS: Array<{ key: BoardTab; label: string; title: string }> = [
  { key: 'board', label: 'Board', title: 'Every available player, sortable by rank and value' },
  { key: 'tiers', label: 'Tiers', title: 'Remaining players stacked by position and tier' },
  { key: 'nfl', label: 'NFL Teams', title: 'The pool by NFL roster: stacks, handcuffs, teammates' },
];

interface DraftRoomPageProps {
  league: League;
}

export function DraftRoomPage({ league }: DraftRoomPageProps) {
  const room = useDraftRoom(league);
  const sim = useDraftSim(room);
  const yahoo = useYahooValues(room.pool);
  const liveSync = useLiveDraftSync(league, room);
  const searchRef = useRef<HTMLInputElement>(null);
  // The board is the selection surface: clicking a row feeds the logger.
  const [selected, setSelected] = useState<PoolPlayer | null>(null);
  const [boardTab, setBoardTab] = useState<BoardTab>('board');

  const { phase, config, derived, undo, reset } = room;

  // Each phase swaps the whole view (setup form -> draft board -> recap),
  // but the browser keeps the old scroll position: hitting Start at the
  // bottom of the setup form would land you at the bottom of the board.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phase]);

  // Clear a selection that got drafted out from under us (mock AI picks).
  useEffect(() => {
    if (selected && derived.draftedPlayerIds.has(selected.id)) setSelected(null);
  }, [selected, derived.draftedPlayerIds]);

  // Draft-day speed: "/" jumps to player search, Ctrl+Z undoes the last pick.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA';
      if (e.key === '/' && !typing) {
        e.preventDefault();
        // The search box lives on the Board tab; jump there first.
        setBoardTab('board');
        requestAnimationFrame(() => searchRef.current?.focus());
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !typing && phase !== 'setup') {
        e.preventDefault();
        undo();
      }
      // D drafts the selected player to whoever is on the clock. Bare key
      // only: Ctrl+D is the browser's bookmark shortcut.
      if (
        (e.key === 'd' || e.key === 'D') &&
        !e.ctrlKey && !e.metaKey && !e.altKey &&
        !typing && selected && canQuickDraft
      ) {
        e.preventDefault();
        quickDraft(selected);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const { playClick, playSuccess, playError, playOnTheClock } = useSounds();

  const isSnake = config.draftType === 'snake';
  const isAuction = config.draftType === 'auction';
  const isMock = config.mode === 'mock';
  const myTurn = phase === 'drafting' && derived.onTheClockId === config.myTeamId;

  // Positions a roster can't take another player at. My team drives mock
  // board filtering; the on-the-clock team drives the quick-draft button.
  const myFullPositions = useMemo(
    () => fullPositions(derived.teams.get(config.myTeamId)),
    [derived.teams, config.myTeamId],
  );
  const clockFullPositions = useMemo(
    () => fullPositions(derived.onTheClockId ? derived.teams.get(derived.onTheClockId) : undefined),
    [derived.teams, derived.onTheClockId],
  );

  // The one alert that must not be missed: a horn the moment it becomes
  // the user's pick (snake) or nomination (auction).
  const wasMyTurnRef = useRef(false);
  useEffect(() => {
    if (myTurn && !wasMyTurnRef.current) playOnTheClock();
    wasMyTurnRef.current = myTurn;
  }, [myTurn, playOnTheClock]);

  const playerById = useMemo(
    () => new Map(room.pool.players.map(p => [p.id, p])),
    [room.pool.players],
  );
  const run = useMemo(
    () => (phase === 'drafting' ? detectRun(room.events, playerById) : null),
    [phase, room.events, playerById],
  );
  const breaks = useMemo(
    () => (phase === 'drafting' ? tierAlerts(derived.available, derived.positionalDemand) : []),
    [phase, derived.available, derived.positionalDemand],
  );

  // Snake: where the draft comes back around to the user.
  const myNextPick = useMemo(() => {
    if (config.draftType !== 'snake' || phase !== 'drafting') return null;
    const orderedIds = config.teams.map(t => t.id);
    const from = myTurn ? derived.pickCount + 1 : derived.pickCount;
    return nextPickFor(config.myTeamId, orderedIds, from, derived.totalPicks);
  }, [config.draftType, config.teams, config.myTeamId, phase, myTurn, derived.pickCount, derived.totalPicks]);

  // Auction pacing: is the room's money going out faster than its picks?
  const spentPct = useMemo(() => {
    if (config.draftType !== 'auction') return null;
    const totalMoney = config.teams.length * config.budget;
    const spent = [...derived.teams.values()].reduce((sum, t) => sum + t.spent, 0);
    return totalMoney > 0 ? Math.round((spent / totalMoney) * 100) : 0;
  }, [config.draftType, config.teams.length, config.budget, derived.teams]);

  const lastEventTs = room.events.length > 0 ? room.events[room.events.length - 1].ts : null;

  // Screen-reader announcement of the latest pick and whose turn it is.
  // Sighted users get the status bar; this is the same signal for everyone.
  const announcement = useMemo(() => {
    if (phase !== 'drafting') return '';
    const last = room.events[room.events.length - 1];
    const parts: string[] = [];
    if (last) {
      const player = playerById.get(last.playerId);
      const teamId = last.kind === 'auction_sale' ? last.wonById : last.teamId;
      const team = config.teams.find(t => t.id === teamId);
      if (player && team) {
        parts.push(
          last.kind === 'auction_sale'
            ? `${player.name} sold to ${team.name} for $${last.price}.`
            : `Pick ${room.events.length}: ${player.name} to ${team.name}.`,
        );
      }
    }
    if (myTurn) {
      parts.push(config.draftType === 'auction' ? 'Your nomination.' : 'You are on the clock.');
    }
    return parts.join(' ');
  }, [phase, room.events, playerById, config.teams, config.draftType, myTurn]);
  // Quick drafting: log a player straight to the on-the-clock team. Only for
  // snake drafts, and in mock mode only when it's actually the user's pick
  // (the AI handles the rest).
  const canQuickDraft =
    phase === 'drafting' &&
    isSnake &&
    derived.onTheClockId !== null &&
    (config.mode === 'live' || derived.onTheClockId === config.myTeamId);

  const quickDraft = (player: PoolPlayer) => {
    if (!canQuickDraft || !derived.onTheClockId) return;
    const error = room.logEvent({
      kind: 'snake_pick',
      playerId: player.id,
      teamId: derived.onTheClockId,
    });
    if (error) playError();
    else {
      playSuccess();
      setSelected(null);
    }
  };

  // Falling behind on draft day: keep the best available pre-selected so
  // "Drafted" (or the D key) is always one action away. Skip positions the
  // drafting team can't roster (mine in a mock, the clock's in a live room):
  // that pick would only bounce off validation.
  useEffect(() => {
    if (phase !== 'drafting' || !isSnake || selected) return;
    const full = isMock ? myFullPositions : clockFullPositions;
    const best = derived.available.find(p => !full.has(p.pos));
    if (best) setSelected(best);
  }, [phase, isSnake, selected, derived.available, isMock, myFullPositions, clockFullPositions]);

  // Two-step inline confirm (no window.confirm): first click arms, second
  // click within 4s resets.
  const [resetArmed, setResetArmed] = useState(false);
  useEffect(() => {
    if (!resetArmed) return;
    const timer = setTimeout(() => setResetArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [resetArmed]);

  const confirmReset = () => {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetArmed(false);
    playClick();
    reset();
  };

  const clearSelection = () => setSelected(null);

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <h1 className={styles.title}>Draft Room</h1>
          <p className={styles.subtitle}>
            {league.name} · {config.season} {isAuction ? 'Auction' : 'Snake'}
            {isMock ? ' · Mock' : ''}
          </p>
        </div>

        <div aria-live="polite" className="visually-hidden">
          {announcement}
        </div>

        {phase === 'setup' ? (
          <DraftSetup room={room} league={league} />
        ) : (
          <>
            {phase === 'complete' && <DraftRecap room={room} />}

            <div
              className={`${styles.statusBar} ${phase === 'drafting' ? styles.statusBarLive : ''} ${
                myTurn ? styles.statusBarMine : ''
              }`}
            >
              <span className={styles.statusItem}>
                Pick {Math.min(derived.pickCount + 1, derived.totalPicks)}/{derived.totalPicks}
              </span>
              {derived.onTheClockId && (
                <span className={styles.statusItem}>
                  {myTurn ? (
                    <strong className={styles.statusYou}>
                      {isAuction ? 'YOUR NOMINATION' : "YOU'RE UP"}
                    </strong>
                  ) : (
                    <>
                      {isAuction ? 'Nominating: ' : 'On the clock: '}
                      <strong className={styles.statusStrong}>
                        {config.teams.find(t => t.id === derived.onTheClockId)?.name}
                      </strong>
                    </>
                  )}
                </span>
              )}
              {isSnake && !myTurn && myNextPick !== null && (
                <span className={styles.statusItem} title="Where the snake comes back to you">
                  Your next: #{myNextPick + 1} ({myNextPick - derived.pickCount} away)
                </span>
              )}
              {isAuction && derived.pickCount > 0 && (
                <span
                  className={styles.statusItem}
                  title="Remaining money vs the sheet value of the players still to be drafted. Positive: the room underpaid so far, so what's left costs more than the sheet says."
                >
                  Inflation:{' '}
                  <strong
                    className={
                      room.inflation.rate >= 1 ? styles.statusStrong : styles.statusBlood
                    }
                  >
                    {room.inflation.rate >= 1 ? '+' : ''}
                    {Math.round((room.inflation.rate - 1) * 100)}%
                  </strong>
                </span>
              )}
              {spentPct !== null && derived.pickCount > 0 && (
                <span
                  className={styles.statusItem}
                  title="Share of the room's total money already spent vs share of picks made"
                >
                  Money: {spentPct}% spent · picks{' '}
                  {Math.round((derived.pickCount / derived.totalPicks) * 100)}%
                </span>
              )}
              {run && (
                <span className={styles.statusAlert} title={`${run.count} of the last ${run.window} picks were ${run.pos}s`}>
                  {run.pos} RUN
                </span>
              )}
              {breaks.map(b => (
                <span
                  key={b.pos}
                  className={styles.statusAlert}
                  title={`${b.left} Tier ${b.tier} ${b.pos}${b.left === 1 ? '' : 's'} left and ${b.demand} teams still need ${b.pos}`}
                >
                  T{b.tier} {b.pos}: {b.left} LEFT
                </span>
              ))}
              {phase === 'drafting' && (
                <span className={styles.statusItem}>
                  <PickTimer lastEventTs={lastEventTs} />
                </span>
              )}
              {liveSync.available && (
                <button
                  type="button"
                  className={liveSync.enabled ? styles.syncBtnOn : styles.syncBtn}
                  onClick={liveSync.toggle}
                  title={
                    liveSync.enabled
                      ? 'Auto-ingesting picks from the Sleeper draft every 10 seconds. Click to go back to manual logging.'
                      : 'Pull picks straight from the Sleeper draft so nobody has to type them'
                  }
                >
                  {liveSync.enabled
                    ? liveSync.status === 'syncing'
                      ? '● LIVE SYNC'
                      : '○ CONNECTING'
                    : 'Live Sync'}
                </button>
              )}
              <span className={styles.statusSpacer} />
              <button
                type="button"
                className={styles.statusUndoBtn}
                onClick={() => {
                  playClick();
                  undo();
                }}
                disabled={room.events.length === 0}
                title="Remove the last pick. Press again to keep backing out (Ctrl+Z works too)."
              >
                Undo
              </button>
              <button
                type="button"
                className={resetArmed ? styles.statusBtnDanger : styles.statusBtn}
                onClick={confirmReset}
                title={
                  resetArmed
                    ? 'Click again to delete every logged pick (completed drafts stay archived)'
                    : 'Delete every logged pick and return to setup'
                }
              >
                {resetArmed ? 'Confirm Reset?' : 'Reset Draft'}
              </button>
            </div>

            {liveSync.error && (
              <p className={styles.shortcutLegend} role="alert">
                Live sync stopped: {liveSync.error}
              </p>
            )}

            {phase === 'drafting' && (
              <p className={styles.shortcutLegend}>
                <kbd>/</kbd> search · <kbd>↑↓</kbd> move · <kbd>Enter</kbd> select
                {isSnake ? <> · <kbd>D</kbd> draft</> : <> · <kbd>1-9</kbd> winner</>}
                {' '}· <kbd>Ctrl+Z</kbd> undo
              </p>
            )}

            {isSnake && phase === 'drafting' && <PickStrip room={room} />}

            <div className={styles.grid}>
              <div className={styles.colSide}>
                {phase === 'drafting' &&
                  (isAuction ? (
                    isMock ? (
                      <MockBidPanel room={room} sim={sim} selected={selected} onLogged={clearSelection} />
                    ) : (
                      <AuctionLogger room={room} selected={selected} onLogged={clearSelection} />
                    )
                  ) : (
                    <SnakeLogger room={room} selected={selected} onLogged={clearSelection} />
                  ))}
                {isSnake && phase === 'drafting' && (
                  <SuggestionsPanel room={room} onSelect={setSelected} />
                )}
                {isAuction && phase === 'drafting' && (
                  <NominationPanel room={room} onSelect={setSelected} />
                )}
                <MyTeamPanel room={room} />
                <LeagueNeeds room={room} />
              </div>
              <div className={styles.colMain}>
                <div className={styles.tabs}>
                  {BOARD_TABS.map(tab => (
                    <button
                      key={tab.key}
                      type="button"
                      className={boardTab === tab.key ? styles.tabOn : styles.tab}
                      onClick={() => setBoardTab(tab.key)}
                      title={tab.title}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                {boardTab === 'board' && (
                  <AvailablePlayers
                    room={room}
                    selectedId={selected?.id ?? null}
                    onSelect={setSelected}
                    onQuickDraft={canQuickDraft ? quickDraft : undefined}
                    excludedPositions={isSnake && isMock ? myFullPositions : undefined}
                    clockFullPositions={clockFullPositions}
                    yahooCosts={yahoo.costs}
                    inputRef={searchRef}
                  />
                )}
                {boardTab === 'tiers' && (
                  <TierBoard room={room} selectedId={selected?.id ?? null} onSelect={setSelected} />
                )}
                {boardTab === 'nfl' && (
                  <NflTeams room={room} selectedId={selected?.id ?? null} onSelect={setSelected} />
                )}
              </div>
            </div>

            <div className={styles.logSection}>
              <PickLog room={room} />
            </div>

            <div className={styles.teamsSection}>
              <TeamBoard room={room} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
