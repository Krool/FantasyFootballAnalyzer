// Renders the draft as shareable PNGs, canvas-drawn in the GRIDIRON palette.
// Built for the group chat, same as the award card - one pasteable image
// beats a four-page PDF and beats screenshotting a scrolling table.
//
// Two boards ship: by-team (each roster's haul) and by-order (every pick in
// draft order, sectioned into rounds - an auction is laid out as the snake
// it implies, most expensive first, so a "round" is a cost tier).

import type { DraftGrade } from '@/types';
import type { GradedPick } from './grading';
import { logger } from './logger';

const INK = '#0a0a0a';
const INK2 = '#141412';
const BONE = '#f1ece1';
const BONE_DIM = '#948e80';
const LIME = '#d6ff2e';

// The grade-badge palette from DraftTable.module.css, except terrible uses
// --blood-text, not --blood: #e63a1f is 4.0:1 on ink, too dim for 15px text.
const GRADE_COLORS: Record<DraftGrade, string> = {
  great: '#d6ff2e',
  good: '#a6e22e',
  bad: '#ff8a3d',
  terrible: '#ff6242',
};

const MONO = "'JetBrains Mono', Consolas, monospace";
const BLACK = "'Bowlby One', 'Arial Black', Arial, sans-serif";

const MARGIN = 40;
const GAP = 16;
const ROW_H = 24;
const BLOCK_HEADER_H = 58;
const HEADER_H = 116;
const FOOTER_H = 52;

export interface DraftBoardData {
  leagueName: string;
  season?: number;
  isAuction: boolean;
  // Turns overall pick numbers into conventional round.slot notation
  // (pick 18 of a 12-teamer prints 2.06); without it the overall number shows.
  // Also sets the cost-tier size when an auction is sectioned into rounds.
  totalTeams?: number;
  picks: GradedPick[];
}

// A titled column of picks on the canvas: a team's roster on the by-team
// board, a round on the by-order board.
interface Block {
  title: string;
  subtitle: Array<{ text: string; color: string }>;
  picks: GradedPick[];
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return cut + '…';
}

function signed(n: number): string {
  return `${n >= 0 ? '+' : ''}${n}`;
}

function slotLabel(data: DraftBoardData, pick: GradedPick): string {
  if (data.isAuction) return `$${pick.auctionValue ?? 0}`;
  const inRound =
    data.totalTeams && data.totalTeams > 0 ? pick.pickNumber - (pick.round - 1) * data.totalTeams : NaN;
  return inRound >= 1 && inRound <= (data.totalTeams ?? 0)
    ? `${pick.round}.${String(inRound).padStart(2, '0')}`
    : `#${pick.pickNumber}`;
}

function teamBlocks(data: DraftBoardData): Block[] {
  const byTeam = new Map<string, GradedPick[]>();
  for (const pick of data.picks) {
    const list = byTeam.get(pick.teamId) ?? [];
    list.push(pick);
    byTeam.set(pick.teamId, list);
  }
  return [...byTeam.values()].map(picks => {
    const sorted = [...picks].sort((a, b) =>
      data.isAuction
        ? (b.auctionValue ?? 0) - (a.auctionValue ?? 0) || a.pickNumber - b.pickNumber
        : a.pickNumber - b.pickNumber,
    );
    const spent = picks.reduce((sum, p) => sum + (p.auctionValue ?? 0), 0);
    const value = Math.round(picks.reduce((sum, p) => sum + p.valueOverExpected, 0));
    return {
      title: picks[0]?.teamName ?? '',
      subtitle: [
        { text: data.isAuction ? `$${spent} SPENT · VALUE ` : 'VALUE ', color: BONE_DIM },
        { text: signed(value), color: value >= 0 ? LIME : GRADE_COLORS.terrible },
      ],
      picks: sorted,
    };
  });
}

