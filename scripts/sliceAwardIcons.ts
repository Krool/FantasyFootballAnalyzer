// Slices the award icon sprite sheets in data/award-sheets/ into per-award
// PNGs in src/images/awards/. The sheets are AI-generated 4x3 sticker grids
// on a magenta chroma-key background; this script keys out the magenta,
// finds each sticker as a connected component (small satellites like the
// alarm clock's "Zzz", the dizzy stars, and the bomb spark attach to their
// nearest big sticker, so nothing gets clipped by a fixed grid), and writes
// each one as a square, centered, transparent 256px PNG named by award id.
//
// Re-run after regenerating a sheet: npx tsx scripts/sliceAwardIcons.ts

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEET_DIR = path.join(ROOT, 'data', 'award-sheets');
const OUT_DIR = path.join(ROOT, 'src', 'images', 'awards');

const OUT_SIZE = 256;
// Sticker anchors are ~50k px on a 1.5M px sheet; satellites (stars, Zzz,
// spark) run a few hundred to a few thousand. Anything under NOISE_AREA is
// a stray speck and gets dropped instead of attached.
const ANCHOR_AREA = 8000;
const NOISE_AREA = 40;

// Output names are award ids from src/utils/awards.ts, row-major per sheet.
// broken_heart is shared by the unluckiest + heartbreak awards (mapped in
// src/utils/awardIcons.ts).
const SHEETS: Record<string, string[]> = {
  'performance-weekly.png': [
    'best_record', 'most_points', 'worst_record', 'most_pa',
    'least_pa', 'lowest_scorer', 'best_week', 'worst_week',
    'consistent', 'boom_bust', 'weekly_highs', 'weekly_lows',
  ],
  'luck-draft.png': [
    'luckiest', 'broken_heart', 'biggest_blowout', 'narrowest_escape',
    'clutch', 'allplay_champ', 'allplay_loser', 'best_draft',
    'worst_draft', 'draft_steal', 'draft_bust', 'late_round_hero',
  ],
  'waivers-trades.png': [
    'best_waiver', 'worst_waiver', 'waiver_king', 'waiver_slacker',
    'most_active', 'least_active', 'trade_shark', 'trade_victim',
    'best_trade', 'worst_trade', 'trade_addict', 'trade_avoider',
  ],
};

interface Box { x0: number; y0: number; x1: number; y1: number }
interface Component extends Box { area: number; cx: number; cy: number; pixels: number[] }

function isMagenta(r: number, g: number, b: number): boolean {
  return r > 110 && b > 110 && g < 0.72 * Math.min(r, b) && r - g > 50 && b - g > 50;
}

function boxDistance(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1));
  const dy = Math.max(0, Math.max(a.y0 - b.y1, b.y0 - a.y1));
  return Math.hypot(dx, dy);
}

