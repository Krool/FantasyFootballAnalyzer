import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { DraftSheet, type SheetTab } from '@/components/draftRoom/DraftSheet';
import { SHEET_HEIGHT, type SheetSnap } from '@/components/draftRoom/sheetSnap';
import { LeagueNeeds } from '@/components/draftRoom/LeagueNeeds';
import { MockBidPanel } from '@/components/draftRoom/MockBidPanel';
import { MockControls } from '@/components/draftRoom/MockControls';
import { MyTeamPanel } from '@/components/draftRoom/MyTeamPanel';
import { NflTeams } from '@/components/draftRoom/NflTeams';
import { NominationPanel } from '@/components/draftRoom/NominationPanel';
import { PickLog } from '@/components/draftRoom/PickLog';
import { QueuePanel } from '@/components/draftRoom/QueuePanel';
import { TeamBoard } from '@/components/draftRoom/TeamBoard';
import { TeamsTab } from '@/components/draftRoom/TeamsTab';
import { TierBoard } from '@/components/draftRoom/TierBoard';
import { POOL } from '@/data/draftPool';
import { detectRun } from '@/utils/draftAlerts';
import { hasDraftedPoolSeason } from '@/utils/draftSeasonState';
import { allKeepers, draftableSlotCount, fullPositions, lineupRows, reservedKeepersFor } from '@/utils/draftEngine';
import { vibrate } from '@/utils/haptics';
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

// Desktop right rail: one element, tabbed. Roster is the default; Queue
// only exists while drafting; Log holds the pick log (with Undo/CSV).
type SideTab = 'roster' | 'queue' | 'log';

type SheetTabKey = 'players' | 'queue' | 'team' | 'log' | 'settings';

