import { isDarkColour, type Branding } from '@vcms/shared';
import { PawPrint } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULT_MENU = '#131c26';
const GLOW = 'radial-gradient(760px 460px at 92% -8%, hsl(var(--primary) / 0.55), transparent 62%), radial-gradient(640px 420px at -8% 112%, hsl(var(--info) / 0.32), transparent 62%)';

/** A logo for light surfaces that switches to the dark-background version in dark mode (when there is one). */
export function ThemedLogo({ branding, className }: { branding: Branding; className?: string }) {
  if (!branding.logoUrl && !branding.logoDarkUrl) return null;
  const light = branding.logoUrl ?? branding.logoDarkUrl!;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={light} alt={branding.brandName} className={cn(className, branding.logoDarkUrl && 'dark:hidden')} />
      {branding.logoDarkUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={branding.logoDarkUrl} alt={branding.brandName} className={cn(className, 'hidden dark:block')} />
      )}
    </>
  );
}

/** Background of the sign-in page's brand area: menu colour, a gradient into the main colour, or a photo. */
function backdrop(b: Branding): { className: string; style?: React.CSSProperties; dark: boolean; overlay?: string } {
  if (b.loginBackground === 'IMAGE' && b.loginBackgroundUrl) {
    return { className: 'bg-cover bg-center text-white', style: { backgroundImage: `url("${b.loginBackgroundUrl}")` }, dark: true, overlay: 'bg-black/50' };
  }
  if (b.loginBackground === 'GRADIENT') {
    return { className: 'text-white', style: { backgroundImage: 'linear-gradient(135deg, hsl(var(--sidebar)) 0%, hsl(var(--primary)) 100%)' }, dark: true, overlay: 'bg-black/15' };
  }
  // The menu colour with a glow of the clinic's main colour, so the panel has depth instead of a flat fill.
  return {
    className: 'bg-sidebar text-sidebar-strong',
    style: { backgroundImage: GLOW },
    dark: isDarkColour(b.sidebarColor ?? DEFAULT_MENU),
  };
}

/**
 * The clinic's sign-in page (white label): a brand panel beside the form, or the form in a card centred on
 * the brand background. Used by the sign-in pages and by the live preview in Settings → Branding.
 */
export function SignInFrame({ branding: b, children, className }: { branding: Branding; children: React.ReactNode; className?: string }) {
  const bg = backdrop(b);
  const panelLogo = bg.dark ? (b.logoDarkUrl ?? b.logoUrl) : b.logoUrl;
  const sub = bg.dark ? 'text-white/80' : 'text-sidebar-foreground';
  const footer = b.loginFooter ?? `© ${new Date().getFullYear()} ${b.brandName}`;
  const welcome = (
    <>
      <h2 className="text-3xl font-semibold leading-tight tracking-tight">{b.loginHeadline ?? `Welcome to ${b.brandName}`}</h2>
      <p className={cn('mt-3 whitespace-pre-line', sub)}>{b.loginMessage ?? 'Sign in with your staff account to see today’s appointments, patients and tasks.'}</p>
    </>
  );

  if (b.loginLayout === 'CENTERED') {
    return (
      <div className={cn('relative flex min-h-screen flex-col items-center justify-center gap-6 p-4 sm:p-8', bg.className, className)} style={bg.style}>
        {bg.overlay && <div className={cn('pointer-events-none absolute inset-0', bg.overlay)} />}
        <div className="page-enter relative w-full max-w-md rounded-2xl border border-white/10 bg-card p-7 text-card-foreground shadow-pop sm:p-9">
          <div className="mb-6 flex items-center gap-3">
            <ThemedLogo branding={b} className="h-12 max-w-[180px] object-contain" />
            {!b.logoUrl && !b.logoDarkUrl && <span className="text-lg font-semibold tracking-tight">{b.brandName}</span>}
          </div>
          {children}
        </div>
        <div className="relative max-w-md text-center">
          {(b.loginHeadline || b.loginMessage) && <p className={cn('whitespace-pre-line text-sm', sub)}>{[b.loginHeadline, b.loginMessage].filter(Boolean).join(' — ')}</p>}
          <p className={cn('mt-2 text-xs', bg.dark ? 'text-white/60' : 'text-sidebar-foreground/70')}>{footer}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('grid min-h-screen lg:grid-cols-[1fr_minmax(480px,560px)]', className)}>
      <div className={cn('relative hidden flex-col justify-between overflow-hidden p-10 lg:flex', bg.className)} style={bg.style}>
        {bg.overlay && <div className={cn('pointer-events-none absolute inset-0', bg.overlay)} />}
        <div className="relative flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {panelLogo && <img src={panelLogo} alt="" className="h-12 max-w-[180px] object-contain" />}
          <span className="text-lg font-semibold tracking-tight">{b.brandName}</span>
        </div>
        <div className="relative max-w-lg">{welcome}</div>
        <p className={cn('relative text-xs', bg.dark ? 'text-white/60' : 'text-sidebar-foreground/60')}>{footer}</p>
        <PawPrint aria-hidden className="pointer-events-none absolute -bottom-16 -right-12 h-80 w-80 -rotate-12 opacity-[0.05]" />
        {!bg.overlay && <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary/20 blur-3xl" />}
      </div>
      <div className="app-canvas flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="page-enter w-full max-w-md rounded-2xl border border-border/60 bg-card/85 p-8 shadow-card backdrop-blur sm:p-10">
          {/* Small screens have no side panel: the clinic's logo sits above the form. */}
          <div className="mb-6 lg:hidden">
            <ThemedLogo branding={b} className="h-12 max-w-[200px] object-contain" />
          </div>
          {children}
          <p className="mt-8 text-center text-xs text-muted-foreground lg:hidden">{footer}</p>
        </div>
      </div>
    </div>
  );
}
