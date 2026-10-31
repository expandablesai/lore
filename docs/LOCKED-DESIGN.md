# Locked design system

Frozen **2026-11-01** at the owner's request: *"lock the current design system
until i ask for a change."*

`node scripts/lock.mjs` enforces this file: the four files that *are* the design
system are hashed, and any edit to them fails the check until the lock is moved
on purpose. The layout contracts below are asserted token by token, so a
refactor that keeps the look but drops the rule still fails.

```bash
pnpm lock:check                                   # what drifted
node scripts/lock.mjs update --reason "why"       # record a sanctioned change
```

## What is frozen, and where it lives

| File | Role |
| --- | --- |
| `apps/web/src/index.css` | The two palettes, surface tokens, glass material, motion, scrollbars, neon layer |
| `apps/web/src/views/common.tsx` | The primitives: `Panel`, `Button`, `Field`, `Badge`, `StatusLine`, `ErrorNote` |
| `apps/web/src/lib/theme.tsx` | `light` / `dark` / `system` plus the independent neon axis |
| `packages/ui/src/index.ts` | `cn` — the only class-merging helper |

## The material: liquid glass

Everything is a translucent pane over a lit page. Nothing is an opaque card on a
flat background.

- **Page**: `body` paints `--page-wash` — three radial glows (blue top-left,
  violet top-right, teal bottom) over a vertical gradient — fixed to the
  viewport, so scrolling content moves across light that does not.
- **Pane**: `.glass` = `rgb(var(--glass))` fill, a 1px `--glass-border` edge,
  `backdrop-filter: blur(26px) saturate(165%)`, and `--shadow-pane`
  (a deep soft drop shadow plus a 1px inset highlight).
- **Raised pane**: `.glass-strong` — 34px blur, 180% saturation, brighter edge.
- **Sheen**: `.glass-sheen::before` lays a 1px gradient hairline across the top
  edge, the way glass catches light.
- **Lift**: `.liquid-lift` translates 1px up on hover over 320ms
  `cubic-bezier(0.22, 1, 0.36, 1)`.

Rules that follow from this:

1. **Describe surfaces, never colours.** Views say `glass`, `glass-strong`,
   `text-slate-200`, `border-[rgb(var(--glass-border))]`. A literal hex colour in
   a view is a bug.
2. **No opaque panels.** A view that needs a solid background is wrong; it needs
   the page wash behind it.
3. **One radius language.** Panes are `rounded-3xl`, fields `rounded-2xl`,
   controls and badges full pills (`rounded-full`). Nothing else.

## The two palettes

Dark is the default. Day mode is a **palette swap**, not a second design: the
Tailwind `slate` scale is remapped on `[data-theme="light"]`, so every existing
`bg-slate-900` / `text-slate-300` flips at once and views never branch on theme.

| Token | Dark | Light | Job |
| --- | --- | --- | --- |
| `--glass` | `255 255 255 / 0.055` | `255 255 255 / 0.66` | pane fill |
| `--glass-strong` | `255 255 255 / 0.10` | `255 255 255 / 0.82` | raised pane |
| `--glass-border` | `255 255 255 / 0.12` | `16 22 38 / 0.10` | 1px edge |
| `--glass-highlight` | `255 255 255 / 0.22` | `255 255 255 / 0.90` | sheen, inner highlight |
| `--accent` | `#58a6ff` | `#2f7cf6` | primary action, focus |
| `--accent-contrast` | `#04121f` | `#ffffff` | text on accent |
| `--page-wash` | blue/violet/teal over near-black | the same glows over paper | the lit room |
| `--shadow-pane` | deep, 85% black | soft, 45% navy | depth per palette |
| `--bubble-user` | blue gradient | blue gradient | the reader's own words |
| `--bubble-assistant` | `white / 0.055` | `white / 0.72` | LORE's answer |

`color-scheme` is set per theme so native controls and scrollbars agree.

## The primitives

The API is frozen as much as the look. Views compose these; they do not
re-invent them.

- **`Panel`** — `.glass .glass-sheen .neon-frame rounded-3xl p-5`. The only
  container.
- **`Button`** — pill, four variants, no others:
  `primary` (accent gradient, contrast text, sky glow),
  `ghost` (glass fill, 1px border),
  `quiet` (text-only, tints on hover),
  `danger` (rose, for destroy only).
  All carry `liquid-lift`, `disabled:opacity-50`, and a
  `focus-visible:outline-2 outline-offset-2 outline-sky-400` ring.
- **`Field`** — a label above an input, never a floating placeholder. Label is
  `text-xs font-medium uppercase tracking-wide text-slate-400`; input is glass,
  `rounded-2xl`, with a sky border and a `2px` sky ring on focus.
- **`Badge`** — pill, `text-[11px] font-medium`, five tones
  (`slate`, `sky`, `emerald`, `amber`, `rose`), each a 15% tint of its hue
  except `slate`, which is a 70% pane fill.
- **`StatusLine`** — one muted sentence (`text-sm text-slate-400`).
- **`ErrorNote`** — `role="alert"`, rose border at 30%, rose fill at 10%,
  rose-200 text, `rounded-2xl`.

## Type

`ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Segoe UI", Inter` at
`letter-spacing: -0.01em`, antialiased. No display face, no second scale: size
and weight alone carry hierarchy (the 11px badge, the 12px uppercase label, the
14px body and control text).

## Motion

Three gestures, no more:

1. `liquid-lift` — 1px rise on hover, 320ms.
2. `.rise` / `lore-rise` — 6px fade-up on arrival, 320ms.
3. `neon-drift` / `neon-hue` — the neon layer only.

Every one collapses under `@media (prefers-reduced-motion: reduce)`.

## Layout contract

- The console is `h-screen overflow-hidden`: **the shell owns the viewport**.
  The sidebar is `h-full` and does not scroll the page. The content column is
  `min-h-0 flex-1` with exactly one `overflow-y-auto` region inside it.
- Consequence, and the reason for the lock: a growing chat moves the transcript,
  never the header or the sidebar.
- Message metadata (the timestamp and the copy control) is a quiet
  `text-[11px] text-slate-500` row **under** the bubble on that message's own
  side — never above it, never inline in the text, never a second bubble.
- Bubbles: the reader's is `--bubble-user` (a blue gradient) with
  `--accent-contrast` text; LORE's is `--bubble-assistant` glass. Bubbles cap at
  roughly 80% of the column so the eye keeps a margin.

## Neon (optional layer)

`data-neon="on"` on `<html>` lights a masked conic gradient *under* the pane —
red, amber, yellow, green, cyan, indigo, violet — blurred 48px, drifting over
15s, with `neon-glow` on controls and a coloured `box-shadow` on the reader's
bubble. It is an overlay, never a tint on text, and it is independent of the
palette: it reads in day mode too. It is off by default and stored per user.

## What counts as a design change

Any of these needs the owner's word first:

- adding, removing or recolouring a token in either palette;
- changing a `glass` / `glass-strong` / `glass-sheen` / `liquid-lift` recipe;
- a new radius, shadow or blur value;
- a new primitive in `common.tsx`, or a new `Button` variant;
- a new font, weight scale or letter-spacing;
- a fourth motion gesture, or dropping the reduced-motion guard;
- inverting the layout contract (anything that makes the header or sidebar
  scroll with the content).

Changes that are **not** design changes and need no unlock: copy inside a view,
a new view built from the existing primitives, new icons sized and coloured like
the ones already there, and translations.
