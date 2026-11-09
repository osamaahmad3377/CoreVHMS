'use client';
import { BookOpen, Pill, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { tabListClass, tabTriggerClass } from '../ui/tabs';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/** The shop's parts: the counter (sales), the pharmacy (prescriptions to approve and hand over) and the formulary. */
export function ShopTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  const { can, canAny } = useSession();
  const tabs = [
    {
      href: '/pos',
      label: 'Counter',
      icon: ShoppingCart,
      show: can('pos.use'),
    },
    {
      href: '/pharmacy',
      label: 'Pharmacy',
      icon: Pill,
      show: canAny('prescriptions.read', 'pharmacy.dispense'),
    },
    {
      href: '/pharmacy/formulary',
      label: 'Formulary',
      icon: BookOpen,
      show: canAny('formulary.manage', 'inventory.read', 'prescriptions.read'),
    },
  ].filter((t) => t.show);
  // The most specific tab wins (/pharmacy/formulary is not the pharmacy tab; a prescription is).
  const current = tabs.filter((t) => pathname === t.href || pathname.startsWith(`${t.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  if (tabs.length < 2) return null;
  return (
    <nav className={cn(tabListClass, 'mb-4 w-fit')} aria-label="Shop">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={current === t.href ? 'page' : undefined} className={tabTriggerClass(current === t.href)}>
          <t.icon className="h-4 w-4" /> {t.label}
        </Link>
      ))}
    </nav>
  );
}
