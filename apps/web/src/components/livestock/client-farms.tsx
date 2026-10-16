'use client';
import { useQuery } from '@tanstack/react-query';
import { Plus, Tractor } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { FarmDialog } from './farm-dialogs';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { FarmRow } from '@/lib/types';

/** The client's farms (for farming clients), with a shortcut to add one. */
export function ClientFarms({ client }: { client: { id: string; displayName: string; type?: string } }) {
  const { can } = useSession();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['farms', 'owner', client.id], queryFn: () => api.get<FarmRow[]>(`/farms?clientId=${client.id}&status=ALL`) });
  if (!q.data?.length && client.type !== 'FARM') return null;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Tractor className="h-4 w-4 text-muted-foreground" /> Farms</CardTitle>
        {can('livestock.write') && <Button size="sm" variant="ghost" onClick={() => setAdding(true)}><Plus /> Add</Button>}
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {q.data?.length ? q.data.map((f) => (
          <Link key={f.id} href={`/livestock/farms/${f.id}`} className="flex justify-between gap-2 hover:underline">
            <span>{f.name}</span><span className="text-xs text-muted-foreground">{f.animalCount ?? 0} animals</span>
          </Link>
        )) : <p className="text-muted-foreground">No farm registered yet.</p>}
      </CardContent>
      <FarmDialog open={adding} onOpenChange={setAdding} owner={{ id: client.id, displayName: client.displayName }} />
    </Card>
  );
}
