'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { History } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingRows } from '../page';
import { Button } from '../ui/button';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import type { AuditEvent } from '@/lib/types';

export function describeAction(action: string) {
  const [, verb] = action.split('.');
  return (verb ?? action).replace(/_/g, ' ');
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  if (Array.isArray(v)) return v.join(', ') || '∅';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function ChangeList({ changes }: { changes: AuditEvent['changes'] }) {
  if (!changes || !Object.keys(changes).length) return null;
  return (
    <ul className="mt-1 grid gap-0.5 text-xs">
      {Object.entries(changes).map(([field, c]) =>
        c && typeof c === 'object' && 'from' in c ? (
          <li key={field} className="break-words">
            <span className="font-medium">{field}</span>: <span className="text-muted-foreground line-through">{show(c.from)}</span> → {show(c.to)}
          </li>
        ) : (
          <li key={field} className="break-words">
            <span className="font-medium">{field}</span>: {show(c)}
          </li>
        ),
      )}
    </ul>
  );
}

/** Field-level change history for one record, from the append-only audit log. */
export function HistoryPanel({ entityId }: { entityId: string }) {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['audit', entityId, page],
    queryFn: () => api.get<Paginated<AuditEvent>>(`/audit-events${qs({ entityId, page, pageSize: 30 })}`),
  });
  if (q.isLoading) return <LoadingRows rows={3} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data!.data;
  if (!rows.length) return <EmptyState icon={History} title="No history yet" />;
  return (
    <div>
      <ol className="relative grid gap-4 border-l pl-5">
        {rows.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
            <p className="text-sm">
              <span className="font-medium capitalize">{describeAction(e.action)}</span>
              {e.summary && <span className="text-muted-foreground"> — {e.summary}</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              {e.actorName ?? 'System'} · {fmtDateTime(e.createdAt)}
            </p>
            <ChangeList changes={e.changes} />
          </li>
        ))}
      </ol>
      {q.data!.meta.total > page * 30 && (
        <Button variant="outline" size="sm" className="mt-4" onClick={() => setPage(page + 1)}>
          Older events
        </Button>
      )}
    </div>
  );
}
