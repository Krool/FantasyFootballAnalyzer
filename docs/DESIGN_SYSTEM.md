# GRIDIRON Design System

The visual language of Fantasy Football Analyzer. Read this before adding any
new component, page, or style. The goal is a sports tabloid aesthetic on a
dark stadium background, with terminal-style data density.

## North Star

> Sports almanac meets Bloomberg terminal. Print magazine confidence,
> spreadsheet honesty.

If something feels rounded, soft, gradient-y, or "SaaS dashboard" it does not
belong. Hard edges, hard shadows, mono labels, italic serif body, chunky
display headlines, lime accents.

---

## Tokens

All tokens are defined in `src/index.css` under `:root`. Never hardcode a color
or font in a component. Always reference a CSS variable.

### Color palette

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#0a0a0a` | Page background, button base |
| `--ink-2` | `#141412` | Raised panels, hover surfaces, stat sections |
| `--ink-3` | `#1f1e1a` | Input backgrounds, deepest hover |
| `--rule` | `#2a2823` | Hairline borders, dashed separators |
| `--bone` | `#f1ece1` | Primary text, primary borders |
| `--bone-dim` | `#8a8478` | Secondary text, mono labels, muted UI |
| `--lime` | `#d6ff2e` | Primary accent. Wins, focus, hover, kickers |
| `--blood` | `#e63a1f` | Errors, losses, warnings |
| `--turf` | `#0f3d2e` | Reserved (rare use only) |
| `--gold` | `#ffcf3a` | Reserved hardware tier |

**Rules:**

- Default surface is `--ink`. Raise to `--ink-2` for nested panels and hover.
- Borders are `--bone` (strong) or `--bone-dim` (muted). Use dashed for
  separators inside cards, solid for the card itself.
- Lime is the primary accent. Use it sparingly so it stays loud.
- Red is reserved for negative states. Do not decorate with it.
- No gradients except the one approved exception (TradeTable winner stripe).
- No purple, blue, teal, or other unapproved hues.

### Legacy aliases

The token rewrite preserves every legacy variable name (`--bg-primary`,
`--bg-secondary`, `--text-primary`, `--accent-gold`, etc) and aliases them to
the new palette. **Do not introduce new code that depends on legacy names.**
New code uses `--ink`, `--bone`, `--lime`, etc. directly.

### Typography

| Token | Family | Use |
|---|---|---|
| `--font-headline` | `"Bowlby One"` | Display headlines, page titles, big stat numbers |
| `--font-display` | `"Fraunces"` | Body copy, italic descriptions, team names |
| `--font-body` | `"Fraunces"` | Same as display. Body uses serif for warmth. |
| `--font-mono` | `"JetBrains Mono"` | Labels, kickers, tickers, tables, code |

**Type rules:**

1. **Bowlby One** is uppercase only. Always set `text-transform: uppercase`,
   `letter-spacing: -0.02em`, and `line-height: 0.82` to `0.95`. Never use it
   for body text. Never use it at less than ~1.1rem.

2. **Fraunces** is the body font. For descriptions and "magazine voice" copy
   prefer `font-style: italic; font-weight: 300`. For team and player names use
   `italic; font-weight: 500`. Never bold Fraunces past 500 in body.

3. **JetBrains Mono** is for everything terminal-flavored: kickers, labels,
   stat counts, tables, badges, filter labels. Always uppercase with tracking
   between `0.12em` and `0.22em`. Font sizes typically `0.6rem` to `0.78rem`.

4. **Headlines on pages** follow the formula:
   ```css
   font-family: var(--font-headline);
   font-size: clamp(56px, 9vw, 140px);
   line-height: 0.82;
   text-transform: uppercase;
   letter-spacing: -0.025em;
   color: var(--bone);
   ```

5. **Subtitles under page headlines** are mono kickers, lime, with a glyph
   prefix:
   ```css
   font-family: var(--font-mono);
   font-size: 0.78rem;
   letter-spacing: 0.22em;
   text-transform: uppercase;
   color: var(--lime);
   ```
   Use `::before { content: '◆ ' }` or `'★ '` or `'▌ '` to mark the kicker.

### Shadows

The system uses **hard offset shadows only**. No blur, no spread, no rgba
softness. Shadow tokens:

