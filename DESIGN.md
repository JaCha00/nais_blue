# NAIS2 Design Contract

This file is the token contract for NAIS2 frontend work. Components that affect layout, spacing, type, color, depth, or motion must trace new values here first.

## 1. Atmosphere / Signature

NAIS2 is a dense desktop workbench for repeated image-generation sessions. The UI should feel calm, compact, and operational: panels are tools, center content stays primary, and visual weight comes from borders, muted surfaces, and clear information hierarchy rather than decoration.

Do:
- Preserve usable center content before side-panel convenience.
- Use compact controls with readable wrapping at narrow widths.
- Keep panels visually quiet with the existing neutral dark/light theme.

Do not:
- Add decorative gradients, glow layers, or marketing-style hero treatment to app surfaces.
- Let fixed sidebars consume the center panel below desktop widths.
- Hide text by clipping when a label can wrap, truncate intentionally, or move to an icon-only affordance with a tooltip.

## 2. Color

The existing Tailwind HSL variables in `src/styles/globals.css` remain the source for runtime color values.

| Token | CSS variable | Role |
| --- | --- | --- |
| `background` | `hsl(var(--background))` | app canvas |
| `foreground` | `hsl(var(--foreground))` | primary text |
| `card` | `hsl(var(--card))` | panel and card surfaces |
| `card-foreground` | `hsl(var(--card-foreground))` | text on panels |
| `muted` | `hsl(var(--muted))` | secondary surface fills |
| `muted-foreground` | `hsl(var(--muted-foreground))` | secondary labels |
| `primary` | `hsl(var(--primary))` | selected state and primary actions |
| `primary-foreground` | `hsl(var(--primary-foreground))` | text on primary |
| `border` | `hsl(var(--border))` | panel and control hairlines |
| `input` | `hsl(var(--input))` | input borders |
| `ring` | `hsl(var(--ring))` | focus ring |
| `destructive` | `hsl(var(--destructive))` | destructive and warning controls |

Existing contextual colors such as amber token balances and destructive warnings may remain when they already express domain state. New UI chrome should use semantic tokens above.

## 3. Typography

NAIS2 inherits the system font stack through Tailwind. This is intentional for a Tauri desktop utility: it matches the host platform and avoids a web-marketing voice.

| Token | Tailwind class | Use |
| --- | --- | --- |
| `type-title` | `text-2xl font-semibold leading-tight` | page-level titles |
| `type-section` | `text-lg font-semibold leading-snug` | card and panel titles |
| `type-body` | `text-sm leading-6` | descriptions and dense body copy |
| `type-label` | `text-xs font-medium leading-5` | field labels and compact metadata |
| `type-control` | `text-xs leading-tight` or `text-sm leading-5` | buttons and inputs |
| `type-code` | `font-mono text-xs leading-5` | prompt and template text boxes |

Text in compact tool surfaces must wrap or truncate deliberately. Fixed-height buttons with translated labels must either use icon-only mode or allow `h-auto min-h-*` plus `whitespace-normal`.

## 4. Spacing

Base unit: `4px`. Use Tailwind scale tokens only.

| Token | Tailwind class | Pixels | Use |
| --- | --- | --- | --- |
| `space-1` | `1` | 4 | icon/text gaps |
| `space-2` | `2` | 8 | control gaps |
| `space-3` | `3` | 12 | shell padding, panel gaps |
| `space-4` | `4` | 16 | card spacing |
| `space-6` | `6` | 24 | roomy card internals |
| `space-8` | `8` | 32 | page rhythm |

Responsive shell contract:
- `>= 1536px`: three-column workbench may show left, center, and right panels.
- `900px - 1535px`: center content stays readable; side panels become explicit drawers or one secondary rail at most.
- `< 900px`: center content is primary; side panels are hidden behind icon controls.

## 5. Components

Shell panels:
- Radius: `rounded-2xl` follows the existing app shell.
- Border: `border border-border/50`.
- Surface: `bg-card/30` to `bg-card/50` with existing backdrop blur where already used.
- Width: desktop sidebars may be fixed, but must be hidden or converted to drawers below the responsive shell thresholds.

Navigation:
- Compact mode is based on available container width, not global window width alone.
- Icon buttons must have accessible labels or tooltips.
- Labels may show only when the center panel has enough inline space.

Prompt controls:
- Action rows must wrap at narrow widths.
- Primary generate action can take the full row when needed.
- Numeric counters and icon controls must not force the panel wider than the viewport.

Style Lab text boxes:
- Prompt/template text areas use `type-code`.
- Width must be `min-w-0 w-full`.
- Height should be stable but readable: compact cards use at least `h-24`, template inputs at least `min-h-36`, rendered previews at least `min-h-32`.
- Long prompt text must remain readable through wrapping and internal scrolling, never through horizontal page scroll.

## 6. Motion

Use the existing low-intensity motion language:
- Duration: `duration-150` to `duration-300`.
- Properties: opacity, transform, color, background, border.
- Avoid animating layout width during breakpoint changes.
- Respect existing browser reduced-motion behavior when adding new motion.

## 7. Depth

Depth strategy is borders plus muted tonal fills.

| Token | Tailwind class | Use |
| --- | --- | --- |
| `depth-panel` | `shadow-lg border border-border/50` | app shell panels |
| `depth-card` | `border border-border/60 bg-card/70` | Style Lab cards |
| `depth-muted` | `bg-muted/20` to `bg-muted/50` | nested metrics and empty states |

Avoid adding new raw `box-shadow` values unless this file is updated first.
