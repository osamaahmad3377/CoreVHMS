# NextCore design system — Glass

A frosted-glass interface: translucent, blurred surfaces over a soft gradient background with a few large colour
shapes, thin light edges, layered shadows and an inner top highlight. Everything is built from CSS variables in
`apps/web/src/app/globals.css`, exposed to Tailwind in `apps/web/tailwind.config.ts`. A clinic's Branding
(Settings → Branding) overrides the brand tokens at runtime (`brandThemeVariables` in `packages/shared/src/branding.ts`).

## Tokens

| Group | Tokens | Notes |
| --- | --- | --- |
| Brand | `--primary` (indigo), `--brand-2` (cyan, secondary accent) | A clinic colour replaces `--primary`; `--brand-2` is derived from it (hue +50°). |
| Neutrals | `--background`, `--foreground`, `--muted`, `--muted-foreground`, `--border`, `--input` | Cool neutrals. `--muted-foreground` stays ≥ 4.5:1 on glass. |
| Semantic | `--success`, `--warning`, `--destructive`, `--info` (+ `-foreground`) | Text-safe (AA) on light glass; lighter values in dark mode. |
| Glass | `--glass` (tint), `--glass-alpha` (0.6 / 0.55 dark), `--glass-strong-alpha` (0.84), `--glass-edge`, `--glass-highlight`, `--glass-blur` (20px), `--glass-saturate` | |
| Background | `--blob-1..3`, `--blob-alpha` | Follow the brand colours. |
| Shape | `--radius` (1rem; Branding corners: 0.375 / 1 / 1.5rem), `--radius-pill` (999px; follows the corners when "Sharp") | Tailwind: `rounded-sm/md/lg/xl/2xl`, `rounded-pill`. |
| Spacing | `--space` 8px | Use Tailwind steps on the 8px grid: 2, 4, 6, 8, 10, 12 (and 1/3 only inside dense controls). |
| Touch | `--tap` 44px | Applied to buttons, fields, tabs and menu items on touch screens. |
| Motion | `--ease` `cubic-bezier(0.32,0.72,0,1)`, 150–300ms | Tailwind `ease-apple`. Reduced motion turns animation and lifts off. |
| Side menu | `--sidebar`, `--sidebar-alpha`, `--sidebar-foreground`, `--sidebar-strong`, `--sidebar-active`, `--sidebar-hover`, `--sidebar-border` | A clinic's menu colour replaces these (firmer glass, alpha 0.9). A light menu colour applies in light mode only. |
| Type | `--font-brand` (Plus Jakarta Sans by default) | Body 15px / 1.6; headings tight (-0.02em). |

## Surfaces (defined once in `globals.css`, `@layer components`)

| Class | Use |
| --- | --- |
| `.surface` | Glass card (`Card`, stat tiles, lists). |
| `.surface-strong` | Opaque glass for dialogs, menus, popovers and toasts, where text must stay crisp. |
| `.surface-flat` | Glass without blur: secondary buttons, tabs, inner tiles, glass inside glass. |
| `.surface-hover` | Hover lift (−2px, deeper shadow). |
| `.surface-menu` | The floating side menu and mobile drawer. |
| `.glass` | The floating top bar. |
| `.text-gradient` | Brand gradient text (used sparingly: the dashboard greeting). |

Glass inside glass never blurs twice (`.surface .surface` drops the blur). Browsers without `backdrop-filter`
and users who ask for reduced transparency get solid surfaces. Print removes all glass.

## Components

- **Button** (`components/ui/button.tsx`): pill-shaped. `default` = the one primary action on a screen (brand
  colour, sheen, glow); `outline` = secondary (frosted glass); `secondary` = tinted; `ghost`; `destructive`;
  `link`. States: hover lift, `active` press (scale .97), 3px focus ring with offset, disabled at 45% opacity.
  Sizes 36 / 40 / 48px, 44px on touch screens.
- **Card** (`components/ui/card.tsx`): `.surface`, `rounded-xl`, header 24px padding with a hairline.
- **Input / Textarea / NativeSelect** (`components/ui/input.tsx`): glass fields with a soft inset, brand focus
  ring, `aria-invalid` turns the edge and ring red; `Field` shows the label, help and inline error.
- **Badge**: pill with tint and inset ring per status (success, warning, destructive, info, default, secondary).
- **Table**: no outer border, uppercase small headers, hairline rows, glass hover.
- **Tabs**: segmented glass pill; the active tab is a raised chip.
- **Dialog / Drawer**: `.surface-strong` panel over a blurred, dimmed backdrop; the mobile menu slides in.
- **Dropdown / Popover / Tooltip**: `.surface-strong`, rounded.
- **Toasts** (sonner): glass, with a coloured edge and icon for success, error, warning and info.
- **Skeletons** (`LoadingRows`, `ShellSkeleton`): shaped like the content (avatar + two lines), shimmering.
- **Empty state** (`EmptyState`): glass icon tile with a soft brand glow, title, one sentence and one action.
- **Navigation**: floating glass side menu (collapsible to icons; slide-in drawer on phones and tablets) and a
  floating glass top bar. The active page is a raised brand-colour pill.

## Rules

1. One primary (`default`) button per screen; everything else `outline`, `ghost` or `secondary`.
2. Use `Card` / `.surface*` classes — never hand-written `bg-card border shadow` combinations.
3. Text on glass uses `foreground` or `muted-foreground` only; coloured text uses the semantic tokens, which are
   AA on glass in both themes.
4. Spacing on the 8px grid; cards pad 24px (16px on phones).
5. Icons: Lucide only, stroke 1.75, 16px in controls, 20px in headers.
6. Motion 150–300ms with `ease-apple`; nothing moves when the user asks for reduced motion.