function orderBlocks(data: DraftBoardData): Block[] {
  const tier = Math.max(1, data.totalTeams ?? new Set(data.picks.map(p => p.teamId)).size);
  if (data.isAuction) {
    // The snake this auction implies: most expensive first, each run of
    // `tier` picks is a round. Same tiering as calculateAuctionRounds.
    const sorted = [...data.picks].sort(
      (a, b) => (b.auctionValue ?? 0) - (a.auctionValue ?? 0) || a.pickNumber - b.pickNumber,
    );
    const blocks: Block[] = [];
    for (let i = 0; i < sorted.length; i += tier) {
      blocks.push({
        title: `ROUND ${blocks.length + 1}`,
        subtitle: [{ text: 'BY PRICE', color: BONE_DIM }],
        picks: sorted.slice(i, i + tier),
      });
    }
    return blocks;
  }
  const byRound = new Map<number, GradedPick[]>();
  for (const pick of data.picks) {
    const list = byRound.get(pick.round) ?? [];
    list.push(pick);
    byRound.set(pick.round, list);
  }
  return [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, picks]) => ({
      title: `ROUND ${round}`,
      subtitle: [],
      picks: [...picks].sort((a, b) => a.pickNumber - b.pickNumber),
    }));
}

function drawBlocks(data: DraftBoardData, blocks: Block[], blockW: number, cols: number,
  drawRow: (ctx: CanvasRenderingContext2D, pick: GradedPick, x: number, y: number) => void,
): HTMLCanvasElement | null {
  if (blocks.length === 0) return null;
  const rows = Math.ceil(blocks.length / cols);
  const maxPicks = Math.max(...blocks.map(b => b.picks.length));
  const blockH = BLOCK_HEADER_H + maxPicks * ROW_H + 14;
  const w = MARGIN * 2 + cols * blockW + (cols - 1) * GAP;
  const h = HEADER_H + rows * blockH + (rows - 1) * GAP + FOOTER_H;

  const canvas = document.createElement('canvas');
  const scale = 2; // crisp on phone screens, where this will be looked at
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    logger.error('[draftBoard] 2D canvas context unavailable');
    return null;
  }
  ctx.scale(scale, scale);

  // Field + faint yard-line grid, same stage the award card sets.
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

  // Header
  ctx.fillStyle = LIME;
  ctx.font = `900 38px ${BLACK}`;
  ctx.fillText(truncate(ctx, data.leagueName.toUpperCase(), w - MARGIN * 2 - 260), MARGIN, 68);
  ctx.fillStyle = BONE_DIM;
  ctx.font = `700 17px ${MONO}`;
  const sub = `${data.season ?? ''} ${data.isAuction ? 'AUCTION' : 'SNAKE'} DRAFT`.trim();
  ctx.fillText(sub, MARGIN, 96);

  blocks.forEach((block, i) => {
    const x = MARGIN + (i % cols) * (blockW + GAP);
    const y = HEADER_H + Math.floor(i / cols) * (blockH + GAP);

    ctx.fillStyle = INK2;
    ctx.fillRect(x, y, blockW, blockH);

    ctx.fillStyle = BONE;
    ctx.font = `900 17px ${BLACK}`;
    ctx.fillText(truncate(ctx, block.title.toUpperCase(), blockW - 24), x + 12, y + 26);

    ctx.font = `700 13px ${MONO}`;
    let sx = x + 12;
    for (const part of block.subtitle) {
      ctx.fillStyle = part.color;
      ctx.fillText(part.text, sx, y + 46);
      sx += ctx.measureText(part.text).width;
    }

    ctx.font = `500 14px ${MONO}`;
    block.picks.forEach((pick, j) => drawRow(ctx, pick, x, y + BLOCK_HEADER_H + j * ROW_H + 8));
  });

  // Footer: grade legend + attribution.
  const footY = h - 22;
  ctx.font = `700 13px ${MONO}`;
  let lx = MARGIN;
  (['great', 'good', 'bad', 'terrible'] as DraftGrade[]).forEach(grade => {
    ctx.fillStyle = GRADE_COLORS[grade];
    ctx.fillText('■', lx, footY);
    lx += 18;
    ctx.fillStyle = BONE_DIM;
    const label = grade.toUpperCase();
    ctx.fillText(label, lx, footY);
    lx += ctx.measureText(label).width + 22;
  });
  ctx.fillStyle = BONE_DIM;
  ctx.textAlign = 'right';
  ctx.fillText('fantasyfootballanalyzer.app', w - MARGIN, footY);
  ctx.textAlign = 'left';

  return canvas;
}

