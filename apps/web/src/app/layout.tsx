import { brandThemeCss } from '@vcms/shared';
import type { Metadata, Viewport } from 'next';
import { brandFontVariables } from '@/lib/fonts';
import { hostInfo } from '@/lib/host-server';
import './globals.css';
import { Providers } from './providers';

/** Browser-tab title and icon: the clinic's own (white label) on its address, otherwise NextCore's. */
export async function generateMetadata(): Promise<Metadata> {
  const branding = (await hostInfo())?.clinic?.branding;
  const name = branding?.brandName ?? 'NextCore VCMS';
  return {
    title: { default: name, template: `%s · ${name}` },
    description: branding ? `${name} — clinic management` : 'Veterinary clinic management system',
    icons: { icon: branding?.iconUrl ?? '/favicon.svg' },
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const branding = (await hostInfo())?.clinic?.branding;
  const css = branding ? brandThemeCss(branding) : '';
  return (
    <html lang="en" className={brandFontVariables} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/* The clinic's colours, font and corners from the first paint, before any script runs. */}
        {css ? <style data-brand-theme dangerouslySetInnerHTML={{ __html: css }} /> : null}
        <Providers defaultTheme={branding?.defaultTheme.toLowerCase() as 'light' | 'dark' | 'system' | undefined}>{children}</Providers>
      </body>
    </html>
  );
}
