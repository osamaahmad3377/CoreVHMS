'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, onlineBookingSettingsSchema } from '@vcms/shared';
import { CalendarCheck, Code2, Download, ExternalLink, Globe, MessageCircle, QrCode, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { ErrorState, LoadingRows } from '@/components/page';
import { CopyButton } from '@/components/platform/clinic-ui';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Switch } from '@/components/ui/checkbox';
import { Input, Textarea } from '@/components/ui/input';
import { tabListClass, tabTriggerClass } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

interface Settings {
  enabled: boolean;
  slug: string;
  saved: boolean;
  daysAhead: number;
  minNoticeHours: number;
  cancelNoticeHours: number;
  branchIds: string[];
  clinicianIds: string[];
  allowNewClients: boolean;
  autoConfirm: boolean;
  welcomeMessage: string;
  updatedByName: string | null;
  appointmentTypes: { id: string; name: string; durationMinutes: number; priceMinor: number | null; allowOnlineBooking: boolean; category: string }[];
  branches: { id: string; name: string }[];
  clinicians: { id: string; name: string; jobTitle: string | null }[];
  last30Days: number;
}

type Draft = Omit<Settings, 'saved' | 'updatedByName' | 'appointmentTypes' | 'branches' | 'clinicians' | 'last30Days'> & { appointmentTypeIds: string[] };
const draftOf = (s: Settings): Draft => ({
  enabled: s.enabled,
  slug: s.slug,
  daysAhead: s.daysAhead,
  minNoticeHours: s.minNoticeHours,
  cancelNoticeHours: s.cancelNoticeHours,
  branchIds: s.branchIds,
  clinicianIds: s.clinicianIds,
  allowNewClients: s.allowNewClients,
  autoConfirm: s.autoConfirm,
  welcomeMessage: s.welcomeMessage,
  appointmentTypeIds: s.appointmentTypes.filter((t) => t.allowOnlineBooking).map((t) => t.id),
});
const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));

