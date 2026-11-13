// Renders any league page's tables as one shareable PNG, canvas-drawn in the
// GRIDIRON palette like the draft and awards boards, and copies it to the
// clipboard (downloading instead where the browser can't hold images).
//
// The page hands over plain rows; this lays them out at a fixed width that
// doesn't care about the viewport, so a table that has to scroll sideways
// on a phone still lands in the group chat whole. Pages pick the columns
// that matter for the image rather than mirroring every on-screen column.

import { logger } from './logger';

const INK = '#0a0a0a';
const INK2 = '#141412';
const RULE = '#2a2823';
const BONE = '#f1ece1';
const BONE_DIM = '#948e80';
const LIME = '#d6ff2e';

// Same colors as the site tokens (--color-good, --color-bad, --blood-text).
export const TONES = {
  bone: BONE,
  dim: BONE_DIM,
  lime: LIME,
  good: '#a6e22e',
  bad: '#ff8a3d',
  terrible: '#ff6242',
} as const;
export type Tone = keyof typeof TONES;

const MONO = "'JetBrains Mono', Consolas, monospace";
const BLACK = "'Bowlby One', 'Arial Black', Arial, sans-serif";
const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";

const CELL_FONT = `500 15px ${MONO}`;
const TEAM_FONT = `italic 500 17px ${SERIF}`;
const SUB_FONT = `500 12px ${MONO}`;
const HEAD_FONT = `700 11px ${MONO}`;
const NOTE_FONT = `italic 400 14px ${SERIF}`;
const FOOT_FONT = `700 13px ${MONO}`;
const SITE = 'fantasyfootballanalyzer.app';

const MARGIN = 40;
const MIN_CONTENT_W = 560;
const PAD_X = 12;
const PAD_Y = 9;
const LINE_H = 20;
const SUB_LINE_H = 16;
const MAX_SUB_LINES = 4;
const HEAD_ROW_H = 30;
const HEADING_H = 34;
const NOTE_LINE_H = 19;
const TABLE_GAP = 30;
const HEADER_H = 116;
const FOOTER_H = 52;
const TILE_H = 100;
const TILE_GAP = 12;

export interface BoardCell {
  text: string;
  tone?: Tone;
  // A smaller line under the text that wraps inside the column: the players
  // behind an injury total, what each side got in a trade. A list wraps
  // between items, never inside one.
  sub?: string | string[];
  subTone?: Tone;
}
export type CellInput = BoardCell | string | number;

export interface BoardColumn {
  label: string;
  align?: 'left' | 'right' | 'center';
  // 'team' draws the italic serif face the site uses for team names.
  kind?: 'team';
  // Widest the column may grow, in CSS px. Text past it truncates; subs wrap.
  max?: number;
}

export interface BoardRow {
  cells: CellInput[];
  // A heavier rule above the row: separates one trade from the next.
  divider?: boolean;
}

export interface BoardTable {
  heading?: string;
  note?: string;
  columns: BoardColumn[];
  rows: Array<BoardRow | CellInput[]>;
}

export interface BoardHeadline {
  label: string;
  name: string;
  value: string;
  detail?: string;
}

export interface ShareBoardData {
  leagueName: string;
  season?: number;
  // The page, e.g. "Luck" or "Waiver Wire"; printed under the league name.
  title: string;
  headlines?: BoardHeadline[];
  tables: BoardTable[];
  // Small print bottom-left, e.g. "Top 25 of 172 pickups".
  footnote?: string;
  // File name stem for the download fallback, e.g. 'injury_luck'.
  slug: string;
}

type Measure = (text: string) => number;

function truncate(measure: Measure, text: string, maxWidth: number): string {
  if (measure(text) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && measure(cut + '…') > maxWidth) cut = cut.slice(0, -1);
  return cut + '…';
}

// Greedy wrap. A string breaks between words; a list breaks between items
// (joined with a middot), so "Puka Nacua 3g" never splits across lines. Past
// maxLines the last line ends in an ellipsis.
export function wrapLines(
  content: string | string[],
  maxWidth: number,
  measure: Measure,
  maxLines = MAX_SUB_LINES,
): string[] {
  const isList = Array.isArray(content);
  const tokens = (isList ? content : content.split(/\s+/)).filter(Boolean);
  const joiner = isList ? '  ·  ' : ' ';
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    const next = line ? line + joiner + token : token;
    if (!line || measure(next) <= maxWidth) {
      line = next;
    } else {
      lines.push(line);
      line = token;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] += isList ? '  ·  …' : ' …';
    return kept;
  }
  return lines;
}

