import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TeamCard } from '@/components/TeamCard';
import type { League } from '@/types';
import { calculateLuckMetrics, type LuckMetrics, type MatchupData } from '@/utils/luck';
import { completedMatchups } from '@/utils/completedMatchups';
import { managerScores } from '@/utils/managerScore';
import { ShareImageButton } from '@/components/ShareImageButton';
import type { BoardColumn, CellInput, ShareBoardData } from '@/utils/shareBoard';
import { TeamDetail } from './TeamDetail';
import styles from './TeamsPage.module.css';

interface TeamsPageProps {
  league: League;
}

export function TeamsPage({ league }: TeamsPageProps) {
  // ?team=<id> opens the team hub; team names across the app link here.
  const [searchParams, setSearchParams] = useSearchParams();
  const detailTeam = useMemo(() => {
    const id = searchParams.get('team');
    return id ? league.teams.find(t => t.id === id) ?? null : null;
  }, [searchParams, league.teams]);

  const openTeam = (id: string | null) => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (id) params.set('team', id);
      else params.delete('team');
      return params;
    });
  };
  // Calculate luck metrics
  const luckByTeam = useMemo((): Map<string, LuckMetrics> => {
    const done = completedMatchups(league);
    if (done.length === 0) {
      return new Map();
    }

    const matchupData: MatchupData[] = done.map(m => ({
      week: m.week,
      team1Id: m.team1Id,
      team1Points: m.team1Points,
      team2Id: m.team2Id,
      team2Points: m.team2Points,
    }));

    const teams = league.teams.map(t => ({
      id: t.id,
      name: t.name,
      wins: t.wins || 0,
      losses: t.losses || 0,
      ties: t.ties || 0,
      pointsFor: t.pointsFor || 0,
    }));

    const metrics = calculateLuckMetrics(matchupData, teams, 10, {
      medianMatchup: league.hasMedianMatchup,
    });
    const map = new Map<string, LuckMetrics>();
    metrics.forEach(m => map.set(m.teamId, m));
    return map;
  }, [league]);

  // One number to argue about: draft + waivers + trades + schedule-adjusted
  // results, each normalized within the league.
  const scores = useMemo(() => {
    if (!league.matchups || league.matchups.length === 0) return [];
    return managerScores(league);
  }, [league]);

  // Season head-to-head grid: every pairing's record this season.
  const h2h = useMemo(() => {
    const grid = new Map<string, Map<string, { w: number; l: number; t: number }>>();
    for (const m of completedMatchups(league)) {
      if (m.team1Points === 0 && m.team2Points === 0) continue;
      const upd = (a: string, b: string, aPts: number, bPts: number) => {
        const row = grid.get(a) ?? new Map();
        const cell = row.get(b) ?? { w: 0, l: 0, t: 0 };
        if (aPts > bPts) cell.w++;
        else if (aPts < bPts) cell.l++;
        else cell.t++;
        row.set(b, cell);
        grid.set(a, row);
      };
      upd(m.team1Id, m.team2Id, m.team1Points, m.team2Points);
      upd(m.team2Id, m.team1Id, m.team2Points, m.team1Points);
    }
    return grid;
  }, [league]);

  // Sort teams by record (wins desc, then points for desc)
  const sortedTeams = [...league.teams].sort((a, b) => {
    const aWins = a.wins || 0;
    const bWins = b.wins || 0;
    if (aWins !== bWins) return bWins - aWins;

    const aPoints = a.pointsFor || 0;
    const bPoints = b.pointsFor || 0;
    return bPoints - aPoints;
  });

  const shortName = (name: string) =>
    name.length > 10 ? `${name.slice(0, 9)}…` : name;

  // ── Share images ──
  const anyTies = sortedTeams.some(t => (t.ties ?? 0) > 0);
  const anyPA = sortedTeams.some(t => (t.pointsAgainst ?? 0) > 0);
  const anyLuck = luckByTeam.size > 0;
  const skillOf = new Map(scores.map(s => [s.teamId, s.score]));
  const standingsBoard = (): ShareBoardData => {
    const columns: BoardColumn[] = [
      { label: '#', align: 'right' },
      { label: 'Team', kind: 'team' },
      { label: 'Record', align: 'right' },
      { label: 'PF', align: 'right' },
      ...(anyPA ? [{ label: 'PA', align: 'right' as const }] : []),
      ...(anyLuck ? [{ label: 'Luck', align: 'right' as const }] : []),
      ...(scores.length > 0 ? [{ label: 'Skill', align: 'right' as const }] : []),
    ];
    return {
      leagueName: league.name,
      season: league.season,
      title: 'Standings',
      slug: 'standings',
      footnote: scores.length > 0 ? 'Skill: draft, waivers, trades and all-play results, scored 0-100' : undefined,
      tables: [{
        columns,
        rows: sortedTeams.map((t, i): CellInput[] => {
          const luck = luckByTeam.get(t.id)?.luckScore;
          const skill = skillOf.get(t.id);
          return [
            String(i + 1),
            t.name,
            `${t.wins ?? 0}-${t.losses ?? 0}${anyTies ? `-${t.ties ?? 0}` : ''}`,
            (t.pointsFor ?? 0).toFixed(1),
            ...(anyPA ? [(t.pointsAgainst ?? 0).toFixed(1)] : []),
            ...(anyLuck
              ? [luck === undefined
                  ? { text: '-', tone: 'dim' as const }
                  : {
                      text: `${luck > 0 ? '+' : ''}${luck.toFixed(1)}`,
                      tone: luck >= 1 ? ('good' as const) : luck <= -1 ? ('bad' as const) : ('dim' as const),
                    }]
              : []),
            ...(scores.length > 0 ? [{ text: skill === undefined ? '-' : String(skill), tone: 'lime' as const }] : []),
          ];
        }),
      }],
    };
  };
  const gridBoard = (): ShareBoardData => ({
    leagueName: league.name,
    season: league.season,
    title: 'Head-to-head',
    slug: 'head_to_head',
    footnote: 'Season records, row team vs column team',
    tables: [{
      // Columns go by row number: twelve team names across the top made
      // the image too wide to read on a phone.
      columns: [
        { label: '#', align: 'right' },
        { label: 'Team', kind: 'team', max: 240 },
        ...sortedTeams.map((_, i) => ({ label: String(i + 1), align: 'center' as const })),
      ],
      rows: sortedTeams.map((row, ri) => [
        { text: String(ri + 1), tone: 'dim' },
        row.name,
        ...sortedTeams.map((col): CellInput => {
          if (row.id === col.id) return { text: '—', tone: 'dim' };
          const cell = h2h.get(row.id)?.get(col.id);
          if (!cell) return '';
          return {
            text: `${cell.w}-${cell.l}${cell.t ? `-${cell.t}` : ''}`,
            tone: cell.w > cell.l ? 'lime' : cell.l > cell.w ? 'terrible' : 'dim',
          };
        }),
      ]),
    }],
  });

  if (detailTeam) {
    return (
      <div className={styles.page}>
        <div className="container">
          <TeamDetail league={league} team={detailTeam} onBack={() => openTeam(null)} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <div className={styles.headerRow}>
            <h1 className={styles.title}>Team Overview</h1>
            <ShareImageButton
              label="Standings"
              ariaLabel="Copy standings image"
              hint="Standings with points, luck and skill score as one image for the group chat"
              build={standingsBoard}
            />
          </div>
          <p className={styles.subtitle}>
            {league.totalTeams} teams in {league.name}
          </p>
          {league.hasMedianMatchup && (
            <p className={styles.subtitle}>
              Median league — luck compares head-to-head results only; the extra
              weekly median win is excluded.
            </p>
          )}
          {league.isBestBall && (
            <p className={styles.subtitle}>
              Best ball — starters are auto-optimized, so points-since-pickup
              and lineup-based numbers reflect optimal lineups, not decisions.
            </p>
          )}
        </div>

        {scores.length > 0 && (
          <section className={styles.skillSection}>
            <h2 className={styles.sectionTitle}>Manager Skill Score</h2>
            <p className={styles.sectionHint}>
              {scores[0].components.trades === null
                ? 'Draft value, waiver PAR, and all-play results (35 / 24 / 41%; no trades yet, so trades sit out).'
                : 'Draft value (30%), waiver PAR (20%), trade PAR (15%), all-play results (35%).'}{' '}
              Each scored 0-100 against this league.
            </p>
            <div className={styles.skillList}>
              {scores.map((s, i) => (
                <div key={s.teamId} className={styles.skillRow}>
                  <span className={styles.skillRank}>{i + 1}</span>
                  <span className={styles.skillName}>{s.teamName}</span>
                  <span
                    className={styles.skillParts}
                    title={`Draft ${s.components.draft} · Waivers ${s.components.waivers}${s.components.trades === null ? '' : ` · Trades ${s.components.trades}`} · Results ${s.components.results}`}
                  >
                    D{s.components.draft} W{s.components.waivers}{s.components.trades === null ? '' : ` T${s.components.trades}`} R{s.components.results}
                  </span>
                  <div className={styles.skillBarTrack}>
                    <div className={styles.skillBarFill} style={{ width: `${s.score}%` }} />
                  </div>
                  <span className={styles.skillScore}>{s.score}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className={styles.grid}>
          {sortedTeams.map((team) => (
            <TeamCard
              key={team.id}
              league={league}
              team={team}
              luckMetrics={luckByTeam.get(team.id)}
              onClick={() => openTeam(team.id)}
            />
          ))}
        </div>

        {h2h.size > 1 && (
          <section className={styles.matrixSection}>
            <div className={styles.sectionHead}>
              <div>
                <h2 className={styles.sectionTitle}>Head-to-Head Grid</h2>
                <p className={styles.sectionHint}>Season records, row vs column.</p>
              </div>
              <ShareImageButton
                compact
                label="Copy"
                ariaLabel="Copy head-to-head grid image"
                hint="The head-to-head grid as one image for the group chat"
                build={gridBoard}
              />
            </div>
            <div className={`${styles.matrixWrapper} scroll-x-hint`}>
              <table className={styles.matrix}>
                <thead>
                  <tr>
                    <th />
                    {sortedTeams.map(t => (
                      <th key={t.id} scope="col" title={t.name}>
                        {shortName(t.name)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedTeams.map(row => (
                    <tr key={row.id}>
                      <th scope="row" title={row.name}>{shortName(row.name)}</th>
                      {sortedTeams.map(col => {
                        if (row.id === col.id) {
                          return <td key={col.id} className={styles.matrixSelf}>—</td>;
                        }
                        const cell = h2h.get(row.id)?.get(col.id);
                        if (!cell) return <td key={col.id} className={styles.matrixEmpty} />;
                        const cls =
                          cell.w > cell.l
                            ? styles.matrixWin
                            : cell.l > cell.w
                              ? styles.matrixLoss
                              : styles.matrixEven;
                        return (
                          <td key={col.id} className={cls} title={`${row.name} ${cell.w}-${cell.l}${cell.t ? `-${cell.t}` : ''} vs ${col.name}`}>
                            {cell.w}-{cell.l}
                            {cell.t > 0 ? `-${cell.t}` : ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
