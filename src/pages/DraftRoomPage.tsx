import { useEffect, useRef, useState } from 'react';
import type { League } from '@/types';
import type { PoolPlayer } from '@/types/draft';
import { useDraftRoom } from '@/hooks/useDraftRoom';
import { useDraftSim } from '@/hooks/useDraftSim';
import { useSounds } from '@/hooks/useSounds';
import { useYahooValues } from '@/hooks/useYahooValues';
import { AuctionLogger } from '@/components/draftRoom/AuctionLogger';
import { AvailablePlayers } from '@/components/draftRoom/AvailablePlayers';
import { DraftSetup } from '@/components/draftRoom/DraftSetup';
import { LeagueNeeds } from '@/components/draftRoom/LeagueNeeds';
import { MockBidPanel } from '@/components/draftRoom/MockBidPanel';
import { MyTeamPanel } from '@/components/draftRoom/MyTeamPanel';
import { NflTeams } from '@/components/draftRoom/NflTeams';
import { PickLog } from '@/components/draftRoom/PickLog';
import { SnakeLogger } from '@/components/draftRoom/SnakeLogger';
import { SuggestionsPanel } from '@/components/draftRoom/SuggestionsPanel';
import { TeamBoard } from '@/components/draftRoom/TeamBoard';
import { TierBoard } from '@/components/draftRoom/TierBoard';
import styles from './DraftRoomPage.module.css';

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
  const searchRef = useRef<HTMLInputElement>(null);
  // The board is the selection surface: clicking a row feeds the logger.
  const [selected, setSelected] = useState<PoolPlayer | null>(null);
  const [boardTab, setBoardTab] = useState<BoardTab>('board');

  const { phase, config, derived, undo, reset } = room;

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

  const { playClick, playSuccess, playError } = useSounds();

  const isSnake = config.draftType === 'snake';
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
  // "Drafted" (or the D key) is always one action away.
  useEffect(() => {
    if (phase === 'drafting' && isSnake && !selected && derived.available.length > 0) {
      setSelected(derived.available[0]);
    }
  }, [phase, isSnake, selected, derived.available]);

  const confirmReset = () => {
    if (window.confirm('Reset the draft? All logged picks for this session will be deleted.')) {
      playClick();
      reset();
    }
  };

  const isAuction = config.draftType === 'auction';
  const isMock = config.mode === 'mock';
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

        {phase === 'setup' ? (
          <DraftSetup room={room} league={league} />
        ) : (
          <>
            {phase === 'complete' && (
              <div className={styles.completeBanner}>
                Draft complete. {derived.totalPicks} picks logged. Export the log below or reset to
                run it again.
              </div>
            )}

            <div className={styles.statusBar}>
              <span className={styles.statusItem}>
                Pick {Math.min(derived.pickCount + 1, derived.totalPicks)}/{derived.totalPicks}
              </span>
              {derived.onTheClockId && (
                <span className={styles.statusItem}>
                  {isAuction ? 'Nominating: ' : 'On the clock: '}
                  <strong className={styles.statusStrong}>
                    {config.teams.find(t => t.id === derived.onTheClockId)?.name}
                  </strong>
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
                className={styles.statusBtn}
                onClick={confirmReset}
                title="Delete every logged pick and return to setup"
              >
                Reset Draft
              </button>
            </div>

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
