import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface HeroStat {
  label: string;
  value: React.ReactNode;
  href?: string;
  alert?: boolean;
}

/**
 * The top of the dashboard: the date and the day's key numbers as quiet widgets. Colours come
 * from the theme, so a clinic's own branding carries through.
 */
export function DashboardHero({ date, stats }: { date: string; stats: HeroStat[] }) {
  return (
    <section aria-label="Today" className="mb-8">
      <h1 className="sr-only">Dashboard</h1>
      <p className="inline-flex items-center gap-2 rounded-pill bg-[hsl(var(--glass)/0.6)] px-3 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-[hsl(var(--glass-edge))] backdrop-blur">{date}</p>
      {stats.length > 0 && (
        <ul className="mt-4 grid grid-cols-3 gap-2.5 sm:gap-4">
          {stats.map((s) => {
            const body = (
              <>
                <span className={cn('block text-[1.75rem] font-semibold leading-none tabular tracking-[-0.03em] sm:text-[2.5rem]', s.alert && 'text-primary')}>{s.value}</span>
                <span className="mt-2 line-clamp-2 block text-[0.6875rem] font-medium leading-tight text-muted-foreground [overflow-wrap:anywhere] min-[400px]:text-xs sm:text-sm">{s.label}</span>
              </>
            );
            const cls = 'surface block h-full rounded-2xl p-3.5 sm:p-6' + (s.href ? ' surface-hover' : '');
            return <li key={s.label}>{s.href ? <Link href={s.href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
          })}
        </ul>
      )}
    </section>
  );
}
