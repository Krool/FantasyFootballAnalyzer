import { useState } from 'react';
import type { PoolPlayer } from '@/types/draft';
import type { UseDraftRoomReturn } from '@/hooks/useDraftRoom';
import type { UseDraftSimReturn } from '@/hooks/useDraftSim';
import { useSounds } from '@/hooks/useSounds';
import { comfortBid } from '@/utils/auctionMath';
import { inflateValue } from '@/utils/inflation';
import { SelectedPlayerCard } from './SelectedPlayerCard';
import styles from './Logger.module.css';

interface MockBidPanelProps {
  room: UseDraftRoomReturn;
  sim: UseDraftSimReturn;
  selected: PoolPlayer | null;
  onLogged: () => void;
}

// The auction mock loop: nominate (from the board) when it's your turn,
// otherwise enter your max bid on each nomination and let the AI teams bid
// against you.
export function MockBidPanel({ room, sim, selected, onLogged }: MockBidPanelProps) {
  const { config, derived, scaledValues, inflation } = room;
  const [maxBid, setMaxBid] = useState('');
  const { playSuccess } = useSounds();

  const me = derived.teams.get(config.myTeamId);
  const nominatorName = sim.pending
    ? config.teams.find(t => t.id === sim.pending!.nominatorId)?.name ?? '?'
    : null;

  if (sim.awaitingMyNomination) {
    return (
      <div className={styles.logger}>
        <h2 className={styles.title}>Your Nomination</h2>
        <SelectedPlayerCard
          player={selected}
          detail={selected ? `Exp $${scaledValues.get(selected.id) ?? 1}` : undefined}
        />
        <button
          type="button"
          className={styles.submit}
          disabled={!selected}
          onClick={() => {
            if (selected) {
              sim.nominate(selected);
              onLogged();
            }
          }}
        >
          Nominate
        </button>
        {sim.notice && <div className={styles.error}>{sim.notice}</div>}
      </div>
    );
  }

  if (!sim.pending) {
    const upNext = derived.onTheClockId
      ? config.teams.find(t => t.id === derived.onTheClockId)?.name
      : null;
    return (
      <div className={styles.logger}>
        <h2 className={styles.title}>Auction</h2>
        <div className={styles.clock}>
          <span className={styles.clockKicker}>Nominating</span>
          <span className={styles.clockTeam}>{upNext ?? '...'}</span>
        </div>
        {sim.notice && <div className={styles.error}>{sim.notice}</div>}
      </div>
    );
  }

  const { player } = sim.pending;
  // The AI bids around this same inflation-adjusted number.
  const expected = inflateValue(scaledValues.get(player.id) ?? 1, inflation.rate);
  const myCap = me?.fullAt[player.pos as keyof typeof me.fullAt] ? 0 : me?.maxBid ?? 0;
  const myComfort =
    me && myCap > 0 ? comfortBid(player, me, derived.available, scaledValues) : null;
  const submit = (amount: number) => {
    playSuccess();
    sim.resolve(amount);
    setMaxBid('');
  };

  // Live-bidding mode: a running auction instead of a sealed max.
  if (config.liveBidding && sim.liveBid) {
    const { highBid, highBidderId } = sim.liveBid;
    const iAmHigh = highBidderId === config.myTeamId;
    const bidderName = highBidderId
      ? config.teams.find(t => t.id === highBidderId)?.name ?? '?'
      : null;
    const nextBid = highBid + 1;
    // How the live price sits against market, so you can judge the bid.
    const overMarket = highBid - expected;
    return (
      <div className={styles.logger}>
        <h2 className={styles.title}>On The Block</h2>
        <SelectedPlayerCard player={player} detail={`Nominated by ${nominatorName}`} />
        <div className={iAmHigh ? styles.clockMine : styles.clock}>
          <div className={styles.liveTopRow}>
            <span className={styles.livePrice}>${highBid > 0 ? highBid : nextBid}</span>
            <div className={styles.liveMeta}>
              <span className={styles.clockKicker}>{highBid > 0 ? 'High bid' : 'Opening bid'}</span>
              <span className={styles.liveBidder}>
                {highBid > 0 ? (iAmHigh ? 'YOU' : bidderName) : 'no bids yet'}
              </span>
            </div>
          </div>
          <div className={styles.liveExpRow}>
            <span className={styles.label}>Exp ${expected}</span>
            {highBid > 0 && (
              <span className={overMarket > 0 ? styles.deltaBad : styles.deltaGood}>
                {overMarket > 0
                  ? `+$${overMarket} over`
                  : overMarket < 0
                    ? `$${-overMarket} under`
                    : 'at value'}
              </span>
            )}
          </div>
        </div>
        <div className={styles.priceRow}>
          <button
            type="button"
            className={styles.submit}
            disabled={iAmHigh || myCap < nextBid}
            onClick={() => {
              playSuccess();
              sim.placeBid(nextBid);
            }}
          >
            Bid ${nextBid}
          </button>
          <button
            type="button"
            className={styles.submit}
            disabled={iAmHigh || myCap < highBid + 5}
            onClick={() => {
              playSuccess();
              sim.placeBid(highBid + 5);
            }}
          >
            Bid ${highBid + 5}
          </button>
        </div>
        <p className={styles.liveHint}>
          Say nothing and the hammer falls{iAmHigh ? ', he is yours.' : '.'}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.logger}>
      <h2 className={styles.title}>On The Block</h2>
      <SelectedPlayerCard player={player} detail={`Nominated by ${nominatorName}`} />
      <div className={styles.priceRow}>
        <div className={styles.field}>
          <span className={styles.label}>Your Max Bid {myCap > 0 ? `(cap $${myCap})` : '(full)'}</span>
          <input
            type="number"
            aria-label="Your max bid"
            className={styles.priceInput}
            min={0}
            max={myCap}
            value={maxBid}
            disabled={myCap === 0}
            onChange={e => setMaxBid(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submit(Math.min(Number(maxBid) || 0, myCap));
            }}
          />
        </div>
        <div className={styles.expected}>
          <span className={styles.label}>Expected</span>
          <span className={styles.expectedValue}>${expected}</span>
        </div>
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
      <div className={styles.priceRow}>
        <button
          type="button"
          className={styles.submit}
          onClick={() => submit(Math.min(Number(maxBid) || 0, myCap))}
        >
          Run Bidding
        </button>
      </div>
    </div>
  );
}
