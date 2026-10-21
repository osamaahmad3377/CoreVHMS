'use client';
import { useQuery } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { Download, FileText, FlaskConical, Pill, Printer, ShieldCheck, Stethoscope } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ErrorState, LoadingRows } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtAge, fmtBytes, fmtDate, fmtWeight } from '@/lib/format';
import { portalApi } from '@/lib/portal-api';

interface PetDetail {
  patient: { id: string; name: string; sex: string; dateOfBirth: string | null; dobEstimated: boolean; colour: string | null; latestWeightKg: number | null; species: { name: string }; breed: { name: string } | null; alerts: { id: string; title: string }[] };
  care: { id: string; title: string; kind: string; status: string; dueDate: string; overdue: boolean; completedAt: string | null; givenElsewhere: boolean }[];
  labReports: { id: string; orderNo: string; releasedAt: string; tests: string[] }[];
  discharges: { id: string; admissionNo: string; admittedAt: string; dischargedAt: string; reason: string; dischargeSummary: string | null; homeCareInstructions: string | null; followUpAt: string | null }[];
  surgeries: { id: string; surgeryNo: string; procedure: string; completedAt: string; postOpInstructions: string | null; followUpAt: string | null }[];
  prescriptions: { id: string; prescriptionNo: string; date: string; items: { product: string; instructions: string; quantity: number; unit: string }[] }[];
  documents: { id: string; fileName: string; description: string | null; sizeBytes: number; sharedAt: string; url: string }[];
}

export default function PortalPet() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['portal', 'pet', id], queryFn: () => portalApi.get<PetDetail>(`/pets/${id}`) });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const { patient: p, care, labReports, discharges, surgeries, prescriptions, documents } = q.data;
  const due = care.filter((c) => c.status === 'DUE' || c.status === 'DEFERRED');
  const done = care.filter((c) => c.status === 'COMPLETED');
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">{p.name}</h1>
        <p className="text-sm text-muted-foreground">{p.species.name}{p.breed ? ` · ${p.breed.name}` : ''} · {enumLabel(p.sex)} · {fmtAge(p.dateOfBirth, p.dobEstimated)} · {fmtWeight(p.latestWeightKg)}</p>
        {!!p.alerts.length && <div className="mt-1 flex flex-wrap gap-1">{p.alerts.map((a) => <Badge key={a.id} variant="destructive">Allergy: {a.title}</Badge>)}</div>}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Vaccinations & preventive care</CardTitle>
          <Button size="sm" variant="outline" asChild><Link href={`/portal/pets/${p.id}/certificate`}><Printer /> Certificate</Link></Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          {due.length ? (
            <ul className="grid gap-1">{due.map((c) => <li key={c.id} className="flex justify-between text-sm"><span>{c.title}</span><span className={c.overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}>{c.overdue ? 'Overdue · ' : 'Due '}{fmtDate(c.dueDate)}</span></li>)}</ul>
          ) : <p className="text-sm text-muted-foreground">Nothing due.</p>}
          {!!done.length && (
            <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">History ({done.length})</summary>
              <ul className="mt-2 grid gap-1">{done.map((c) => <li key={c.id} className="flex justify-between"><span>{c.title}{c.givenElsewhere ? ' (elsewhere)' : ''}</span><span className="text-muted-foreground">{fmtDate(c.completedAt)}</span></li>)}</ul>
            </details>
          )}
        </CardContent>
      </Card>
      {!!labReports.length && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-primary" /> Test results</CardTitle></CardHeader>
          <ul className="divide-y border-t">{labReports.map((l) => <li key={l.id}><Link href={`/portal/lab/${l.id}`} className="flex justify-between px-4 py-2.5 text-sm hover:bg-muted/50"><span>{l.tests.join(', ')}</span><span className="text-muted-foreground">{fmtDate(l.releasedAt)}</span></Link></li>)}</ul>
        </Card>
      )}
      {(!!discharges.length || !!surgeries.length) && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Stethoscope className="h-4 w-4 text-primary" /> Hospital stays & surgery aftercare</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {surgeries.map((s) => (
              <div key={s.id} className="rounded-lg surface-flat p-3 text-sm">
                <p className="font-medium">{s.procedure} · {fmtDate(s.completedAt)}</p>
                {s.postOpInstructions && <p className="mt-1 whitespace-pre-wrap">{s.postOpInstructions}</p>}
                {s.followUpAt && <p className="mt-1 font-medium">Check-up due {fmtDate(s.followUpAt)}</p>}
              </div>
            ))}
            {discharges.map((d) => (
              <div key={d.id} className="rounded-lg surface-flat p-3 text-sm">
                <p className="font-medium">Hospital stay {fmtDate(d.admittedAt)} – {fmtDate(d.dischargedAt)}</p>
                <p className="text-muted-foreground">{d.reason}</p>
                {d.dischargeSummary && <p className="mt-1 whitespace-pre-wrap">{d.dischargeSummary}</p>}
                {d.homeCareInstructions && <><p className="mt-2 font-medium">Care at home</p><p className="whitespace-pre-wrap">{d.homeCareInstructions}</p></>}
                {d.followUpAt && <p className="mt-1 font-medium">Check-up due {fmtDate(d.followUpAt)}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {!!prescriptions.length && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Pill className="h-4 w-4 text-primary" /> Medicines prescribed</CardTitle></CardHeader>
          <ul className="divide-y border-t">
            {prescriptions.map((rx) => rx.items.map((i, n) => (
              <li key={`${rx.id}-${n}`} className="px-4 py-2.5 text-sm"><p className="font-medium">{i.product} <span className="text-xs font-normal text-muted-foreground">· {fmtDate(rx.date)}</span></p><p className="text-muted-foreground">{i.instructions}</p></li>
            )))}
          </ul>
        </Card>
      )}
      {!!documents.length && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Documents from the clinic</CardTitle></CardHeader>
          <ul className="divide-y border-t">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{d.fileName}</span><span className="text-xs text-muted-foreground">{d.description ? `${d.description} · ` : ''}{fmtBytes(d.sizeBytes)} · {fmtDate(d.sharedAt)}</span></span>
                <Button size="sm" variant="outline" asChild><a href={d.url}><Download /> Download</a></Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
