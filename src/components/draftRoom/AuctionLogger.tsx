import { useEffect, useRef, useState } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { comfortBid } from '@/utils/auctionMath';
import { inflateValue } from '@/utils/inflation';
import { SelectedPlayerCard } from './SelectedPlayerCard';
import styles from './Logger.module.css';

interface AuctionLoggerProps {
  room: UseDraftRoomReturn;
  selected: PoolPlayer | null;
  onLogged: () => void;
}

export function AuctionLogger({ room, selected, onLogged }: AuctionLoggerProps) {
  const { config, derived, scaledValues, inflation, logEvent } = room;
  // Empty string means "follow the rotation"; a manual choice sticks for one sale.
  const [nominatorId, setNominatorId] = useState('');
  const [winnerId, setWinnerId] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { playSuccess, playError } = useSounds();
  const winnerRef = useRef<HTMLSelectElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  // Two-digit team picks ("1" then "2" = team 12) buffer briefly.
  const digitBuffer = useRef('');
  const digitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveNominator = nominatorId || derived.onTheClockId || config.teams[0]?.id || '';
  // Compare the sale against the inflation-adjusted price: that's what the
  // player should actually cost in THIS room, not on the preseason sheet.
  const expected = selected
    ? inflateValue(scaledValues.get(selected.id) ?? 1, inflation.rate)
    : null;

  const me = derived.teams.get(config.myTeamId);
  // "What can I pay for THIS player and still finish my roster" — the
  // number you actually need mid-bidding-war.
  const myComfort =
    selected && me && me.openSlots > 0
      ? comfortBid(selected, me, derived.available, scaledValues)
      : null;

  // Keyboard flow for a fast room: picking a player (Enter in search or a
  // row click) jumps focus here so the next keystrokes pick the winner.
  useEffect(() => {
    if (selected) winnerRef.current?.focus();
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectTeamByNumber = (raw: string) => {
    const n = Number(raw);
    const team = config.teams[n - 1];
    if (!team) return;
    setWinnerId(team.id);
    priceRef.current?.focus();
  };

  const onWinnerKeyDown = (e: React.KeyboardEvent<HTMLSelectElement>) => {
    if (!/^[0-9]$/.test(e.key)) return;
    e.preventDefault();
    if (digitTimer.current) clearTimeout(digitTimer.current);
    digitBuffer.current += e.key;
    const buffered = Number(digitBuffer.current);
    // Unambiguous (no team count starts with this prefix beyond it): commit
    // now; otherwise wait a beat for a second digit.
    if (buffered * 10 > config.teams.length) {
      selectTeamByNumber(digitBuffer.current);
      digitBuffer.current = '';
    } else {
      digitTimer.current = setTimeout(() => {
        selectTeamByNumber(digitBuffer.current);
        digitBuffer.current = '';
      }, 450);
    }
  };

  const submit = () => {
    if (!selected || !winnerId) {
      setError('Pick a player from the board and a winning team.');
      return;
    }
    const result = logEvent({
      kind: 'auction_sale',
      playerId: selected.id,
      nominatedById: effectiveNominator,
      wonById: winnerId,
      price: Number(price),
      // Stamp the adjusted value we displayed so the pick log agrees with
      // what the user saw at sale time.
      expectedValue: expected ?? undefined,
    });
    setError(result);
    if (result) {
      playError();
    } else {
      playSuccess();
      setNominatorId('');
      setWinnerId('');
      setPrice('');
      onLogged();
    }
  };

  return (
    <div className={styles.logger}>
      <h2 className={styles.title}>Log Sale</h2>

      <SelectedPlayerCard player={selected} />

      <div className={styles.field}>
        <span className={styles.label}>Nominated By</span>
        <select
          className={styles.select}
          value={effectiveNominator}
          onChange={e => setNominatorId(e.target.value)}
        >
          {config.teams.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.id === derived.onTheClockId ? ' (up)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Won By (type the team number)</span>
        <select
          ref={winnerRef}
          className={styles.select}
          value={winnerId}
          onChange={e => setWinnerId(e.target.value)}
          onKeyDown={onWinnerKeyDown}
        >
          <option value="">Select team...</option>
          {config.teams.map((t, i) => {
            const teamState = derived.teams.get(t.id)!;
            const cantBuy =
              teamState.openSlots === 0 ||
              (selected ? teamState.fullAt[selected.pos as keyof typeof teamState.fullAt] ?? false : false);
            return (
              <option key={t.id} value={t.id} disabled={cantBuy}>
                {i + 1}. {t.name} (${teamState.maxBid} max{cantBuy ? ', full' : ''})
              </option>
            );
          })}
        </select>
      </div>

      <div className={styles.priceRow}>
        <div className={styles.field}>
          <span className={styles.label}>Price</span>
          <input
            ref={priceRef}
            type="number"
            className={styles.priceInput}
            min={1}
            value={price}
            onChange={e => setPrice(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submit();
            }}
          />
        </div>
        {expected !== null && (
          <div className={styles.expected}>
            <span className={styles.label}>Expected</span>
            <span className={styles.expectedValue}>${expected}</span>
            {price !== '' && Number(price) > 0 && (
              <span className={Number(price) <= expected ? styles.deltaGood : styles.deltaBad}>
                {Number(price) <= expected ? '' : '+'}
                {Number(price) - expected} vs value
              </span>
            )}
          </div>
        )}
        {myComfort !== null && (
          <div className={styles.expected}>
            <span
              className={styles.label}
              title="Your highest bid that still leaves market price for every open starter slot plus $1 per bench spot"
            >
              Your comfort
            </span>
            <span className={styles.expectedValue}>${myComfort}</span>
          </div>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <button
        type="button"
        className={styles.submit}
        onClick={submit}
        disabled={!selected || !winnerId || !price}
      >
        Sold
      </button>
    </div>
  );
}
