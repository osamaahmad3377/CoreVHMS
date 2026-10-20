import { z } from 'zod';
import { optText } from './schemas/common';

/**
 * Clinic branding (white label): the name, logo, icon and colours staff see in the app, on the clinic's sign-in
 * page and in the browser tab. Changed by the clinic owner only (permission `branding.manage`).
 */
const hexColour = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #0f766e')
  .transform((v) => v.toLowerCase())
  .nullish();

export const BRAND_FONTS = ['SYSTEM', 'INTER', 'ROBOTO', 'OPEN_SANS', 'LATO', 'POPPINS', 'NUNITO', 'MERRIWEATHER'] as const;
export type BrandFont = (typeof BRAND_FONTS)[number];
/** Font names as shown to the owner; SYSTEM is the device's own interface font. */
export const BRAND_FONT_LABELS: Record<BrandFont, string> = {
  SYSTEM: 'Inter (standard)',
  INTER: 'Inter',
  ROBOTO: 'Roboto',
  OPEN_SANS: 'Open Sans',
  LATO: 'Lato',
  POPPINS: 'Poppins',
  NUNITO: 'Nunito',
  MERRIWEATHER: 'Merriweather (serif)',
};
export type CornerStyle = 'SHARP' | 'STANDARD' | 'ROUNDED';
export type ThemeMode = 'LIGHT' | 'DARK' | 'SYSTEM';
export type LoginLayout = 'SPLIT' | 'CENTERED';
export type LoginBackground = 'MENU_COLOUR' | 'GRADIENT' | 'IMAGE';
export type PrintLogoPosition = 'LEFT' | 'CENTER' | 'RIGHT';

/** Corner roundness of buttons, fields and cards (the theme's --radius). */
export const CORNER_RADIUS: Record<CornerStyle, string> = { SHARP: '0.25rem', STANDARD: '0.75rem', ROUNDED: '1.25rem' };