```css
--shadow-offset:      6px 6px 0 var(--ink);
--shadow-offset-bone: 6px 6px 0 var(--bone);
```

**Per-component overrides** are common. The pattern is:

| Element | Default shadow | Hover shadow |
|---|---|---|
| Card on dark bg | `5px 5px 0 var(--bone)` | `8px 8px 0 var(--lime)` |
| Button (outline) | `4px 4px 0 var(--bone)` | `6px 6px 0 var(--bone)` |
| Button (lime fill) | `4px 4px 0 var(--ink)` | `6px 6px 0 var(--ink)` |
| Filter bar | `4px 4px 0 var(--bone)` | (no hover) |
| Table wrapper | `5px 5px 0 var(--bone)` | (no hover) |
| Badge | `2px 2px 0 var(--ink)` | `3px 3px 0 var(--ink)` |

Hover effect on cards/buttons is `transform: translate(-2px, -2px)` to
`translate(-3px, -3px)` paired with a larger shadow. This makes it look like
the element is lifting off the page toward you.

### Layout

| Token | Value | Use |
|---|---|---|
| `--ticker-h` | `38px` | Reserved for any future top sticky element |

There is no spacing scale. Use `rem` units directly. Common values:
`0.3rem`, `0.5rem`, `0.75rem`, `1rem`, `1.25rem`, `1.5rem`, `2rem`, `3rem`.

### Borders and corners

**Border-radius is forbidden** except in two cases:

1. Circular avatars and the legacy spinner (`border-radius: 50%`)
2. That's it.

All other elements have square corners. This is non-negotiable for the
aesthetic.

Border widths are `1px` (hairline / dashed separators) or `2px` (everything
load-bearing) or `3px` (page section dividers, focus rings). Use `4px` to `6px`
only for accent reveals (top stripes, leaderboard left bars).

---

## Component patterns

### Page header

Every page that isn't the Home page uses this header pattern:

```tsx
<div className={styles.header}>
  <h1 className={styles.title}>Page Name</h1>
  <p className={styles.subtitle}>Context line</p>
</div>
```

```css
.header {
  margin-bottom: 2.5rem;
  padding-bottom: 1.25rem;
  border-bottom: 3px solid var(--bone);
}
.title { /* See "Headlines on pages" formula above */ }
.subtitle {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--lime);
}
.subtitle::before { content: '◆ '; }
```

When extending: copy this exact pattern. Don't invent a new page header.

### Card

Two flavors: **dark card** (default, on the ink background) and **lime card**
(used for accent rhythm in grids).

```css
.card {
  background: var(--ink);
  border: 2px solid var(--bone);
  padding: 1.4rem 1.4rem 1.5rem;
  box-shadow: 5px 5px 0 var(--bone);
  transition: transform .2s ease, box-shadow .2s ease, background .2s ease;
}
.card:hover {
  transform: translate(-3px, -3px);
  box-shadow: 8px 8px 0 var(--lime);
  border-color: var(--lime);
  background: var(--ink-2);
}
```

For the lime accent variant in a grid (every 3rd card flips):
```css
.card:nth-child(3n+2) {
  background: var(--lime);
  color: var(--ink);
  border-color: var(--lime);
  box-shadow: 5px 5px 0 var(--bone);
}
```
Inside an accent card, all text becomes `var(--ink)` and accents become `var(--bone)`.

### Top stripe reveal

Hover effect for cards that should feel "alive":
```css
.card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 4px;
  background: var(--lime);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform .35s cubic-bezier(.2, .8, .2, 1);
}
.card:hover::before { transform: scaleX(1); }
```

### Buttons

Three styles: outline (default), lime-filled (primary), ghost icon button.

```css
/* Outline */
.btn {
  padding: 0.7rem 1.2rem;
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  border: 2px solid var(--bone);
  background: transparent;
  color: var(--bone);
  box-shadow: 4px 4px 0 var(--bone);
}
.btn:hover { transform: translate(-2px, -2px); box-shadow: 6px 6px 0 var(--bone); }

/* Primary */
.btn-primary {
  background: var(--lime);
  color: var(--ink);
  border-color: var(--lime);
  box-shadow: 4px 4px 0 var(--ink);
}
```

Buttons never have border-radius. Buttons never use a soft shadow.

### Inputs

