import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1400px' } },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        warning: { DEFAULT: 'hsl(var(--warning))', foreground: 'hsl(var(--warning-foreground))' },
        success: { DEFAULT: 'hsl(var(--success))', foreground: 'hsl(var(--success-foreground))' },
        'brand-2': 'hsl(var(--brand-2))',
        info: { DEFAULT: 'hsl(var(--info))', foreground: 'hsl(var(--info-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        sidebar: { DEFAULT: 'hsl(var(--sidebar))', foreground: 'hsl(var(--sidebar-foreground))', border: 'hsl(var(--sidebar-border))', active: 'hsl(var(--sidebar-active))', strong: 'hsl(var(--sidebar-strong))', hover: 'hsl(var(--sidebar-hover))' },
      },
      borderRadius: { pill: 'var(--radius-pill)', '2xl': 'calc(var(--radius) + 10px)', xl: 'calc(var(--radius) + 6px)', lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      boxShadow: {
        card: 'inset 0 1px 0 hsl(var(--glass-highlight)), 0 1px 2px hsl(var(--shadow) / 0.05), 0 8px 24px -6px hsl(var(--shadow) / 0.1)',
        'card-hover': 'inset 0 1px 0 hsl(var(--glass-highlight)), 0 2px 4px hsl(var(--shadow) / 0.06), 0 18px 40px -10px hsl(var(--shadow) / 0.2)',
        pop: 'inset 0 1px 0 hsl(var(--glass-highlight)), 0 2px 6px hsl(var(--shadow) / 0.08), 0 32px 72px -16px hsl(var(--shadow) / 0.35)',
        glow: 'inset 0 1px 0 hsl(0 0% 100% / 0.25), 0 1px 2px hsl(var(--primary) / 0.3), 0 8px 22px -6px hsl(var(--primary) / 0.55)',
      },
      transitionTimingFunction: { apple: 'var(--ease)' },
      fontFamily: {
        sans: ['var(--font-brand)'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: { '2xs': ['0.6875rem', { lineHeight: '1rem' }] },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: { 'accordion-down': 'accordion-down 0.2s ease-out', 'accordion-up': 'accordion-up 0.2s ease-out' },
    },
  },
  plugins: [animate],
};
export default config;
