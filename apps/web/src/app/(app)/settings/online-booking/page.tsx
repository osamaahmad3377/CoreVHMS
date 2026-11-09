'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { onlineBookingSettingsSchema } from '@vcms/shared';
import { AlertTriangle, CalendarCheck, Home, Code2, Download, ExternalLink, Globe, MessageCircle, QrCode, Share2 } from 'lucide-react';
import Link from 'next/link';
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
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { tabListClass, tabTriggerClass } from '@/components/ui/tabs';
import { api } from '@/lib/api';
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
  allowHomeVisits: boolean;
  /** Home visits can be offered online only while the clinic has them switched on. */
  homeVisits: { available: boolean; travelMinutes: number };
  welcomeMessage: string;
  updatedByName: string | null;
  appointmentTypes: { id: string; name: string; durationMinutes: number; priceMinor: number | null; allowOnlineBooking: boolean; category: string; categoryName: string; categorySort: number }[];
  /** Every category, so one with no appointment type yet (e.g. Vaccination, Deworming) can be offered too. */
  categories: { id: string; name: string; sortOrder: number }[];
  branches: { id: string; name: string; rosteredVets: number }[];
  clinicians: { id: string; name: string; jobTitle: string | null; hasHours: boolean }[];
  last30Days: number;
}

