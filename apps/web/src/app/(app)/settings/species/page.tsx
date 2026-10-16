'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SPECIES_CATEGORIES, enumLabel } from '@vcms/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import type { Breed, Species } from '@/lib/types';
import { cn } from '@/lib/utils';

export default function SpeciesPage() {
  const qc = useQueryClient();
  const species = useQuery({ queryKey: ['species', 'all'], queryFn: () => api.get<Species[]>('/species?all=true') });
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newCat, setNewCat] = useState('COMPANION');
  const [newBreed, setNewBreed] = useState('');
  const current = species.data?.find((s) => s.id === selected) ?? species.data?.[0];
  const breeds = useQuery({ queryKey: ['breeds', current?.id], queryFn: () => api.get<Breed[]>(`/species/${current!.id}/breeds`), enabled: !!current });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['species'] });
    qc.invalidateQueries({ queryKey: ['breeds'] });
  };
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: invalidate, onError: (e: Error) => toast.error(e.message) });

  if (species.isLoading) return <LoadingRows />;
  if (species.error) return <ErrorState error={species.error} onRetry={() => species.refetch()} />;

  return (
    <RequirePermission anyOf={['settings.manage']}>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Species</CardTitle>
          </CardHeader>
          <form
            className="flex gap-2 border-b p-3"
            onSubmit={(e) => {
              e.preventDefault();
              act.mutate(() => api.post('/species', { name: newName, category: newCat }).then(() => setNewName('')));
            }}
          >
            <Input placeholder="New species" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Species name" />
            <NativeSelect aria-label="Category" className="w-40" value={newCat} onChange={(e) => setNewCat(e.target.value)}>
              {SPECIES_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {enumLabel(c)}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" size="sm" disabled={!newName.trim()}>
              <Plus /> Add
            </Button>
          </form>
          <ul className="max-h-[560px] divide-y overflow-y-auto">
            {species.data!.map((s) => (
              <li key={s.id} className={cn('flex items-center gap-3 px-4 py-2', current?.id === s.id && 'bg-muted')}>
                <button className="min-w-0 flex-1 text-left" onClick={() => setSelected(s.id)}>
                  <p className={cn('text-sm font-medium', !s.isActive && 'text-muted-foreground line-through')}>{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {enumLabel(s.category)} · {s._count?.breeds ?? 0} breeds · {s._count?.patients ?? 0} patients
                  </p>
                </button>
                <Switch checked={s.isActive} aria-label={`${s.name} active`} onCheckedChange={(v) => act.mutate(() => api.patch(`/species/${s.id}`, { isActive: v }))} />
              </li>
            ))}
          </ul>
        </Card>
        {current && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>
                Breeds — {current.name} <Badge variant="secondary">{breeds.data?.length ?? 0}</Badge>
              </CardTitle>
            </CardHeader>
            <form
              className="flex gap-2 border-b p-3"
              onSubmit={(e) => {
                e.preventDefault();
                act.mutate(() => api.post('/species/breeds', { speciesId: current.id, name: newBreed }).then(() => setNewBreed('')));
              }}
            >
              <Input placeholder="New breed" value={newBreed} onChange={(e) => setNewBreed(e.target.value)} aria-label="Breed name" />
              <Button type="submit" size="sm" disabled={!newBreed.trim()}>
                <Plus /> Add
              </Button>
            </form>
            {breeds.isLoading ? (
              <LoadingRows rows={3} />
            ) : (
              <ul className="flex flex-wrap gap-1.5 p-4">
                {breeds.data?.map((b) => (
                  <li key={b.id}>
                    <Badge variant="secondary" className="gap-1 normal-case tracking-normal">
                      {b.name}
                      <button className="ml-1 text-muted-foreground hover:text-destructive" aria-label={`Hide ${b.name}`} onClick={() => act.mutate(() => api.patch(`/species/breeds/${b.id}`, { isActive: false }))}>
                        ×
                      </button>
                    </Badge>
                  </li>
                ))}
                {!breeds.data?.length && <li className="text-sm text-muted-foreground">No breeds listed for this species.</li>}
              </ul>
            )}
          </Card>
        )}
      </div>
    </RequirePermission>
  );
}
