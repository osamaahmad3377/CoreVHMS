'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Power, Star } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { TemplateDesigner } from '@/components/certificates/template-designer';
import type { CertificateTemplateDetail } from '@/components/certificates/types';
import { ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

export default function CertificateTemplateDesignerPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['certificate-template', id], queryFn: () => api.get<CertificateTemplateDetail>(`/certificate-templates/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['certificate-template', id] });
    qc.invalidateQueries({ queryKey: ['certificate-templates'] });
  };
  const save = useMutation({
    mutationFn: (body: { name: string; layout: unknown }) => api.patch(`/certificate-templates/${id}`, body),
    onSuccess: () => {
      toast.success('Template saved');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh, onError: (e: Error) => toast.error(e.message) });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Certificate templates', href: '/settings/certificate-templates' }, { label: t.name }]}
        title={<span className="flex flex-wrap items-center gap-2">{t.name} {t.isDefault && <Badge variant="success">Default</Badge>}{!t.isActive && <Badge variant="secondary">Off</Badge>}</span>}
        description={`${t.kindLabel}${t.used ? ` · used for ${t.used} certificate${t.used === 1 ? '' : 's'} (they keep the design they were issued with)` : ''}`}
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/settings/certificate-templates"><ArrowLeft /> All templates</Link>
          </Button>
        }
      />
      <TemplateDesigner
        key={t.id}
        kind={t.kind}
        name={t.name}
        layout={t.layout}
        saving={save.isPending}
        onSave={(v) => save.mutate(v)}
        extraActions={
          <>
            {!t.isDefault && t.isActive && <Button size="sm" variant="outline" loading={act.isPending} onClick={() => act.mutate(() => api.post(`/certificate-templates/${id}/default`))}><Star /> Make default</Button>}
            <Button size="sm" variant="ghost" onClick={() => act.mutate(() => api.patch(`/certificate-templates/${id}`, { isActive: !t.isActive }))}><Power /> {t.isActive ? 'Switch off' : 'Switch on'}</Button>
          </>
        }
      />
    </>
  );
}
