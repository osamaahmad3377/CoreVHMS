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
        info: { DEFAULT: 'hsl(var(--info))', foreground: 'hsl(var(--info-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        sidebar: { DEFAULT: 'hsl(var(--sidebar))', foreground: 'hsl(var(--sidebar-foreground))', border: 'hsl(var(--sidebar-border))', active: 'hsl(var(--sidebar-active))', strong: 'hsl(var(--sidebar-strong))', hover: 'hsl(var(--sidebar-hover))' },
      },
      borderRadius: { '2xl': 'calc(var(--radius) + 10px)', xl: 'calc(var(--radius) + 6px)', lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      boxShadow: {
        card: '0 0 0 0.5px hsl(var(--shadow) / 0.06), 0 1px 2px hsl(var(--shadow) / 0.04), 0 4px 16px -4px hsl(var(--shadow) / 0.05)',
        'card-hover': '0 0 0 0.5px hsl(var(--shadow) / 0.06), 0 2px 4px hsl(var(--shadow) / 0.04), 0 14px 36px -8px hsl(var(--shadow) / 0.14)',
        pop: '0 0 0 0.5px hsl(var(--shadow) / 0.1), 0 8px 16px hsl(var(--shadow) / 0.08), 0 28px 64px -12px hsl(var(--shadow) / 0.3)',
        glow: '0 0 0 1px hsl(var(--primary) / 0.2), 0 8px 24px -6px hsl(var(--primary) / 0.4)',
      },
      transitionTimingFunction: { apple: 'cubic-bezier(0.32, 0.72, 0, 1)' },
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
