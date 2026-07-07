# NAIS2 Design System

## Atmosphere / Signature

NAIS2 is a dense production cockpit for image generation work. UI should feel quiet, direct, and repeatable: dark-native surfaces, thin borders, restrained contrast, compact controls, and prompt text kept readable over decoration.

## Color

- `--background` light `0 0% 100%`, dark `0 0% 3.9%`: app background.
- `--foreground` light `0 0% 3.9%`, dark `0 0% 98%`: primary text.
- `--card` light `0 0% 100%`, dark `0 0% 3.9%`: framed panel surface.
- `--card-foreground` light `0 0% 3.9%`, dark `0 0% 98%`: text on card.
- `--popover` light `0 0% 100%`, dark `0 0% 3.9%`: overlay surface.
- `--primary` light `0 0% 9%`, dark `0 0% 98%`: primary action and selected states.
- `--primary-foreground` light `0 0% 98%`, dark `0 0% 9%`: text on primary.
- `--secondary` light `0 0% 96.1%`, dark `0 0% 14.9%`: secondary control fill.
- `--muted` light `0 0% 96.1%`, dark `0 0% 14.9%`: inactive panels and quiet fills.
- `--muted-foreground` light `0 0% 45.1%`, dark `0 0% 63.9%`: secondary text.
- `--accent` light `0 0% 96.1%`, dark `0 0% 14.9%`: hover and contextual highlight.
- `--destructive` light `0 84.2% 60.2%`, dark `0 62.8% 30.6%`: errors and destructive actions.
- `--border` light `0 0% 89.8%`, dark `0 0% 14.9%`: hairline borders.
- `--ring` light `0 0% 3.9%`, dark `0 0% 83.1%`: focus ring.
- Chart accents are available through `--chart-1` to `--chart-5`; do not introduce new raw accent colors in components.

## Typography

- Font stack: `Pretendard Variable`, `Pretendard`, `Inter`, `-apple-system`, `BlinkMacSystemFont`, `system-ui`, `sans-serif`.
- Mono stack: `JetBrains Mono`, `Consolas`, `Monaco`, `monospace`.
- Page title: `text-2xl`, weight `600`, line-height from Tailwind default.
- Section title: `text-sm` or `text-base`, weight `600`.
- Body: `text-sm`, weight `400`.
- Metadata and counters: `text-xs`, mono only for ids, filenames, paths, and numeric job state.
- Letter spacing remains Tailwind default; no negative tracking.

## Spacing

- Base unit is Tailwind spacing `1 = 0.25rem = 4px`.
- Dense controls use `gap-2`, `px-3`, `py-2`.
- Panels use `p-3` or `p-4`.
- Page grids use `gap-3` or `gap-4`.
- Large shell gutters are owned by `ThreeColumnLayout`; pages should not add outer hero spacing.

## Components

- Page section panel: `rounded-lg border border-border/50 bg-card/50`.
- Repeated item card: `rounded-lg border border-border/50 bg-background/40`.
- Form control: existing `Input`, `Textarea`, `Select`, `Switch`, `Button`.
- Focus: `focus-visible:ring-2 focus-visible:ring-ring`.
- Disabled: opacity and cursor state from shared UI components.
- Icons: Lucide only.
- Do not nest visual cards inside decorative cards; compact repeated cards inside a page section are allowed.

## Motion

- Existing transitions use `transition-colors`, `transition-all`, and Framer Motion nav indicator.
- Studio interactions should use opacity/color/background transitions only.
- No layout animation for editor panels.
- Reduced-motion inherits browser and Tailwind defaults.

## Depth

- Depth is border-first with muted translucent fills.
- Existing shell shadows may stay at layout level.
- New studio panels use borders and tonal fills, not custom box shadows.
