'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BRAND_FONTS,
  BRAND_FONT_LABELS,
  BRAND_PRESETS,
  LETTERHEAD_PRESETS,
  brandThemeVariables,
  brandingUpdateSchema,
  contrastRatio,
  type BrandFont,
  type Branding,
} from '@vcms/shared';
import { CalendarDays, Check, FileText, ImageOff, LayoutDashboard, LogIn, Mail, Moon, Palette, PawPrint, RotateCcw, Sun, Upload, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ClinicHeader } from '@/components/billing/invoice-document';
import { SignInFrame } from '@/components/branding/sign-in-frame';
import { LetterFooter, Letterhead } from '@/components/documents/letterhead';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger, tabListClass, tabTriggerClass } from '@/components/ui/tabs';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/** The app's own colours, used when the clinic has not chosen any. */
const DEFAULT_PRIMARY = '#0f7b6c';
const DEFAULT_SIDEBAR = '#131c26';
const PRIMARY_SWATCHES = ['#0f7b6c', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#334155'];
const SIDEBAR_SWATCHES = ['#131c26', '#0f172a', '#1e1b4b', '#14532d', '#422006', '#4c0519', '#f8fafc', '#ffffff'];

/** Everything on this page that is saved with the Save button (images save as soon as they upload). */
const draftOf = (b: Branding, orgName: string) => ({
  brandName: b.brandName === orgName ? '' : b.brandName,
  primaryColor: b.primaryColor,
  sidebarColor: b.sidebarColor,
  loginHeadline: b.loginHeadline ?? '',
  loginMessage: b.loginMessage ?? '',
  brandFont: b.brandFont,
  cornerStyle: b.cornerStyle,
  menuLogoSize: b.menuLogoSize,
  defaultTheme: b.defaultTheme,
  loginLayout: b.loginLayout,
  loginBackground: b.loginBackground,
  loginFooter: b.loginFooter ?? '',
  printLogoPosition: b.printLogoPosition,
  printHeaderText: b.printHeaderText ?? '',
  printFooterText: b.printFooterText ?? '',
  printUseBrandColour: b.printUseBrandColour,
  printLogoSize: b.printLogoSize,
  printNameSize: b.printNameSize,
  printRule: b.printRule,
  printShowAddress: b.printShowAddress,
  printShowContact: b.printShowContact,
  printShowTaxNumber: b.printShowTaxNumber,
  printFooterAlign: b.printFooterAlign,
  printPreprinted: b.printPreprinted,
  printTopSpaceMm: b.printTopSpaceMm,
  emailSenderName: b.emailSenderName ?? '',
  emailSignature: b.emailSignature ?? '',
});
type Draft = ReturnType<typeof draftOf>;

/** The saved branding with the unsaved draft on top, for the previews. */
const withDraft = (b: Branding, d: Draft, orgName: string): Branding => ({
  ...b,
  ...d,
  brandName: d.brandName.trim() || orgName,
  loginHeadline: d.loginHeadline || null,
  loginMessage: d.loginMessage || null,
  loginFooter: d.loginFooter || null,
  printHeaderText: d.printHeaderText || null,
  printFooterText: d.printFooterText || null,
  emailSenderName: d.emailSenderName || null,
  emailSignature: d.emailSignature || null,
});

const fontStack = (f: BrandFont) => (f === 'SYSTEM' ? undefined : `var(--font-${f.toLowerCase().replace('_', '-')})`);

/** A titled group of settings; stacked (title above) to leave room for the preview beside the form. */
function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-b pb-6 last:border-0">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

/** A row of large radio buttons (one choice). */
function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; title: string; text?: string; icon?: React.ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('flex items-start gap-2.5 rounded-md border p-3 text-left text-sm transition-colors', value === o.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted')}
        >
          {o.icon}
          <span className="min-w-0">
            <span className="block font-medium">{o.title}</span>
            {o.text && <span className="block text-xs text-muted-foreground">{o.text}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

function ColourPicker({ id, label, hint, value, fallback, swatches, onChange }: { id: string; label: string; hint: string; value: string | null; fallback: string; swatches: string[]; onChange: (v: string | null) => void }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const shown = value ?? fallback;
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${label}: suggestions`}>
          {swatches.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              aria-label={`Use ${c}`}
              aria-pressed={shown === c}
              onClick={() => onChange(c)}
              className={cn('h-7 w-7 rounded-md border shadow-sm ring-offset-2 transition-transform hover:scale-110', shown === c && 'ring-2 ring-ring')}
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="color" aria-label={`${label}: pick any colour`} value={shown} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded-md border bg-card p-1" />
          <Input
            id={id}
            value={text}
            placeholder={`${fallback} (default)`}
            className="w-36 font-mono"
            maxLength={7}
            onChange={(e) => {
              const v = e.target.value.trim();
              setText(v);
              if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase());
              if (v === '') onChange(null);
            }}
          />
          {value && <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}><RotateCcw /> Default</Button>}
        </div>
      </div>
    </Field>
  );
}

type ImageKind = 'logo' | 'icon' | 'logo-dark' | 'login-background';

function ImagePicker({ kind, url, label, hint, shape = 'wide', dark, orgId, onChanged }: { kind: ImageKind; url: string | null; label: string; hint: string; shape?: 'wide' | 'square' | 'photo'; dark?: boolean; orgId: string; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const set = useMutation({
    mutationFn: async (file: File | null) => {
      let attachmentId: string | null = null;
      if (file) {
        const fd = new FormData();
        fd.append('entityType', 'Branding');
        fd.append('entityId', orgId);
        fd.append('category', kind);
        fd.append('file', file);
        attachmentId = (await api.upload<{ id: string }>('/attachments', fd)).id;
      }
      await api.post(`/organization/${kind}`, { attachmentId });
    },
    onSuccess: (_, file) => {
      toast.success(file ? `${label} updated` : `${label} removed`);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-md border', dark ? 'bg-slate-900' : 'bg-muted/50', { wide: 'h-16 w-40', square: 'h-16 w-16', photo: 'h-20 w-36' }[shape])}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className={cn('h-full w-full', shape === 'photo' ? 'object-cover' : 'object-contain p-1')} />
        ) : (
          <span className={cn('flex items-center gap-1 text-xs', dark ? 'text-slate-400' : 'text-muted-foreground')}><ImageOff className="h-3.5 w-3.5" /> None</span>
        )}
      </div>
      <div className="grid min-w-0 flex-1 gap-1.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
        <div className="flex gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label={`Upload ${label}`} onChange={(e) => { const f = e.target.files?.[0]; if (f) set.mutate(f); e.target.value = ''; }} />
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} loading={set.isPending && set.variables !== null}><Upload /> {url ? 'Replace' : 'Upload'}</Button>
          {url && <Button type="button" variant="ghost" size="sm" onClick={() => set.mutate(null)} loading={set.isPending && set.variables === null}>Remove</Button>}
        </div>
      </div>
    </div>
  );
}

/** Applies the draft's theme variables (colours, font, corners) to a preview, in light or dark. */
function Themed({ b, dark, className, children }: { b: Branding; dark?: boolean; className?: string; children: React.ReactNode }) {
  const v = brandThemeVariables(b);
  const vars = dark ? { ...v.light, ...v.dark } : { ...v.light, ...v.lightOnly };
  return (
    <div className={cn('font-sans text-foreground', dark && 'dark', className)} style={vars as React.CSSProperties}>
      {children}
    </div>
  );
}

/** A small mock of the app in the draft branding. */
function AppPreview({ b, dark }: { b: Branding; dark: boolean }) {
  const menuDark = contrastRatio(b.sidebarColor ?? DEFAULT_SIDEBAR, '#ffffff') > 4.5;
  const logo = menuDark ? (b.logoDarkUrl ?? b.logoUrl) : b.logoUrl;
  return (
    <Themed b={b} dark={dark} className="overflow-hidden rounded-lg border">
      <div className="flex h-72 bg-background">
        <div className="flex w-40 shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-2">
          <div className="mb-2 flex items-center gap-1.5 px-1 text-sidebar-strong">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo ?? '/favicon.svg'} alt="" className="h-6 max-w-[44px] object-contain" />
            <span className="truncate text-xs font-semibold">{b.brandName}</span>
          </div>
          {[['Today', LayoutDashboard], ['Calendar', CalendarDays], ['Clients', Users], ['Patients', PawPrint]].map(([label, Icon], i) => {
            const I = Icon as typeof Users;
            return (
              <div key={label as string} className={cn('flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-sidebar-foreground', i === 0 && 'bg-sidebar-active text-white')}>
                <I className="h-3.5 w-3.5" /> {label as string}
              </div>
            );
          })}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 bg-background p-3">
          <div className="text-sm font-semibold">Good morning, Dr. Ayesha</div>
          <div className="grid gap-2 rounded-lg border bg-card p-2 text-xs text-card-foreground">
            <div className="flex items-center justify-between"><span>Bella · Dog</span><span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-2xs font-semibold text-primary">Waiting</span></div>
            <div className="flex items-center justify-between"><span>Milo · Cat</span><span className="rounded-md bg-accent px-1.5 py-0.5 text-2xs font-semibold text-accent-foreground">Booked</span></div>
          </div>
          <div className="rounded-md border bg-card px-2 py-1.5 text-xs text-muted-foreground">Search by name or phone…</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">Check in</span>
            <span className="rounded-md border bg-card px-3 py-1.5 text-xs">Cancel</span>
            <span className="text-xs text-primary underline">View history</span>
          </div>
        </div>
      </div>
    </Themed>
  );
}

/** The sign-in page in the draft branding, scaled down. */
function SignInPreview({ b }: { b: Branding }) {
  return (
    <div className="relative h-[270px] overflow-hidden rounded-lg border" aria-label="Sign-in page preview">
      <div className="pointer-events-none absolute left-0 top-0 w-[1200px] origin-top-left scale-[0.38]" aria-hidden>
        <Themed b={b}>
          <SignInFrame branding={b} className="!min-h-[710px]">
            <div className="grid gap-4">
              <div>
                <h1 className="text-xl font-semibold">Sign in</h1>
                <p className="mt-1 text-sm text-muted-foreground">Sign in to {b.brandName}.</p>
              </div>
              <div className="grid gap-1.5"><span className="text-sm font-medium">Email</span><div className="h-9 rounded-md border bg-card" /></div>
              <div className="grid gap-1.5"><span className="text-sm font-medium">Password</span><div className="h-9 rounded-md border bg-card" /></div>
              <div className="flex h-9 items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground">Sign in</div>
            </div>
          </SignInFrame>
        </Themed>
      </div>
    </div>
  );
}

/** The top of a printed invoice in the draft branding. */
function PrintPreview({ b, clinic }: { b: Branding; clinic: ClinicHeader }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white shadow-sm" aria-label="Printout preview">
      <Themed b={b} className="p-6 text-[9pt] text-black">
        <Letterhead clinic={clinic} branding={b} aside={<><p className="text-base font-bold">TAX INVOICE</p><p>INV-000123</p><p>Date: today</p></>} />
        <div className="grid gap-1">
          <div className="flex justify-between border-b pb-1 font-semibold"><span>Description</span><span>Amount</span></div>
          <div className="flex justify-between"><span>Consultation</span><span>2,500.00</span></div>
          <div className="flex justify-between"><span>Vaccination</span><span>1,800.00</span></div>
        </div>
        <LetterFooter branding={b} />
      </Themed>
    </div>
  );
}

/** An email to staff or clients in the draft branding. */
function EmailPreview({ b, replyTo }: { b: Branding; replyTo: string | null }) {
  const colour = b.primaryColor ?? DEFAULT_PRIMARY;
  const onColour = contrastRatio(colour, '#ffffff') >= 4.5 ? '#ffffff' : '#111827';
  return (
    <div className="overflow-hidden rounded-lg border bg-slate-100 p-3 text-slate-900" aria-label="Email preview">
      <div className="mb-2 grid gap-0.5 rounded-md bg-white px-3 py-2 text-xs">
        <p><span className="text-slate-500">From:</span> <b>{b.emailSenderName || b.brandName}</b> &lt;no-reply@…&gt;</p>
        <p><span className="text-slate-500">Reply to:</span> {replyTo ?? <span className="text-amber-700">no clinic email set</span>}</p>
        <p><span className="text-slate-500">Subject:</span> Bella is due for a vaccination</p>
      </div>
      <div className="rounded-md border border-slate-200 bg-white p-4 text-sm">
        <p className="mb-2 text-base font-semibold" style={{ color: contrastRatio(colour, '#ffffff') >= 3 ? colour : '#0f5f5a' }}>Bella is due for a vaccination</p>
        <p>Hello Ahmed,</p>
        <p className="mt-1">Bella’s yearly vaccination is due on 3 November. Reply or call us to book.</p>
        <span className="mt-3 inline-block rounded-md px-3 py-1.5 text-xs" style={{ background: colour, color: onColour }}>Book now</span>
        {b.emailSignature && <p className="mt-4 whitespace-pre-line">{b.emailSignature}</p>}
        <p className="mt-4 text-xs text-slate-500">{b.brandName}</p>
      </div>
    </div>
  );
}

function BrandingForm({ branding, orgId, orgName, clinic }: { branding: Branding; orgId: string; orgName: string; clinic: ClinicHeader }) {
  const qc = useQueryClient();
  const { refresh } = useSession();
  const [draft, setDraft] = useState<Draft>(() => draftOf(branding, orgName));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const reload = () => {
    qc.invalidateQueries({ queryKey: ['branding'] });
    qc.invalidateQueries({ queryKey: ['receipt-settings'] });
    refresh();
  };

  const save = useMutation({
    mutationFn: () => {
      const parsed = brandingUpdateSchema.safeParse(draft);
      if (!parsed.success) {
        setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
        throw new Error('Check the highlighted fields');
      }
      setErrors({});
      return api.put<Branding>('/organization/branding', parsed.data);
    },
    onSuccess: (b) => {
      setDraft(draftOf(b, orgName));
      toast.success('Branding saved. Everyone sees it the next time a page loads.');
      reload();
    },
    onError: (e: Error) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      setError(e.message);
    },
  });

  const b = useMemo(() => withDraft(branding, draft, orgName), [branding, draft, orgName]);
  const adjusted = !!draft.primaryColor && contrastRatio(draft.primaryColor, '#ffffff') < 3;
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(branding, orgName));
  const preset = BRAND_PRESETS.find(
    (p) => p.primaryColor === (draft.primaryColor ?? DEFAULT_PRIMARY) && p.sidebarColor === (draft.sidebarColor ?? DEFAULT_SIDEBAR) && p.brandFont === draft.brandFont && p.cornerStyle === draft.cornerStyle,
  );
  const side = (title: string, node: React.ReactNode, note?: string, extra?: React.ReactNode) => (
    <div className="grid content-start gap-2 xl:sticky xl:top-20">
      <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{title}</p>{extra}</div>
      {node}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      {error && <FormError message={error} />}
      <Tabs defaultValue="look">
        <TabsList className="h-auto flex-wrap overflow-visible">
          <TabsTrigger value="look"><Palette className="h-4 w-4" /> Look &amp; feel</TabsTrigger>
          <TabsTrigger value="signin"><LogIn className="h-4 w-4" /> Sign-in page</TabsTrigger>
          <TabsTrigger value="print"><FileText className="h-4 w-4" /> Printouts</TabsTrigger>
          <TabsTrigger value="email"><Mail className="h-4 w-4" /> Emails</TabsTrigger>
        </TabsList>

        <TabsContent value="look">
          <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
            <div className="grid min-w-0 gap-6">
              <Section title="Ready-made themes" description="One click sets colours, font and corners that go well together. You can change any of them afterwards.">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
                  {BRAND_PRESETS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      aria-pressed={preset?.key === p.key}
                      onClick={() => setDraft((d) => ({ ...d, primaryColor: p.primaryColor, sidebarColor: p.sidebarColor, brandFont: p.brandFont, cornerStyle: p.cornerStyle }))}
                      className={cn('overflow-hidden rounded-md border text-left text-xs transition-colors hover:border-primary', preset?.key === p.key && 'border-primary ring-1 ring-primary')}
                    >
                      <span className="flex h-10">
                        <span className="w-1/3 border-r" style={{ background: p.sidebarColor }} />
                        <span className="flex flex-1 items-center justify-center bg-white"><span className="h-3 w-10 rounded-sm" style={{ background: p.primaryColor }} /></span>
                      </span>
                      <span className="flex items-center justify-between gap-1 px-2 py-1.5">
                        <span className="min-w-0">
                          <span className="block truncate font-medium" style={{ fontFamily: fontStack(p.brandFont) }}>{p.name}</span>
                          <span className="block truncate text-muted-foreground">{BRAND_FONT_LABELS[p.brandFont].replace(' (serif)', '')}</span>
                        </span>
                        {preset?.key === p.key && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                      </span>
                    </button>
                  ))}
                </div>
              </Section>

              <Section title="Name" description="Shown in the menu, on the sign-in page and in the browser tab.">
                <Field label="Name shown in the app" htmlFor="b-name" hint={`Leave empty to use your clinic name (${orgName}).`} error={errors.brandName}>
                  <Input id="b-name" value={draft.brandName} maxLength={60} placeholder={orgName} onChange={(e) => set('brandName', e.target.value)} />
                </Field>
              </Section>

              <Section title="Logos and icon" description="PNG, JPG or WebP. Images apply as soon as they upload.">
                <div className="grid gap-4">
                  <ImagePicker kind="logo" label="Logo" url={branding.logoUrl} orgId={orgId} onChanged={reload} hint="For light backgrounds: printouts, light menus and the sign-in form. A wide logo on a transparent background works best." />
                  <ImagePicker kind="logo-dark" label="Logo for dark backgrounds" url={branding.logoDarkUrl} dark orgId={orgId} onChanged={reload} hint="Optional: a light or white version for dark menus, the sign-in panel and dark mode. Without it, the logo above is used." />
                  <ImagePicker kind="icon" label="Browser-tab icon" url={branding.hasOwnIcon ? branding.iconUrl : null} shape="square" orgId={orgId} onChanged={reload} hint="A square image, at least 64 × 64. Without one, the logo is used." />
                </div>
              </Section>

              <Section title="Colours" description="Text and buttons always stay readable: a very light main colour is darkened slightly where needed.">
                <div className="grid gap-5">
                  <ColourPicker id="b-primary" label="Main colour" hint="Buttons, links and highlights." value={draft.primaryColor} fallback={DEFAULT_PRIMARY} swatches={PRIMARY_SWATCHES} onChange={(v) => set('primaryColor', v)} />
                  {adjusted && <p className="-mt-3 text-xs text-warning">This colour is light, so links and button text use a slightly darker shade of it.</p>}
                  <ColourPicker id="b-sidebar" label="Menu colour" hint="Background of the side menu. Its text switches between light and dark to stay readable." value={draft.sidebarColor} fallback={DEFAULT_SIDEBAR} swatches={SIDEBAR_SWATCHES} onChange={(v) => set('sidebarColor', v)} />
                </div>
              </Section>

              <Section title="Font and shape" description="The lettering, and how rounded buttons, fields and cards are.">
                <div className="grid gap-4">
                  <Field label="Font" htmlFor="b-font">
                    <div className="flex flex-wrap items-center gap-3">
                      <NativeSelect id="b-font" className="w-56" value={draft.brandFont} onChange={(e) => set('brandFont', e.target.value as BrandFont)}>
                        {BRAND_FONTS.filter((f) => f !== 'INTER').map((f) => <option key={f} value={f}>{BRAND_FONT_LABELS[f]}</option>)}
                      </NativeSelect>
                      <span className="text-sm text-muted-foreground" style={{ fontFamily: fontStack(draft.brandFont) }}>Bella · Vaccination due 3 November</span>
                    </div>
                  </Field>
                  <Choice
                    label="Corners"
                    value={draft.cornerStyle}
                    onChange={(v) => set('cornerStyle', v)}
                    options={[
                      { value: 'SHARP', title: 'Sharp', text: 'Square, formal', icon: <span className="mt-0.5 h-4 w-6 shrink-0 rounded-[2px] bg-primary" /> },
                      { value: 'STANDARD', title: 'Standard', text: 'Softly rounded', icon: <span className="mt-0.5 h-4 w-6 shrink-0 rounded-[7px] bg-primary" /> },
                      { value: 'ROUNDED', title: 'Rounded', text: 'Soft, friendly', icon: <span className="mt-0.5 h-4 w-6 shrink-0 rounded-[12px] bg-primary" /> },
                    ]}
                  />
                </div>
              </Section>

              <Section title="Menu logo" description="How large your logo is at the top of the side menu. The clinic name sits below it.">
                <Choice
                  label="Logo size"
                  value={draft.menuLogoSize}
                  onChange={(v) => set('menuLogoSize', v)}
                  options={[
                    { value: 'SMALL', title: 'Small', icon: <span className="mt-0.5 h-3 w-3 shrink-0 rounded-sm bg-primary" /> },
                    { value: 'MEDIUM', title: 'Medium', icon: <span className="mt-0.5 h-4 w-4 shrink-0 rounded-sm bg-primary" /> },
                    { value: 'LARGE', title: 'Large', icon: <span className="mt-0.5 h-5 w-5 shrink-0 rounded-sm bg-primary" /> },
                  ]}
                />
              </Section>

              <Section title="Light or dark" description="What staff see until they choose for themselves with the moon button.">
                <Choice
                  label="Default theme"
                  value={draft.defaultTheme}
                  onChange={(v) => set('defaultTheme', v)}
                  options={[
                    { value: 'LIGHT', title: 'Light', icon: <Sun className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> },
                    { value: 'DARK', title: 'Dark', icon: <Moon className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> },
                    { value: 'SYSTEM', title: 'Follow the device', text: 'Like the computer or phone' },
                  ]}
                />
              </Section>
            </div>
            {side(
              'Preview',
              <AppPreview b={b} dark={dark} />,
              'Colours, font and name update here as you type; staff see them after you save.',
              <div className={cn(tabListClass)} role="group" aria-label="Preview theme">
                <Button type="button" size="sm" variant={dark ? 'ghost' : 'secondary'} aria-pressed={!dark} onClick={() => setDark(false)}><Sun /> Light</Button>
                <Button type="button" size="sm" variant={dark ? 'secondary' : 'ghost'} aria-pressed={dark} onClick={() => setDark(true)}><Moon /> Dark</Button>
              </div>,
            )}
          </div>
        </TabsContent>

        <TabsContent value="signin">
          <div className="grid gap-6 xl:grid-cols-[1fr_460px]">
            <div className="grid min-w-0 gap-6">
              <Section title="Layout" description="How your clinic’s sign-in page is arranged.">
                <Choice
                  label="Sign-in layout"
                  value={draft.loginLayout}
                  onChange={(v) => set('loginLayout', v)}
                  options={[
                    { value: 'SPLIT', title: 'Side panel', text: 'Your welcome beside the form' },
                    { value: 'CENTERED', title: 'Centred card', text: 'The form on your background' },
                  ]}
                />
              </Section>
              <Section title="Background" description="Behind the welcome (side panel) or the whole page (centred card).">
                <div className="grid gap-4">
                  <Choice
                    label="Sign-in background"
                    value={draft.loginBackground}
                    onChange={(v) => set('loginBackground', v)}
                    options={[
                      { value: 'MENU_COLOUR', title: 'Menu colour' },
                      { value: 'GRADIENT', title: 'Colour blend', text: 'Menu colour into main colour' },
                      { value: 'IMAGE', title: 'Photo', text: 'Your own picture' },
                    ]}
                  />
                  {draft.loginBackground === 'IMAGE' && (
                    <ImagePicker kind="login-background" label="Background photo" url={branding.loginBackgroundUrl} shape="photo" orgId={orgId} onChanged={reload} hint="A wide photo, e.g. your clinic or team (at least 1600 px wide). It is darkened slightly so text stays readable. Without one, the menu colour is used." />
                  )}
                </div>
              </Section>
              <Section title="Words" description="The welcome next to the sign-in form, and a line at the bottom.">
                <div className="grid gap-3">
                  <Field label="Headline" htmlFor="b-headline" hint={`Leave empty for “Welcome to ${b.brandName}”.`} error={errors.loginHeadline}>
                    <Input id="b-headline" value={draft.loginHeadline} maxLength={120} onChange={(e) => set('loginHeadline', e.target.value)} />
                  </Field>
                  <Field label="Message" htmlFor="b-message" hint="e.g. opening hours or who to call for help." error={errors.loginMessage}>
                    <Textarea id="b-message" rows={3} value={draft.loginMessage} maxLength={300} onChange={(e) => set('loginMessage', e.target.value)} />
                  </Field>
                  <Field label="Footer line" htmlFor="b-login-footer" hint={`e.g. address and website. Leave empty for “© ${new Date().getFullYear()} ${b.brandName}”.`} error={errors.loginFooter}>
                    <Input id="b-login-footer" value={draft.loginFooter} maxLength={200} onChange={(e) => set('loginFooter', e.target.value)} />
                  </Field>
                </div>
              </Section>
            </div>
            {side('Preview', <SignInPreview b={b} />, 'On phones the welcome panel is hidden and your logo sits above the form.')}
          </div>
        </TabsContent>

        <TabsContent value="print">
          <div className="grid gap-6 xl:grid-cols-[1fr_460px]">
            <div className="grid min-w-0 gap-6">
              <Section title="Letterhead" description="The top of every printed invoice, certificate, lab report, discharge summary, surgical report, purchase order, referral letter and claim form.">
                <div className="grid gap-4">
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox checked={draft.printPreprinted} onCheckedChange={(v) => set('printPreprinted', v === true)} className="mt-0.5" />
                    <span>I print on paper that already has our letterhead<span className="block text-xs text-muted-foreground">Nothing is printed at the top; the space is left blank so the pre-printed paper shows through.</span></span>
                  </label>
                  {draft.printPreprinted ? (
                    <Field label="Blank space at the top (mm)" htmlFor="b-print-space" hint="Measure the pre-printed header on your paper. 40 mm is typical." error={errors.printTopSpaceMm}>
                      <Input id="b-print-space" type="number" min={0} max={120} value={draft.printTopSpaceMm} onChange={(e) => set('printTopSpaceMm', Math.max(0, Math.min(120, Math.round(Number(e.target.value) || 0))))} className="w-32" />
                    </Field>
                  ) : (
                    <>
                      <div>
                        <p className="mb-2 text-sm font-medium">Start from a design</p>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
                          {LETTERHEAD_PRESETS.map((p) => {
                            const active = (Object.keys(p.values) as (keyof typeof p.values)[]).every((k) => draft[k] === p.values[k]);
                            return (
                              <button key={p.key} type="button" onClick={() => setDraft((d) => ({ ...d, ...p.values }))} aria-pressed={active} className={cn('rounded-md border p-3 text-left text-sm transition-colors', active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted')}>
                                <span className="block font-medium">{p.name}</span>
                                <span className="block text-xs text-muted-foreground">{p.description}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <p className="mb-2 text-sm font-medium">Logo position</p>
                        <Choice
                          label="Logo position"
                          value={draft.printLogoPosition}
                          onChange={(v) => set('printLogoPosition', v)}
                          options={[
                            { value: 'LEFT', title: 'On the left' },
                            { value: 'CENTER', title: 'In the centre' },
                            { value: 'RIGHT', title: 'On the right' },
                          ]}
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <p className="mb-2 text-sm font-medium">Logo size</p>
                          <Choice label="Logo size" value={draft.printLogoSize} onChange={(v) => set('printLogoSize', v)} options={[{ value: 'SMALL', title: 'Small' }, { value: 'MEDIUM', title: 'Medium' }, { value: 'LARGE', title: 'Large' }]} />
                        </div>
                        <div>
                          <p className="mb-2 text-sm font-medium">Clinic name size</p>
                          <Choice label="Clinic name size" value={draft.printNameSize} onChange={(v) => set('printNameSize', v)} options={[{ value: 'SMALL', title: 'Small' }, { value: 'MEDIUM', title: 'Medium' }, { value: 'LARGE', title: 'Large' }]} />
                        </div>
                      </div>
                      <div>
                        <p className="mb-2 text-sm font-medium">Lines</p>
                        <Choice
                          label="Lines"
                          value={draft.printRule}
                          onChange={(v) => set('printRule', v)}
                          options={[
                            { value: 'BAND', title: 'Coloured band', text: 'Thick bar on top and a line below' },
                            { value: 'LINE', title: 'Thin line', text: 'One line below the header' },
                            { value: 'DOUBLE', title: 'Double line', text: 'A formal double rule below' },
                            { value: 'NONE', title: 'No lines' },
                          ]}
                        />
                      </div>
                      <Field label="Line under the clinic name" htmlFor="b-print-header" hint="e.g. “Companion & farm animal hospital · Open 24 hours”." error={errors.printHeaderText}>
                        <Input id="b-print-header" value={draft.printHeaderText} maxLength={200} onChange={(e) => set('printHeaderText', e.target.value)} />
                      </Field>
                      <fieldset className="grid gap-2">
                        <legend className="mb-1 text-sm font-medium">Show on the letterhead</legend>
                        {([['printShowAddress', 'Address'], ['printShowContact', 'Phone and email'], ['printShowTaxNumber', 'Tax number']] as const).map(([k, label]) => (
                          <label key={k} className="flex items-center gap-2 text-sm">
                            <Checkbox checked={draft[k]} onCheckedChange={(v) => set(k, v === true)} /> {label}
                          </label>
                        ))}
                      </fieldset>
                      <label className="flex items-start gap-2 text-sm">
                        <Checkbox checked={draft.printUseBrandColour} onCheckedChange={(v) => set('printUseBrandColour', v === true)} className="mt-0.5" />
                        <span>Print the clinic name and lines in the main colour<span className="block text-xs text-muted-foreground">Turn off for black-only printing. Very light colours always print black.</span></span>
                      </label>
                    </>
                  )}
                </div>
              </Section>
              <Section title="Footer" description="Printed at the end of each document.">
                <Field label="Footer text" htmlFor="b-print-footer" hint="e.g. bank details for payment, registration number, or a thank-you." error={errors.printFooterText}>
                  <Textarea id="b-print-footer" rows={3} value={draft.printFooterText} maxLength={300} onChange={(e) => set('printFooterText', e.target.value)} />
                </Field>
                <div>
                  <p className="mb-2 text-sm font-medium">Footer alignment</p>
                  <Choice label="Footer alignment" value={draft.printFooterAlign} onChange={(v) => set('printFooterAlign', v)} options={[{ value: 'LEFT', title: 'Left' }, { value: 'CENTER', title: 'Centre' }, { value: 'RIGHT', title: 'Right' }]} />
                </div>
              </Section>
              <p className="text-xs text-muted-foreground">
                Address, phone and tax number come from <Link href="/settings/organization" className="text-primary hover:underline">Clinic details</Link> and the branch. Receipts have their own settings in <Link href="/settings/receipts" className="text-primary hover:underline">Receipts &amp; printing</Link>.
              </p>
            </div>
            {side('Preview', <PrintPreview b={b} clinic={clinic} />)}
          </div>
        </TabsContent>

        <TabsContent value="email">
          <div className="grid gap-6 xl:grid-cols-[1fr_460px]">
            <div className="grid min-w-0 gap-6">
              <Section title="Sender" description="How your emails appear in the inbox: reminders, invitations, password resets and messages to clients.">
                <div className="grid gap-2">
                  <Field label="Sender name" htmlFor="b-sender" hint={`Leave empty to use “${b.brandName}”.`} error={errors.emailSenderName}>
                    <Input id="b-sender" value={draft.emailSenderName} maxLength={60} placeholder={b.brandName} onChange={(e) => set('emailSenderName', e.target.value)} />
                  </Field>
                  <p className="text-xs text-muted-foreground">
                    {clinic.email ? <>Replies go to <b>{clinic.email}</b> (from <Link href="/settings/organization" className="text-primary hover:underline">Clinic details</Link>).</> : <>Add your clinic’s email in <Link href="/settings/organization" className="text-primary hover:underline">Clinic details</Link> so replies reach you.</>}
                  </p>
                </div>
              </Section>
              <Section title="Signature" description="Closing lines under every email.">
                <Field label="Signature" htmlFor="b-signature" hint="e.g. “The team at Happy Paws · 042 111 222 · happypaws.pk”." error={errors.emailSignature}>
                  <Textarea id="b-signature" rows={4} value={draft.emailSignature} maxLength={500} onChange={(e) => set('emailSignature', e.target.value)} />
                </Field>
              </Section>
            </div>
            {side('Preview', <EmailPreview b={b} replyTo={clinic.email ?? null} />, 'Emails use your main colour for headings and buttons.')}
          </div>
        </TabsContent>
      </Tabs>

      <div className="action-bar mt-6 flex flex-wrap items-center justify-end gap-2 py-3">
        {dirty && <span className="mr-auto text-xs text-muted-foreground">You have unsaved changes.</span>}
        <Button type="button" variant="outline" disabled={!dirty || save.isPending} onClick={() => { setDraft(draftOf(branding, orgName)); setErrors({}); setError(null); }}>Undo changes</Button>
        <Button type="submit" loading={save.isPending} disabled={!dirty}>Save</Button>
      </div>
    </form>
  );
}

function BrandingCard() {
  const { session } = useSession();
  const q = useQuery({ queryKey: ['branding'], queryFn: () => api.get<Branding>('/organization/branding') });
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api.get<ClinicHeader>('/organization'), staleTime: 300_000 });
  const o = session.organization!;
  const failed = q.error ?? org.error;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>Make the app your clinic’s own: logo, colours, font, sign-in page, printouts and emails. Only the clinic owner can change this.</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading || org.isLoading ? (
          <LoadingRows />
        ) : failed ? (
          <ErrorState error={failed} onRetry={() => { q.refetch(); org.refetch(); }} />
        ) : (
          <BrandingForm branding={q.data!} orgId={o.id} orgName={o.name} clinic={org.data!} />
        )}
      </CardContent>
    </Card>
  );
}

export default function BrandingSettings() {
  return (
    <RequirePermission anyOf={['branding.manage']}>
      <BrandingCard />
    </RequirePermission>
  );
}
