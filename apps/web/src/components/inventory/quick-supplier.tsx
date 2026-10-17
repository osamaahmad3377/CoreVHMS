'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Supplier } from '@/lib/types';

/** "+ Add supplier" link that opens a two-field form in place, so a delivery or order is not abandoned. */
export function QuickAddSupplier({ onCreated }: { onCreated: (s: Supplier) => void }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<Supplier>('/suppliers', { name: name.trim(), phone: phone.trim() || null }),
    onSuccess: (s) => {
      toast.success(`${s.name} added`);
      qc.setQueryData<Supplier[]>(['suppliers'], (old) => (old ? [...old, s].sort((a, b) => a.name.localeCompare(b.name)) : old));
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      onCreated(s);
      setOpen(false);
      setName('');
      setPhone('');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!can('procurement.write')) return null;
  if (!open) {
    return (
      <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => setOpen(true)}>
        <Plus className="h-3 w-3" /> Add supplier
      </button>
    );
  }
  return (
    <div className="grid gap-2 rounded-md border bg-muted/30 p-2">
      <Input aria-label="New supplier name" placeholder="Supplier name" value={name} maxLength={160} autoFocus onChange={(e) => setName(e.target.value)} />
      <Input aria-label="New supplier phone" placeholder="Phone (optional)" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} />
      <div className="flex gap-2">
        <Button type="button" size="sm" loading={m.isPending} disabled={!name.trim()} onClick={() => m.mutate()}>Save supplier</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
