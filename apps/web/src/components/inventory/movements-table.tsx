'use client';
import { enumLabel, type Paginated } from '@vcms/shared';
import Link from 'next/link';
import { DataTable } from '../data-table';
import { EmptyState } from '../page';
import { fmtDateTime } from '@/lib/format';
import type { StockMovement } from '@/lib/types';
import { cn } from '@/lib/utils';

export const REF_LABEL: Record<string, string> = { Dispensation: 'Dispensing', Administration: 'Given in clinic', InvoiceLine: 'Sale', GoodsReceipt: 'Delivery', StockCount: 'Stock count', SupplierReturn: 'Returned to supplier', StockDisposal: 'Disposal', SurgeryItem: 'Used in surgery', FieldVisitItem: 'Used on farm visit', GroupTreatment: 'Herd treatment', Transfer: 'Transfer' };

export function MovementsTable({ query, page, onPage, hideProduct }: { query: { data?: Paginated<StockMovement>; isLoading: boolean; error: unknown; refetch: () => unknown; isFetching?: boolean }; page: number; onPage: (p: number) => void; hideProduct?: boolean }) {
  return (
    <DataTable
      query={query}
      rowKey={(m) => m.id}
      page={page}
      onPage={onPage}
      empty={<EmptyState title="No movements" />}
      columns={[
        { key: 'when', header: 'When', cell: (m) => <span className="whitespace-nowrap text-xs">{fmtDateTime(m.createdAt)}<span className="block text-muted-foreground">{m.createdByName}</span></span> },
        ...(hideProduct ? [] : [{ key: 'p', header: 'Product', cell: (m: StockMovement) => <span className="text-sm">{m.product.name}</span> }]),
        {
          key: 'type',
          header: 'Movement',
          cell: (m) => (
            <span className="text-sm">
              {enumLabel(m.type, 'movement')}
              <span className="block text-xs text-muted-foreground">
                {m.reference?.href ? <Link href={m.reference.href} className="text-primary hover:underline">{m.reference.label}</Link> : m.reference?.label ?? (m.referenceType && (REF_LABEL[m.referenceType] ?? m.referenceType.replace(/([a-z])([A-Z])/g, '$1 $2')))}
                {m.reason && m.reason !== m.reference?.label && <> · {m.reason}</>}
              </span>
            </span>
          ),
        },
        { key: 'batch', header: 'Batch · location', cell: (m) => <span className="text-xs">{m.batch.batchNumber} · {m.location.name}</span> },
        { key: 'qty', header: 'Qty', className: 'text-right tabular', headerClassName: 'text-right', cell: (m) => <span className={cn('font-medium', m.quantity < 0 ? 'text-destructive' : 'text-success')}>{m.quantity > 0 ? '+' : ''}{m.quantity}</span> },
        { key: 'bal', header: 'Balance', className: 'text-right tabular', headerClassName: 'text-right', cell: (m) => m.balanceAfter },
      ]}
    />
  );
}
