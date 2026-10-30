'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { Receipt } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { api, qs } from '@/lib/api';
import { chargeNet, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Charge } from '@/lib/types';

/**
 * What this consultation has put on the client's bill so far. View-only; reception turns charges into an
 * invoice. Users without billing.write see it as "Charges sent to reception".
 */
export function ConsultationCharges({ encounterId, hasPrescriptions }: { encounterId: string; hasPrescriptions: boolean }) {
  const { can, currency } = useSession();
  const q = useQuery({
    queryKey: ['charges', { encounterId }],
    queryFn: () => api.get<Paginated<Charge> & { totalMinor: number }>(`/charges${qs({ encounterId, status: 'ALL', pageSize: 50 })}`),
    enabled: can('billing.read'),
  });
  if (!can('billing.read')) return null;
  const rows = q.data?.data ?? [];
  const live = rows.filter((c) => c.status !== 'WAIVED');
  const total = live.reduce((n, c) => n + chargeNet(c), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-muted-foreground" /> {can('billing.write') ? 'Charges for this consultation' : 'Charges sent to reception'}
        </CardTitle>
        {live.length > 0 && <span className="text-sm font-semibold tabular">{fmtMoney(total, currency)}</span>}
      </CardHeader>
      {rows.length ? (
        <ul className="divide-y text-sm">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className={`min-w-0 flex-1 truncate ${c.status === 'WAIVED' ? 'text-muted-foreground line-through' : ''}`}>
                {c.description}
                {c.quantity !== 1 && <span className="text-muted-foreground"> × {c.quantity}</span>}
              </span>
              {c.status === 'INVOICED' && <Badge variant="success">On invoice</Badge>}
              {c.status === 'WAIVED' && <Badge variant="outline">Waived</Badge>}
              {c.discountMinor > 0 && <Badge variant="success" title={c.discountNote ?? undefined}>Plan</Badge>}
              <span className="tabular text-xs">{fmtMoney(chargeNet(c), currency)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-2 text-xs text-muted-foreground">{q.isLoading ? 'Loading…' : 'No charges yet. The consultation fee is added when the consultation is finished.'}</p>
      )}
      {hasPrescriptions && <p className="border-t px-3 py-2 text-2xs text-muted-foreground">Medicines are charged when the pharmacy hands them over.</p>}
    </Card>
  );
}
