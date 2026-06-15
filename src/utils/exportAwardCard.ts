// Renders one award as a shareable PNG (canvas-drawn in the GRIDIRON
// palette) and triggers a download. Built for the group chat: a 800x420
// card beats a four-page PDF when you just want to rub in Toilet Bowl.

import type { Award } from './awards';
import { logger } from './logger';

const INK = '#0a0a0a';
const INK2 = '#141412';
const BONE = '#f1ece1';
const BONE_DIM = '#8a8478';
const LIME = '#d6ff2e';

// Returns false when the browser couldn't produce the image (no 2D context,
// blocked toDataURL) so the caller can tell the user instead of leaving a
// dead button. Returns true once the download has been triggered.
export function exportAwardCard(award: Award, leagueName: string, season: number): boolean {
  const w = 800;
  const h = 420;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    logger.error('[awardCard] 2D canvas context unavailable');
    return false;
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

  // Icon
  ctx.font = '64px serif';
  ctx.fillText(award.icon || '🏆', 50, 160);

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

  try {
    const link = document.createElement('a');
    link.download = `${award.name.replace(/[^a-z0-9]/gi, '_')}_${season}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    return true;
  } catch (err) {
    // toDataURL can throw (memory limits, tainted canvas). The drawing all
    // happened on data we own, but fail loud rather than silent either way.
    logger.error('[awardCard] toDataURL/download failed:', err);
    return false;
  }
}
