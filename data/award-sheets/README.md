# Award icon sprite sheets

Source sheets for the award sticker icons in `src/images/awards/`. Generated
with ChatGPT image generation (July 2026), sliced by
`npm run build:award-icons` (`scripts/sliceAwardIcons.ts`): magenta
chroma-key, connected-component crop (floating bits like the alarm clock's
"Zzz" attach to the nearest sticker), square pad, 256px quantized PNG named
by award id.

Cell-to-award-id mapping lives in the `SHEETS` table in the script. The
broken heart is shared by `unluckiest` and `heartbreak` on purpose;
`src/utils/awardIcons.ts` maps both ids to it.

## Adding or regenerating icons

Generate a landscape (1536x1024) image with a 4x3 grid and this style block,
word for word, so new icons match the existing set:

> A sprite sheet of 12 fantasy football award icons arranged in a strict
> 4-column by 3-row grid on a solid, uniform, pure magenta background
> (#FF00FF) for chroma-key cutout. Wide gutters of flat magenta between
> cells. No gridlines, no labels, no text, no watermarks.
>
> Style: flat 2D screen-print illustration, like a vintage sports almanac or
> varsity pennant woodcut. Limited palette only: off-white bone (#f1ece1),
> lime (#d6ff2e), blood red (#e63a1f), gold (#ffcf3a), and near-black ink
> (#0a0a0a). Every shape has a thick near-black outline plus a thin off-white
> keyline around the whole silhouette so it reads on both dark and light
> backgrounds. Solid flat fills, slightly rough hand-cut edges,
> misregistered-print charm. Absolutely no gradients, no soft shadows, no
> glow, no 3D rendering, no glossy highlights, no photorealism, and no
> magenta, pink, or purple anywhere inside the icons.
>
> Composition: each icon is chunky and fills about 85 to 90 percent of its
> cell, square-ish silhouette, centered, never touching a neighboring cell.
> Designed to stay readable when shrunk to 40 pixels. Consistent line weight,
> palette, and level of detail across all 12 icons.
>
> The 12 icons, left to right, top to bottom:
> [numbered list of concrete subjects]

Then drop the PNG here, add its filename and 12 award ids to `SHEETS` in
`scripts/sliceAwardIcons.ts`, run `npm run build:award-icons`, and wire any
new ids in `src/utils/awardIcons.ts`.