type Draft = Omit<Settings, 'saved' | 'updatedByName' | 'appointmentTypes' | 'categories' | 'homeVisits' | 'branches' | 'clinicians' | 'last30Days'> & { appointmentTypeIds: string[]; offerCategoryIds: string[] };
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
  allowHomeVisits: s.allowHomeVisits,
  welcomeMessage: s.welcomeMessage,
  appointmentTypeIds: s.appointmentTypes.filter((t) => t.allowOnlineBooking).map((t) => t.id),
  offerCategoryIds: [],
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
  if (d.enabled && !d.appointmentTypeIds.length && !d.offerCategoryIds.length) errs.appointmentTypeIds = 'Choose at least one service';
  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(s));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  const submit = (next = d) => {
    setTried(true);
    setError(null);
    const p = onlineBookingSettingsSchema.safeParse(next);
    if (!p.success || (next.enabled && !next.appointmentTypeIds.length && !next.offerCategoryIds.length)) return;
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
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>What clients can book</CardTitle>
              <CardDescription className="mt-1">
                Clients choose categories — one or several for the same visit. Each is booked as the appointment type shown; times come from each vet’s working hours and existing bookings.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2">
            <BookableCategories types={s.appointmentTypes} categories={s.categories} chosen={d.appointmentTypeIds} offers={d.offerCategoryIds} onChange={(ids) => set('appointmentTypeIds', ids)} onOffersChange={(ids) => set('offerCategoryIds', ids)} />
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
                    {!c.hasHours && <span className="text-xs text-warning">· no working hours</span>}
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
            {s.branches.some((b) => !b.rosteredVets) && (
              <p className="flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-sm text-warning ring-1 ring-inset ring-warning/25">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {s.branches.filter((b) => !b.rosteredVets).map((b) => b.name).join(', ')}: no vet has working hours there, so {s.branches.filter((b) => !b.rosteredVets).length === 1 ? 'it is' : 'they are'} not shown online. Set their working hours under Staff.
                </span>
              </p>
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
            <div className="grid gap-2 border-t pt-4">
              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Home className="h-4 w-4 text-primary" /> Home visits
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {d.allowHomeVisits ? 'Clients choose first: at the clinic or a home visit, and give their address.' : 'Off: clients book visits at the clinic only.'}
                  </span>
                </span>
                <Switch checked={d.allowHomeVisits} disabled={!s.homeVisits.available && !d.allowHomeVisits} onCheckedChange={(v) => set('allowHomeVisits', v)} aria-label="Clients can book home visits" />
              </label>
              {s.homeVisits.available ? (
                d.allowHomeVisits && (
                  <p className="text-xs text-muted-foreground">
                    {s.homeVisits.travelMinutes ? `${s.homeVisits.travelMinutes} min travel is kept free on the vet’s calendar before each home visit. ` : ''}
                    Call-out fee, travel charge and travel time are under{' '}
                    <Link href="/settings/home-visits" className="font-medium text-primary hover:underline">
                      Home visits
                    </Link>
                    .
                  </p>
                )
              ) : (
                <p className="text-xs text-muted-foreground">
                  Home visits are switched off for your clinic. Switch them on under{' '}
                  <Link href="/settings/modules" className="font-medium text-primary hover:underline">
                    Services you offer
                  </Link>{' '}
                  to offer them online.
                </p>
              )}
            </div>
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

/**
 * What clients can book: the categories (as in step 1 of the consultation), each offered or not, and the
 * appointment type a booking in it is made as — which sets its length and the vets' free times. Clients can choose
 * several categories for one visit.
 */
function BookableCategories({
  types,
  categories,
  chosen,
  offers,
  onChange,
  onOffersChange,
}: {
  types: Settings['appointmentTypes'];
  categories: Settings['categories'];
  chosen: string[];
  offers: string[];
  onChange: (ids: string[]) => void;
  onOffersChange: (ids: string[]) => void;
}) {
  const groups: { name: string; sort: number; types: Settings['appointmentTypes']; emptyId?: string }[] = [];
  for (const t of types) {
    const g = groups.find((x) => x.name === t.categoryName);
    if (g) g.types.push(t);
    else groups.push({ name: t.categoryName, sort: t.categorySort, types: [t] });
  }
  // Categories with no appointment type yet: offering one adds its type when saved.
  for (const c of categories) if (!groups.some((g) => g.name.toLowerCase() === c.name.toLowerCase())) groups.push({ name: c.name, sort: c.sortOrder, types: [], emptyId: c.id });
  groups.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const usual = (g: (typeof groups)[number]) => g.types.find((t) => t.name.toLowerCase() === g.name.toLowerCase()) ?? g.types[0];
  /** The category's types off, then this one on (one type per category). */
  const pick = (g: (typeof groups)[number], id: string | null) => onChange([...chosen.filter((x) => !g.types.some((t) => t.id === x)), ...(id ? [id] : [])]);
  return (
    <ul className="grid gap-2">
      {groups.map((g) => {
        if (g.emptyId) return <EmptyCategory key={g.emptyId} name={g.name} on={offers.includes(g.emptyId)} onChange={(v) => onOffersChange(v ? [...offers, g.emptyId!] : offers.filter((x) => x !== g.emptyId))} />;
        // The same one the booking page uses: the one named like the category, else the first ticked.
        const current = (chosen.includes(usual(g).id) ? usual(g) : g.types.find((t) => chosen.includes(t.id))) ?? null;
        const on = !!current;
        const shown = current ?? usual(g);
        return (
          <li key={g.name} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3 py-2.5 transition-colors', on && 'border-primary/40 bg-primary/[0.04]')}>
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
              <Checkbox checked={on} aria-label={`Offer ${g.name} online`} onCheckedChange={(v) => pick(g, v === true ? usual(g).id : null)} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{g.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {on ? `${shown.durationMinutes} min` : 'Not offered online'}
                </span>
              </span>
            </label>
            {g.types.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Booked as
                <NativeSelect aria-label={`${g.name} is booked as`} className="h-9 w-56 text-sm" value={shown.id} disabled={!on} onChange={(e) => pick(g, e.target.value)}>
                  {g.types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.durationMinutes} min
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A category with no appointment type yet: offering it online adds one when saved. */
function EmptyCategory({ name, on, onChange }: { name: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <li className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3 py-2.5 transition-colors', on && 'border-primary/40 bg-primary/[0.04]')}>
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
        <Checkbox checked={on} aria-label={`Offer ${name} online`} onCheckedChange={(v) => onChange(v === true)} />
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{name}</span>
          <span className="block text-xs text-muted-foreground">{on ? `A “${name}” appointment type (15 min) is added when you save — change its length under Appointment types.` : 'Not offered online · no appointment type yet'}</span>
        </span>
      </label>
    </li>
  );
}

export default function OnlineBookingPage() {
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <OnlineBookingSettingsPage />
    </RequirePermission>
  );
}