/** Share card: the link, open/copy, WhatsApp and Facebook share, QR code for the counter, and the website embed code. */
function ShareCard({ link, live }: { link: string; live: boolean }) {
  const qr = useQuery({ queryKey: ['booking-qr', link], queryFn: () => api.get<{ dataUrl: string | null }>(`/online-booking/qr?url=${encodeURIComponent(link)}`), enabled: !!link, staleTime: Infinity });
  const text = `Book your pet’s appointment online: ${link}`;
  const embed = `<iframe src="${link}" title="Book an appointment" style="width:100%;min-height:900px;border:0;border-radius:16px"></iframe>`;
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="grid content-start gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Your booking link</h2>
            {live ? <Badge variant="success">Live</Badge> : <Badge variant="warning">Off — clients see “not available”</Badge>}
          </div>
          <div className="flex gap-2">
            <Input readOnly value={link} className="font-mono text-sm" onFocus={(e) => e.target.select()} aria-label="Booking link" />
            <CopyButton text={link} what="Booking link" variant="outline" size="sm" label="Copy" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={link} target="_blank" rel="noopener noreferrer">
                <ExternalLink /> Open the page
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle /> Share on WhatsApp
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer">
                <Share2 /> Share on Facebook
              </a>
            </Button>
          </div>
          <details className="rounded-xl surface-flat p-3">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Code2 className="h-4 w-4 text-muted-foreground" /> Put it on your website
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">Ask your web designer to paste this where the booking form should appear. For Google, add the link as the “Appointment link” in your Google Business Profile.</p>
            <div className="mt-2 flex gap-2">
              <Input readOnly value={embed} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Website embed code" />
              <CopyButton text={embed} what="Embed code" variant="outline" size="sm" label="Copy" />
            </div>
          </details>
        </div>
        <div className="grid justify-items-center gap-2 text-center">
          {qr.data?.dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr.data.dataUrl} alt="QR code of the booking link" className="h-44 w-44 rounded-2xl bg-white p-2 shadow-card" />
          ) : (
            <div className="flex h-44 w-44 items-center justify-center rounded-2xl surface-flat">
              <QrCode className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
          <p className="text-xs text-muted-foreground">Print it for the counter — clients scan to book.</p>
          {qr.data?.dataUrl && (
            <Button variant="ghost" size="sm" asChild>
              <a href={qr.data.dataUrl} download="booking-qr.png">
                <Download /> Download QR
              </a>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function OnlineBookingSettingsPage() {
  const qc = useQueryClient();
  const { currency } = useSession();
  const q = useQuery({ queryKey: ['online-booking'], queryFn: () => api.get<Settings>('/online-booking') });
  const [d, setD] = useState<Draft | null>(null);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setD(draftOf(q.data));
  }, [q.data]);
  const save = useMutation({
    mutationFn: (draft: Draft) => api.put<Settings>('/online-booking', draft),
    onSuccess: (r) => {
      qc.setQueryData(['online-booking'], r);
      toast.success(r.enabled ? 'Saved — your booking page is live' : 'Saved — online booking is off');
    },
    onError: (e: Error) => setError(e.message),
  });
  if (q.isLoading || !d) return q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <LoadingRows rows={6} />;
  const s = q.data!;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const link = `${origin}/book/${s.slug}`;
  const parsed = onlineBookingSettingsSchema.safeParse(d);
  const errs: Record<string, string | undefined> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
  if (d.enabled && !d.appointmentTypeIds.length) errs.appointmentTypeIds = 'Choose at least one service';
  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(s));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  const submit = (next = d) => {
    setTried(true);
    setError(null);
    const p = onlineBookingSettingsSchema.safeParse(next);
    if (!p.success || (next.enabled && !next.appointmentTypeIds.length)) return;
    save.mutate(next);
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20" aria-hidden>
          <CalendarCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight">Online booking</h2>
          <p className="text-sm text-muted-foreground">A page where clients book a free time themselves — share it on WhatsApp, Facebook, Google and your website.</p>
        </div>
        <label className="flex items-center gap-3 rounded-pill surface-flat py-2 pl-4 pr-2">
          <span className="text-sm font-semibold">{d.enabled ? 'On' : 'Off'}</span>
          <Switch
            checked={d.enabled}
            disabled={save.isPending}
            aria-label="Online booking on"
            onCheckedChange={(v) => {
              const next = { ...d, enabled: v };
              setD(next);
              submit(next);
            }}
          />
        </label>
      </div>

      {s.saved && <ShareCard link={link} live={s.enabled} />}
      {s.saved && (
        <p className="-mt-3 text-sm text-muted-foreground">
          {s.last30Days} booking{s.last30Days === 1 ? '' : 's'} made online in the last 30 days{s.updatedByName ? ` · settings last changed by ${s.updatedByName}` : ''}.
        </p>
      )}

      {error && <FormError message={error} />}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>What clients can book</CardTitle>
              <CardDescription className="mt-1">Only these services appear on the page. Times come from each vet’s working hours and existing bookings.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2">
            {s.appointmentTypes.map((t) => (
              <label key={t.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl surface-flat p-3 transition-colors', d.appointmentTypeIds.includes(t.id) && 'border-primary/40 bg-primary/[0.06]')}>
                <Checkbox checked={d.appointmentTypeIds.includes(t.id)} onCheckedChange={(v) => set('appointmentTypeIds', toggle(d.appointmentTypeIds, t.id, v === true))} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t.durationMinutes} min{t.priceMinor ? ` · shows “from ${formatMoney(t.priceMinor, currency)}”` : ''}
                  </span>
                </span>
              </label>
            ))}
            {!s.appointmentTypes.length && <p className="text-sm text-muted-foreground">Add appointment types under Settings → Appointment types first.</p>}
            {tried && errs.appointmentTypeIds && <p className="text-sm text-destructive">{errs.appointmentTypeIds}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Vets and branches</CardTitle>
              <CardDescription className="mt-1">Clients can pick a vet or take the first free one. Leave all unticked to offer everyone.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <span className="text-sm font-semibold">Vets</span>
              <div className="flex flex-wrap gap-2">
                {s.clinicians.map((c) => (
                  <label key={c.id} className={cn('flex cursor-pointer items-center gap-2 rounded-pill surface-flat px-3 py-2 text-sm', d.clinicianIds.includes(c.id) && 'border-primary/40 bg-primary/[0.06]')}>
                    <Checkbox checked={d.clinicianIds.includes(c.id)} onCheckedChange={(v) => set('clinicianIds', toggle(d.clinicianIds, c.id, v === true))} />
                    {c.name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{d.clinicianIds.length ? `${d.clinicianIds.length} of ${s.clinicians.length} vets offered` : 'All vets with working hours are offered'}</p>
            </div>
            {s.branches.length > 1 && (
              <div className="grid gap-2">
                <span className="text-sm font-semibold">Branches</span>
                <div className="flex flex-wrap gap-2">
                  {s.branches.map((b) => (
                    <label key={b.id} className={cn('flex cursor-pointer items-center gap-2 rounded-pill surface-flat px-3 py-2 text-sm', d.branchIds.includes(b.id) && 'border-primary/40 bg-primary/[0.06]')}>
                      <Checkbox checked={d.branchIds.includes(b.id)} onCheckedChange={(v) => set('branchIds', toggle(d.branchIds, b.id, v === true))} />
                      {b.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Booking rules</CardTitle>
              <CardDescription className="mt-1">How far ahead, how much notice, and who confirms.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Days ahead" htmlFor="ob-days" hint="How far ahead clients can book" error={tried ? errs.daysAhead : undefined}>
                <Input id="ob-days" type="number" inputMode="numeric" min={1} max={365} value={d.daysAhead} onChange={(e) => set('daysAhead', Number(e.target.value))} />
              </Field>
              <Field label="Notice (hours)" htmlFor="ob-notice" hint="No bookings sooner than this" error={tried ? errs.minNoticeHours : undefined}>
                <Input id="ob-notice" type="number" inputMode="numeric" min={0} max={336} value={d.minNoticeHours} onChange={(e) => set('minNoticeHours', Number(e.target.value))} />
              </Field>
              <Field label="Changes (hours)" htmlFor="ob-cancel" hint="Clients can change or cancel up to this many hours before" error={tried ? errs.cancelNoticeHours : undefined}>
                <Input id="ob-cancel" type="number" inputMode="numeric" min={0} max={336} value={d.cancelNoticeHours} onChange={(e) => set('cancelNoticeHours', Number(e.target.value))} />
              </Field>
            </div>
            <div className="grid gap-2">
              <span className="text-sm font-semibold">When a client books</span>
              <div className={tabListClass} role="radiogroup" aria-label="When a client books">
                <button type="button" role="radio" aria-checked={!d.autoConfirm} className={tabTriggerClass(!d.autoConfirm)} onClick={() => set('autoConfirm', false)}>
                  Front desk confirms
                </button>
                <button type="button" role="radio" aria-checked={d.autoConfirm} className={tabTriggerClass(d.autoConfirm)} onClick={() => set('autoConfirm', true)}>
                  Confirm automatically
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{d.autoConfirm ? 'The time is confirmed straight away.' : 'The time is held and shows as “Booked” until the front desk confirms it.'}</p>
            </div>
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-sm font-semibold">New clients can book</span>
                <span className="block text-sm text-muted-foreground">Off: only clients already registered (matched by mobile number).</span>
              </span>
              <Switch checked={d.allowNewClients} onCheckedChange={(v) => set('allowNewClients', v)} aria-label="New clients can book" />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Page wording and address</CardTitle>
              <CardDescription className="mt-1">The page uses your clinic’s logo and colours from Branding.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Field label="Welcome message (optional)" htmlFor="ob-msg" hint="Shown at the top of the page.">
              <Textarea id="ob-msg" rows={3} maxLength={500} placeholder="e.g. Book vaccinations and check-ups online. For emergencies please call us." value={d.welcomeMessage} onChange={(e) => set('welcomeMessage', e.target.value)} />
            </Field>
            <Field label="Page address" htmlFor="ob-slug" error={tried ? errs.slug : undefined} hint="Changing it breaks links you have already shared.">
              <div className="flex items-center gap-2">
                <span className="hidden whitespace-nowrap text-sm text-muted-foreground sm:inline">{origin}/book/</span>
                <Input id="ob-slug" value={d.slug} onChange={(e) => set('slug', e.target.value.toLowerCase())} aria-invalid={tried && !!errs.slug} />
              </div>
            </Field>
          </CardContent>
        </Card>
      </div>

      <div className="action-bar -mx-1 flex flex-wrap items-center justify-end gap-2 rounded-xl px-4 py-3">
        {dirty && <span className="mr-auto text-sm text-muted-foreground">You have unsaved changes</span>}
        <Button variant="outline" disabled={!dirty} onClick={() => setD(draftOf(s))}>
          Undo changes
        </Button>
        <Button loading={save.isPending} disabled={!dirty && s.saved} onClick={() => submit()}>
          Save
        </Button>
      </div>
    </div>
  );
}

export default function OnlineBookingPage() {
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <OnlineBookingSettingsPage />
    </RequirePermission>
  );
}
