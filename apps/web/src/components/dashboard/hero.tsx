import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface HeroStat {
  label: string;
  value: React.ReactNode;
  href?: string;
  alert?: boolean;
}

/**
 * The dashboard's welcome: the date, a large greeting and the day's key numbers as quiet widgets. Colours come
 * from the theme, so a clinic's own branding carries through.
 */
export function DashboardHero({ greeting, subtitle, date, stats }: { greeting: string; subtitle: string; date: string; stats: HeroStat[] }) {
  return (
    <section aria-label="Welcome" className="mb-8">
      <p className="text-sm font-medium text-muted-foreground">{date}</p>
      <h1 className="mt-1 text-balance text-[1.875rem] font-bold leading-[1.1] tracking-[-0.028em] [word-spacing:0.06em] sm:text-[2.75rem]">{greeting}</h1>
      <p className="mt-2 max-w-2xl text-[0.9375rem] text-muted-foreground sm:text-base">{subtitle}</p>
      {stats.length > 0 && (
        <ul className="mt-6 grid grid-cols-3 gap-2.5 sm:gap-4">
          {stats.map((s) => {
            const body = (
              <>
                <span className={cn('block text-[1.75rem] font-semibold leading-none tabular tracking-[-0.03em] sm:text-[2.5rem]', s.alert && 'text-primary')}>{s.value}</span>
                <span className="mt-2 line-clamp-2 block text-xs font-medium leading-tight text-muted-foreground sm:text-sm">{s.label}</span>
              </>
            );
            const cls = 'block h-full rounded-2xl bg-card p-3.5 shadow-card transition-all duration-300 ease-apple sm:p-6' + (s.href ? ' hover:-translate-y-0.5 hover:shadow-card-hover' : '');
            return <li key={s.label}>{s.href ? <Link href={s.href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
          })}
        </ul>
      )}
    </section>
  );
}