async function sliceSheet(sheetFile: string, names: string[]) {
  const { data, info } = await sharp(path.join(SHEET_DIR, sheetFile))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;

  // 1. Chroma-key: opaque mask of everything that isn't magenta.
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (!isMagenta(r, g, b)) mask[i] = 1;
  }

  // 2. Erode one pixel so the keyed edge loses its magenta-blended fringe.
  const eroded = new Uint8Array(mask);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      for (let dy = -1; dy <= 1 && eroded[i]; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !mask[ny * W + nx]) {
            eroded[i] = 0;
            break;
          }
        }
      }
    }
  }

  // 3. Despill: any surviving pinkish pixel is halo sitting on the bone
  //    keyline; pull it toward bone.
  for (let i = 0; i < W * H; i++) {
    if (!eroded[i]) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (r > g + 50 && b > g + 50) {
      data[i * 4] = Math.round(r * 0.35 + 241 * 0.65);
      data[i * 4 + 1] = Math.round(g * 0.35 + 236 * 0.65);
      data[i * 4 + 2] = Math.round(b * 0.35 + 225 * 0.65);
    }
  }

  // 4. Connected components (8-way BFS) over the eroded mask.
  const seen = new Uint8Array(W * H);
  const components: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (!eroded[start] || seen[start]) continue;
    const comp: Component = {
      x0: W, y0: H, x1: 0, y1: 0, area: 0, cx: 0, cy: 0, pixels: [],
    };
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % W, y = (i / W) | 0;
      comp.area++;
      comp.cx += x;
      comp.cy += y;
      comp.pixels.push(i);
      if (x < comp.x0) comp.x0 = x;
      if (x > comp.x1) comp.x1 = x;
      if (y < comp.y0) comp.y0 = y;
      if (y > comp.y1) comp.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (eroded[ni] && !seen[ni]) {
            seen[ni] = 1;
            stack.push(ni);
          }
        }
      }
    }
    comp.cx /= comp.area;
    comp.cy /= comp.area;
    components.push(comp);
  }

  // 5. Big components are sticker anchors; everything else attaches to the
  //    nearest anchor so satellites survive un-clipped.
  const anchors = components.filter(c => c.area >= ANCHOR_AREA);
  if (anchors.length !== names.length) {
    throw new Error(
      `${sheetFile}: expected ${names.length} sticker anchors, found ${anchors.length} ` +
      `(areas: ${components.map(c => c.area).sort((a, b) => b - a).slice(0, 16).join(', ')})`,
    );
  }
  const groups = anchors.map(a => ({ box: { ...a } as Box, members: [a] }));
  for (const comp of components) {
    if (comp.area >= ANCHOR_AREA || comp.area < NOISE_AREA) continue;
    let best = groups[0];
    let bestDist = Infinity;
    for (const g of groups) {
      const d = boxDistance(comp, g.box);
      if (d < bestDist) {
        bestDist = d;
        best = g;
      }
    }
    best.members.push(comp);
    best.box.x0 = Math.min(best.box.x0, comp.x0);
    best.box.y0 = Math.min(best.box.y0, comp.y0);
    best.box.x1 = Math.max(best.box.x1, comp.x1);
    best.box.y1 = Math.max(best.box.y1, comp.y1);
  }

  // 6. Order row-major: sort by anchor centroid y, chunk into rows of 4,
  //    sort each row by x.
  const rowSize = 4;
  const ordered = [...groups].sort((a, b) => a.members[0].cy - b.members[0].cy);
  const rows: (typeof groups) = [];
  for (let r = 0; r < ordered.length; r += rowSize) {
    rows.push(...ordered.slice(r, r + rowSize).sort((a, b) => a.members[0].cx - b.members[0].cx));
  }

  // 7. Crop each group onto a centered square transparent canvas and save.
  for (let n = 0; n < rows.length; n++) {
    const { box, members } = rows[n];
    const w = box.x1 - box.x0 + 1;
    const h = box.y1 - box.y0 + 1;
    const side = Math.ceil(Math.max(w, h) * 1.06);
    const square = Buffer.alloc(side * side * 4);
    const offX = ((side - w) / 2 - box.x0) | 0;
    const offY = ((side - h) / 2 - box.y0) | 0;
    for (const m of members) {
      for (const i of m.pixels) {
        const x = i % W, y = (i / W) | 0;
        const o = ((y + offY) * side + (x + offX)) * 4;
        square[o] = data[i * 4];
        square[o + 1] = data[i * 4 + 1];
        square[o + 2] = data[i * 4 + 2];
        square[o + 3] = 255;
      }
    }
    const outFile = path.join(OUT_DIR, `${names[n]}.png`);
    await sharp(square, { raw: { width: side, height: side, channels: 4 } })
      .resize(OUT_SIZE, OUT_SIZE)
      .png({ compressionLevel: 9, palette: true, quality: 80 })
      .toFile(outFile);
    console.log(
      `${sheetFile} [${n}] -> ${names[n]}.png ` +
      `(${w}x${h} @ ${box.x0},${box.y0}, ${members.length - 1} satellite(s))`,
    );
  }
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [sheetFile, names] of Object.entries(SHEETS)) {
  await sliceSheet(sheetFile, names);
}
console.log('Done.');
