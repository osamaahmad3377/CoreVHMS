'use client';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useParams } from 'next/navigation';
import { ErrorState, LoadingRows } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { fmtDateTime } from '@/lib/format';
import { portalApi } from '@/lib/portal-api';
import { cn } from '@/lib/utils';

interface Report {
  orderNo: string;
  releasedAt: string;
  releasedByName: string | null;
  patient: { name: string; species: { name: string } };
  tests: { name: string; imaging: { findings: string; conclusion: string } | null; results: { analyte: string; value: number | string | null; unit: string | null; refLow: number | null; refHigh: number | null; flag: string | null; comment: string | null }[] }[];
}

export default function PortalLabReport() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['portal', 'lab', id], queryFn: () => portalApi.get<Report>(`/lab-reports/${id}`) });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const r = q.data;
  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Test results for {r.patient.name}</h1>
          <p className="text-sm text-muted-foreground">{r.orderNo} · released {fmtDateTime(r.releasedAt)}{r.releasedByName ? ` by ${r.releasedByName}` : ''}</p>
        </div>
        <Button size="sm" variant="outline" className="no-print" onClick={() => window.print()}><Printer /> Print</Button>
      </div>
      <p className="rounded-md bg-info/10 px-3 py-2 text-sm text-info">Your vet will explain what these results mean for {r.patient.name}. Values marked H or L are outside the clinic’s reference range, which is not always a cause for concern.</p>
      {r.tests.map((t) => (
        <Card key={t.name}>
          <CardHeader><CardTitle>{t.name}</CardTitle></CardHeader>
          {t.imaging ? (
            <CardContent className="grid gap-2 text-sm"><p><b>Findings:</b> {t.imaging.findings}</p><p><b>Conclusion:</b> {t.imaging.conclusion}</p></CardContent>
          ) : (
            <Table>
              <THead><TR><TH>Test</TH><TH className="text-right">Result</TH><TH>Unit</TH><TH>Reference range</TH></TR></THead>
              <TBody>
                {t.results.map((x) => (
                  <TR key={x.analyte}>
                    <TD>{x.analyte}</TD>
                    <TD className={cn('text-right font-medium tabular', x.flag && x.flag !== 'NORMAL' && 'text-destructive')}>{x.value ?? '—'}{x.flag === 'HIGH' || x.flag === 'CRITICAL_HIGH' ? ' H' : x.flag === 'LOW' || x.flag === 'CRITICAL_LOW' ? ' L' : ''}</TD>
                    <TD className="text-sm text-muted-foreground">{x.unit}</TD>
                    <TD className="text-sm text-muted-foreground">{x.refLow != null && x.refHigh != null ? `${x.refLow} – ${x.refHigh}` : '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      ))}
    </div>
  );
}
