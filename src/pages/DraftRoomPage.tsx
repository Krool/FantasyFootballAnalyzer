import { useEffect, useMemo, useRef, useState } from 'react';
import type { League } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import { useDraftQueue } from '@/hooks/useDraftQueue';
import { useDraftRoom } from '@/hooks/useDraftRoom';
import { useDraftSim } from '@/hooks/useDraftSim';
import { useLiveDraftSync } from '@/hooks/useLiveDraftSync';
import { useSounds } from '@/hooks/useSounds';
import { useSuggestedPicks } from '@/hooks/useSuggestedPicks';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useYahooValues } from '@/hooks/useYahooValues';
import { AuctionBoard } from '@/components/draftRoom/AuctionBoard';
import { AuctionLogger } from '@/components/draftRoom/AuctionLogger';
import { AvailablePlayers } from '@/components/draftRoom/AvailablePlayers';
import { ConnectedBanner } from '@/components/draftRoom/ConnectedBanner';
import { DraftBoard } from '@/components/draftRoom/DraftBoard';
import { DraftRecap } from '@/components/draftRoom/DraftRecap';
import { DraftSetup } from '@/components/draftRoom/DraftSetup';
import { DraftSheet } from '@/components/draftRoom/DraftSheet';
import { LeagueNeeds } from '@/components/draftRoom/LeagueNeeds';
import { MockBidPanel } from '@/components/draftRoom/MockBidPanel';
import { MockControls } from '@/components/draftRoom/MockControls';
import { MyTeamPanel } from '@/components/draftRoom/MyTeamPanel';
import { NflTeams } from '@/components/draftRoom/NflTeams';
import { NominationPanel } from '@/components/draftRoom/NominationPanel';
import { PickLog } from '@/components/draftRoom/PickLog';
import { QueuePanel } from '@/components/draftRoom/QueuePanel';
import { SnakeLogger } from '@/components/draftRoom/SnakeLogger';
import { TeamBoard } from '@/components/draftRoom/TeamBoard';
import { TeamsTab } from '@/components/draftRoom/TeamsTab';
import { TierBoard } from '@/components/draftRoom/TierBoard';
import { detectRun } from '@/utils/draftAlerts';
import { fullPositions } from '@/utils/draftEngine';
import { picksUntilMine } from '@/utils/pickPreview';
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

const SCORING_LABEL: Record<string, string> = {
  standard: 'Standard',
  half_ppr: 'Half PPR',
  ppr: 'Full PPR',
  custom: 'Custom',
};

type BoardTab = 'board' | 'tiers' | 'teams' | 'nfl';

const BOARD_TABS: Array<{ key: BoardTab; label: string; title: string }> = [
  { key: 'board', label: 'Board', title: 'Every available player, sortable by rank and value' },
  { key: 'tiers', label: 'Tiers', title: 'Remaining players stacked by position and tier' },
  { key: 'teams', label: 'Teams', title: 'One league roster at a time; arrows flip between teams' },
  { key: 'nfl', label: 'NFL Teams', title: 'The pool by NFL roster: stacks, handcuffs, teammates' },
];

type SheetTabKey = 'players' | 'queue' | 'team' | 'log';

const SHEET_TABS: Array<{ key: SheetTabKey; label: string }> = [
  { key: 'players', label: 'Players' },
  { key: 'queue', label: 'Queue' },
  { key: 'team', label: 'Team' },
  { key: 'log', label: 'Log' },
];

interface DraftRoomPageProps {
  league: League;
  // True only for the first render after a fresh successful connect landed
  // here because the league has no draft data yet (App's isEmptyPreseason
  // routing). Shows a one-time confirmation so the connect doesn't look like
  // it silently failed.
  justConnected?: boolean;
}

