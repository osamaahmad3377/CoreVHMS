'use client';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from './confirm';
import { Button } from './ui/button';
import { api } from '@/lib/api';

/** What the server says before a delete (see the API's `deletion-check` routes). */
export interface DeletionCheck {
  canDelete: boolean;
  /** e.g. ['4 visits', '2 invoices'] */
  usedBy: string[];
  /** What to do instead, e.g. “Archive the client instead …”. */
  instead: string;
  /** Clients only: the animals that would be deleted with them. */
  animals?: string[];
}

export interface DeleteRecordOptions {
  /** The record's name as staff know it, e.g. “Bella” or “Consult room 2”. */
  name: string;
  /** API path of the record, e.g. `/patients/<id>`; `<path>/deletion-check` answers whether it can go. */
  path: string;
  /** The usual alternative (archive / switch off), offered when the record has history. */
  instead?: { label: string; run: () => unknown };
  /** Query keys to refresh after deleting. */
  invalidate?: unknown[][];
  onDeleted?: () => void;
}

/**
 * Permanent delete for records added by mistake. Asks the server first: a record with no history gets a clear
 * “can’t be undone” confirmation; one with history is never deleted — staff see what it is linked to and are offered
 * the safe alternative (archive or switch off) instead.
 */
export function useDeleteRecord() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  return async function deleteRecord(o: DeleteRecordOptions): Promise<boolean> {
    let check: DeletionCheck;
    try {
      check = await api.get<DeletionCheck>(`${o.path}/deletion-check`);
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }

    if (!check.canDelete) {
      const r = await confirm({
        title: `${o.name} can’t be deleted`,
        description: (
          <div className="grid gap-3 text-sm">
            <p>Deleting is only for records added by mistake. This one is already part of the clinic’s history:</p>
            <ul className="list-disc space-y-0.5 pl-5 text-foreground">
              {check.usedBy.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
            <p>{check.instead}</p>
          </div>
        ),
        confirmLabel: o.instead?.label ?? 'OK',
        cancelLabel: 'Close',
        hideCancel: !o.instead,
      });
      if (r.confirmed && o.instead) await o.instead.run();
      return false;
    }

    const animals = check.animals ?? [];
    const r = await confirm({
      title: `Delete ${o.name} permanently?`,
      description: (
        <div className="grid gap-2 text-sm">
          <p>It has never been used, so nothing else is affected. This can’t be undone.</p>
          {animals.length > 0 && (
            <p>
              Their {animals.length === 1 ? 'animal' : `${animals.length} animals`} <b className="text-foreground">{animals.join(', ')}</b> {animals.length === 1 ? 'is' : 'are'} deleted too.
            </p>
          )}
        </div>
      ),
      confirmLabel: 'Delete permanently',
      destructive: true,
    });
    if (!r.confirmed) return false;
    try {
      await api.del(o.path);
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
    toast.success(`${o.name} deleted`);
    for (const key of o.invalidate ?? []) qc.invalidateQueries({ queryKey: key });
    o.onDeleted?.();
    return true;
  };
}

/** A small “Delete” button for lists and edit dialogs. */
export function DeleteRecordButton({ label = 'Delete', iconOnly, className, ...o }: DeleteRecordOptions & { label?: string; iconOnly?: boolean; className?: string }) {
  const deleteRecord = useDeleteRecord();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size={iconOnly ? 'icon-sm' : 'sm'}
      aria-label={iconOnly ? `Delete ${o.name}` : undefined}
      title={iconOnly ? `Delete ${o.name}` : undefined}
      className={className ?? 'text-muted-foreground hover:text-destructive'}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await deleteRecord(o);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Trash2 />
      {!iconOnly && label}
    </Button>
  );
}
