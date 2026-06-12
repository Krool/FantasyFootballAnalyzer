// Static identity for the 32 NFL franchises: full name, brand colors, and
// the ESPN CDN logo slug. Keyed by the canonical abbreviation produced by
// canonicalTeam() in utils/playerNames (FantasyPros convention: JAC, WAS).
//
// Logos hotlink ESPN's public CDN (the CSP in index.html already allows
// a.espncdn.com); consumers must render a text fallback for unknown teams,
// free agents ('FA', ''), and image load failures.

import { canonicalTeam } from '@/utils/playerNames';

export interface NflTeamInfo {
  abbr: string;
  name: string;
  // Primary/secondary brand hex. Used for accent stripes and chips only;
  // body text stays on the app palette for contrast.
  primary: string;
  secondary: string;
  espnSlug: string;
}

export const NFL_TEAMS: Record<string, NflTeamInfo> = {
  ARI: { abbr: 'ARI', name: 'Arizona Cardinals', primary: '#97233f', secondary: '#ffb612', espnSlug: 'ari' },
  ATL: { abbr: 'ATL', name: 'Atlanta Falcons', primary: '#a71930', secondary: '#000000', espnSlug: 'atl' },
  BAL: { abbr: 'BAL', name: 'Baltimore Ravens', primary: '#241773', secondary: '#9e7c0c', espnSlug: 'bal' },
  BUF: { abbr: 'BUF', name: 'Buffalo Bills', primary: '#00338d', secondary: '#c60c30', espnSlug: 'buf' },
  CAR: { abbr: 'CAR', name: 'Carolina Panthers', primary: '#0085ca', secondary: '#101820', espnSlug: 'car' },
  CHI: { abbr: 'CHI', name: 'Chicago Bears', primary: '#0b162a', secondary: '#c83803', espnSlug: 'chi' },
  CIN: { abbr: 'CIN', name: 'Cincinnati Bengals', primary: '#fb4f14', secondary: '#000000', espnSlug: 'cin' },
  CLE: { abbr: 'CLE', name: 'Cleveland Browns', primary: '#311d00', secondary: '#ff3c00', espnSlug: 'cle' },
  DAL: { abbr: 'DAL', name: 'Dallas Cowboys', primary: '#041e42', secondary: '#869397', espnSlug: 'dal' },
  DEN: { abbr: 'DEN', name: 'Denver Broncos', primary: '#fb4f14', secondary: '#002244', espnSlug: 'den' },
  DET: { abbr: 'DET', name: 'Detroit Lions', primary: '#0076b6', secondary: '#b0b7bc', espnSlug: 'det' },
  GB: { abbr: 'GB', name: 'Green Bay Packers', primary: '#203731', secondary: '#ffb612', espnSlug: 'gb' },
  HOU: { abbr: 'HOU', name: 'Houston Texans', primary: '#03202f', secondary: '#a71930', espnSlug: 'hou' },
  IND: { abbr: 'IND', name: 'Indianapolis Colts', primary: '#002c5f', secondary: '#a2aaad', espnSlug: 'ind' },
  JAC: { abbr: 'JAC', name: 'Jacksonville Jaguars', primary: '#006778', secondary: '#d7a22a', espnSlug: 'jax' },
  KC: { abbr: 'KC', name: 'Kansas City Chiefs', primary: '#e31837', secondary: '#ffb81c', espnSlug: 'kc' },
  LAC: { abbr: 'LAC', name: 'Los Angeles Chargers', primary: '#0080c6', secondary: '#ffc20e', espnSlug: 'lac' },
  LAR: { abbr: 'LAR', name: 'Los Angeles Rams', primary: '#003594', secondary: '#ffa300', espnSlug: 'lar' },
  LV: { abbr: 'LV', name: 'Las Vegas Raiders', primary: '#000000', secondary: '#a5acaf', espnSlug: 'lv' },
  MIA: { abbr: 'MIA', name: 'Miami Dolphins', primary: '#008e97', secondary: '#fc4c02', espnSlug: 'mia' },
  MIN: { abbr: 'MIN', name: 'Minnesota Vikings', primary: '#4f2683', secondary: '#ffc62f', espnSlug: 'min' },
  NE: { abbr: 'NE', name: 'New England Patriots', primary: '#002244', secondary: '#c60c30', espnSlug: 'ne' },
  NO: { abbr: 'NO', name: 'New Orleans Saints', primary: '#d3bc8d', secondary: '#101820', espnSlug: 'no' },
  NYG: { abbr: 'NYG', name: 'New York Giants', primary: '#0b2265', secondary: '#a71930', espnSlug: 'nyg' },
  NYJ: { abbr: 'NYJ', name: 'New York Jets', primary: '#125740', secondary: '#000000', espnSlug: 'nyj' },
  PHI: { abbr: 'PHI', name: 'Philadelphia Eagles', primary: '#004c54', secondary: '#a5acaf', espnSlug: 'phi' },
  PIT: { abbr: 'PIT', name: 'Pittsburgh Steelers', primary: '#ffb612', secondary: '#101820', espnSlug: 'pit' },
  SEA: { abbr: 'SEA', name: 'Seattle Seahawks', primary: '#002244', secondary: '#69be28', espnSlug: 'sea' },
  SF: { abbr: 'SF', name: 'San Francisco 49ers', primary: '#aa0000', secondary: '#b3995d', espnSlug: 'sf' },
  TB: { abbr: 'TB', name: 'Tampa Bay Buccaneers', primary: '#d50a0a', secondary: '#34302b', espnSlug: 'tb' },
  TEN: { abbr: 'TEN', name: 'Tennessee Titans', primary: '#0c2340', secondary: '#4b92db', espnSlug: 'ten' },
  WAS: { abbr: 'WAS', name: 'Washington Commanders', primary: '#5a1414', secondary: '#ffb612', espnSlug: 'wsh' },
};

export function nflTeamInfo(team: string | null | undefined): NflTeamInfo | null {
  return NFL_TEAMS[canonicalTeam(team)] ?? null;
}

// 500px source scaled down by the consumer; the -dark variants are drawn
// for dark backgrounds like the app's ink.
export function nflLogoUrl(team: string | null | undefined): string | null {
  const info = nflTeamInfo(team);
  return info ? `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${info.espnSlug}.png` : null;
}

// WCAG relative luminance (0..1) of a #rrggbb hex.
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const chan = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
}

// The brand color that registers on the ink background: the primary unless
// it's too dark to read, then whichever of the pair is brighter. Half the
// league's primaries are near-black navy; their secondaries carry the
// identity on dark surfaces. Consumers should still soften the result
// (color-mix toward --bone) before using it as text.
export function nflAccentColor(team: string | null | undefined): string | null {
  const info = nflTeamInfo(team);
  if (!info) return null;
  if (luminance(info.primary) >= 0.15) return info.primary;
  return luminance(info.secondary) > luminance(info.primary) ? info.secondary : info.primary;
}

// Sleeper player headshot; needs the player's sleeperId from the pool.
export function playerHeadshotUrl(sleeperId: string | undefined): string | null {
  return sleeperId ? `https://sleepercdn.com/content/nfl/players/thumb/${sleeperId}.jpg` : null;
}