// Settings is last and wears a glyph: it holds the controls that used to
// crowd the status bar (pace, sound, live sync, reset). They belong at the
// bottom of a phone where the thumb already is, not stacked above the board.
const SHEET_TABS: SheetTab[] = [
  { key: 'players', label: 'Players' },
  { key: 'queue', label: 'Queue' },
  { key: 'team', label: 'Team' },
  { key: 'log', label: 'Log' },
  { key: 'settings', label: '⚙', ariaLabel: 'Draft settings', narrow: true },
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
  // Typed text that isn't a Sleeper draft URL or id.
  const [watchBad, setWatchBad] = useState(false);
  const [boardTab, setBoardTab] = useState<BoardTab>('board');
  const [sideTab, setSideTab] = useState<SideTab>('roster');
  // Phone drafting swaps the three-panel grid for a Sleeper-style bottom
  // sheet: the board owns the screen and these tabs ride in the sheet.
  const isPhone = useMediaQuery('(max-width: 640px)');
  const [sheetTab, setSheetTab] = useState<SheetTabKey>('players');
  // Owned here, not in the sheet: collapsing the sheet has to hand the space
  // back to the board, so both need to read it. Opens at HALF - the player
  // list is the reason you're on this screen.
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('half');
  // Which roster the Teams tab is showing; lives here so flipping to another
  // tab and back doesn't lose the place. null = the user's own team.
  const [viewTeamId, setViewTeamId] = useState<string | null>(null);
  // A transient flourish when one of your own picks is a clear value.
  const [spark, setSpark] = useState<string | null>(null);
  const lastSparkSeqRef = useRef(-1);

  const { phase, config, derived, undo, reset } = room;

  // Phone + live draft = focus mode. The class drives the one piece of
  // chrome this page doesn't own (the app-level guest banner); everything
  // else it hides directly. Cleared on unmount so leaving mid-draft - back
  // button, tab switch - can't strand the banner hidden on other pages.
  const draftFocus = phase === 'drafting' && isPhone;
  useEffect(() => {
    if (!draftFocus) return;
    document.body.classList.add('draft-focus');
    return () => document.body.classList.remove('draft-focus');
  }, [draftFocus]);


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
  // The handler lives in a ref so the listener mounts ONCE: this page
  // re-renders on every draft event, and a dep-less effect was tearing down
  // and re-registering the window listener hundreds of times per draft.
  const keydownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keydownRef.current = (e: KeyboardEvent) => {
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
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => keydownRef.current(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
    if (myTurn && !wasMyTurnRef.current) {
      playOnTheClock();
      vibrate([60, 30, 60]);
    }
    wasMyTurnRef.current = myTurn;
  }, [myTurn, playOnTheClock]);

  const playerById = useMemo(
    () => new Map(room.pool.players.map(p => [p.id, p])),
    [room.pool.players],
  );

  // Roster-fill counts for the board's filter chips ("RB 1/2"), keepers
  // included so a reserved slot reads as filled from pick one. This replaced
  // the "Still need:" line in the roster panel.
  const slotCounts = useMemo(() => {
    if (phase !== 'drafting') return undefined;
    const me = derived.teams.get(config.myTeamId);
    if (!me) return undefined;
    const reserved = reservedKeepersFor(
      config.myTeamId,
      allKeepers(config),
      derived.reservedPlayerIds,
      playerById,
    );
    const entries = [...me.picks, ...reserved];
    const lineup = lineupRows(entries, config.rosterSlots);
    const counts = new Map<string, { filled: number; total: number }>();
    for (const row of lineup) {
      if (row.slot === 'BENCH') continue;
      // Superflex folds into the FLEX chip; there's no SFLX filter.
      const key = row.slot === 'SUPERFLEX' ? 'FLEX' : row.slot;
      const c = counts.get(key) ?? { filled: 0, total: 0 };
      c.total += 1;
      if (row.pick) c.filled += 1;
      counts.set(key, c);
    }
    // IR is not draftable, so it never counts toward the ALL chip.
    const rosterSize = config.draftType === 'snake'
      ? config.rounds
      : draftableSlotCount(config.rosterSlots);
    counts.set('ALL', { filled: entries.length, total: rosterSize });
    return counts;
  }, [phase, config, derived.teams, derived.reservedPlayerIds, playerById]);

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
      vibrate(40);
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

  // The Queue tab only exists while drafting; fall back to the roster when
  // the draft completes (or resets) with it open.
  const activeSideTab: SideTab = sideTab === 'queue' && phase !== 'drafting' ? 'roster' : sideTab;
  // Queued players still on the open board (drafted and keeper-reserved ones
  // fall out of the panel the same way).
  const queuedCount = useMemo(
    () =>
      queue.ids.filter(
        id => !derived.draftedPlayerIds.has(id) && !derived.reservedPlayerIds.has(id),
      ).length,
    [queue.ids, derived.draftedPlayerIds, derived.reservedPlayerIds],
  );

  // The money logger, auction only. Snake picks log through the per-row
  // Draft buttons (plus the D key), with Undo in the status bar and the
  // Pick Log; the old Log Pick panel is gone.
  const logger =
    phase === 'drafting' && isAuction ? (
      isMock ? (
        <MockBidPanel room={room} sim={sim} selected={selected} onLogged={clearSelection} />
      ) : (
        <AuctionLogger room={room} selected={selected} onLogged={clearSelection} />
      )
    ) : null;

  const playersPane = (
    <AvailablePlayers
      room={room}
      selectedId={selected?.id ?? null}
      onSelect={setSelected}
      onQuickDraft={phase === 'drafting' && isSnake ? quickDraft : undefined}
      quickDraftActive={canQuickDraft}
      excludedPositions={isSnake && isMock ? myFullPositions : undefined}
      clockFullPositions={clockFullPositions}
      yahooCosts={yahoo.costs}
      picksUntilMine={openPicksUntilMine}
      suggested={isSnake ? suggested : undefined}
      handcuffFor={isSnake ? handcuffFor : undefined}
      queue={phase === 'drafting' ? { queued: queue.queued, toggle: queue.toggle } : undefined}
      slotCounts={slotCounts}
      inputRef={searchRef}
    />
  );

  const phoneSheet = draftFocus;

  // The league's real draft for the season this room targets is already done.
  const alreadyDrafted = hasDraftedPoolSeason(league);

  const configSummary = `${league.name} · ${config.season} ${isAuction ? 'Auction' : 'Snake'} · ${
    SCORING_LABEL[config.scoring]
  }${config.rosterSlots.SUPERFLEX > 0 ? ' · Superflex' : ''}${
    config.tePremium ? ' · TEP' : ''
  }${isMock ? ' · Mock' : ''}`;

  // The controls that used to trail the status bar. On desktop they stay in
  // the bar; on a phone they move into the settings pane so the bar can be a
  // single status line. Same elements either way - one definition, so the
  // two placements can't drift apart.
  const draftControls = (
    <>
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
    </>
  );

  return (
    <div
      className={phoneSheet ? `${styles.page} ${styles.pageWithSheet}` : styles.page}
      // How much of the viewport the sheet is currently eating. The board's
      // scroller and the page's bottom padding both size against it, so
      // minimizing the sheet grows the board instead of leaving dead space.
      style={
        phoneSheet
          ? ({ '--sheet-h': SHEET_HEIGHT[sheetSnap] } as React.CSSProperties)
          : undefined
      }
    >
      <div className={phase === 'setup' ? 'container' : `container ${styles.wide}`}>
        {/* The masthead is orientation, and mid-draft on a phone you are
            already oriented - it cost a screenful above the board. The same
            config line reappears at the top of the settings pane, which is
            where you'd go looking for it. */}
        {!phoneSheet && (
          <div className={styles.header}>
            <h1 className={styles.title}>Draft Room</h1>
            <p className={styles.subtitle}>{configSummary}</p>
          </div>
        )}

        {showConnectedBanner && (
          <ConnectedBanner onDismiss={() => setShowConnectedBanner(false)} />
        )}

        <div aria-live="polite" className="visually-hidden">
          {announcement}
        </div>

        {phase === 'setup' ? (
          <>
            {/* Reachable by URL or the year dropdown even after the header
                stops advertising it. Say the draft is over and point at the
                analysis rather than opening straight onto a setup screen for
                a draft that already happened; mocks stay available below. */}
            {alreadyDrafted && (
              <div className={styles.draftDonePanel}>
                <h2 className={styles.draftDoneTitle}>This league already drafted</h2>
                <p className={styles.draftDoneCopy}>
                  {league.name} finished its {POOL.season} draft, so there is nothing left to run
                  here. The picks, grades, and projections are on the Draft Analysis page.
                </p>
                <div className={styles.draftDoneActions}>
                  <Link to="/draft" className={styles.draftDoneCta}>
                    See the draft analysis
                  </Link>
                </div>
                <p className={styles.draftDoneAside}>
                  Setting up below still runs a mock against the {POOL.season} board.
                </p>
              </div>
            )}
            <DraftSetup room={room} league={league} />
          </>
        ) : (
          <>
            {phase === 'complete' && <DraftRecap room={room} />}

            <div
              className={`${styles.statusBar} ${phase === 'drafting' ? styles.statusBarLive : ''} ${
                myTurn ? styles.statusBarMine : ''
              } ${phoneSheet ? styles.statusBarFocus : ''}`}
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
                        {/* The strip has one job and the pick counter sits
                            right beside the name, so the label is understood
                            without saying it. Kept on desktop, where the bar
                            carries other items the name could be confused
                            with. */}
                        {!phoneSheet && (isAuction ? 'Nominating: ' : 'On the clock: ')}
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
              {/* Focus mode hides the app header, so the strip carries the
                  way out. Fixed width and always rendered, so it can't shift
                  the row. Leaving is safe: the session is saved and the room
                  offers to resume it. */}
              {phoneSheet && (
                <Link
                  to="/"
                  className={styles.statusClose}
                  aria-label="Leave the draft room"
                  title="Leave the draft room. Your draft is saved."
                >
                  ✕
                </Link>
              )}
              {/* Rendered on your own turn too (it reads as "where you pick
                  after this one"): the chip appearing and disappearing at
                  every handoff re-wrapped the bar at some widths, which
                  changed its height - a page jump right at YOU'RE UP. */}
              {isSnake && myNextPick !== null && (
                <span
                  className={`${styles.statusItem} ${styles.statusSecondary} ${styles.statusNext}`}
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
              {!phoneSheet && liveSync.available && !liveSync.enabled && (
                <input
                  type="text"
                  className={watchBad ? styles.watchInputBad : styles.watchInput}
                  placeholder="Mock draft URL (optional)"
                  defaultValue={liveSync.watchId ?? ''}
                  onChange={e => {
                    // Blank clears back to the league's own draft.
                    setWatchBad(!liveSync.setWatch(e.target.value) && e.target.value.trim() !== '');
                  }}
                  title="Paste a sleeper.com draft URL to follow that draft instead of your league's. Sleeper doesn't list mocks under a league, so this is the only way to rehearse against one."
                />
              )}
              {!phoneSheet && liveSync.available && (
                <button
                  type="button"
                  className={liveSync.enabled ? styles.syncBtnOn : styles.syncBtn}
                  onClick={liveSync.toggle}
                  disabled={liveSync.enabled && liveSync.status === 'connecting'}
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
              {!phoneSheet && (
                <>
                  <span className={styles.statusSpacer} />
                  {isMock && phase === 'drafting' && (
                    <MockControls sim={sim} isSnake={isSnake} />
                  )}
                  {draftControls}
                </>
              )}
            </div>

            {liveSync.error && (
              <p className={styles.shortcutLegend} role="alert">
                Live sync stopped: {liveSync.error}
              </p>
            )}

            {watchBad && (
              <p className={styles.shortcutLegend} role="alert">
                That isn't a Sleeper draft link. Paste the URL from the draft
                itself, like sleeper.com/draft/nfl/1234567890.
              </p>
            )}

            {liveSync.mismatch && (
              <p className={styles.shortcutLegend} role="alert">
                Heads up: that draft doesn't match this room ({liveSync.mismatch}).
                Picks still land, but the board order and pick advice follow this
                room's settings.
              </p>
            )}

            {/* One persistent line for the whole time sync is on, whose text
                swaps between healthy and retrying. The retry state used to be
                its own paragraph that popped in and out above the board on
                every flaky poll, bouncing the layout mid-draft. */}
            {liveSync.enabled && (
              <p
                className={styles.shortcutLegend}
                role={liveSync.status === 'error' ? 'alert' : undefined}
              >
                {liveSync.status === 'error'
                  ? 'Live sync hit a snag and is retrying. Picks may be a few seconds behind; log manually if it persists.'
                  : liveSync.watchId && !liveSync.mismatch
                    ? `${
                        liveSync.watchSlot
                          ? `Following draft ${liveSync.watchId} from seat ${liveSync.watchSlot}, which is mapped to your team.`
                          : `Following draft ${liveSync.watchId}. Couldn't tell which seat is yours, so picks are seated in slot order.`
                      } Clear the field to go back to your league's own draft.`
                    : 'Live sync on: pulling picks from the Sleeper draft every 10 seconds.'}
              </p>
            )}

            {liveSync.unmapped.length > 0 && (
              <p className={styles.shortcutLegend} role="alert">
                Live sync couldn't match {liveSync.unmapped.join(', ')} to the
                rankings pool. Everything else is syncing; log those by hand if
                they're on the board.
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

            <div className={phoneSheet ? styles.boardAnchor : undefined}>
              {isSnake ? <DraftBoard room={room} /> : <AuctionBoard room={room} />}
            </div>

            {phoneSheet ? (
              <DraftSheet
                tabs={SHEET_TABS}
                active={sheetTab}
                onTabChange={key => setSheetTab(key as SheetTabKey)}
                snap={sheetSnap}
                onSnapChange={setSheetSnap}
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
                {sheetTab === 'settings' && (
                  <div className={styles.settingsPane}>
                    <p className={styles.settingsSummary}>{configSummary}</p>
                    {isMock && (
                      <div className={styles.settingsGroup}>
                        <span className={styles.settingsLabel}>Mock pace</span>
                        <MockControls sim={sim} isSnake={isSnake} />
                      </div>
                    )}
                    {liveSync.available && (
                      <div className={styles.settingsGroup}>
                        <span className={styles.settingsLabel}>Live sync</span>
                        {!liveSync.enabled && (
                          <input
                            type="text"
                            className={watchBad ? styles.watchInputBad : styles.watchInput}
                            placeholder="Mock draft URL (optional)"
                            defaultValue={liveSync.watchId ?? ''}
                            onChange={e => {
                              setWatchBad(
                                !liveSync.setWatch(e.target.value) &&
                                  e.target.value.trim() !== '',
                              );
                            }}
                            title="Paste a sleeper.com draft URL to follow that draft instead of your league's."
                          />
                        )}
                        <button
                          type="button"
                          className={liveSync.enabled ? styles.syncBtnOn : styles.syncBtn}
                          onClick={liveSync.toggle}
                          disabled={liveSync.enabled && liveSync.status === 'connecting'}
                        >
                          {liveSync.enabled
                            ? liveSync.status === 'syncing'
                              ? '● LIVE SYNC'
                              : liveSync.status === 'error'
                                ? '○ RECONNECTING'
                                : '○ CONNECTING'
                            : 'Live Sync'}
                        </button>
                      </div>
                    )}
                    <div className={styles.settingsGroup}>
                      <span className={styles.settingsLabel}>Draft</span>
                      <div className={styles.settingsRow}>{draftControls}</div>
                    </div>
                    {/* Focus mode hides the app nav, so the way out lives
                        here. Leaving is safe: the session is saved and the
                        room offers to resume it. */}
                    <div className={styles.settingsGroup}>
                      <span className={styles.settingsLabel}>Leave</span>
                      <div className={styles.settingsRow}>
                        <Link to="/rankings" className={styles.settingsLink}>
                          Rankings
                        </Link>
                        <Link to="/values" className={styles.settingsLink}>
                          Values
                        </Link>
                        <Link to="/" className={styles.settingsLink}>
                          Home
                        </Link>
                      </div>
                    </div>
                  </div>
                )}
              </DraftSheet>
            ) : (
              <>
                <div className={logger ? styles.grid : `${styles.grid} ${styles.gridNoLog}`}>
                  {logger && <div className={styles.colLog}>{logger}</div>}
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
                    {/* Keyed on the tab so switching remounts the pane and
                        replays the fade-in instead of only fading in once. */}
                    <div key={boardTab} className={styles.tabPane}>
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
                  </div>
                  <div className={styles.colSide}>
                    <div className={styles.tabs}>
                      <button
                        type="button"
                        className={activeSideTab === 'roster' ? styles.tabOn : styles.tab}
                        aria-pressed={activeSideTab === 'roster'}
                        onClick={() => setSideTab('roster')}
                        title="Your roster, lineup-shaped"
                      >
                        Roster
                      </button>
                      {phase === 'drafting' && (
                        <button
                          type="button"
                          className={activeSideTab === 'queue' ? styles.tabOn : styles.tab}
                          aria-pressed={activeSideTab === 'queue'}
                          onClick={() => setSideTab('queue')}
                          title="Your ordered shortlist; queue players with the + button on the board"
                        >
                          Queue{queuedCount > 0 ? ` · ${queuedCount}` : ''}
                        </button>
                      )}
                      <button
                        type="button"
                        className={activeSideTab === 'log' ? styles.tabOn : styles.tab}
                        aria-pressed={activeSideTab === 'log'}
                        onClick={() => setSideTab('log')}
                        title="Every logged pick, newest first, with Undo and CSV export"
                      >
                        Log
                      </button>
                    </div>
                    {activeSideTab === 'roster' && <MyTeamPanel room={room} />}
                    {activeSideTab === 'queue' && phase === 'drafting' && (
                      <>
                        {isAuction && <NominationPanel room={room} onSelect={setSelected} />}
                        <QueuePanel room={room} queue={queue} onSelect={setSelected} />
                      </>
                    )}
                    {activeSideTab === 'log' && <PickLog room={room} />}
                  </div>
                </div>

                <div className={styles.teamsSection}>
                  {/* Post-draft every row reads FULL; the panel is noise. */}
                  {phase !== 'complete' && <LeagueNeeds room={room} layout="row" />}
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