function drawTeamsBoard(data: DraftBoardData): HTMLCanvasElement | null {
  const blocks = teamBlocks(data);
  const cols = blocks.length >= 10 ? 4 : blocks.length >= 5 ? 3 : Math.max(1, blocks.length);
  const blockW = 320;
  return drawBlocks(data, blocks, blockW, cols, (ctx, pick, x, py) => {
    ctx.fillStyle = BONE_DIM;
    ctx.textAlign = 'right';
    ctx.fillText(slotLabel(data, pick), x + 56, py);
    ctx.textAlign = 'left';
    // Name in the grade's color: the color IS the grade, no badge needed.
    ctx.fillStyle = GRADE_COLORS[pick.grade];
    const valueText = signed(pick.valueOverExpected);
    const valueW = ctx.measureText(valueText).width;
    ctx.fillText(truncate(ctx, pick.player.name, blockW - 56 - 24 - valueW - 14), x + 64, py);
    ctx.textAlign = 'right';
    ctx.fillStyle = pick.valueOverExpected >= 0 ? BONE : BONE_DIM;
    ctx.fillText(valueText, x + blockW - 12, py);
    ctx.textAlign = 'left';
  });
}

function drawOrderBoard(data: DraftBoardData): HTMLCanvasElement | null {
  const blocks = orderBlocks(data);
  const blockW = 430; // wider than by-team: each row also names the roster
  const cols = blocks.length >= 9 ? 3 : blocks.length >= 3 ? 2 : 1;
  return drawBlocks(data, blocks, blockW, cols, (ctx, pick, x, py) => {
    ctx.fillStyle = BONE_DIM;
    ctx.textAlign = 'right';
    ctx.fillText(slotLabel(data, pick), x + 56, py);
    ctx.textAlign = 'left';
    ctx.fillStyle = GRADE_COLORS[pick.grade];
    const valueText = signed(pick.valueOverExpected);
    const valueW = ctx.measureText(valueText).width;
    const teamW = 110;
    ctx.fillText(truncate(ctx, pick.player.name, blockW - 56 - 24 - teamW - valueW - 22), x + 64, py);
    ctx.textAlign = 'right';
    ctx.fillStyle = BONE_DIM;
    ctx.fillText(truncate(ctx, pick.teamName, teamW), x + blockW - 12 - valueW - 10, py);
    ctx.fillStyle = pick.valueOverExpected >= 0 ? BONE : BONE_DIM;
    ctx.fillText(valueText, x + blockW - 12, py);
    ctx.textAlign = 'left';
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))), 'image/png');
  });
}

// 'copied' when the PNG landed on the clipboard, 'saved' when the browser
// can't do image clipboards (Firefox, older Safari) and we downloaded it
// instead, false when the canvas itself couldn't be produced.
async function deliver(
  canvas: HTMLCanvasElement | null,
  data: DraftBoardData,
  suffix: string,
): Promise<'copied' | 'saved' | false> {
  if (!canvas) return false;

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      // Hand the clipboard a promise, not an awaited blob: Safari discards
      // the user-gesture token at the first await, then rejects the write.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasToBlob(canvas) })]);
      return 'copied';
    } catch (err) {
      logger.warn('[draftBoard] clipboard write failed, downloading instead:', err);
    }
  }

  try {
    const link = document.createElement('a');
    const season = data.season ? `_${data.season}` : '';
    link.download = `${data.leagueName.replace(/[^a-z0-9]/gi, '_')}${season}_${suffix}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    return 'saved';
  } catch (err) {
    logger.error('[draftBoard] toDataURL/download failed:', err);
    return false;
  }
}

export function exportDraftBoard(data: DraftBoardData): Promise<'copied' | 'saved' | false> {
  return deliver(drawTeamsBoard(data), data, 'draft_board');
}

export function exportDraftOrder(data: DraftBoardData): Promise<'copied' | 'saved' | false> {
  return deliver(drawOrderBoard(data), data, 'draft_order');
}
