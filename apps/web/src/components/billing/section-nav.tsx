'use client';
import type { Permission } from '@vcms/shared';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { tabListClass, tabTriggerClass } from '../ui/tabs';

export interface SectionLink {
  href: string;
  label: string;
  anyOf: Permission[];
  exact?: boolean;
  /** Less-used pages: listed under a "More" menu instead of as a tab. */
  more?: boolean;
}

export const BILLING_LINKS: SectionLink[] = [
  { href: '/billing', label: 'Invoices', anyOf: ['billing.read'], exact: true },
  { href: '/billing/charges', label: 'Not yet invoiced', anyOf: ['billing.read'] },
  { href: '/billing/payments', label: 'Payments', anyOf: ['billing.read'] },
  { href: '/billing/estimates', label: 'Estimates', anyOf: ['billing.read'] },
  { href: '/billing/cash', label: 'Cash drawer', anyOf: ['cash.manage'] },
  { href: '/billing/expenses', label: 'Expenses', anyOf: ['expenses.write', 'reports.financial'] },
];

export const INVENTORY_LINKS: SectionLink[] = [
  { href: '/inventory', label: 'Stock', anyOf: ['inventory.read'], exact: true },
  { href: '/inventory/catalog', label: 'Products', anyOf: ['inventory.read', 'formulary.manage'] },
  { href: '/inventory/forecast', label: 'Forecast', anyOf: ['inventory.read', 'procurement.read'] },
  { href: '/inventory/purchase-orders', label: 'Orders', anyOf: ['procurement.read'] },
  { href: '/inventory/requests', label: 'Order requests', anyOf: ['procurement.request', 'procurement.read'] },
  { href: '/inventory/suppliers', label: 'Suppliers', anyOf: ['procurement.read', 'inventory.read'] },
  { href: '/inventory/movements', label: 'Stock history', anyOf: ['inventory.read'], more: true },
  { href: '/inventory/counts', label: 'Stock counts', anyOf: ['inventory.read'], more: true },
  { href: '/inventory/returns', label: 'Supplier returns', anyOf: ['procurement.read', 'inventory.read'], more: true },
  { href: '/inventory/controlled', label: 'Controlled drugs register', anyOf: ['inventory.read'], more: true },
  { href: '/inventory/locations', label: 'Store rooms', anyOf: ['inventory.read', 'settings.manage'], more: true },
];

/** Sub-navigation for multi-page modules; links the user cannot use are hidden, `more` links go under a "More" menu. */
export function SectionNav({ links }: { links: SectionLink[] }) {
  const pathname = usePathname();
  const { canAny } = useSession();
  const visible = links.filter((l) => canAny(...l.anyOf));
  const isActive = (l: SectionLink) => (l.exact ? pathname === l.href : pathname.startsWith(l.href));
  const main = visible.filter((l) => !l.more);
  const more = visible.filter((l) => l.more);
  const activeMore = more.find(isActive);
  const tab = (active: boolean) => tabTriggerClass(active);
  return (
    <nav aria-label="Section" className={cn(tabListClass, 'mb-6')}>
      {main.map((l) => {
        const active = isActive(l);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined} className={tab(active)}>
            {l.label}
          </Link>
        );
      })}
      {more.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(tab(!!activeMore), 'inline-flex items-center gap-1')}>
            {activeMore ? activeMore.label : 'More'} <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {more.map((l) => (
              <DropdownMenuItem key={l.href} asChild>
                <Link href={l.href} aria-current={isActive(l) ? 'page' : undefined} className={cn(isActive(l) && 'font-semibold')}>{l.label}</Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
}
