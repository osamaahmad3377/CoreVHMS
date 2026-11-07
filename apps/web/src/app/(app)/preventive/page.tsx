'use client';
import { useQuery } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { Syringe } from 'lucide-react';
import { Suspense, useState } from 'react';
import { EmptyState, PageHeader } from '@/components/page';
import { AddVaccinationDialog } from '@/components/preventive/add-vaccination-dialog';
import { Protocols, Worklist } from '@/components/preventive/protocols';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useUrlState } from '@/hooks/use-url-state';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { tabListClass, tabTriggerClass } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

interface ComplianceRow { protocolId: string; name: string; kind: string; species: string; patientsInScope: number; inPlan: number; upToDate: number; overdue: number; notInPlan: number; compliancePercent: number | null }

function Compliance() {
  const q = useQuery({ queryKey: ['compliance'], queryFn: () => api.get<ComplianceRow[]>('/preventive/compliance') });
  return (
    <Card>
      {q.data?.length ? (
        <Table>
          <THead><TR><TH>Protocol</TH><TH className="text-right">Active patients</TH><TH className="text-right">Up to date</TH><TH className="text-right">Overdue</TH><TH className="text-right">Not in a plan</TH><TH className="text-right">Compliance</TH></TR></THead>
          <TBody>
            {q.data.map((r) => (
              <TR key={r.protocolId}>
                <TD><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{enumLabel(r.kind)} · {r.species}</p></TD>
                <TD className="text-right tabular">{r.patientsInScope}</TD>
                <TD className="text-right tabular text-success">{r.upToDate}</TD>
                <TD className={cn('text-right tabular', r.overdue && 'font-semibold text-destructive')}>{r.overdue}</TD>
                <TD className="text-right tabular text-muted-foreground">{r.notInPlan}</TD>
                <TD className="text-right"><span className="font-semibold tabular">{r.compliancePercent ?? '—'}{r.compliancePercent != null && '%'}</span></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : <EmptyState title="No approved protocols yet" description="Compliance is measured against your approved protocols." />}
      <p className="border-t px-4 py-2 text-xs text-muted-foreground">Up to date = in the care plan and not overdue. “Not in a plan” patients can be added with Apply to patients on the Vaccines or All schedules tab.</p>
    </Card>
  );
}

function Preventive() {
  const url = useUrlState();
  const { can } = useSession();
  const tab = url.get('tab', 'due');
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader
        title="Vaccines & reminders"
        help="preventive"
        description="Vaccinations, parasite control and health checks — what is due, who to remind, and how well patients are covered."
        actions={
          can('preventive.write') && (
            <Button onClick={() => setAdding(true)}>
              <Syringe /> Add patient for vaccination
            </Button>
          )
        }
      />
      <AddVaccinationDialog open={adding} onOpenChange={setAdding} />
      <div className={cn(tabListClass, 'mb-6')} role="tablist">
        {[['due', 'Due & overdue'], ['vaccines', 'Vaccines'], ['protocols', 'All schedules'], ['compliance', 'Compliance']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => url.set({ tab: k })} className={tabTriggerClass()}>{l}</button>
        ))}
      </div>
      {tab === 'vaccines' ? <Protocols kind="VACCINATION" /> : tab === 'protocols' ? <Protocols /> : tab === 'compliance' ? <Compliance /> : <Worklist />}
    </>
  );
}

export default function PreventivePage() {
  return (
    <RequirePermission anyOf={['preventive.read']}>
      <Suspense><Preventive /></Suspense>
    </RequirePermission>
  );
}
