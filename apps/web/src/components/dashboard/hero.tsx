import { PawPrint } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface HeroStat {
  label: string;
  value: React.ReactNode;
  href?: string;
  alert?: boolean;
}

/**
 * The dashboard's welcome banner: a greeting, today's date and the day's key numbers on a surface made from the
 * clinic's own main colour (so white-label themes carry through). Text uses the theme's on-colour, so it stays readable.
 */
export function DashboardHero({ greeting, subtitle, date, stats }: { greeting: string; subtitle: string; date: string; stats: HeroStat[] }) {
  return (
    <section
      aria-label="Welcome"
      className="relative mb-6 overflow-hidden rounded-2xl border border-primary/30 bg-primary text-primary-foreground shadow-card-hover"
    >
      {/* Layered colour: a lighter wash from the corner, a second hue at the other, and a faint pattern. */}
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(900px_300px_at_85%_-20%,hsl(0_0%_100%/0.22),transparent_60%),radial-gradient(700px_320px_at_0%_120%,hsl(var(--info)/0.45),transparent_60%)]" />
      <div aria-hidden className="absolute inset-0 opacity-[0.07] [background-image:radial-gradient(hsl(0_0%_100%)_1px,transparent_1px)] [background-size:18px_18px]" />
      <PawPrint aria-hidden className="absolute -bottom-6 right-8 hidden h-40 w-40 rotate-12 opacity-[0.09] sm:block" />
      <div className="relative flex flex-col gap-5 p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="inline-flex items-center rounded-full bg-primary-foreground/15 px-3 py-1 text-xs font-medium ring-1 ring-inset ring-primary-foreground/25 backdrop-blur">{date}</p>
          <h1 className="mt-3 text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{greeting}</h1>
          <p className="mt-1.5 max-w-xl text-sm opacity-85">{subtitle}</p>
        </div>
        {stats.length > 0 && (
          <ul className="grid grid-cols-3 gap-2.5 sm:gap-3 lg:min-w-[400px]">
            {stats.map((s) => {
              const body = (
                <>
                  <span className="block text-2xl font-semibold leading-none tabular tracking-tight sm:text-[1.7rem]">{s.value}</span>
                  <span className="mt-1.5 block truncate text-[11px] font-medium opacity-85">{s.label}</span>
                </>
              );
              const cls = cn('block rounded-xl bg-primary-foreground/12 px-3.5 py-3 ring-1 ring-inset ring-primary-foreground/20 backdrop-blur transition hover:bg-primary-foreground/20', s.alert && 'bg-primary-foreground/22 ring-primary-foreground/40');
              return <li key={s.label}>{s.href ? <Link href={s.href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
