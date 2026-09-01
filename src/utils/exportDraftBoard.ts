// Renders the full draft as one shareable PNG: every team's haul with
// price (or round), value, and grade color, canvas-drawn in the GRIDIRON
// palette. Built for the group chat, same as the award card - one pasteable
// image beats a four-page PDF and beats screenshotting a scrolling table.

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

export interface DraftBoardData {
  leagueName: string;
  season?: number;
  isAuction: boolean;
  // Turns overall pick numbers into conventional round.slot notation
  // (pick 18 of a 12-teamer prints 2.06); without it the overall number shows.
  totalTeams?: number;
  picks: GradedPick[];
}

interface TeamBlock {
  name: string;
  picks: GradedPick[];
  spent: number;
  value: number;
}

function groupTeams(data: DraftBoardData): TeamBlock[] {
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
    return {
      name: picks[0]?.teamName ?? '',
      picks: sorted,
      spent: picks.reduce((sum, p) => sum + (p.auctionValue ?? 0), 0),
      value: picks.reduce((sum, p) => sum + p.valueOverExpected, 0),
    };
  });
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

function drawBoard(data: DraftBoardData): HTMLCanvasElement | null {
  const teams = groupTeams(data);
  if (teams.length === 0) return null;

  const cols = teams.length >= 10 ? 4 : teams.length >= 5 ? 3 : teams.length;
  const rows = Math.ceil(teams.length / cols);
  const maxPicks = Math.max(...teams.map(t => t.picks.length));

  const margin = 40;
  const gap = 16;
  const blockW = 320;
  const rowH = 24;
  const blockHeaderH = 58;
  const blockH = blockHeaderH + maxPicks * rowH + 14;
  const headerH = 116;
  const footerH = 52;
  const w = margin * 2 + cols * blockW + (cols - 1) * gap;
  const h = headerH + rows * blockH + (rows - 1) * gap + footerH;

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
  ctx.fillText(truncate(ctx, data.leagueName.toUpperCase(), w - margin * 2 - 260), margin, 68);
  ctx.fillStyle = BONE_DIM;
  ctx.font = `700 17px ${MONO}`;
  const sub = `${data.season ?? ''} ${data.isAuction ? 'AUCTION' : 'SNAKE'} DRAFT`.trim();
  ctx.fillText(sub, margin, 96);

  teams.forEach((team, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (blockW + gap);
    const y = headerH + row * (blockH + gap);

    ctx.fillStyle = INK2;
    ctx.fillRect(x, y, blockW, blockH);

    ctx.fillStyle = BONE;
    ctx.font = `900 17px ${BLACK}`;
    ctx.fillText(truncate(ctx, team.name.toUpperCase(), blockW - 24), x + 12, y + 26);

    ctx.font = `700 13px ${MONO}`;
    ctx.fillStyle = BONE_DIM;
    const summary = data.isAuction ? `$${team.spent} SPENT · VALUE ` : `VALUE `;
    ctx.fillText(summary, x + 12, y + 46);
    ctx.fillStyle = team.value >= 0 ? LIME : GRADE_COLORS.terrible;
    ctx.fillText(signed(Math.round(team.value)), x + 12 + ctx.measureText(summary).width, y + 46);

    ctx.font = `500 14px ${MONO}`;
    team.picks.forEach((pick, j) => {
      const py = y + blockHeaderH + j * rowH + 8;
      // Cost (auction) or round.pick, right-aligned in a fixed gutter.
      ctx.fillStyle = BONE_DIM;
      ctx.textAlign = 'right';
      const inRound =
        data.totalTeams && data.totalTeams > 0 ? pick.pickNumber - (pick.round - 1) * data.totalTeams : NaN;
      const slot = data.isAuction
        ? `$${pick.auctionValue ?? 0}`
        : inRound >= 1 && inRound <= (data.totalTeams ?? 0)
          ? `${pick.round}.${String(inRound).padStart(2, '0')}`
          : `#${pick.pickNumber}`;
      ctx.fillText(slot, x + 56, py);
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
  });

  // Footer: grade legend + attribution.
  const footY = h - 22;
  ctx.font = `700 13px ${MONO}`;
  let lx = margin;
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
  ctx.fillText('fantasyfootballanalyzer.app', w - margin, footY);
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
export async function exportDraftBoard(data: DraftBoardData): Promise<'copied' | 'saved' | false> {
  const canvas = drawBoard(data);
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
    link.download = `${data.leagueName.replace(/[^a-z0-9]/gi, '_')}${season}_draft_board.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    return 'saved';
  } catch (err) {
    logger.error('[draftBoard] toDataURL/download failed:', err);
    return false;
  }
}
