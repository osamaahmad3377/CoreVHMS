'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { CalendarPlus, Lightbulb, Receipt, Stethoscope, Syringe } from 'lucide-react';
import Link from 'next/link';
import { Button } from '../ui/button';
import { api, qs } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { CareItem, EncounterRow, PatientDetail } from '@/lib/types';

/**
 * One clear suggestion at the top of a patient's page, chosen from what is true for this patient right now:
 * an unfinished consultation, overdue vaccinations or preventive care, money the client owes, or simply
 * "book the next visit". Nobody has to work out what to do next.
 */
export function PatientNextStep({ patient: p, onBook }: { patient: PatientDetail; onBook: () => void }) {
  const { can, currency } = useSession();
  const open = useQuery({
    queryKey: ['encounters', 'open', p.id],
    queryFn: () => api.get<Paginated<EncounterRow>>(`/encounters${qs({ patientId: p.id, status: 'OPEN', pageSize: 1 })}`),
    enabled: can('clinical.read'),
  });
  const care = useQuery({
    queryKey: ['care-plan', p.id],
    queryFn: () => api.get<{ items: CareItem[] }>(`/patients/${p.id}/care-plan`),
    enabled: can('preventive.read'),
  });
  if (p.status !== 'ACTIVE') return null;

  const openVisit = open.data?.data[0];
  const overdue = (care.data?.items ?? []).filter((i) => i.overdue && (i.status === 'DUE' || i.status === 'DEFERRED'));
  const owes = p.owner && p.owner.balanceMinor > 0 && can('billing.write') ? p.owner.balanceMinor : 0;

  let tip: { icon: typeof Lightbulb; text: string; action: React.ReactNode } | null = null;
  if (openVisit && can('clinical.read')) {
    tip = { icon: Stethoscope, text: `${p.name} has a consultation in progress.`, action: <Button size="sm" asChild><Link href={`/consultations/${openVisit.id}`}>Continue the consultation</Link></Button> };
  } else if (overdue.length) {
    tip = {
      icon: Syringe,
      text: overdue.length === 1 ? `${overdue[0].title} is overdue for ${p.name}.` : `${overdue.length} vaccinations or care items are overdue for ${p.name}, starting with ${overdue[0].title}.`,
      action: <Button size="sm" asChild><Link href={`/patients/${p.id}?tab=care`}>Open the care plan</Link></Button>,
    };
  } else if (owes) {
    tip = { icon: Receipt, text: `${p.owner!.displayName} owes ${fmtMoney(owes, currency)}.`, action: <Button size="sm" asChild><Link href={`/clients/${p.owner!.id}`}>See the account</Link></Button> };
  } else if (can('appointments.write') && p.owner) {
    tip = { icon: CalendarPlus, text: 'Nothing urgent for this patient. Book the next visit before they leave?', action: <Button size="sm" variant="outline" onClick={onBook}>Book appointment</Button> };
  }
  if (!tip) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3" role="status">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <tip.icon className="h-4 w-4" />
      </span>
      <p className="min-w-0 flex-1 text-sm">
        <span className="mr-1.5 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-primary"><Lightbulb className="h-3 w-3" /> Suggested next</span>
        {tip.text}
      </p>
      {tip.action}
    </div>
  );
}
