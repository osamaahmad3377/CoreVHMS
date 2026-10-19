import { BRAND_PRESETS, CORNER_RADIUS, brandThemeCss, brandThemeVariables, brandingUpdateSchema, contrastRatio } from './branding';
import { OWNER_ONLY_PERMISSIONS, SYSTEM_ROLE_TEMPLATES } from './permissions';

/** Parses "h s% l%" back to a hex colour for contrast checks. */
function hslToHex(v: string) {
  const [h, s, l] = v.replace(/%/g, '').split(' ').map(Number);
  const S = s / 100;
  const L = l / 100;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round((L - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))) * 255);
  };
  return '#' + [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

describe('clinic branding', () => {
  it('validates and normalises colours and texts', () => {
    expect(brandingUpdateSchema.parse({ primaryColor: '#0F766E', brandName: '  Happy Paws  ', loginMessage: '' })).toMatchObject({
      primaryColor: '#0f766e',
      brandName: 'Happy Paws',
      loginMessage: null,
    });
    expect(brandingUpdateSchema.safeParse({ primaryColor: 'red' }).success).toBe(false);
    expect(brandingUpdateSchema.safeParse({ sidebarColor: '#12345' }).success).toBe(false);
    expect(brandingUpdateSchema.safeParse({ brandName: 'x'.repeat(61) }).success).toBe(false);
  });

  it('uses the defaults when no colours are chosen', () => {
    expect(brandThemeCss({})).toBe('');
  });

  it('keeps a readable main colour and makes a light one readable on white and on the dark theme', () => {
    for (const colour of ['#0f766e', '#2563eb', '#facc15', '#a3e635', '#ffffff', '#000000']) {
      const { light, dark } = brandThemeVariables({ primaryColor: colour });
      expect(contrastRatio(hslToHex(light['--primary']), '#ffffff')).toBeGreaterThanOrEqual(2.95);
      expect(contrastRatio(hslToHex(dark['--primary']), '#0d1418')).toBeGreaterThanOrEqual(2.95);
      // Button text on the main colour.
      expect(contrastRatio(hslToHex(light['--primary']), hslToHex(light['--primary-foreground']))).toBeGreaterThanOrEqual(4.4);
    }
    // A colour that already reads well is not changed.
    expect(hslToHex(brandThemeVariables({ primaryColor: '#2563eb' }).light['--primary'])).toBe('#2563eb');
  });

  it('switches the menu text between light and dark for the menu colour', () => {
    const darkMenu = brandThemeVariables({ sidebarColor: '#0f172a' }).light;
    const lightMenu = brandThemeVariables({ sidebarColor: '#f8fafc' }).light;
    expect(darkMenu['--sidebar-strong']).toBe('0 0% 100%');
    expect(contrastRatio(hslToHex(lightMenu['--sidebar-strong']), '#f8fafc')).toBeGreaterThan(10);
    expect(contrastRatio(hslToHex(lightMenu['--sidebar-foreground']), '#f8fafc')).toBeGreaterThanOrEqual(4.5);
    expect(brandThemeCss({ sidebarColor: '#f8fafc' })).toMatch(/^:root\{--sidebar:.*\}\.dark\{--sidebar:.*\}$/);
  });

  it('applies font and corners, and leaves the defaults alone', () => {
    const v = brandThemeVariables({ brandFont: 'OPEN_SANS', cornerStyle: 'ROUNDED' }).light;
    expect(v['--font-brand']).toBe('var(--font-open-sans), ui-sans-serif, system-ui, sans-serif');
    expect(v['--radius']).toBe(CORNER_RADIUS.ROUNDED);
    expect(brandThemeVariables({ brandFont: 'MERRIWEATHER' }).light['--font-brand']).toContain('serif');
    expect(brandThemeCss({ brandFont: 'SYSTEM', cornerStyle: 'STANDARD' })).toBe('');
  });

  it('ready-made themes are readable', () => {
    expect(new Set(BRAND_PRESETS.map((p) => p.key)).size).toBe(BRAND_PRESETS.length);
    for (const p of BRAND_PRESETS) {
      expect(brandingUpdateSchema.safeParse(p).success).toBe(true);
      expect(contrastRatio(p.primaryColor, '#ffffff')).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps email sender names safe for the From header', () => {
    expect(brandingUpdateSchema.safeParse({ emailSenderName: 'Happy Paws Clinic' }).success).toBe(true);
    for (const bad of ['Evil <x@y.z>', 'a@b.c', 'Line\nBreak', 'Quote"d']) {
      expect(brandingUpdateSchema.safeParse({ emailSenderName: bad }).success).toBe(false);
    }
    expect(brandingUpdateSchema.safeParse({ loginLayout: 'SIDEWAYS' }).success).toBe(false);
  });

  it('branding is for the owner only', () => {
    for (const role of SYSTEM_ROLE_TEMPLATES) {
      const has = OWNER_ONLY_PERMISSIONS.some((p) => role.permissions.includes(p));
      expect([role.key, has]).toEqual([role.key, role.key === 'owner']);
    }
  });
});