function toCell(input: CellInput): BoardCell {
  if (typeof input === 'string') return { text: input };
  if (typeof input === 'number') return { text: String(input) };
  return input;
}

interface LaidOutTable {
  table: BoardTable;
  rows: Array<{ cells: BoardCell[]; divider: boolean; subs: string[][]; h: number }>;
  widths: number[];
  noteLines: string[];
  h: number;
}

function layoutTable(
  table: BoardTable,
  measureIn: (font: string) => Measure,
): { widths: number[]; rows: Array<{ cells: BoardCell[]; divider: boolean }> } {
  const rows = table.rows.map(r =>
    Array.isArray(r) ? { cells: r.map(toCell), divider: false } : { cells: r.cells.map(toCell), divider: !!r.divider },
  );
  const head = measureIn(HEAD_FONT);
  const sub = measureIn(SUB_FONT);
  const widths = table.columns.map((col, i) => {
    const main = measureIn(col.kind === 'team' ? TEAM_FONT : CELL_FONT);
    let natural = head(col.label.toUpperCase());
    for (const row of rows) {
      const cell = row.cells[i];
      if (!cell) continue;
      natural = Math.max(natural, main(cell.text));
      if (cell.sub) {
        // An unwrapped list wants its full length; the cap below wraps it.
        const s = Array.isArray(cell.sub) ? cell.sub.join('  ·  ') : cell.sub;
        natural = Math.max(natural, sub(s));
      }
    }
    const cap = col.max ?? (col.kind === 'team' ? 230 : 300);
    return Math.ceil(Math.min(natural, cap)) + PAD_X * 2;
  });
  return { widths, rows };
}

async function loadFonts(): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts?.load) return;
  // The faces are self-hosted with font-display: optional, so one the page
  // hasn't painted yet may not be loaded; canvas would silently fall back.
  // Ask for them, but never hold the export hostage to a slow network.
  const loads = Promise.all([CELL_FONT, TEAM_FONT, SUB_FONT, HEAD_FONT, NOTE_FONT, `900 38px ${BLACK}`]
    .map(f => fonts.load(f).catch(() => [])));
  await Promise.race([loads, new Promise(resolve => setTimeout(resolve, 1200))]);
}

