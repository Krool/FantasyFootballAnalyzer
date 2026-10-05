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

## Sheet 4: lineups, byes, games missed (planned, 2026-10-04)

Fifteen new awards plus one bonus (Perfect Week), so this sheet is a 4x4
grid. The slicer chunks rows of 4, so it handles 16 cells with no code
change. Generate it SQUARE (1024x1024 or 1536x1536) with the same style
block, swapping the first sentence for:

> A sprite sheet of 16 fantasy football award icons arranged in a strict
> 4-column by 4-row grid on a solid, uniform, pure magenta background
> (#FF00FF) for chroma-key cutout.

and "all 12 icons" for "all 16 icons". Then append this list:

> 1. A wooden team bench piled high with gold coins and footballs, coins
>    spilling onto the ground.
> 2. A clipboard with a lime checkmark and a play diagram, a whistle hanging
>    off the clip.
> 3. A sleeping football in a hammock tied between two goalposts, a "Zzz"
>    floating above.
> 4. A cleat stepping on a rake whose handle swings up into the football
>    helmet wearing it, a small red impact burst.
> 5. A giant red X stamped over a jersey, a crumpled lineup card underneath.
> 6. An empty jersey with no player in it, floating like a ghost, a hollow
>    zero on its chest.
> 7. A wrench and screwdriver crossed over a lineup card, small motion lines
>    showing constant fiddling.
> 8. A padlock clamped shut on a lineup card, a gold seal on the lock.
> 9. A wall calendar page with a pile of five helmets stacked on one date,
>    the page curling.
> 10. A calendar page with neat evenly spaced lime checkmarks and a single
>     helmet on one date.
> 11. A first-aid kit overflowing with bandage rolls, crutches leaning
>     against it.
> 12. A football helmet made of riveted iron with a gold rivet star,
>     battle-dented but whole.
> 13. A trash can with a football player's arm reaching out of it, the hand
>     holding a gold trophy.
> 14. A rocket launching straight up out of a football, a lime exhaust
>     trail.
> 15. A football falling off a cliff edge, crumbling rock beneath it.
> 16. A lineup card with every row marked by a lime checkmark and a gold
>     star sticker in the corner.

SHEETS order for `lineups-byes.png`: `bench_warmer`, `lineup_savant`,
`set_and_forget`, `self_inflicted`, `worst_call`, `ghost_starter`,
`tinkerer`, `loyalist`, `bye_pileup`, `bye_planner`, `infirmary`,
`iron_man`, `drop_regret`, `late_surge`, `late_collapse`, `perfect_week`.

Check before slicing: 16 separate stickers, no pink or purple inside any
icon, nothing touching a neighbor, and the ghost jersey (6) and the Zzz (3)
attached closely enough to their sticker to crop with it.
