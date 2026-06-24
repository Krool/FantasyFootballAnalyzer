// Content for the static tool landing pages (trade analyzer, draft grades).
// Kept separate from the ToolLanding component so that file only exports a
// component (react-refresh) and so the prerender can import the data without
// pulling in anything else. See src/pages/ToolLanding.tsx and
// scripts/prerender.tsx.

export interface ToolLandingCta {
  // Route path without the base (e.g. '' for home, 'rankings').
  to: string;
  label: string;
  primary?: boolean;
}

export interface ToolLandingContent {
  // dist/<path>/index.html, also the in-app route.
  path: string;
  title: string;
  desc: string;
  kicker: string;
  heading: string;
  intro: string;
  points: Array<{ h: string; p: string }>;
  ctas: ToolLandingCta[];
}

export const TOOL_LANDINGS: Record<'trade-analyzer' | 'draft-grades', ToolLandingContent> = {
  'trade-analyzer': {
    path: 'trade-analyzer',
    title: 'Fantasy Football Trade Analyzer (Free): Sleeper, ESPN, Yahoo',
    desc:
      'Free fantasy football trade analyzer for Sleeper, ESPN, and Yahoo. ' +
      'Grade every trade by the points each side actually scored after the deal, and crown the winner. No login.',
    kicker: '▌ TRADE VERDICTS',
    heading: 'Fantasy Football Trade Analyzer',
    intro:
      'Settle every trade with the only number that matters: points scored after the deal. ' +
      'Connect your Sleeper, ESPN, or Yahoo league and the trade analyzer grades each side on what their ' +
      'players produced once they changed teams, then names the winner.',
    points: [
      { h: 'Judged on real production', p: 'Not preseason hype. Each side is scored on the fantasy points its acquired players put up after the trade.' },
      { h: 'Both sides graded', p: 'A letter grade per manager and a clear verdict, so the group chat argument is over.' },
      { h: 'Every league, every season', p: 'Works across Sleeper, ESPN, and Yahoo, for the current season and your league history.' },
    ],
    ctas: [
      { to: '', label: 'Connect your league', primary: true },
      { to: 'rankings', label: 'Browse rankings' },
    ],
  },
  'draft-grades': {
    path: 'draft-grades',
    title: 'Fantasy Football Draft Grades & Grader (Free): Sleeper, ESPN, Yahoo',
    desc:
      'Free fantasy football draft grades for Sleeper, ESPN, and Yahoo. ' +
      'Grade every pick on actual season production, see who found value and who reached, and run mock drafts. No login.',
    kicker: '▌ DRAFT GRADES',
    heading: 'Fantasy Football Draft Grades',
    intro:
      'Find out who won your draft on the only evidence that counts: how the picks actually scored. ' +
      'Connect your Sleeper, ESPN, or Yahoo league for a letter grade on every pick and every team, ' +
      'or run a mock draft first to pressure-test your board.',
    points: [
      { h: 'Graded on production', p: 'Each pick is scored against what it returned in started games, so value and reaches are obvious.' },
      { h: 'Team draft leaderboard', p: 'See which manager drafted best, who reached early, and who stole value late.' },
      { h: 'Mock first', p: 'Practice snake or auction drafts against AI opponents, then grade the real thing.' },
    ],
    ctas: [
      { to: '', label: 'Connect your league', primary: true },
      { to: 'draft-room', label: 'Run a mock draft' },
    ],
  },
};