```css
.input {
  padding: 0.75rem 0.9rem;
  background: var(--ink);
  border: 2px solid var(--bone-dim);
  color: var(--bone);
  font-family: var(--font-mono);
  font-size: 0.9rem;
}
.input:focus {
  outline: none;
  border-color: var(--lime);
  box-shadow: 4px 4px 0 var(--lime);
}
.input::placeholder {
  color: var(--bone-dim);
  font-style: italic;
  font-family: var(--font-body);
}
```

Note the placeholder swap to italic serif. This is intentional and creates
character.

### Tables

```css
.table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 0.85rem;
}
.table th {
  background: var(--ink);
  font-weight: 700;
  color: var(--bone-dim);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  border-bottom: 2px solid var(--bone);
}
.table td { border-bottom: 1px dashed var(--rule); }
.table tbody tr:hover { background: var(--ink-2); }
.table tbody tr:hover td:first-child {
  box-shadow: inset 4px 0 0 var(--lime);
}
```

The lime inset stripe on hover is the signature interaction for tables. Always
include it.

Tables sit inside a `tableWrapper` that supplies the bone border and offset
shadow:
```css
.tableWrapper {
  overflow-x: auto;
  border: 2px solid var(--bone);
  box-shadow: 5px 5px 0 var(--bone);
  background: var(--ink);
}
```

### Sortable column headers

```css
.sortable {
  cursor: pointer;
  user-select: none;
  position: relative;
  transition: color .15s ease;
}
.sortable:hover { color: var(--lime); }
.sortable::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 2px;
  background: var(--lime);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.2s ease;
}
.sortable:hover::after { transform: scaleX(1); }
```

### Badges

Grade badges and category badges all follow this pattern: hard border, mono
type, hard shadow, hover lift.

```css
.badge {
  padding: 0.3rem 0.7rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  border: 2px solid var(--ink);
  box-shadow: 3px 3px 0 var(--ink);
}
.badge:hover {
  transform: translate(-1px, -1px);
  box-shadow: 4px 4px 0 var(--ink);
}
```

Color variants:
- Great / Win: `background: var(--lime); color: var(--ink);`
- Good: `background: #a6e22e; color: var(--ink);`
- Bad: `background: #ff8a3d; color: var(--ink);`
- Terrible / Loss: `background: var(--blood); color: var(--bone);`

### Leaderboard rows

The pattern that appears in TradeTable, WaiverTable, and elsewhere:

```css
.leaderboardItem {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 0.9rem;
  background: var(--ink-2);
  border-left: 3px solid var(--rule);
  font-family: var(--font-mono);
}
.leaderboardItem:hover {
  background: var(--ink);
  border-left-color: var(--lime);
}
.leaderboardItem:nth-child(1) { border: 2px solid var(--lime); border-left-width: 6px; }
.leaderboardItem:nth-child(2) { border: 2px solid var(--bone); border-left-width: 6px; }
.leaderboardItem:nth-child(3) { border: 2px solid #cd7f32; border-left-width: 6px; }
```

### Stat counters / numbered grids

For grids of cards that feel like a magazine spread, add a leading-zero counter:

```css
.grid { counter-reset: trophy; }
.gridItem::after {
  counter-increment: trophy;
  content: counter(trophy, decimal-leading-zero);
  position: absolute;
  top: 1rem;
  right: 1rem;
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.2em;
  color: var(--bone-dim);
}
```

**Always use `decimal-leading-zero`**, never string-concat (`'0' counter(x)`),
because the latter breaks past 9.

### Empty states

```css
.empty {
  text-align: center;
  padding: 4rem 2rem;
  background: var(--ink);
  border: 2px dashed var(--bone-dim);
}
.empty h2 {
  font-family: var(--font-headline);
  font-size: 1.75rem;
  text-transform: uppercase;
}
.empty p {
  font-family: var(--font-display);
  font-style: italic;
  color: var(--bone-dim);
}
```

The dashed border + italic serif is the empty-state signature.

### Error / notice boxes

```css
.error {
  background: var(--ink);
  border: 2px solid var(--blood);
  color: var(--bone);
  padding: 1rem 1.2rem;
  font-family: var(--font-mono);
  box-shadow: 4px 4px 0 var(--blood);
}
```

Same shape, swap color. Notice/info uses `--bone-dim` border and dashed style.

### Manifesto / callout

