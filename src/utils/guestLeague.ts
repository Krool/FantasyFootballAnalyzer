import { POOL } from '@/data/draftPool';
import type { League, Platform, DraftType, RosterSlots } from '@/types';
import { DEFAULT_ROSTER_SLOTS } from '@/hooks/useDraftRoom';

// Guest mode: build a synthetic League from user-picked draft settings so
// Rankings and the Draft Room work with no login. Everything downstream
// already tolerates a teamless league (configFromLeague synthesizes Team 1..N,
// the Rankings page reads the same shape), so a guest is just a League with
// isGuest set and no real connection data.

// The scoring options a guest can pick. League.scoringType also allows
// 'custom', but a guest never has a real league to derive custom rules from.
export type GuestScoring = 'standard' | 'ppr' | 'half_ppr';

export interface GuestSettings {
  scoringType: GuestScoring;
  draftType: DraftType;
  totalTeams: number;
  // League starts a QB-eligible flex (superflex / 2QB). Drives the Draft
  // Room's QB-pricing warning and changes how the board should be read.
  hasSuperflex: boolean;
  // Which platform's board the Rankings delta column compares against. This
  // is only a ranking lens, not a real account. Sleeper by default: its ADP
  // is scoring-specific, so it tracks the half-PPR default most closely.
  platform: Platform;
}

export const GUEST_LEAGUE_ID = 'guest';

export const DEFAULT_GUEST_SETTINGS: GuestSettings = {
  scoringType: 'half_ppr',
  draftType: 'snake',
  totalTeams: 12,
  hasSuperflex: false,
  platform: 'sleeper',
};

// Common league sizes, offered in the guest setup controls.
export const GUEST_TEAM_OPTIONS = [8, 10, 12, 14, 16];

export function buildGuestLeague(
  settings: GuestSettings,
  // A superflex guest needs an actual SUPERFLEX slot, not just the flag: all
  // QB-pricing math (projectionValues, par, the mock AI's 2QB ADP) keys off
  // rosterSlots.SUPERFLEX, never league.hasSuperflex. Without the slot the
  // toggle only flips a warning and QBs stay priced as 1QB.
  rosterSlots: RosterSlots = settings.hasSuperflex
    ? { ...DEFAULT_ROSTER_SLOTS, SUPERFLEX: 1 }
    : DEFAULT_ROSTER_SLOTS,
): League {
  return {
    id: GUEST_LEAGUE_ID,
    platform: settings.platform,
    name: 'Guest draft prep',
    // Draft prep targets the upcoming season (the bundled pool's season),
    // never a real league's last season. See docs/FANTASY_FOOTBALL.md.
    season: POOL.season,
    draftType: settings.draftType,
    teams: [],
    scoringType: settings.scoringType,
    totalTeams: settings.totalTeams,
    rosterSlots,
    hasSuperflex: settings.hasSuperflex,
    isLoaded: true,
    isGuest: true,
    status: 'preseason',
  };
}

// Guest state lives only in memory, so a reload (notably the chunk-failure
// auto-reload after a redeploy) would otherwise drop the visitor back to
// DEFAULT_GUEST_SETTINGS and lose the scoring/roster/format they just picked.
// Persist the picked settings per-tab so a reload restores them; sessionStorage
// (not localStorage) keeps "guest" a single-session notion that clears with the
// tab. Reads are defensive: a malformed or partial blob falls back to defaults.
const GUEST_SETTINGS_KEY = 'guest-settings';

export function saveGuestSettings(settings: GuestSettings): void {
  try {
    sessionStorage.setItem(GUEST_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private-mode / quota / disabled storage: in-memory state still works.
  }
}

export function loadGuestSettings(): GuestSettings | null {
  try {
    const raw = sessionStorage.getItem(GUEST_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuestSettings>;
    // Merge over defaults so a blob written by an older build (missing a newer
    // field) can't produce an undefined setting that breaks the draft room.
    return { ...DEFAULT_GUEST_SETTINGS, ...parsed };
  } catch {
    return null;
  }
}

export function clearGuestSettings(): void {
  try {
    sessionStorage.removeItem(GUEST_SETTINGS_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

// Recover the editable settings from a guest league so updateGuest can merge a
// partial change and rebuild. scoringType is narrowed back to GuestScoring;
// a guest league is never built with 'custom'.
export function settingsFromGuestLeague(league: League): GuestSettings {
  return {
    scoringType: league.scoringType === 'custom' ? 'half_ppr' : league.scoringType,
    draftType: league.draftType,
    totalTeams: league.totalTeams,
    hasSuperflex: league.hasSuperflex ?? false,
    platform: league.platform,
  };
}
