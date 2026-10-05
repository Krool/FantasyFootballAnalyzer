// Renders one award as a shareable PNG (canvas-drawn in the GRIDIRON
// palette) and copies it to the clipboard, downloading instead where the
// browser can't hold images. Built for the group chat: a 800x420 card beats
// a four-page PDF when you just want to rub in Toilet Bowl.

import type { Award } from './awards';
import { loadAwardIcon } from './awardIcons';
import { logger } from './logger';

const INK = '#0a0a0a';
const INK2 = '#141412';
const BONE = '#f1ece1';
const BONE_DIM = '#8a8478';
const LIME = '#d6ff2e';

async function drawAwardCard(award: Award, leagueName: string, season: number): Promise<HTMLCanvasElement | null> {
  const iconImg = await loadAwardIcon(award.id);
  const w = 800;
  const h = 420;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    logger.error('[awardCard] 2D canvas context unavailable');
    return null;
  }

  // Field
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, h);

  // Faint yard-line grid
  ctx.strokeStyle = INK2;
  ctx.lineWidth = 2;
  for (let x = 0; x <= w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // Lime frame
  ctx.strokeStyle = LIME;
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, w - 28, h - 28);

  // Kicker: league + season
  ctx.fillStyle = BONE_DIM;
  ctx.font = "700 16px 'JetBrains Mono', Consolas, monospace";
  ctx.fillText(`${leagueName.toUpperCase()} · ${season}`.slice(0, 60), 50, 70);

  // Icon: sticker art when we have it, emoji fallback otherwise. The image
  // box bottom-aligns with the old emoji baseline so the text block below
  // stays put.
  if (iconImg) {
    ctx.drawImage(iconImg, 50, 84, 76, 76);
  } else {
    ctx.font = '64px serif';
    ctx.fillText(award.icon || '🏆', 50, 160);
  }

  // Award name
  ctx.fillStyle = LIME;
  ctx.font = "900 44px 'Arial Black', Arial, sans-serif";
  ctx.fillText(award.name.toUpperCase().slice(0, 28), 50, 225);

  // Winner
  ctx.fillStyle = BONE;
  ctx.font = "italic 500 34px Georgia, 'Times New Roman', serif";
  ctx.fillText(award.winner.teamName.slice(0, 36), 50, 280);

  // Value + detail
  ctx.fillStyle = LIME;
  ctx.font = "700 26px 'JetBrains Mono', Consolas, monospace";
  ctx.fillText(String(award.value).slice(0, 40), 50, 325);

  ctx.fillStyle = BONE_DIM;
  ctx.font = "300 italic 18px Georgia, serif";
  const detail = award.detail || award.description;
  ctx.fillText(detail.slice(0, 70), 50, 360);

  // Bone rule
  ctx.fillStyle = BONE;
  ctx.fillRect(50, 335, w - 100, 3);

  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))), 'image/png');
  });
}

// 'copied' when the PNG landed on the clipboard, 'saved' when the browser
// can't do image clipboards (Firefox, older Safari) and we downloaded it
// instead, false when the canvas itself couldn't be produced, so the caller
// can say so instead of leaving a dead button.
export async function exportAwardCard(
  award: Award,
  leagueName: string,
  season: number,
): Promise<'copied' | 'saved' | false> {
  // Start drawing before any await: the icon load is async, and Safari drops
  // the user-gesture token at the first await, then rejects the clipboard
  // write. So the clipboard gets a promise of the blob, not the blob.
  const canvasPromise = drawAwardCard(award, leagueName, season);

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = canvasPromise.then(c => {
        if (!c) throw new Error('no canvas');
        return canvasToBlob(c);
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'copied';
    } catch (err) {
      logger.warn('[awardCard] clipboard write failed, downloading instead:', err);
    }
  }

  const canvas = await canvasPromise;
  if (!canvas) return false;
  try {
    // An over-limit or tainted canvas RETURNS "data:," on Safari rather
    // than throwing; downloading that would report a save with no file.
    const url = canvas.toDataURL('image/png');
    if (!url || url.length < 100) {
      logger.error('[awardCard] toDataURL returned a blank image');
      return false;
    }
    const link = document.createElement('a');
    link.download = `${award.name.replace(/[^a-z0-9]/gi, '_')}_${season}.png`;
    link.href = url;
    // In the DOM for the click: Firefox lands in this fallback, and it has
    // historically ignored clicks on detached anchors.
    document.body.appendChild(link);
    link.click();
    link.remove();
    return 'saved';
  } catch (err) {
    logger.error('[awardCard] toDataURL/download failed:', err);
    return false;
  }
}
