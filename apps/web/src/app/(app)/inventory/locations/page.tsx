'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LOCATION_TYPES, enumLabel } from '@vcms/shared';
import { MapPin, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { INVENTORY_LINKS, SectionNav } from '@/components/billing/section-nav';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { StockLocation } from '@/lib/types';

function LocationDialog({ location, open, onOpenChange }: { location: StockLocation | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { session } = useSession();
  const [f, setF] = useState({ branchId: '', name: '', type: 'PHARMACY', isDefault: false, isActive: true });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setError(null); setF(location ? { branchId: location.branchId, name: location.name, type: location.type, isDefault: location.isDefault, isActive: location.isActive } : { branchId: session.branch?.id ?? session.branches[0]?.id ?? '', name: '', type: 'PHARMACY', isDefault: false, isActive: true }); }
  }, [open, location, session]);
  const m = useMutation({
    mutationFn: () => (location ? api.patch(`/stock-locations/${location.id}`, f) : api.post('/stock-locations', f)),
    onSuccess: () => { toast.success('Store room saved'); qc.invalidateQueries({ queryKey: ['stock-locations'] }); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{location ? `Edit ${location.name}` : 'Add store room'}</DialogTitle>
          <DialogDescription>Stock is taken from the main store room of a branch when medicines are given or items are sold.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <Field label="Branch" htmlFor="loc-branch" required>
          <NativeSelect id="loc-branch" value={f.branchId} disabled={!!location} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
            {session.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Name" htmlFor="loc-name" required><Input id="loc-name" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Type" htmlFor="loc-type">
          <NativeSelect id="loc-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{LOCATION_TYPES.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}</NativeSelect>
        </Field>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isDefault} onCheckedChange={(v) => setF({ ...f, isDefault: !!v })} /> Main store room for this branch</label>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: !!v })} /> Active</label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!f.name.trim() || !f.branchId} onClick={() => { setError(null); m.mutate(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Locations() {
  const { canAny, session } = useSession();
  const [editing, setEditing] = useState<StockLocation | null | undefined>(undefined);
  const query = useQuery({ queryKey: ['stock-locations'], queryFn: () => api.get<StockLocation[]>('/stock-locations') });
  const editable = canAny('settings.manage', 'inventory.write');
  const branchName = (id: string) => session.branches.find((b) => b.id === id)?.name ?? '—';
  return (
    <>
      <PageHeader title="Store rooms" actions={editable && <Button size="sm" onClick={() => setEditing(null)}><Plus /> Add store room</Button>} />
      <SectionNav links={INVENTORY_LINKS} />
      <Card>
        <DataTable
          query={query}
          rowKey={(l) => l.id}
          onRowClick={editable ? (l) => setEditing(l) : undefined}
          empty={<EmptyState icon={MapPin} title="No store rooms yet" description="Add at least one store room (for example Pharmacy or Shop) per branch to start tracking stock." />}
          columns={[
            { key: 'name', header: 'Store room', cell: (l) => <span className="flex items-center gap-2 font-medium">{l.name}{l.isDefault && <Badge>Default</Badge>}</span> },
            { key: 'branch', header: 'Branch', cell: (l) => <span className="text-sm">{l.branch?.name ?? branchName(l.branchId)}</span> },
            { key: 'type', header: 'Type', cell: (l) => <span className="text-sm">{enumLabel(l.type)}</span> },
            { key: 'st', header: 'Status', cell: (l) => <StatusBadge status={l.isActive ? 'ACTIVE' : 'ARCHIVED'} /> },
          ]}
        />
      </Card>
      <LocationDialog location={editing ?? null} open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} />
    </>
  );
}

export default function LocationsPage() {
  return (
    <RequirePermission anyOf={['inventory.read', 'settings.manage']}>
      <Locations />
    </RequirePermission>
  );
}
