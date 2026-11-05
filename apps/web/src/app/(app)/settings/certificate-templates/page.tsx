'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CERTIFICATE_KIND_INFO,
  CERTIFICATE_STYLES,
  CERTIFICATE_STYLE_LABELS,
  SAMPLE_VACCINATIONS,
  defaultCertificateLayout,
  kindsFor,
  sampleCertificateData,
  type CertificateKind,
  type CertificateStyle,
} from '@vcms/shared';
import { Award, Check, MoreHorizontal, Palette, Plus, Power, Star, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ScaledCertificate, sampleData } from '@/components/certificates/certificate-page';
import type { CertificateTemplateRow } from '@/components/certificates/types';
import { useConfirm } from '@/components/confirm';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/** Pick a starting design for a new template: three ready-made styles, previewed with sample data. */
function NewTemplateDialog({ kind, onClose }: { kind: CertificateKind | null; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const [style, setStyle] = useState<CertificateStyle>('classic');
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/certificate-templates', { kind, name: name.trim() || `${CERTIFICATE_KIND_INFO[kind!].label} — ${CERTIFICATE_STYLE_LABELS[style]}`, layout: defaultCertificateLayout(kind!, style) }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['certificate-templates'] });
      router.push(`/settings/certificate-templates/${t.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!kind) return null;
  const data = sampleData(sampleCertificateData(kind), SAMPLE_VACCINATIONS, session.organization?.logoUrl ?? null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New {CERTIFICATE_KIND_INFO[kind].label.toLowerCase()} template</DialogTitle>
          <DialogDescription>Choose a design to start from — you can change everything in the designer.</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Design" className="grid grid-cols-3 gap-3">
          {CERTIFICATE_STYLES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={style === s} onClick={() => setStyle(s)} className={cn('grid gap-2 rounded-xl border p-2 text-left transition-colors', style === s ? 'border-primary ring-2 ring-primary/30' : 'border-foreground/10 hover:bg-muted/50')}>
              <ScaledCertificate layout={defaultCertificateLayout(kind, s)} data={data} width={180} className="pointer-events-none mx-auto" />
              <span className="flex items-center justify-between text-sm font-medium">{CERTIFICATE_STYLE_LABELS[s]}{style === s && <Check className="h-4 w-4 text-primary" />}</span>
            </button>
          ))}
        </div>
        <label className="grid gap-1 text-sm">
          Name
          <Input value={name} maxLength={120} placeholder={`${CERTIFICATE_KIND_INFO[kind].label} — ${CERTIFICATE_STYLE_LABELS[style]}`} onChange={(e) => setName(e.target.value)} />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} onClick={() => create.mutate()}><Palette /> Create and design</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KindCard({ kind, templates, onNew }: { kind: CertificateKind; templates: CertificateTemplateRow[]; onNew: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const info = CERTIFICATE_KIND_INFO[kind];
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['certificate-templates'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = async (t: CertificateTemplateRow) => {
    const r = await confirm({ title: `Delete “${t.name}”?`, description: 'This can’t be undone.', confirmLabel: 'Delete', destructive: true });
    if (r.confirmed) act.mutate(() => api.del(`/certificate-templates/${t.id}`).then(() => toast.success('Template deleted')));
  };
  return (
    <Card className="flex flex-col">
      <CardHeader className="items-start">
        <div className="min-w-0">
          <CardTitle className="text-base">{info.label}</CardTitle>
          <CardDescription className="mt-0.5">{info.description}</CardDescription>
        </div>
        <Button size="sm" variant="outline" aria-label={`New ${info.label.toLowerCase()} template`} onClick={onNew}><Plus /> New</Button>
      </CardHeader>
      <CardContent className="grid gap-1.5">
        {templates.length ? (
          templates.map((t) => (
            <div key={t.id} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2', !t.isActive && 'opacity-60')}>
              <Link href={`/settings/certificate-templates/${t.id}`} className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium hover:underline">
                  {t.name}
                  {t.isDefault && <Badge variant="success" className="normal-case tracking-normal">Default</Badge>}
                  {!t.isActive && <Badge variant="secondary" className="normal-case tracking-normal">Off</Badge>}
                </p>
                <p className="truncate text-2xs text-muted-foreground">
                  {t.used ? `Used for ${t.used} certificate${t.used === 1 ? '' : 's'}` : 'Not used yet'} · changed {fmtDate(t.updatedAt)}{t.updatedByName ? ` by ${t.updatedByName}` : ''}
                </p>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${t.name}`}><MoreHorizontal /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem asChild><Link href={`/settings/certificate-templates/${t.id}`}><Palette /> Design</Link></DropdownMenuItem>
                  {!t.isDefault && t.isActive && <DropdownMenuItem onSelect={() => act.mutate(() => api.post(`/certificate-templates/${t.id}/default`))}><Star /> Make default</DropdownMenuItem>}
                  <DropdownMenuItem onSelect={() => act.mutate(() => api.patch(`/certificate-templates/${t.id}`, { isActive: !t.isActive }))}><Power /> {t.isActive ? 'Switch off' : 'Switch on'}</DropdownMenuItem>
                  {!t.used && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => remove(t)}><Trash2 /> Delete</DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        ) : (
          <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Uses the built-in Classic design. Create a template to change it.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function CertificateTemplatesPage() {
  const q = useQuery({ queryKey: ['certificate-templates'], queryFn: () => api.get<CertificateTemplateRow[]>('/certificate-templates') });
  const [creating, setCreating] = useState<CertificateKind | null>(null);
  return (
    <RequirePermission anyOf={['certificates.templates']}>
      <div className="grid gap-5">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Award className="h-5 w-5 text-primary" /> Certificate templates</h2>
          <p className="text-sm text-muted-foreground">
            Design how each certificate looks — drag and drop text, your logo, signatures, the QR code and more. Each kind uses its default template; certificates already issued keep the design they were issued with.
          </p>
        </div>
        {q.isLoading ? (
          <LoadingRows />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          (['PATIENT', 'STAFF'] as const).map((subject) => (
            <section key={subject} className="grid gap-3">
              <h3 className="text-sm font-semibold text-muted-foreground">{subject === 'PATIENT' ? 'Patient certificates' : 'Staff certificates'}</h3>
              <div className="grid gap-3 xl:grid-cols-2">
                {kindsFor(subject).map((k) => (
                  <KindCard key={k} kind={k} templates={(q.data ?? []).filter((t) => t.kind === k)} onNew={() => setCreating(k)} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
      {creating && <NewTemplateDialog kind={creating} onClose={() => setCreating(null)} />}
    </RequirePermission>
  );
}