export function DraftRoomPage({ league, justConnected }: DraftRoomPageProps) {
  const room = useDraftRoom(league);
  const [showConnectedBanner, setShowConnectedBanner] = useState(!!justConnected);
  const queue = useDraftQueue(room.config.leagueKey);
  const sim = useDraftSim(room, { myQueue: queue.ids });
  const yahoo = useYahooValues(room.pool);
  const liveSync = useLiveDraftSync(league, room);
  // Suggested picks + handcuffs highlight inline on the player board.
  const { suggested, handcuffFor } = useSuggestedPicks(
    room,
    room.config.draftType === 'snake' && room.phase === 'drafting',
  );
  const searchRef = useRef<HTMLInputElement>(null);
  // The board is the selection surface: clicking a row feeds the logger.
  const [selected, setSelected] = useState<PoolPlayer | null>(null);
  const [boardTab, setBoardTab] = useState<BoardTab>('board');
  // Phone drafting swaps the three-panel grid for a Sleeper-style bottom
  // sheet: the board owns the screen and these tabs ride in the sheet.
  const isPhone = useMediaQuery('(max-width: 640px)');
  const [sheetTab, setSheetTab] = useState<SheetTabKey>('players');
  // Which roster the Teams tab is showing; lives here so flipping to another
  // tab and back doesn't lose the place. null = the user's own team.
  const [viewTeamId, setViewTeamId] = useState<string | null>(null);
  // A transient flourish when one of your own picks is a clear value.
  const [spark, setSpark] = useState<string | null>(null);
  const lastSparkSeqRef = useRef(-1);

  const { phase, config, derived, undo, reset } = room;

  // Each phase swaps the whole view (setup form -> draft board -> recap),
  // but the browser keeps the old scroll position: hitting Start at the
  // bottom of the setup form would land you at the bottom of the board.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phase]);

  // Post-draft, the Board tab is an empty pool search; land on the rosters
  // instead. Leaving complete (undo reopens the draft, reset starts a new
  // one) must land back on Board, or the room reopens on the wrong tab.
  useEffect(() => {
    setBoardTab(phase === 'complete' ? 'teams' : 'board');
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
      // Drafting only: post-draft the Board tab is an empty pool search,
      // and yanking the recap over to it would be a dead end.
      if (e.key === '/' && !typing && phase === 'drafting') {
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

  const { playClick, playSuccess, playError, playOnTheClock, isMuted, toggleMute } = useSounds();

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

  // Celebrate your own value picks: a snake player who slid well past his board
  // rank, or an auction buy comfortably under his adjusted value.
  useEffect(() => {
    if (phase !== 'drafting' || room.events.length === 0) return;
    const last = room.events[room.events.length - 1];
    if (last.seq === lastSparkSeqRef.current) return;
    lastSparkSeqRef.current = last.seq;
    if (last.isKeeper) return;
    const owner = last.kind === 'auction_sale' ? last.wonById : last.teamId;
    if (owner !== config.myTeamId) return;
    const player = playerById.get(last.playerId);
    if (!player) return;
    let msg: string | null = null;
    if (last.kind === 'snake_pick') {
      const fell = room.events.length - player.overallRank;
      if (fell >= config.teams.length) msg = `STEAL · ${player.name} slid ${fell} past his rank`;
    } else {
      const value = room.scaledValues.get(last.playerId) ?? 1;
      if (last.price <= value * 0.7 && value - last.price >= 3) {
        msg = `BARGAIN · ${player.name} for $${value - last.price} under value`;
      }
    }
    if (msg) setSpark(msg);
  }, [room.events, phase, config.myTeamId, config.teams.length, playerById, room.scaledValues]);

  useEffect(() => {
    if (!spark) return;
    const timer = setTimeout(() => setSpark(null), 1800);
    return () => clearTimeout(timer);
  }, [spark]);

  const run = useMemo(
    () => (phase === 'drafting' ? detectRun(room.events, playerById) : null),
    [phase, room.events, playerById],
  );
  // Snake: where the draft comes back around to the user.
  const myNextPick = useMemo(() => {
    if (config.draftType !== 'snake' || phase !== 'drafting') return null;
    const orderedIds = config.teams.map(t => t.id);
    const from = myTurn ? derived.pickCount + 1 : derived.pickCount;
    return nextPickFor(config.myTeamId, orderedIds, from, derived.totalPicks, config.snakeFormat);
  }, [config.draftType, config.snakeFormat, config.teams, config.myTeamId, phase, myTurn, derived.pickCount, derived.totalPicks]);

  // Of the picks before the user's next turn, how many can actually take
  // someone off the open board. Keeper-locked slots don't count: those
  // picks are spoken for by players already outside the pool.
  const openPicksUntilMine = useMemo(() => {
    if (config.draftType !== 'snake' || phase !== 'drafting' || myTurn || myNextPick === null) {
      return null;
    }
    return picksUntilMine(
      config.myTeamId,
      config.teams.map(t => t.id),
      derived.pickCount,
      derived.totalPicks,
      config.keepers,
      derived.draftedPlayerIds,
      config.snakeFormat,
    ).filter(p => !p.isMine && !p.keeperPlayerId).length;
  }, [
    config.draftType,
    config.snakeFormat,
    config.myTeamId,
    config.teams,
    config.keepers,
    phase,
    myTurn,
    myNextPick,
    derived.pickCount,
    derived.totalPicks,
    derived.draftedPlayerIds,
  ]);

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

  // Shared between the desktop three-panel grid and the phone bottom sheet.
  const logger =
    phase === 'drafting' ? (
      isAuction ? (
        isMock ? (
          <MockBidPanel room={room} sim={sim} selected={selected} onLogged={clearSelection} />
        ) : (
          <AuctionLogger room={room} selected={selected} onLogged={clearSelection} />
        )
      ) : (
        <SnakeLogger room={room} selected={selected} onLogged={clearSelection} simPaused={sim.paused} />
      )
    ) : null;

  const playersPane = (
    <AvailablePlayers
      room={room}
      selectedId={selected?.id ?? null}
      onSelect={setSelected}
      onQuickDraft={canQuickDraft ? quickDraft : undefined}
      excludedPositions={isSnake && isMock ? myFullPositions : undefined}
      clockFullPositions={clockFullPositions}
      yahooCosts={yahoo.costs}
      picksUntilMine={openPicksUntilMine}
      suggested={isSnake ? suggested : undefined}
      handcuffFor={isSnake ? handcuffFor : undefined}
      queue={phase === 'drafting' ? { queued: queue.queued, toggle: queue.toggle } : undefined}
      inputRef={searchRef}
    />
  );

  const phoneSheet = phase === 'drafting' && isPhone;

  return (
    <div className={phoneSheet ? `${styles.page} ${styles.pageWithSheet}` : styles.page}>
      <div className={phase === 'setup' ? 'container' : `container ${styles.wide}`}>
        <div className={styles.header}>
          <h1 className={styles.title}>Draft Room</h1>
          <p className={styles.subtitle}>
            {league.name} · {config.season} {isAuction ? 'Auction' : 'Snake'}
            {' · '}{SCORING_LABEL[config.scoring]}
            {config.rosterSlots.SUPERFLEX > 0 ? ' · Superflex' : ''}
            {config.tePremium ? ' · TEP' : ''}
            {isMock ? ' · Mock' : ''}
          </p>
        </div>

        {showConnectedBanner && (
          <ConnectedBanner onDismiss={() => setShowConnectedBanner(false)} />
        )}

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
              {/* The only contents that change pick to pick live together in
                  one group: on phones it renders as a single fixed-height row
                  (name ellipsizes, alert keeps a slot) so the board below
                  stops jumping as names and badges come and go. */}
              <div className={styles.statusPrimary}>
                <span className={styles.statusItem}>
                  Pick {Math.min(derived.pickCount + 1, derived.totalPicks)}/{derived.totalPicks}
                </span>
                {derived.onTheClockId && (
                  <span className={`${styles.statusItem} ${styles.statusClock}`}>
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
                {run && (
                  <span className={styles.statusAlert} title={`${run.count} of the last ${run.window} picks were ${run.pos}s`}>
                    {run.pos} RUN
                  </span>
                )}
              </div>
              {isSnake && !myTurn && myNextPick !== null && (
                <span
                  className={`${styles.statusItem} ${styles.statusSecondary}`}
                  title="Where the snake comes back to you"
                >
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
                  className={`${styles.statusItem} ${styles.statusSecondary}`}
                  title="Share of the room's total money already spent vs share of picks made"
                >
                  Money: {spentPct}% spent · picks{' '}
                  {Math.round((derived.pickCount / derived.totalPicks) * 100)}%
                </span>
              )}
              {phase === 'drafting' && (
                <span className={`${styles.statusItem} ${styles.statusSecondary}`}>
                  <PickTimer lastEventTs={lastEventTs} />
                </span>
              )}
              {/* Last in the info group: the chip comes and goes with the
                  run, and popping in mid-bar shoved every item after it. */}
              {run && (
                <span className={styles.statusAlert} title={`${run.count} of the last ${run.window} picks were ${run.pos}s`}>
                  {run.pos} RUN
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
                      : liveSync.status === 'error'
                        ? '○ RECONNECTING'
                        : '○ CONNECTING'
                    : 'Live Sync'}
                </button>
              )}
              <span className={styles.statusSpacer} />
              {isMock && phase === 'drafting' && <MockControls sim={sim} isSnake={isSnake} />}
              <button
                type="button"
                className={styles.soundBtn}
                onClick={toggleMute}
                aria-pressed={isMuted}
                title={isMuted ? 'Sounds are off. Click to unmute.' : 'Mute all app sounds'}
              >
                {isMuted ? '🔇' : '🔊'}
              </button>
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

            {liveSync.enabled && liveSync.status === 'error' && (
              <p className={styles.shortcutLegend} role="alert">
                Live sync hit a snag and is retrying. Picks may be a few seconds behind; log manually if it persists.
              </p>
            )}

            {yahoo.status === 'error' && (
              <p className={styles.shortcutLegend} role="alert">
                Yahoo prices failed to load. Reconnect Yahoo and reload to see market values.
              </p>
            )}

            {phase === 'drafting' && (
              <p className={`${styles.shortcutLegend} ${styles.kbdHints}`}>
                <kbd>/</kbd> search · <kbd>↑↓</kbd> move · <kbd>Enter</kbd> select
                {isSnake ? <> · <kbd>D</kbd> draft</> : <> · <kbd>1-9</kbd> winner</>}
                {' '}· <kbd>Ctrl+Z</kbd> undo
              </p>
            )}

            {spark && (
              <div className={styles.spark} role="status">
                {spark}
              </div>
            )}

            {isSnake ? <DraftBoard room={room} /> : <AuctionBoard room={room} />}

            {phoneSheet ? (
              <DraftSheet
                tabs={SHEET_TABS}
                active={sheetTab}
                onTabChange={key => setSheetTab(key as SheetTabKey)}
              >
                {/* Players stays pure pool: the row Draft buttons cover the
                    common logging flows, and the full logger (odd cases:
                    another team's pick, auction sales) lives in Log. */}
                {sheetTab === 'players' && playersPane}
                {sheetTab === 'queue' && (
                  <>
                    {isAuction && <NominationPanel room={room} onSelect={setSelected} />}
                    <QueuePanel room={room} queue={queue} onSelect={setSelected} />
                  </>
                )}
                {sheetTab === 'team' && (
                  <>
                    <MyTeamPanel room={room} />
                    <LeagueNeeds room={room} />
                  </>
                )}
                {sheetTab === 'log' && (
                  <>
                    {logger}
                    <PickLog room={room} />
                  </>
                )}
              </DraftSheet>
            ) : (
              <>
                <div className={styles.grid}>
                  <div className={styles.colLog}>
                    {logger}
                    <PickLog room={room} />
                  </div>
                  <div className={styles.colMain}>
                    <div className={styles.tabs}>
                      {BOARD_TABS.map(tab => (
                        <button
                          key={tab.key}
                          type="button"
                          className={boardTab === tab.key ? styles.tabOn : styles.tab}
                          aria-pressed={boardTab === tab.key}
                          onClick={() => setBoardTab(tab.key)}
                          title={tab.title}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    {boardTab === 'board' && playersPane}
                    {boardTab === 'tiers' && (
                      <TierBoard room={room} selectedId={selected?.id ?? null} onSelect={setSelected} />
                    )}
                    {boardTab === 'teams' && (
                      <TeamsTab room={room} viewTeamId={viewTeamId} onViewTeam={setViewTeamId} />
                    )}
                    {boardTab === 'nfl' && (
                      <NflTeams room={room} selectedId={selected?.id ?? null} onSelect={setSelected} />
                    )}
                  </div>
                  <div className={styles.colSide}>
                    {isAuction && phase === 'drafting' && (
                      <NominationPanel room={room} onSelect={setSelected} />
                    )}
                    {phase === 'drafting' && (
                      <QueuePanel room={room} queue={queue} onSelect={setSelected} />
                    )}
                    <MyTeamPanel room={room} />
                    {/* Post-draft every row reads FULL; the panel is noise. */}
                    {phase !== 'complete' && <LeagueNeeds room={room} />}
                  </div>
                </div>

                <div className={styles.teamsSection}>
                  <TeamBoard room={room} />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
