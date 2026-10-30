'use client';
import { useQuery } from '@tanstack/react-query';
import { DENTITION_LABELS, dentitionForSpecies, type Paginated } from '@vcms/shared';
import { Plus, Smile } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { NewDentalChartDialog } from '@/components/dental/patient-dental';
import { Field } from '@/components/forms/field';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { PatientPicker, type PickedPatient } from '@/components/patients/patient-picker';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, qs } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DentalChartListItem } from '@/lib/types';
import { cn } from '@/lib/utils';

function DentalList() {
  const { can } = useSession();
  const [status, setStatus] = useState<'DRAFT' | 'ALL'>('DRAFT');
  const [page, setPage] = useState(1);
  const [picking, setPicking] = useState(false);
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [starting, setStarting] = useState<PickedPatient | null>(null);
  const q = useQuery({ queryKey: ['dental-charts', status, page], queryFn: () => api.get<Paginated<DentalChartListItem>>(`/dental/charts${qs({ status, page, pageSize: 25 })}`) });
  const drafts = useQuery({ queryKey: ['dental-charts', 'DRAFT', 'count'], queryFn: () => api.get<Paginated<DentalChartListItem>>('/dental/charts?status=DRAFT&pageSize=1') });
  const rows = q.data?.data ?? [];
  const pages = q.data ? Math.max(1, Math.ceil(q.data.meta.total / q.data.meta.pageSize)) : 1;
  const draftCount = drafts.data?.meta.total ?? 0;

  return (
    <>
      <PageHeader
        title="Dental"
        description="Tooth-by-tooth dental charts: findings, gum disease stage, extractions and cleaning."
        help="dental"
        actions={
          can('clinical.write') && (
            <Button onClick={() => setPicking(true)}>
              <Plus /> New dental chart
            </Button>
          )
        }
      />
      <div className="mb-3 flex gap-1" role="tablist" aria-label="Which charts">
        {(
          [
            ['DRAFT', `Waiting to be signed${draftCount ? ` (${draftCount})` : ''}`],
            ['ALL', 'All charts'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={status === k}
            onClick={() => {
              setStatus(k);
              setPage(1);
            }}
            className={cn('rounded-pill px-4 py-1.5 text-sm font-medium transition-colors', status === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
          >
            {label}
          </button>
        ))}
      </div>
      <Card>
        {q.isLoading ? (
          <LoadingRows />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !rows.length ? (
          <EmptyState icon={Smile} title={status === 'DRAFT' ? 'Nothing waiting to be signed' : 'No dental charts yet'} description="Start a chart from here or from the patient’s Dental tab." />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Chart</TH>
                  <TH>Patient</TH>
                  <TH className="hidden md:table-cell">Owner</TH>
                  <TH>Date</TH>
                  <TH className="hidden lg:table-cell">Findings</TH>
                  <TH className="hidden md:table-cell">Vet</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((c) => (
                  <TR key={c.id} className="cursor-pointer hover:bg-muted/40">
                    <TD>
                      <Link href={`/dental/${c.id}`} className="font-medium text-primary hover:underline">{c.chartNo}</Link>
                      <p className="text-xs text-muted-foreground">{DENTITION_LABELS[c.dentition]}</p>
                    </TD>
                    <TD>
                      <Link href={`/patients/${c.patient.id}?tab=dental`} className="hover:underline">{c.patient.name}</Link>
                      <p className="text-xs text-muted-foreground">{c.patient.patientNo} · {c.patient.species.name}</p>
                    </TD>
                    <TD className="hidden md:table-cell">{c.client.displayName}</TD>
                    <TD className="whitespace-nowrap">{fmtDate(c.examinedAt)}</TD>
                    <TD className="hidden text-sm text-muted-foreground lg:table-cell">
                      {[c.periodontalStage != null && `PD${c.periodontalStage}`, c._count.teeth && `${c._count.teeth} teeth`, c._count.procedures && `${c._count.procedures} procedure(s)`].filter(Boolean).join(' · ') || '—'}
                    </TD>
                    <TD className="hidden text-sm md:table-cell">{c.signedByName ?? c.clinicianName}</TD>
                    <TD><Badge variant={c.status === 'SIGNED' ? 'success' : 'warning'}>{c.status === 'SIGNED' ? 'Signed' : 'Draft'}</Badge></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {pages > 1 && (
              <div className="flex items-center justify-end gap-2 border-t p-3 text-sm">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <span className="text-muted-foreground">Page {page} of {pages}</span>
                <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            )}
          </>
        )}
      </Card>

      <Dialog open={picking} onOpenChange={(o) => { setPicking(o); if (!o) setPatient(null); }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>New dental chart</DialogTitle>
            <DialogDescription>Which patient is it for?</DialogDescription>
          </DialogHeader>
          <Field label="Patient" htmlFor="nd-patient">
            <PatientPicker id="nd-patient" value={patient} onChange={setPatient} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPicking(false)}>Cancel</Button>
            <Button disabled={!patient} onClick={() => { setStarting(patient); setPicking(false); }}>Next</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {starting && (
        <NewDentalChartDialog
          patientId={starting.id}
          patientName={starting.name}
          suggested={dentitionForSpecies(starting.species?.name, starting.species?.category)}
          open={!!starting}
          onOpenChange={(o) => { if (!o) { setStarting(null); setPatient(null); } }}
        />
      )}
    </>
  );
}

export default function DentalPage() {
  return (
    <RequirePermission anyOf={['clinical.read']}>
      <DentalList />
    </RequirePermission>
  );
}