async function drawBoard(data: ShareBoardData): Promise<HTMLCanvasElement | null> {
  const tables = data.tables.filter(t => t.rows.length > 0 && t.columns.length > 0);
  if (tables.length === 0) return null;
  await loadFonts();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    logger.error('[shareBoard] 2D canvas context unavailable');
    return null;
  }
  const measureIn = (font: string): Measure => text => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };

  // Widths first: the board is as wide as its widest table.
  const sized = tables.map(t => ({ table: t, ...layoutTable(t, measureIn) }));
  const headlines = data.headlines ?? [];
  const contentW = Math.max(
    MIN_CONTENT_W,
    ...sized.map(s => s.widths.reduce((a, b) => a + b, 0)),
  );

  // A narrower table stretches to the board: the slack goes to the column
  // that wraps (fewer lines), else the team column, else the first.
  const subMeasure = measureIn(SUB_FONT);
  const noteMeasure = measureIn(NOTE_FONT);
  const laid: LaidOutTable[] = sized.map(({ table, widths, rows }) => {
    const slack = contentW - widths.reduce((a, b) => a + b, 0);
    if (slack > 0) {
      let target = table.columns.findIndex((_, i) => rows.some(r => r.cells[i]?.sub));
      if (target < 0) target = table.columns.findIndex(c => c.kind === 'team');
      if (target < 0) target = 0;
      widths[target] += slack;
    }
    const outRows = rows.map(row => {
      const subs = row.cells.map((cell, i) =>
        cell?.sub ? wrapLines(cell.sub, widths[i] - PAD_X * 2, subMeasure) : [],
      );
      const subLines = Math.max(0, ...subs.map(s => s.length));
      return { ...row, subs, h: PAD_Y * 2 + LINE_H + subLines * SUB_LINE_H };
    });
    const noteLines = table.note ? wrapLines(table.note, contentW, noteMeasure, 3) : [];
    const h =
      (table.heading ? HEADING_H : 0) +
      noteLines.length * NOTE_LINE_H +
      (noteLines.length ? 8 : 0) +
      HEAD_ROW_H +
      outRows.reduce((a, r) => a + r.h, 0);
    return { table, rows: outRows, widths, noteLines, h };
  });

  const tileCols = Math.max(1, Math.min(headlines.length, contentW >= 720 ? 3 : 2));
  const tileRows = Math.ceil(headlines.length / tileCols);
  const tilesH = tileRows > 0 ? tileRows * TILE_H + (tileRows - 1) * TILE_GAP + TABLE_GAP : 0;

  // A footnote that won't fit beside the site URL gets its own line above it.
  const footMeasure = measureIn(FOOT_FONT);
  const footBeside = !data.footnote || footMeasure(data.footnote) <= contentW - footMeasure(SITE) - 32;
  const footerH = FOOTER_H + (footBeside ? 0 : 20);

  const w = MARGIN * 2 + contentW;
  const h =
    HEADER_H +
    tilesH +
    laid.reduce((a, t) => a + t.h, 0) +
    (laid.length - 1) * TABLE_GAP +
    footerH;

  // 2x for crisp phone screens, capped under iOS Safari's ~16.7M pixel limit
  // (past it the canvas silently blanks), same as the draft boards.
  const MAX_PIXELS = 16_000_000;
  const scale = Math.min(2, Math.max(1, Math.floor(Math.sqrt(MAX_PIXELS / (w * h)) * 4) / 4));
  canvas.width = Math.floor(w * scale);
  canvas.height = Math.floor(h * scale);
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';

  // Field + faint yard-line grid + lime frame.
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = INK2;
  ctx.lineWidth = 2;
  for (let x = 0; x <= w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.strokeStyle = LIME;
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  // Header: league name, then season + page.
  ctx.fillStyle = LIME;
  ctx.font = `900 38px ${BLACK}`;
  ctx.fillText(truncate(measureIn(ctx.font), data.leagueName.toUpperCase(), contentW), MARGIN, 68);
  ctx.fillStyle = BONE_DIM;
  ctx.font = `700 17px ${MONO}`;
  ctx.fillText(`${data.season ?? ''} ${data.title.toUpperCase()}`.trim(), MARGIN, 96);

  let y = HEADER_H;

  // Headline tiles, same anatomy as the awards tiles minus the sticker.
  if (headlines.length > 0) {
    const tileW = (contentW - (tileCols - 1) * TILE_GAP) / tileCols;
    headlines.forEach((hl, i) => {
      const x = MARGIN + (i % tileCols) * (tileW + TILE_GAP);
      const ty = y + Math.floor(i / tileCols) * (TILE_H + TILE_GAP);
      ctx.fillStyle = INK2;
      ctx.fillRect(x, ty, tileW, TILE_H);
      const tw = tileW - 24;
      ctx.fillStyle = BONE_DIM;
      ctx.font = `700 11px ${MONO}`;
      ctx.fillText(truncate(measureIn(ctx.font), hl.label.toUpperCase(), tw), x + 12, ty + 22);
      ctx.fillStyle = BONE;
      ctx.font = TEAM_FONT;
      ctx.fillText(truncate(measureIn(ctx.font), hl.name, tw), x + 12, ty + 45);
      ctx.fillStyle = LIME;
      ctx.font = `900 22px ${BLACK}`;
      ctx.fillText(truncate(measureIn(ctx.font), hl.value, tw), x + 12, ty + 74);
      if (hl.detail) {
        ctx.fillStyle = BONE_DIM;
        ctx.font = SUB_FONT;
        ctx.fillText(truncate(measureIn(ctx.font), hl.detail, tw), x + 12, ty + 92);
      }
    });
    y += tilesH;
  }

  laid.forEach((t, ti) => {
    if (ti > 0) y += TABLE_GAP;
    if (t.table.heading) {
      ctx.fillStyle = BONE;
      ctx.font = `900 20px ${BLACK}`;
      ctx.fillText(truncate(measureIn(ctx.font), t.table.heading.toUpperCase(), contentW), MARGIN, y + 24);
      y += HEADING_H;
    }
    if (t.noteLines.length) {
      ctx.fillStyle = BONE_DIM;
      ctx.font = NOTE_FONT;
      t.noteLines.forEach((line, i) => ctx.fillText(line, MARGIN, y + 14 + i * NOTE_LINE_H));
      y += t.noteLines.length * NOTE_LINE_H + 8;
    }

    const xs: number[] = [];
    t.widths.reduce((x, wd) => (xs.push(x), x + wd), MARGIN);
    const textX = (i: number, align: BoardColumn['align']) =>
      align === 'right' ? xs[i] + t.widths[i] - PAD_X : align === 'center' ? xs[i] + t.widths[i] / 2 : xs[i] + PAD_X;

    // Column heads on a raised strip, bone rule under.
    ctx.fillStyle = INK2;
    ctx.fillRect(MARGIN, y, contentW, HEAD_ROW_H);
    ctx.font = HEAD_FONT;
    ctx.fillStyle = BONE_DIM;
    t.table.columns.forEach((col, i) => {
      ctx.textAlign = col.align ?? 'left';
      ctx.fillText(truncate(measureIn(HEAD_FONT), col.label.toUpperCase(), t.widths[i] - PAD_X * 2), textX(i, col.align), y + 20);
    });
    ctx.textAlign = 'left';
    ctx.fillStyle = BONE;
    ctx.fillRect(MARGIN, y + HEAD_ROW_H - 2, contentW, 2);
    y += HEAD_ROW_H;

    t.rows.forEach((row, ri) => {
      if (row.divider && ri > 0) {
        ctx.fillStyle = BONE_DIM;
        ctx.fillRect(MARGIN, y - 1, contentW, 1);
      }
      t.table.columns.forEach((col, i) => {
        const cell = row.cells[i];
        if (!cell) return;
        const inner = t.widths[i] - PAD_X * 2;
        const font = col.kind === 'team' ? TEAM_FONT : CELL_FONT;
        ctx.textAlign = col.align ?? 'left';
        ctx.font = font;
        ctx.fillStyle = TONES[cell.tone ?? 'bone'];
        ctx.fillText(truncate(measureIn(font), cell.text, inner), textX(i, col.align), y + PAD_Y + 15);
        const subs = row.subs[i];
        if (subs.length) {
          ctx.font = SUB_FONT;
          ctx.fillStyle = TONES[cell.subTone ?? 'dim'];
          subs.forEach((line, li) =>
            ctx.fillText(
              truncate(subMeasure, line, inner),
              textX(i, col.align),
              y + PAD_Y + LINE_H + 12 + li * SUB_LINE_H,
            ),
          );
        }
      });
      ctx.textAlign = 'left';
      y += row.h;
      if (ri < t.rows.length - 1 && !t.rows[ri + 1].divider) {
        ctx.fillStyle = RULE;
        ctx.fillRect(MARGIN, y - 1, contentW, 1);
      }
    });
  });

  const footY = h - 22;
  ctx.font = FOOT_FONT;
  ctx.fillStyle = BONE_DIM;
  if (data.footnote) {
    ctx.fillText(truncate(footMeasure, data.footnote, contentW), MARGIN, footBeside ? footY : footY - 20);
  }
  ctx.textAlign = 'right';
  ctx.fillText(SITE, w - MARGIN, footY);
  ctx.textAlign = 'left';

  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))), 'image/png');
  });
}

