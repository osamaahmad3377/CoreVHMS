'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { NativeSelect } from '@/components/ui/input';
import { SETTINGS_NAV } from '@/lib/navigation';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { canAny } = useSession();
  const items = SETTINGS_NAV.filter((i) => canAny(...i.anyOf));
  const current = items.find((i) => pathname.startsWith(i.href));
  return (
    <RequirePermission anyOf={['org.manage', 'branches.manage', 'users.read', 'roles.manage', 'settings.manage']}>
      <PageHeader help="setup" title="Settings" description="Organization, branches, staff access and catalogues" />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Small screens: one compact picker instead of a hidden horizontal scroller of 17 links. */}
        <div className="lg:hidden">
          <label htmlFor="settings-section" className="sr-only">Settings section</label>
          <NativeSelect id="settings-section" value={current?.href ?? ''} onChange={(e) => e.target.value && router.push(e.target.value)}>
            {!current && <option value="">Choose a section…</option>}
            {items.map((i) => <option key={i.href} value={i.href}>{i.label}</option>)}
          </NativeSelect>
        </div>
        <nav aria-label="Settings" className="hidden flex-col gap-1 lg:flex">
          {items.map((i) => {
            const active = pathname.startsWith(i.href);
            return (
              <Link
                key={i.href}
                href={i.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
                  active && 'bg-muted font-medium text-foreground',
                )}
              >
                <i.icon className="h-4 w-4" /> {i.label}
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </RequirePermission>
  );
}
