import { useState } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import { useSounds } from '@/hooks/useSounds';
import { inflateValue } from '@/utils/inflation';
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

  const effectiveNominator = nominatorId || derived.onTheClockId || config.teams[0]?.id || '';
  // Compare the sale against the inflation-adjusted price: that's what the
  // player should actually cost in THIS room, not on the preseason sheet.
  const expected = selected
    ? inflateValue(scaledValues.get(selected.id) ?? 1, inflation.rate)
    : null;

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

      {selected ? (
        <div className={styles.clockMine}>
          <span className={styles.clockKicker}>
            {selected.pos}
            {selected.posRank} · {selected.team} · #{selected.overallRank} · Tier {selected.tier}
          </span>
          <span className={styles.clockTeam}>{selected.name}</span>
        </div>
      ) : (
        <div className={styles.clock}>
          <span className={styles.clockKicker}>No player selected</span>
          <span className={styles.clockTeam}>Pick a player from the board</span>
        </div>
      )}

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
        <span className={styles.label}>Won By</span>
        <select className={styles.select} value={winnerId} onChange={e => setWinnerId(e.target.value)}>
          <option value="">Select team...</option>
          {config.teams.map(t => {
            const teamState = derived.teams.get(t.id)!;
            const cantBuy =
              teamState.openSlots === 0 ||
              (selected ? teamState.fullAt[selected.pos as keyof typeof teamState.fullAt] ?? false : false);
            return (
              <option key={t.id} value={t.id} disabled={cantBuy}>
                {t.name} (${teamState.maxBid} max{cantBuy ? ', full' : ''})
              </option>
            );
          })}
        </select>
      </div>

      <div className={styles.priceRow}>
        <div className={styles.field}>
          <span className={styles.label}>Price</span>
          <input
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
