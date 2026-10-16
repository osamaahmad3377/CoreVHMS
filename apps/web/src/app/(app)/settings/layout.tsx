'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { SETTINGS_NAV } from '@/lib/navigation';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { canAny } = useSession();
  const items = SETTINGS_NAV.filter((i) => canAny(...i.anyOf));
  return (
    <RequirePermission anyOf={['org.manage', 'branches.manage', 'users.read', 'roles.manage', 'settings.manage']}>
      <PageHeader
        help="setup" title="Settings" description="Organization, branches, staff access and catalogues" />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Settings" className="flex gap-1 overflow-x-auto lg:flex-col">
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
