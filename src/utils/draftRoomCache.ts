// localStorage persistence for in-progress Draft Room sessions, following
// the leagueCache.ts pattern: versioned key prefix, defensive try/catch,
// one entry per league+season. A session is just the config plus the event
// log; everything else is re-derived on load.

import type { DraftEvent, DraftRoomConfig } from '@/types/draft';
import { logger } from '@/utils/logger';

// Bump when DraftRoomConfig or DraftEvent change shape incompatibly; older
// sessions are then ignored rather than hydrated into a broken room.
const CACHE_VERSION = 1;
const KEY_PREFIX = 'ffa:draftroom:v' + CACHE_VERSION + ':';

export interface DraftRoomSession {
  config: DraftRoomConfig;
  events: DraftEvent[];
  phase: 'drafting' | 'complete';
  savedAt: number;
}

function keyFor(leagueKey: string): string {
  return KEY_PREFIX + leagueKey;
}

export function saveDraftRoom(session: Omit<DraftRoomSession, 'savedAt'>): void {
  try {
    const entry: DraftRoomSession = { ...session, savedAt: Date.now() };
    localStorage.setItem(keyFor(session.config.leagueKey), JSON.stringify(entry));
  } catch (err) {
    logger.warn('[draftRoomCache] Failed to persist draft session:', err);
  }
}

export function loadDraftRoom(leagueKey: string): DraftRoomSession | null {
  try {
    const raw = localStorage.getItem(keyFor(leagueKey));
    if (!raw) return null;
    const entry = JSON.parse(raw) as DraftRoomSession;
    if (!entry?.config?.leagueKey || !Array.isArray(entry.events)) return null;
    return entry;
  } catch (err) {
    logger.warn('[draftRoomCache] Failed to read draft session:', err);
    return null;
  }
}

export function clearDraftRoom(leagueKey: string): void {
  try {
    localStorage.removeItem(keyFor(leagueKey));
  } catch (err) {
    logger.warn('[draftRoomCache] Failed to clear draft session:', err);
  }
}

// ---- Completed-draft archive ----
// Finished drafts used to be destroyed by Reset; now each completed session
// is archived immutably (capped) so past mocks and the real draft can be
// revisited and compared.

const ARCHIVE_CAP = 20;

function archiveKeyFor(leagueKey: string): string {
  return `${KEY_PREFIX}history:${leagueKey}`;
}

export function archiveDraftRoom(session: Omit<DraftRoomSession, 'savedAt'>): void {
  try {
    const entry: DraftRoomSession = { ...session, savedAt: Date.now() };
    const existing = loadDraftArchive(session.config.leagueKey);
    // The same completed draft saves once; re-archiving an identical event
    // log (e.g. a re-render) must not duplicate it.
    if (existing.some(s => s.savedAt === entry.savedAt || sameEvents(s.events, entry.events))) {
      return;
    }
    const next = [entry, ...existing].slice(0, ARCHIVE_CAP);
    localStorage.setItem(archiveKeyFor(session.config.leagueKey), JSON.stringify(next));
  } catch (err) {
    logger.warn('[draftRoomCache] Failed to archive draft session:', err);
  }
}

function sameEvents(a: DraftEvent[], b: DraftEvent[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((e, i) => e.playerId === b[i].playerId && e.ts === b[i].ts);
}

export function loadDraftArchive(leagueKey: string): DraftRoomSession[] {
  try {
    const raw = localStorage.getItem(archiveKeyFor(leagueKey));
    if (!raw) return [];
    const list = JSON.parse(raw) as DraftRoomSession[];
    if (!Array.isArray(list)) return [];
    return list.filter(s => s?.config?.leagueKey && Array.isArray(s.events));
  } catch (err) {
    logger.warn('[draftRoomCache] Failed to read draft archive:', err);
    return [];
  }
}

// The most recent COMPLETED, real (non-mock) draft for a league: the live draft
// you logged by hand, usable as the league's draft data. Mock drafts are
// excluded so a practice run never masquerades as the real thing. Prefers the
// active session if it finished, otherwise the newest live entry in the archive.
export function loadCompletedLiveDraft(leagueKey: string): DraftRoomSession | null {
  const active = loadDraftRoom(leagueKey);
  if (active && active.phase === 'complete' && active.config.mode === 'live') return active;
  return loadDraftArchive(leagueKey).find(s => s.config.mode === 'live') ?? null;
}

export function removeFromDraftArchive(leagueKey: string, savedAt: number): void {
  try {
    const next = loadDraftArchive(leagueKey).filter(s => s.savedAt !== savedAt);
    localStorage.setItem(archiveKeyFor(leagueKey), JSON.stringify(next));
  } catch (err) {
    logger.warn('[draftRoomCache] Failed to update draft archive:', err);
  }
}
