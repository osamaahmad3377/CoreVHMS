'use client';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { SETTINGS_GROUPS, visibleSettings } from '@/lib/navigation';
import { PlanBanner } from '@/components/plan/upgrade';
import { useSession } from '@/lib/session';

/** Settings home: every settings page as a card with one line saying what it is for, grouped like an owner thinks. */
export default function SettingsIndex() {
  const { canAny, session } = useSession();
  // Pages for services the clinic does not offer (Settings → Services you offer) are hidden.
  const items = visibleSettings(canAny, session.organization?.enabledModules, !!session.entitlements);
  return (
    <div className="grid gap-6">
      <PlanBanner />
      {SETTINGS_GROUPS.map((g) => {
        const inGroup = items.filter((i) => i.group === g);
        if (!inGroup.length) return null;
        return (
          <section key={g} aria-labelledby={`sg-${g}`}>
            <h2 id={`sg-${g}`} className="mb-2 text-sm font-semibold">{g}</h2>
            <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {inGroup.map((i) => (
                <Link key={i.href} href={i.href} className="group flex items-center gap-3 rounded-xl bg-card p-3.5 shadow-card transition-all duration-300 ease-apple hover:-translate-y-px hover:shadow-card-hover">
                  <span className="rounded-md bg-primary/10 p-2 text-primary"><i.icon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{i.label}</span>
                    <span className="block text-xs text-muted-foreground">{i.hint}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