// 'copied' when the PNG landed on the clipboard, 'saved' when the browser
// can't do image clipboards (Firefox, older Safari) and we downloaded it
// instead, false when the canvas itself couldn't be produced.
export async function exportShareBoard(data: ShareBoardData): Promise<'copied' | 'saved' | false> {
  // Start drawing before any await: font loading is async, and Safari drops
  // the user-gesture token at the first await, then rejects the clipboard
  // write. So the clipboard gets a promise of the blob.
  const canvasPromise = drawBoard(data);

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = canvasPromise.then(c => {
        if (!c) throw new Error('no canvas');
        return canvasToBlob(c);
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'copied';
    } catch (err) {
      logger.warn('[shareBoard] clipboard write failed, downloading instead:', err);
    }
  }

  const canvas = await canvasPromise.catch(() => null);
  if (!canvas) return false;
  try {
    // An over-limit or tainted canvas RETURNS "data:," on Safari rather
    // than throwing; downloading that would report a save with no file.
    const url = canvas.toDataURL('image/png');
    if (!url || url.length < 100) {
      logger.error('[shareBoard] toDataURL returned a blank image');
      return false;
    }
    const link = document.createElement('a');
    const season = data.season ? `_${data.season}` : '';
    link.download = `${data.leagueName.replace(/[^a-z0-9]/gi, '_')}${season}_${data.slug}.png`;
    link.href = url;
    // In the DOM for the click: Firefox lands in this fallback, and it has
    // historically ignored clicks on detached anchors.
    document.body.appendChild(link);
    link.click();
    link.remove();
    return 'saved';
  } catch (err) {
    logger.error('[shareBoard] toDataURL/download failed:', err);
    return false;
  }
}
