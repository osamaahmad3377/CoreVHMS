'use client';
import type { Permission } from '@vcms/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export interface SectionLink {
  href: string;
  label: string;
  anyOf: Permission[];
  exact?: boolean;
}

export const BILLING_LINKS: SectionLink[] = [
  { href: '/billing', label: 'Invoices', anyOf: ['billing.read'], exact: true },
  { href: '/billing/charges', label: 'Unbilled charges', anyOf: ['billing.read'] },
  { href: '/billing/payments', label: 'Payments', anyOf: ['billing.read'] },
  { href: '/billing/estimates', label: 'Estimates', anyOf: ['billing.read'] },
  { href: '/billing/cash', label: 'Cash registers', anyOf: ['cash.manage'] },
  { href: '/billing/expenses', label: 'Expenses', anyOf: ['expenses.write', 'reports.financial'] },
];

export const INVENTORY_LINKS: SectionLink[] = [
  { href: '/inventory', label: 'Stock', anyOf: ['inventory.read'], exact: true },
  { href: '/inventory/catalog', label: 'Products', anyOf: ['inventory.read', 'formulary.manage'] },
  { href: '/inventory/movements', label: 'Movements', anyOf: ['inventory.read'] },
  { href: '/inventory/counts', label: 'Stock counts', anyOf: ['inventory.read'] },
  { href: '/inventory/requests', label: 'Item requests', anyOf: ['procurement.request', 'procurement.read'] },
  { href: '/inventory/purchase-orders', label: 'Purchase orders', anyOf: ['procurement.read'] },
  { href: '/inventory/returns', label: 'Supplier returns', anyOf: ['procurement.read', 'inventory.read'] },
  { href: '/inventory/suppliers', label: 'Suppliers', anyOf: ['procurement.read', 'inventory.read'] },
  { href: '/inventory/controlled', label: 'Controlled register', anyOf: ['inventory.read'] },
  { href: '/inventory/locations', label: 'Locations', anyOf: ['inventory.read', 'settings.manage'] },
];

/** Sub-navigation for multi-page modules; links the user cannot use are hidden. */
export function SectionNav({ links }: { links: SectionLink[] }) {
  const pathname = usePathname();
  const { canAny } = useSession();
  return (
    <nav aria-label="Section" className="-mt-2 mb-4 flex gap-1 overflow-x-auto border-b">
      {links
        .filter((l) => canAny(...l.anyOf))
        .map((l) => {
          const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? 'page' : undefined}
              className={cn('-mb-px whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-sm font-medium', active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              {l.label}
            </Link>
          );
        })}
    </nav>
  );
}
