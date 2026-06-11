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
