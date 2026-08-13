// Bottom-sheet snap states, shared by the sheet and the page around it.
// Lives outside DraftSheet.tsx so that file exports only its component and
// keeps fast refresh working.

export type SheetSnap = 'peek' | 'half' | 'full';

// Viewport share per snap, as CSS lengths. MUST match the heights in
// DraftSheet.module.css (.sheet and its data-snap rules): the page reads
// these into --sheet-h so the draft board can size against whatever the
// sheet is not using.
export const SHEET_HEIGHT: Record<SheetSnap, string> = {
  peek: 'max(7.5dvh, 4.5rem)',
  half: '52dvh',
  full: '94dvh',
};

// The same shares as numbers, for the drag math inside the sheet.
export const SNAP_SHARE: Record<SheetSnap, number> = {
  peek: 0.075,
  half: 0.52,
  full: 0.94,
};
