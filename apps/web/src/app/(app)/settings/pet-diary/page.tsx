'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DIARY_SECTIONS, DIARY_SECTION_LABELS, DIARY_THEMES, DIARY_THEME_INFO, sampleDiary, type DiarySettings } from '@vcms/shared';
import { Check, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ColorField } from '@/components/certificates/template-designer';
import { DiaryPreview, type DiaryStyle } from '@/components/diary/diary-pages';
import { useConfirm } from '@/components/confirm';
import { ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Input, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid content-start gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

type Auto = Record<'diary' | 'certificate', { label: string; exists: boolean; on: boolean }>;

/** The two automations that put the owner's links into a message. */
function AutomaticSending() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['diary-automatic'], queryFn: () => api.get<Auto>('/diary-settings/automatic-sending') });
  const set = useMutation({
    mutationFn: (v: { which: 'diary' | 'certificate'; on: boolean }) => api.put<Auto>('/diary-settings/automatic-sending', v),
    onSuccess: (d) => {
      qc.setQueryData(['diary-automatic'], d);
      qc.invalidateQueries({ queryKey: ['automations'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Send the links automatically</CardTitle>
        <CardDescription>The owner gets the link by their preferred channel (WhatsApp or email) — only if they agreed to be contacted. You can change the wording, timing and channel under Settings → Automations.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {q.data ? (
          (['diary', 'certificate'] as const).map((k) => (
            <Toggle
              key={k}
              label={q.data[k].label}
              hint={k === 'diary' ? 'An hour after the visit is finished, with the link to the animal’s online diary.' : 'As soon as a patient certificate is issued, with the link to view, check or print it.'}
              checked={q.data[k].on}
              onChange={(on) => set.mutate({ which: k, on })}
            />
          ))
        ) : (
          <LoadingRows rows={2} />
        )}
      </CardContent>
    </Card>
  );
}

function PetDiarySettings() {
  const { session } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['diary-settings'], queryFn: () => api.get<DiarySettings>('/diary-settings') });
  const [draft, setDraft] = useState<DiarySettings | null>(null);
  useEffect(() => {
    if (q.data) setDraft(q.data);
  }, [q.data]);
  const brand = session.organization?.branding.primaryColor ?? '#0d7a70';
  const style: DiaryStyle = useMemo(() => ({ accent: brand, logoUrl: session.organization?.logoUrl ?? null, photoUrl: null }), [brand, session.organization?.logoUrl]);
  const diary = useMemo(() => sampleDiary({ name: session.organization?.name ?? 'Your clinic' }), [session.organization?.name]);
  const save = useMutation({
    mutationFn: () => api.put<DiarySettings>('/diary-settings', draft),
    onSuccess: (s) => {
      qc.setQueryData(['diary-settings'], s);
      qc.invalidateQueries({ queryKey: ['diary-booklet'] });
      toast.success('Pet diary design saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reset = useMutation({
    mutationFn: () => api.post<DiarySettings>('/diary-settings/reset'),
    onSuccess: (s) => {
      qc.setQueryData(['diary-settings'], s);
      setDraft(s);
      qc.invalidateQueries({ queryKey: ['diary-booklet'] });
      toast.success('Back to the standard design');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.isLoading || !draft) return <LoadingRows />;
  const set = <K extends keyof DiarySettings>(k: K, v: DiarySettings[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const hidden = new Set<string>(draft.hiddenSections);
  const dirty = JSON.stringify(draft) !== JSON.stringify(q.data);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Pet diary' }]}
        title="Pet diary"
        description="Design the printed health book and the owner’s online diary. The pages are filled in from each animal’s records; here you choose how they look."
        actions={
          <>
            <Button variant="ghost" size="sm" loading={reset.isPending} onClick={async () => (await confirm({ title: 'Back to the standard design?', description: 'Your changes to the pet diary design are removed.', confirmLabel: 'Reset' })) && reset.mutate()}><RotateCcw /> Standard design</Button>
            <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}><Save /> Save</Button>
          </>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
        <div className="grid gap-5">
          <Card>
            <CardHeader><CardTitle>Style</CardTitle></CardHeader>
            <CardContent className="grid gap-5">
              <div role="radiogroup" aria-label="Style" className="grid gap-3 sm:grid-cols-3">
                {DIARY_THEMES.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={draft.theme === t} onClick={() => set('theme', t)} className={cn('flex flex-col items-stretch justify-start rounded-xl border p-3 text-left transition hover:border-primary/60', draft.theme === t && 'border-primary bg-primary/5 ring-1 ring-primary')}>
                    <span className="flex items-center justify-between text-sm font-semibold">{DIARY_THEME_INFO[t].label}{draft.theme === t && <Check className="h-4 w-4 text-primary" />}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{DIARY_THEME_INFO[t].hint}</span>
                  </button>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Row label="Title on the cover"><Input value={draft.title} maxLength={40} onChange={(e) => set('title', e.target.value)} /></Row>
                <Row label="Line under the title" hint="Optional — a motto or welcome."><Input value={draft.tagline ?? ''} maxLength={100} onChange={(e) => set('tagline', e.target.value)} /></Row>
              </div>
              <div className="grid gap-2">
                <Toggle label="Use the clinic’s brand colour" hint="Set under Settings → Branding. Switch off to use a different colour just for the diary." checked={draft.accentColor == null} onChange={(on) => set('accentColor', on ? null : brand)} />
                {draft.accentColor != null && <div className="max-w-xs"><ColorField label="Diary colour" value={draft.accentColor} onChange={(v) => set('accentColor', v)} /></div>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What’s inside</CardTitle>
              <CardDescription>The owner and animal pages are always included. Leave out what your clinic doesn’t use.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {DIARY_SECTIONS.map((s) => (
                <Toggle key={s} label={DIARY_SECTION_LABELS[s]} checked={!hidden.has(s)} onChange={(on) => set('hiddenSections', on ? draft.hiddenSections.filter((x) => x !== s) : [...draft.hiddenSections, s])} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Extras and wording</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle label="QR code" hint="Back cover and owner page: opens the online diary." checked={draft.showQr} onChange={(v) => set('showQr', v)} />
                <Toggle label="Animal’s photo" hint="On the cover and the description page, when there is one." checked={draft.showPhoto} onChange={(v) => set('showPhoto', v)} />
              </div>
              <Row label="Pages for handwritten notes" hint="Ruled pages before the back cover.">
                <div className="flex gap-1.5" role="radiogroup" aria-label="Notes pages">
                  {[0, 1, 2, 3, 4].map((n) => (
                    <Button key={n} type="button" size="sm" variant={draft.notesPages === n ? 'default' : 'outline'} role="radio" aria-checked={draft.notesPages === n} onClick={() => set('notesPages', n)}>{n}</Button>
                  ))}
                </div>
              </Row>
              <Row label="Back cover heading"><Input value={draft.backTitle} maxLength={80} onChange={(e) => set('backTitle', e.target.value)} /></Row>
              <Row label="Back cover message" hint="“Your pet’s” is replaced by the animal’s name."><Textarea rows={3} maxLength={400} value={draft.backMessage} onChange={(e) => set('backMessage', e.target.value)} /></Row>
              <div className="grid gap-4 sm:grid-cols-2">
                <Row label="Emergency note" hint="Shown on the back cover, e.g. the out-of-hours number."><Input value={draft.emergencyNote ?? ''} maxLength={160} onChange={(e) => set('emergencyNote', e.target.value)} placeholder="Out-of-hours emergencies: 0300 1234567" /></Row>
                <Row label="Footer line" hint="On every inner page, e.g. opening hours."><Input value={draft.footerNote ?? ''} maxLength={120} onChange={(e) => set('footerNote', e.target.value)} placeholder="Open daily 9am – 8pm" /></Row>
              </div>
            </CardContent>
          </Card>

          <AutomaticSending />
        </div>

        <div className="xl:sticky xl:top-20">
          <p className="mb-2 text-sm font-medium">Preview <span className="font-normal text-muted-foreground">(with made-up details)</span></p>
          <DiaryPreview booklet={{ diary, settings: draft, qrValue: draft.showQr ? 'https://example.com/d/sample' : null }} style={style} limit={4} maxCell={230} />
          {draft.accentColor == null && <p className="mt-3 text-xs text-muted-foreground">Light colours are darkened a little so white text stays readable.</p>}
        </div>
      </div>
    </>
  );
}

export default function PetDiarySettingsPage() {
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <PetDiarySettings />
    </RequirePermission>
  );
}