export const brandingUpdateSchema = z.object({
  /** Name shown in the menu, on the sign-in page and in the browser tab; empty = the clinic name. */
  brandName: optText(60),
  /** Buttons, links and highlights. */
  primaryColor: hexColour,
  /** Side menu background. */
  sidebarColor: hexColour,
  /** Sign-in page welcome. */
  loginHeadline: optText(120),
  loginMessage: optText(300),
  // Look and feel
  brandFont: z.enum(BRAND_FONTS).optional(),
  cornerStyle: z.enum(['SHARP', 'STANDARD', 'ROUNDED']).optional(),
  defaultTheme: z.enum(['LIGHT', 'DARK', 'SYSTEM']).optional(),
  // Sign-in page
  loginLayout: z.enum(['SPLIT', 'CENTERED']).optional(),
  loginBackground: z.enum(['MENU_COLOUR', 'GRADIENT', 'IMAGE']).optional(),
  loginFooter: optText(200),
  // Printed documents
  printLogoPosition: z.enum(['LEFT', 'CENTER', 'RIGHT']).optional(),
  printHeaderText: optText(200),
  printFooterText: optText(300),
  printUseBrandColour: z.boolean().optional(),
  // Emails
  emailSenderName: optText(60).refine((v) => !v || !/[<>"\r\n@]/.test(v), 'Use letters, numbers and spaces only'),
  emailSignature: optText(500),
});
export type BrandingUpdateInput = z.infer<typeof brandingUpdateSchema>;

export interface Branding {
  brandName: string;
  primaryColor: string | null;
  sidebarColor: string | null;
  logoUrl: string | null;
  iconUrl: string | null;
  /** False when the tab icon is the logo (no separate icon uploaded). */
  hasOwnIcon: boolean;
  /** Logo for dark backgrounds; null = use the normal logo everywhere. */
  logoDarkUrl: string | null;
  loginHeadline: string | null;
  loginMessage: string | null;
  brandFont: BrandFont;
  cornerStyle: CornerStyle;
  defaultTheme: ThemeMode;
  loginLayout: LoginLayout;
  loginBackground: LoginBackground;
  loginBackgroundUrl: string | null;
  loginFooter: string | null;
  printLogoPosition: PrintLogoPosition;
  printHeaderText: string | null;
  printFooterText: string | null;
  printUseBrandColour: boolean;
  emailSenderName: string | null;
  emailSignature: string | null;
}

/**
 * One-click starting points for the Branding page: colours, font and corners that go well together.
 * The owner can change any of them afterwards.
 */
export const BRAND_PRESETS: { key: string; name: string; primaryColor: string; sidebarColor: string; brandFont: BrandFont; cornerStyle: CornerStyle }[] = [
  { key: 'classic', name: 'Classic teal', primaryColor: '#0f7b6c', sidebarColor: '#131c26', brandFont: 'SYSTEM', cornerStyle: 'STANDARD' },
  { key: 'ocean', name: 'Ocean', primaryColor: '#2563eb', sidebarColor: '#0f172a', brandFont: 'SYSTEM', cornerStyle: 'STANDARD' },
  { key: 'lavender', name: 'Lavender', primaryColor: '#7c3aed', sidebarColor: '#1e1b4b', brandFont: 'POPPINS', cornerStyle: 'ROUNDED' },
  { key: 'meadow', name: 'Meadow', primaryColor: '#16a34a', sidebarColor: '#14532d', brandFont: 'NUNITO', cornerStyle: 'ROUNDED' },
  { key: 'sunset', name: 'Sunset', primaryColor: '#ea580c', sidebarColor: '#431407', brandFont: 'LATO', cornerStyle: 'STANDARD' },
  { key: 'rose', name: 'Rose', primaryColor: '#db2777', sidebarColor: '#4c0519', brandFont: 'POPPINS', cornerStyle: 'ROUNDED' },
  { key: 'clean', name: 'Clean white', primaryColor: '#0891b2', sidebarColor: '#f8fafc', brandFont: 'SYSTEM', cornerStyle: 'STANDARD' },
  { key: 'heritage', name: 'Heritage', primaryColor: '#334155', sidebarColor: '#1c1917', brandFont: 'MERRIWEATHER', cornerStyle: 'SHARP' },
];

// ── Colour maths (WCAG relative luminance) ──

type Hsl = { h: number; s: number; l: number };

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: [number, number, number]): Hsl {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const c = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** True when white text reads well on this colour (decides which logo version a background needs). */
export function isDarkColour(hex: string): boolean {
  return luminance(hexToRgb(hex)) < 0.2;
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const ratioHsl = (c: Hsl, against: [number, number, number]) => {
  const [x, y] = [luminance(hslToRgb(c)), luminance(against)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Moves lightness (keeping hue and saturation) until the colour reads against `against` at `ratio`. */
function readableOn(c: Hsl, against: [number, number, number], ratio: number, direction: -1 | 1): Hsl {
  let out = { ...c };
  for (let i = 0; i < 100 && ratioHsl(out, against) < ratio; i++) out = { ...out, l: Math.max(0, Math.min(100, out.l + direction)) };
  return out;
}

const css = ({ h, s, l }: Hsl) => `${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%`;
const WHITE: [number, number, number] = [255, 255, 255];
const DARK_BG: [number, number, number] = [13, 20, 24]; // the dark theme's page background
const INK = { h: 200, s: 30, l: 11 };

/**
 * Theme variables (the app's HSL CSS custom properties) for a clinic's colours, in light and dark mode.
 * The chosen colour is kept when it is readable; otherwise only its lightness is adjusted, so links and
 * buttons always meet contrast (3:1 for links/controls, 4.5:1 for button text).
 */
export function brandThemeVariables(b: { primaryColor?: string | null; sidebarColor?: string | null; cornerStyle?: CornerStyle | null; brandFont?: BrandFont | null }) {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  if (b.cornerStyle && b.cornerStyle !== 'STANDARD') light['--radius'] = CORNER_RADIUS[b.cornerStyle];
  // Font files are self-hosted by the web app, which defines --font-<name> for each choice.
  if (b.brandFont && b.brandFont !== 'SYSTEM') {
    const fallback = b.brandFont === 'MERRIWEATHER' ? 'Georgia, serif' : 'ui-sans-serif, system-ui, sans-serif';
    light['--font-brand'] = `var(--font-${b.brandFont.toLowerCase().replace('_', '-')}), ${fallback}`;
  }
  if (b.primaryColor) {
    const base = rgbToHsl(hexToRgb(b.primaryColor));
    const p = readableOn(base, WHITE, 3, -1);
    const pd = readableOn(base, DARK_BG, 3, 1);
    const onP = ratioHsl(p, WHITE) >= 4.5 ? '0 0% 100%' : css(INK);
    const onPd = ratioHsl(pd, WHITE) >= 4.5 ? '0 0% 100%' : css({ h: 200, s: 30, l: 6 });
    Object.assign(light, {
      '--primary': css(p),
      '--primary-foreground': onP,
      '--ring': css(p),
      '--accent': css({ h: base.h, s: Math.min(base.s, 45), l: 93 }),
      '--accent-foreground': css(readableOn({ h: base.h, s: base.s, l: 22 }, hslToRgb({ h: base.h, s: Math.min(base.s, 45), l: 93 }), 4.5, -1)),
      '--sidebar-active': css({ ...p, l: Math.min(Math.max(p.l, 28), 40) }),
    });
    Object.assign(dark, {
      '--primary': css(pd),
      '--primary-foreground': onPd,
      '--ring': css(pd),
      '--accent': css({ h: base.h, s: Math.min(base.s, 40), l: 16 }),
      '--accent-foreground': css({ h: base.h, s: Math.min(base.s, 50), l: 80 }),
      '--sidebar-active': css({ ...pd, l: Math.min(Math.max(pd.l, 26), 36) }),
    });
  }
  if (b.sidebarColor) {
    const sb = rgbToHsl(hexToRgb(b.sidebarColor));
    const darkMenu = luminance(hexToRgb(b.sidebarColor)) < 0.2;
    const vars = {
      '--sidebar': css(sb),
      '--sidebar-foreground': darkMenu ? css({ h: sb.h, s: Math.min(sb.s, 15), l: 82 }) : css({ h: sb.h, s: Math.min(sb.s, 30), l: 20 }),
      '--sidebar-strong': darkMenu ? '0 0% 100%' : css({ h: sb.h, s: Math.min(sb.s, 30), l: 8 }),
      '--sidebar-border': css({ ...sb, l: darkMenu ? Math.min(sb.l + 8, 100) : Math.max(sb.l - 10, 0) }),
      '--sidebar-hover': darkMenu ? '0 0% 100% / 0.06' : '0 0% 0% / 0.06',
    };
    Object.assign(light, vars);
    Object.assign(dark, vars);
  }
  return { light, dark };
}

/** CSS that applies a clinic's colours on top of the default theme (empty when it uses the defaults). */
export function brandThemeCss(b: Parameters<typeof brandThemeVariables>[0]): string {
  const { light, dark } = brandThemeVariables(b);
  const block = (sel: string, v: Record<string, string>) =>
    Object.keys(v).length ? `${sel}{${Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';')}}` : '';
  return block(':root', light) + block('.dark', dark);
}
