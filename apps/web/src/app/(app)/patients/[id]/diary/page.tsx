'use client';
import { useQuery } from '@tanstack/react-query';
import type { DiaryBooklet } from '@vcms/shared';
import { ArrowLeft, Printer, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { DiaryPreview, DiaryPrintRoot, type DiaryStyle } from '@/components/diary/diary-pages';
import { ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

function DiaryView() {
  const { id } = useParams<{ id: string }>();
  const { session, can } = useSession();
  const q = useQuery({ queryKey: ['diary-booklet', id], queryFn: () => api.get<DiaryBooklet>(`/patients/${id}/diary/booklet`) });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data;
  const style: DiaryStyle = { accent: session.organization?.branding.primaryColor ?? '#0d7a70', logoUrl: session.organization?.logoUrl ?? null, photoUrl: b.diary.patient.photoAttachmentId ? `/api/v1/attachments/${b.diary.patient.photoAttachmentId}/download?inline=1` : null };
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Patients', href: '/patients' }, { label: b.diary.patient.name, href: `/patients/${id}?tab=diary` }, { label: 'Pet diary' }]}
        title={`${b.diary.patient.name}’s pet diary`}
        description="Built from the patient’s records in the clinic’s design — print it as an A5 booklet (front and back covers included). Blank rows are left for stamps."
        actions={
          <>
            <Button variant="ghost" size="sm" asChild><Link href={`/patients/${id}?tab=diary`}><ArrowLeft /> Back to the patient</Link></Button>
            {can('settings.manage') && <Button variant="outline" size="sm" asChild><Link href="/settings/pet-diary"><Settings2 /> Design</Link></Button>}
            <Button size="sm" onClick={() => window.print()}><Printer /> Print</Button>
          </>
        }
      />
      <DiaryPreview booklet={b} style={style} />
      <DiaryPrintRoot booklet={b} style={style} />
    </>
  );
}

export default function PetDiaryPage() {
  return (
    <RequirePermission anyOf={['preventive.read']}>
      <DiaryView />
    </RequirePermission>
  );
}
