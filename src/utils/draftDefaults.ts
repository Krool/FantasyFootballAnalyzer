// Draft Room defaults, kept in a leaf module on purpose.
//
// These used to live in useDraftRoom.ts, which imports the full draft pool.
// guestLeague.ts needs only the roster shape, so importing it from there pulled
// the ~450KB pool JSON into the eager entry chunk by way of App.tsx. Anything
// that needs a default without needing the pool should import it from here.
//
// NOTE: this is NOT the same constant as projectedRoster.ts's
// DEFAULT_ROSTER_SLOTS — that one carries IR: 0. They are deliberately
// separate; do not "de-duplicate" them without checking both call sites.

import type { RosterSlots } from '@/types';

// Used when the platform didn't expose roster settings (Yahoo default shape).
// Shared with the Rankings page so both surfaces price the pool identically.
export const DEFAULT_ROSTER_SLOTS: RosterSlots = {
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DST: 1, BENCH: 6, IR: 1,
};

export const DEFAULT_BUDGET = 200;
