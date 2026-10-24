'use client';
import { brandThemeCss, type Branding } from '@vcms/shared';
import { MapPin, Phone } from 'lucide-react';

/**
 * The clinic-branded shell of the public booking pages: the clinic's colours, logo and name over the glass
 * background, and a quiet footer. No staff menus — this is what clients see.
 */
export function BookingFrame({ name, branding, logoSrc, address, phone, children }: { name: string; branding?: Branding | null; logoSrc?: string | null; address?: string | null; phone?: string | null; children: React.ReactNode }) {
  const css = branding ? brandThemeCss(branding) : '';
  return (
    <div className="app-canvas min-h-screen">
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        <header className="mb-6 flex flex-wrap items-center gap-4 sm:mb-8">
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoSrc} alt={name} className="h-14 max-w-[180px] object-contain" />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-brand-2 text-2xl font-bold text-white shadow-glow" aria-hidden>
              {name.trim().charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{name}</h1>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {address && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {address}
                </span>
              )}
              {phone && (
                <a href={`tel:${phone.replace(/\s/g, '')}`} className="flex items-center gap-1 hover:text-primary">
                  <Phone className="h-3.5 w-3.5" /> {phone}
                </a>
              )}
            </p>
          </div>
        </header>
        {children}
        <p className="mt-10 text-center text-xs text-muted-foreground">Your details are used only to manage your appointment with {name}.</p>
      </div>
    </div>
  );
}
