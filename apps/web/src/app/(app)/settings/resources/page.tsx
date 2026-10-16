'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RESOURCE_TYPES, enumLabel } from '@vcms/shared';
import { DoorOpen, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Resource } from '@/lib/types';

export default function ResourcesPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['resources', 'all'], queryFn: () => api.get<Resource[]>('/resources?all=true') });
  const [name, setName] = useState('');
  const [type, setType] = useState('ROOM');
  const [branchId, setBranchId] = useState(session.branch?.id ?? '');
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resources'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <Card>
        <CardHeader>
          <CardTitle>Rooms, theatres & equipment</CardTitle>
        </CardHeader>
        <form className="flex flex-wrap gap-2 border-b p-3" onSubmit={(e) => { e.preventDefault(); act.mutate(() => api.post('/resources', { name, type, branchId }).then(() => setName(''))); }}>
          <Input className="min-w-[180px] flex-1" placeholder="e.g. Consult room 2" value={name} onChange={(e) => setName(e.target.value)} aria-label="Resource name" />
          <NativeSelect aria-label="Type" className="w-40" value={type} onChange={(e) => setType(e.target.value)}>
            {RESOURCE_TYPES.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Branch" className="w-48" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {session.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </NativeSelect>
          <Button type="submit" size="sm" disabled={!name.trim()}><Plus /> Add</Button>
        </form>
        <DataTable
          query={q}
          rowKey={(r) => r.id}
          empty={<EmptyState icon={DoorOpen} title="No rooms or equipment" description="Bookable resources prevent two appointments using the same room at once." />}
          columns={[
            { key: 'name', header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span> },
            { key: 'type', header: 'Type', cell: (r) => enumLabel(r.type) },
            { key: 'branch', header: 'Branch', cell: (r) => r.branch?.name },
            { key: 'active', header: 'Bookable', cell: (r) => <Switch checked={r.isActive} aria-label={`${r.name} active`} onCheckedChange={(v) => act.mutate(() => api.patch(`/resources/${r.id}`, { isActive: v }))} /> },
          ]}
        />
      </Card>
    </RequirePermission>
  );
}
