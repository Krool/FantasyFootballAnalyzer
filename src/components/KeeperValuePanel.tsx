import type { KeeperValueRow } from '@/utils/keeperValue';
import { TeamLink } from './TeamLink';
import { PosBadge } from './PosBadge';
import styles from './KeeperValuePanel.module.css';

interface KeeperValuePanelProps {
  rows: KeeperValueRow[];
}

const money = (n: number) => `$${n.toFixed(1)}`;

// Keepers carry no reach-or-steal grade in the table, because the round they
// cost was set by the league's keeper rule rather than by anyone reading the
// board. This is the judgment they do deserve: was the player worth the pick
// he consumed?
export function KeeperValuePanel({ rows }: KeeperValuePanelProps) {
  if (rows.length === 0) return null;

  const best = rows[0];
  const worst = rows[rows.length - 1];

  return (
    <section className={styles.panel} aria-labelledby="keeperValueTitle">
      <h3 id="keeperValueTitle" className={styles.title}>
        Who got the best keeper?
      </h3>
      <p className={styles.blurb}>
        A keeper is a trade with the draft: you surrender the pick his cost round eats and receive a
        player the board rates somewhere else. Both sides are priced on the same curve, which is
        steep early and flat late, so turning a 6th into a 2nd beats turning a 13th into a 5th even
        though the second jumps twice as many rounds.
      </p>

      <div className={`${styles.tableWrap} scroll-x-hint`}>
        <table className={`table ${styles.table}`}>
          <thead>
            <tr>
              <th>Team</th>
              <th>Keeper</th>
              <th>Pos</th>
              <th className="text-center" title="Where the FantasyPros consensus ranks him overall">
                FP#
              </th>
              <th className="text-center" title="The round his consensus rank corresponds to: what he is worth on the board">
                Asset
              </th>
              <th className="text-center" title="The round the keeper actually cost">
                Cost
              </th>
              <th className="text-right" title="Curve value of the player, minus the value of the pick surrendered">
                Surplus
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={`${row.teamId}-${row.playerName}`}>
                <td className={styles.team}>
                  <TeamLink teamId={row.teamId} name={row.teamName} />
                </td>
                <td className={styles.player}>{row.playerName}</td>
                <td>
                  <PosBadge pos={row.pos} />
                </td>
                <td className="font-mono text-center">{row.consensusRank}</td>
                <td className="font-mono text-center">R{row.assetRound}</td>
                <td className="font-mono text-center">R{row.costRound}</td>
                <td
                  className={`font-mono text-right ${row.surplus >= 0 ? styles.good : styles.bad}`}
                  title={`Worth ${money(row.worth)}, paid ${money(row.paid)}`}
                >
                  {row.surplus >= 0 ? '+' : '−'}
                  {money(Math.abs(row.surplus))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 1 && (
        <p className={styles.footnote}>
          {/* A keeper rule that charges a round or two of interest can price
              every keeper above market. Topping that table is not a win, so
              only call it one when the surplus is actually positive — and
              exactly zero is a break-even, not "the cheapest overpay" (the
              table styles +$0.0 green). */}
          {best.surplus > 0
            ? `${best.teamName} got the most out of the keeper rule: ${best.playerName}, a round ${best.assetRound} asset for a round ${best.costRound} pick.`
            : best.surplus === 0
              ? `Nobody beat the keeper rule this year. The closest was ${best.teamName}'s ${best.playerName}, a round ${best.assetRound} asset for a round ${best.costRound} pick — dead even.`
              : `Nobody beat the keeper rule this year. The cheapest overpay was ${best.teamName}'s ${best.playerName}, a round ${best.assetRound} asset for a round ${best.costRound} pick.`}
          {/* Negative surplus can happen inside a single round (rank 60 kept at
              pick 55), where "later than" would contradict the numbers shown.
              Renders in the all-negative league too — the biggest overpay is
              the line a commissioner quotes (rows.length > 1 above guarantees
              this is a different row than best). */}
          {worst.surplus < 0 &&
            ` ${worst.teamName} paid over the odds for ${worst.playerName}, ${
              worst.assetRound > worst.costRound
                ? `whose market round (${worst.assetRound}) is later than the round he cost (${worst.costRound})`
                : `worth less on the board than the round ${worst.costRound} pick he consumed`
            }.`}
        </p>
      )}
    </section>
  );
}
