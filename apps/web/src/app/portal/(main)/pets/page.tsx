'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { LoadingRows } from '@/components/page';
import { Card } from '@/components/ui/card';
import { fmtAge } from '@/lib/format';
import { portalApi } from '@/lib/portal-api';

export default function PortalPets() {
  const q = useQuery({ queryKey: ['portal', 'overview'], queryFn: () => portalApi.get<{ pets: { id: string; name: string; dateOfBirth: string | null; species: { name: string }; breed: { name: string } | null }[] }>('/overview') });
  if (!q.data) return <LoadingRows />;
  return (
    <div className="grid gap-3">
      <h1 className="text-xl font-semibold">My animals</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {q.data.pets.map((p) => (
          <Link key={p.id} href={`/portal/pets/${p.id}`}>
            <Card className="p-4 hover:border-primary/50"><p className="font-semibold">{p.name}</p><p className="text-sm text-muted-foreground">{p.species.name}{p.breed ? ` · ${p.breed.name}` : ''} · {fmtAge(p.dateOfBirth)}</p></Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
