'use client';
import { brandThemeCss, isDarkColour, type Branding } from '@vcms/shared';
import { useTheme } from 'next-themes';
import { useEffect } from 'react';
import { themeChosen } from '@/lib/theme-choice';

/** The app's default side-menu colour (globals.css --sidebar), used when the clinic has not chosen one. */
const DEFAULT_MENU = '#ffffff';

/**
 * True when the clinic's side menu is dark, so it needs the logo version made for dark backgrounds.
 * In dark mode the menu is always dark (a light menu colour only applies in light mode).
 */
export function menuIsDark(branding: Branding | null | undefined, darkTheme = false) {
  return darkTheme || isDarkColour(branding?.sidebarColor ?? DEFAULT_MENU);
}

/** The logo for a background: the dark-background version when there is one, otherwise the normal logo. */
export function logoFor(branding: Branding | null | undefined, darkBackground: boolean) {
  if (!branding) return null;
  return darkBackground ? (branding.logoDarkUrl ?? branding.logoUrl) : branding.logoUrl;
}

/**
 * Applies a clinic's white-label branding in the browser: colours, font and corners (theme variables), the
 * browser-tab title and icon, and the clinic's default light/dark theme for staff who have not chosen one.
 * The server already renders these for the address; this keeps them in step after sign-in and right after
 * the owner saves new branding.
 */
export function BrandTheme({ branding }: { branding: Branding | null | undefined }) {
  const name = branding?.brandName;
  const icon = branding?.iconUrl;
  const defaultTheme = branding?.defaultTheme;
  const { setTheme } = useTheme();
  useEffect(() => {
    if (!name) return;
    // Pages have no titles of their own; keep any "Page · " prefix and replace the product name.
    const base = document.title.includes(' · ') ? document.title.split(' · ')[0] + ' · ' : '';
    document.title = base + name;
  }, [name]);
  useEffect(() => {
    if (!icon) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.removeAttribute('type');
    link.href = icon;
  }, [icon]);
  useEffect(() => {
    if (defaultTheme && !themeChosen()) setTheme(defaultTheme.toLowerCase());
  }, [defaultTheme, setTheme]);
  const css = branding ? brandThemeCss(branding) : '';
  return css ? <style data-brand-theme dangerouslySetInnerHTML={{ __html: css }} /> : null;
}