The "fine print" callout on Home is the pattern for any aside that needs to
stand apart from the main content:

```css
.manifesto {
  border: 2px solid var(--bone);
  border-left: 6px solid var(--lime);
  box-shadow: 5px 5px 0 var(--bone);
  padding: 1.4rem 1.6rem 1.5rem;
}
```

The chunky 6px lime left bar is the signature.

---

## Layout patterns

### Page structure

```tsx
<div className={styles.page}>
  <div className="container">
    <div className={styles.header}>{/* page header */}</div>
    {/* page content */}
  </div>
</div>
```

```css
.page { padding: 3rem 0 5rem; }
```

### Grid for cards

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.5rem;
}
```

Card minimum width is `280px` to `360px` depending on density. Gap is `1rem`
to `1.5rem`. Always `auto-fill`, never `auto-fit`.

### Section dividers

Use `border-bottom: 3px solid var(--bone)` for major page sections, and
`border-bottom: 2px dashed var(--bone-dim)` for minor section titles inside a
page.

---

## Voice and copy rules

This applies to any user-facing text we add:

1. **No em dashes (`—`).** Use periods, commas, or split into two sentences.
2. **No AI cliches.** Banned phrases include but are not limited to:
   "in the world of", "dive into", "unleash", "harness the power of",
   "seamlessly", "leverage", "elevate", "revolutionize", "game-changer",
   anything that sounds like a SaaS landing page.
3. **Voice is dry, confident, sports-page editorial.** Short sentences. Active
   verbs. Numbers over adjectives.
4. **Headline formula.** Two words, period, optional italic word for emphasis.
   Bowlby One does the heavy lifting visually so the words can be plain.
5. **Kickers and labels are uppercase mono.** Always.
6. **Honesty over marketing.** If a claim isn't strictly true, fix the claim
   or fix the code. Do not write copy the implementation can't back up.

---

## When extending

**Before adding anything**, ask:

1. Does an existing pattern in this doc cover it? Use that.
2. Does an existing CSS module have a similar component? Copy and adapt the
   classes from it. The system intentionally has lots of repetition for now.
3. Am I introducing a new color, font, shadow shape, or border-radius? **Stop.**
   Either reuse a token or open a discussion about expanding the system.
4. Am I writing copy? Re-read the voice rules above.

**Files to look at first when adding a new page:**

- `src/index.css` for tokens
- `src/pages/AwardsPage.module.css` for the canonical "tabloid grid + section"
  layout
- `src/components/TradeTable.module.css` for the canonical "filter bar +
  cards + leaderboard" layout
- `src/components/TeamCard.module.css` for the canonical "stat-dense card"
  layout

**Files NOT to copy from:**

- Anything in `src/utils/exportPdf.ts` — the PDF report has its own palette
  and is not part of this design system (yet).
- The `ErrorBoundary` inline styles — they intentionally don't depend on
  CSS modules so they survive a render crash. The shape is correct, but
  don't import inline patterns from it elsewhere.

---

## Future extraction targets

When the moment is right, these patterns should become shared React primitives:

- `<TabloidCard variant="dark|lime|dashed">` — collapses ~6 card definitions
- `<RankRow rank={1} primary={...} secondary={...} value={...} />` — collapses
  ~4 leaderboard implementations
- `<PageHeader title={...} subtitle={...} />` — collapses ~7 page header dupes
- `<StatTile label={...} value={...} delta={...} />` — for the "stat strip"
  pattern across Trades, Waivers, etc.

Until then, the duplication is intentional. Don't extract a primitive before
seeing it used three times in production.

---

## Reduced motion and accessibility

- All animations respect `prefers-reduced-motion: reduce` via the global rule
  in `src/index.css`. Don't bypass it.
- Focus rings are `outline: 3px solid var(--lime); outline-offset: 3px;`.
  Never remove focus visibility.
- Skip-nav link uses lime-on-ink and is required on every page-level layout.
- Color contrast: bone on ink is ~14:1, lime on ink is ~13:1, bone-dim on ink
  is ~4.5:1. Don't drop bone-dim below this size or contrast.

---

## Files of record

| File | Purpose |
|---|---|
| `src/index.css` | Tokens and global primitives |
| `docs/DESIGN_SYSTEM.md` | This document |
| `docs/redesign-proposal.html` | Original standalone proposal (reference only) |
