import { describe, it, expect } from 'vitest';
import { disambiguateIds, duplicateSleeperRows, parseCsv, playerId } from './poolBuild';

// The build script that uses these runs daily, unattended, and commits its
// output straight to master. Nothing downstream asserts on what it produced, so
// these are the assertions standing between a silent join/id regression and the
// live site.

describe('playerId', () => {
  // Saved Draft Room sessions persist these ids. A change to the scheme
  // silently orphans every logged pick in every saved session, which is why
  // CLAUDE.md says not to touch it without a migration. Pin the exact strings.
  it('slugs name and position', () => {
    expect(playerId('Jahmyr Gibbs', 'RB', 'DET')).toBe('jahmyr-gibbs-rb');
    expect(playerId('Puka Nacua', 'WR', 'LAR')).toBe('puka-nacua-wr');
  });

  it('keys defences on the franchise, not the name', () => {
    expect(playerId('Denver Broncos', 'DST', 'DEN')).toBe('dst-den');
    // Same franchise reached by a different label must land on the same id.
    expect(playerId('Broncos D/ST', 'DST', 'DEN')).toBe('dst-den');
  });

  it('strips punctuation and case so ranking-source spelling drift is stable', () => {
    expect(playerId("Ja'Marr Chase", 'WR', 'CIN')).toBe('jamarr-chase-wr');
    expect(playerId('Jaxon Smith-Njigba', 'WR', 'SEA')).toBe('jaxon-smithnjigba-wr');
  });

  it('ignores generational suffixes, which sources disagree about', () => {
    expect(playerId('Michael Pittman Jr.', 'WR', 'IND')).toBe(
      playerId('Michael Pittman', 'WR', 'IND'),
    );
  });

  it('separates two positions for the same name', () => {
    expect(playerId('Lamar Jackson', 'QB', 'BAL')).not.toBe(
      playerId('Lamar Jackson', 'CB', 'LV'),
    );
  });
});

describe('disambiguateIds', () => {
  it('leaves unique ids untouched', () => {
    const players = [
      { id: 'a-rb', name: 'A', team: 'DET' },
      { id: 'b-wr', name: 'B', team: 'LAR' },
    ];
    expect(disambiguateIds(players)).toEqual([]);
    expect(players.map(p => p.id)).toEqual(['a-rb', 'b-wr']);
  });

  it('suffixes every member of a colliding group with its franchise', () => {
    // Not just the second one: suffixing only the loser would leave the
    // winner's id dependent on ranking order, so it would move day to day.
    const players = [
      { id: 'mike-williams-wr', name: 'Mike Williams', team: 'LAC' },
      { id: 'mike-williams-wr', name: 'Mike Williams', team: 'NYJ' },
      { id: 'solo-te', name: 'Solo', team: 'KC' },
    ];
    expect(disambiguateIds(players)).toEqual([]);
    expect(players.map(p => p.id)).toEqual([
      'mike-williams-wr-lac',
      'mike-williams-wr-nyj',
      'solo-te',
    ]);
  });

  it('handles a three-way collision', () => {
    const players = [
      { id: 'josh-allen-lb', name: 'Josh Allen', team: 'JAC' },
      { id: 'josh-allen-lb', name: 'Josh Allen', team: 'BUF' },
      { id: 'josh-allen-lb', name: 'Josh Allen', team: 'CHI' },
    ];
    expect(disambiguateIds(players)).toEqual([]);
    expect(new Set(players.map(p => p.id)).size).toBe(3);
  });

  it('reports an id the franchise suffix cannot separate', () => {
    // Same name, position AND team: the caller must fail the build rather than
    // ship two players sharing one id.
    const players = [
      { id: 'dupe-rb', name: 'Dupe', team: 'DET' },
      { id: 'dupe-rb', name: 'Dupe', team: 'DET' },
    ];
    expect(disambiguateIds(players)).toEqual(['dupe-rb-det']);
  });
});

describe('duplicateSleeperRows', () => {
  const row = (over: Partial<Parameters<typeof duplicateSleeperRows>[0][number]>) => ({
    name: 'Isaiah Williams',
    team: 'FA',
    pos: 'WR',
    overallRank: 511,
    sleeperId: '11608',
    ...over,
  });

  it('keeps the row whose franchise agrees with the Sleeper dump', () => {
    // The real 2026-08 case: FantasyPros carried a lingering FA row next to
    // the NYJ row for the same player, and both matched Sleeper id 11608.
    const fa = row({ team: 'FA', overallRank: 511 });
    const nyj = row({ team: 'NYJ', overallRank: 551 });
    const groups = duplicateSleeperRows([fa, nyj], new Map([['11608', 'NYJ']]));
    expect(groups).toEqual([{ keeper: nyj, dropped: [fa] }]);
  });

  it('falls back to the better rank when no row matches the dump team', () => {
    const better = row({ team: 'FA', overallRank: 511 });
    const worse = row({ team: 'PHI', overallRank: 551 });
    const groups = duplicateSleeperRows([worse, better], new Map([['11608', 'NYJ']]));
    expect(groups).toEqual([{ keeper: better, dropped: [worse] }]);
  });

  it('compares franchises canonically, so a Sleeper JAX dump team keeps a JAC row', () => {
    const jac = row({ team: 'JAC', overallRank: 551 });
    const fa = row({ team: 'FA', overallRank: 511 });
    const groups = duplicateSleeperRows([fa, jac], new Map([['11608', 'JAC']]));
    expect(groups).toEqual([{ keeper: jac, dropped: [fa] }]);
  });

  it('leaves distinct players, rows without a sleeperId, and DSTs alone', () => {
    const players = [
      row({ sleeperId: '1' }),
      row({ sleeperId: '2', team: 'NYJ' }),
      row({ sleeperId: undefined }),
      row({ sleeperId: undefined }),
      // DST "ids" are team codes; two defenses never legitimately collide, and
      // the pass must not try to merge them if a source ever mislabels one.
      row({ pos: 'DST', sleeperId: 'JAX', team: 'JAC' }),
      row({ pos: 'DST', sleeperId: 'JAX', team: 'JAC' }),
    ];
    expect(duplicateSleeperRows(players, new Map())).toEqual([]);
  });
});

describe('parseCsv', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    // The salary sheet carries names like "Smith, Jr." — splitting on the comma
    // would shift every later column and mis-price the row.
    expect(parseCsv('name,salary\n"Smith, Jr.",42')).toEqual([
      ['name', 'salary'],
      ['Smith, Jr.', '42'],
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([['a'], ['say "hi"']]);
  });

  it('handles CRLF without emitting empty fields', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops blank rows but keeps a trailing row with no newline', () => {
    expect(parseCsv('a\n\n\nb')).toEqual([['a'], ['b']]);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
