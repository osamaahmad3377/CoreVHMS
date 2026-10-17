'use client';
import { ChevronLeft, ChevronRight, ChevronsUpDown, ArrowDown, ArrowUp } from 'lucide-react';
import * as React from 'react';
import type { Paginated } from '@vcms/shared';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorState, LoadingRows } from './page';
import { Button } from './ui/button';
import { NativeSelect } from './ui/input';
import { Table, TBody, TD, TH, THead, TR } from './ui/table';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  sortKey?: string;
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  query: { data?: Paginated<T> | T[]; isLoading: boolean; error: unknown; refetch: () => unknown; isFetching?: boolean };
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sort?: string;
  onSort?: (sort: string) => void;
  page?: number;
  pageSize?: number;
  onPage?: (page: number) => void;
  onPageSize?: (size: number) => void;
  empty?: React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  query,
  rowKey,
  onRowClick,
  sort,
  onSort,
  page = 1,
  pageSize = 25,
  onPage,
  onPageSize,
  empty,
  className,
}: DataTableProps<T>) {
  if (query.isLoading) return <LoadingRows />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const rows = Array.isArray(query.data) ? query.data : (query.data?.data ?? []);
  const meta = Array.isArray(query.data) ? null : query.data?.meta;
  if (!rows.length) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;

  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className={cn(query.isFetching && 'opacity-70 transition-opacity', className)}>
      <Table>
        <THead>
          <TR>
            {columns.map((c) => {
              const active = sort && c.sortKey && sort.replace(/^-/, '') === c.sortKey;
              const desc = sort?.startsWith('-');
              return (
                <TH key={c.key} className={c.headerClassName} aria-sort={active ? (desc ? 'descending' : 'ascending') : undefined}>
                  {c.sortKey && onSort ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => onSort(active && !desc ? `-${c.sortKey}` : c.sortKey!)}
                    >
                      {c.header}
                      {active ? desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-50" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </TH>
              );
            })}
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR
              key={rowKey(row)}
              data-clickable={!!onRowClick}
              onClick={onRowClick ? (e) => !(e.target as HTMLElement).closest('a,button') && onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <TD key={c.key} className={c.className}>
                  {c.cell(row)}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
      {meta && onPage && (
        <div className="flex flex-col items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground sm:flex-row">
          <span className="tabular">
            {(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            {onPageSize && (
              <NativeSelect
                aria-label="Rows per page"
                className="h-8 w-[104px] text-xs"
                value={pageSize}
                onChange={(e) => onPageSize(Number(e.target.value))}
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </NativeSelect>
            )}
            <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <span className="tabular">
              Page {page} of {totalPages}
            </span>
            <Button variant="outline" size="icon-sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
