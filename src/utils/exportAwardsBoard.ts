// Renders the whole awards case as one shareable PNG, canvas-drawn in the
// GRIDIRON palette like the draft boards, and copies it to the clipboard
// (downloading instead where the browser can't hold images). One pasteable
// image for the group chat beats screenshotting a scrolling page.

import type { Award } from './awards';
import { getCategoryDisplayName } from './awards';
import { loadAwardIcon } from './awardIcons';
import { logger } from './logger';

const INK = '#0a0a0a';
const INK2 = '#141412';
const BONE = '#f1ece1';
const BONE_DIM = '#948e80';
const LIME = '#d6ff2e';

const MONO = "'JetBrains Mono', Consolas, monospace";
const BLACK = "'Bowlby One', 'Arial Black', Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

const MARGIN = 40;
const GAP = 12;
const COLS = 4;
const TILE_W = 300;
const TILE_H = 104;
const ICON = 52;
const HEADER_H = 116;
const SECTION_H = 40;
const FOOTER_H = 52;

export interface AwardsBoardData {
  leagueName: string;
  season?: number;
  // Already in display order, one entry per non-empty category.
  sections: Array<{ category: string; awards: Award[] }>;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return cut + '…';
}

async function drawAwardsBoard(data: AwardsBoardData): Promise<HTMLCanvasElement | null> {
  const sections = data.sections.filter(s => s.awards.length > 0);
  if (sections.length === 0) return null;

  const all = sections.flatMap(s => s.awards);
  const icons = new Map(
    await Promise.all(all.map(async a => [a.id, await loadAwardIcon(a.id)] as const)),
  );

  const sectionHeights = sections.map(
    s => SECTION_H + Math.ceil(s.awards.length / COLS) * (TILE_H + GAP),
  );
  const w = MARGIN * 2 + COLS * TILE_W + (COLS - 1) * GAP;
  const h = HEADER_H + sectionHeights.reduce((a, b) => a + b, 0) + FOOTER_H;

  const canvas = document.createElement('canvas');
  // 2x for crisp phone screens, capped under iOS Safari's ~16.7M pixel
  // limit (past it the canvas silently blanks), same as the draft boards.
  const MAX_PIXELS = 16_000_000;
  const scale = Math.min(2, Math.max(1, Math.floor(Math.sqrt(MAX_PIXELS / (w * h)) * 4) / 4));
  canvas.width = Math.floor(w * scale);
  canvas.height = Math.floor(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    logger.error('[awardsBoard] 2D canvas context unavailable');
    return null;
  }
  ctx.scale(scale, scale);

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

  // Header
  ctx.fillStyle = LIME;
  ctx.font = `900 38px ${BLACK}`;
  ctx.fillText(truncate(ctx, data.leagueName.toUpperCase(), w - MARGIN * 2), MARGIN, 68);
  ctx.fillStyle = BONE_DIM;
  ctx.font = `700 17px ${MONO}`;
  ctx.fillText(`${data.season ?? ''} SEASON AWARDS`.trim(), MARGIN, 96);

  let y = HEADER_H;
  sections.forEach((section, si) => {
    ctx.fillStyle = BONE;
    ctx.font = `900 18px ${BLACK}`;
    ctx.fillText(getCategoryDisplayName(section.category).toUpperCase(), MARGIN, y + 24);

    section.awards.forEach((award, i) => {
      const x = MARGIN + (i % COLS) * (TILE_W + GAP);
      const ty = y + SECTION_H + Math.floor(i / COLS) * (TILE_H + GAP);
      ctx.fillStyle = INK2;
      ctx.fillRect(x, ty, TILE_W, TILE_H);

      const icon = icons.get(award.id);
      const iconY = ty + (TILE_H - ICON) / 2;
      if (icon) {
        ctx.drawImage(icon, x + 10, iconY, ICON, ICON);
      } else {
        ctx.font = `40px ${SERIF}`;
        ctx.fillText(award.icon || '🏆', x + 12, iconY + 44);
      }

      const tx = x + 10 + ICON + 12;
      const tw = TILE_W - (tx - x) - 10;
      ctx.fillStyle = BONE_DIM;
      ctx.font = `700 11px ${MONO}`;
      ctx.fillText(truncate(ctx, award.name.toUpperCase(), tw), tx, ty + 24);
      ctx.fillStyle = BONE;
      ctx.font = `italic 500 17px ${SERIF}`;
      ctx.fillText(truncate(ctx, award.winner.teamName, tw), tx, ty + 48);
      ctx.fillStyle = LIME;
      ctx.font = `900 18px ${BLACK}`;
      ctx.fillText(truncate(ctx, String(award.value), tw), tx, ty + 74);
      if (award.detail) {
        ctx.fillStyle = BONE_DIM;
        ctx.font = `500 11px ${MONO}`;
        ctx.fillText(truncate(ctx, award.detail.toUpperCase(), tw), tx, ty + 93);
      }
    });

    y += sectionHeights[si];
  });

  ctx.fillStyle = BONE_DIM;
  ctx.font = `700 13px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText('fantasyfootballanalyzer.app', w - MARGIN, h - 22);
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
export async function exportAwardsBoard(data: AwardsBoardData): Promise<'copied' | 'saved' | false> {
  // Start drawing before any await: the icon loads are async, and Safari
  // drops the user-gesture token at the first await, then rejects the
  // clipboard write. So the clipboard gets a promise of the blob.
  const canvasPromise = drawAwardsBoard(data);

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = canvasPromise.then(c => {
        if (!c) throw new Error('no canvas');
        return canvasToBlob(c);
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'copied';
    } catch (err) {
      logger.warn('[awardsBoard] clipboard write failed, downloading instead:', err);
    }
  }

  const canvas = await canvasPromise;
  if (!canvas) return false;
  try {
    // An over-limit or tainted canvas RETURNS "data:," on Safari rather
    // than throwing; downloading that would report a save with no file.
    const url = canvas.toDataURL('image/png');
    if (!url || url.length < 100) {
      logger.error('[awardsBoard] toDataURL returned a blank image');
      return false;
    }
    const link = document.createElement('a');
    const season = data.season ? `_${data.season}` : '';
    link.download = `${data.leagueName.replace(/[^a-z0-9]/gi, '_')}${season}_awards.png`;
    link.href = url;
    // In the DOM for the click: Firefox lands in this fallback, and it has
    // historically ignored clicks on detached anchors.
    document.body.appendChild(link);
    link.click();
    link.remove();
    return 'saved';
  } catch (err) {
    logger.error('[awardsBoard] toDataURL/download failed:', err);
    return false;
  }
}
