'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlignCenter, AlignLeft, AlignRight, ImagePlus, Printer, RotateCcw, Save } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { ErrorState, LoadingRows } from '@/components/page';
import type { ReceiptData } from '@/components/receipts/receipt-document';
import { RECEIPT_KEY, ReceiptPreview, useReceiptContext, useReceiptPrinter } from '@/components/receipts/use-receipt';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { ReceiptContext, ReceiptSettings } from '@/lib/types';
import { cn } from '@/lib/utils';

/** A sample sale for the preview and test print (not a real invoice). */
function sample(currency: string, branchId: string | null, servedBy: string): ReceiptData {
  const big = currency === 'PKR' ? 100 : 1;
  return {
    number: 'INV-SAMPLE',
    isVoid: false,
    date: new Date().toISOString(),
    branchId,
    currency,
    pricesIncludeTax: false,
    servedBy,
    customer: 'Sample customer',
    patient: 'Bruno',
    lines: [
      { id: '1', description: 'Adult dog food, chicken & rice 3 kg', code: 'FD-DOG3', quantity: 1, unitPriceMinor: 4500 * big, discountMinor: 0, grossMinor: 4500 * big },
      { id: '2', description: 'Dental chew sticks', code: 'TR-DENT7', quantity: 2, unitPriceMinor: 1200 * big, discountMinor: 200 * big, grossMinor: 2200 * big },
      { id: '3', description: 'Nail trim', code: 'GRM-NAIL', quantity: 1, unitPriceMinor: 800 * big, discountMinor: 0, grossMinor: 800 * big },
    ],
    subtotalMinor: 7500 * big,
    taxMinor: 0,
    totalMinor: 7500 * big,
    creditedMinor: 0,
    payments: [{ method: 'CASH', amountMinor: 7500 * big, receiptNo: 'RCPT-SAMPLE' }],
    tenderedMinor: 8000 * big,
    changeMinor: 500 * big,
  };
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4 py-2">
      <span className="text-sm">{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: React.ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn('flex items-center gap-1 rounded px-3 py-1 text-sm', value === o.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ReceiptSettingsForm({ ctx }: { ctx: ReceiptContext }) {
  const qc = useQueryClient();
  const { can, currency, session } = useSession();
  const { print } = useReceiptPrinter();
  const fileRef = useRef<HTMLInputElement>(null);
  const strip = (s: ReceiptSettings): ReceiptSettings => { const { updatedAt: _u, updatedByName: _n, ...rest } = s; return rest as ReceiptSettings; };
  const [f, setF] = useState<ReceiptSettings>(strip(ctx.settings));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setF(strip(ctx.settings)), [ctx.settings]);
  const set = <K extends keyof ReceiptSettings>(k: K, v: ReceiptSettings[K]) => setF((s) => ({ ...s, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(strip(ctx.settings));
  const editable = can('settings.manage');

  // The logo the draft would print: the uploaded receipt logo, or the branding logo.
  const draftLogo = !f.showLogo
    ? null
    : f.logoSource === 'CUSTOM'
      ? f.customLogoAttachmentId ? `/api/v1/attachments/${f.customLogoAttachmentId}/download?inline=1` : null
      : ctx.brandingLogo ? '/api/v1/organization/logo' : null;
  const draftCtx = useMemo<ReceiptContext>(() => ({ ...ctx, settings: f }), [ctx, f]);
  const data = useMemo(() => sample(currency, session.branch?.id ?? null, session.user.name), [currency, session.branch?.id, session.user.name]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('entityType', 'ReceiptLogo');
      fd.append('entityId', session.organization!.id);
      fd.append('category', 'logo');
      fd.append('file', file);
      return api.upload<{ id: string }>('/attachments', fd);
    },
    onSuccess: (a) => { setF((s) => ({ ...s, logoSource: 'CUSTOM', customLogoAttachmentId: a.id, showLogo: true })); toast.success('Logo uploaded — save to use it'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: () => api.put<ReceiptContext>('/receipt-settings', f),
    onSuccess: (d) => { qc.setQueryData(RECEIPT_KEY, d); toast.success('Receipt settings saved'); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid content-start gap-4">
        {error && <FormError message={error} />}
        <fieldset disabled={!editable} className="contents">
          <Card>
            <CardHeader><div><CardTitle>Paper</CardTitle><CardDescription>Most receipt printers use 80 mm rolls; small mobile printers use 58 mm.</CardDescription></div></CardHeader>
            <CardContent className="flex flex-wrap items-start gap-x-8 gap-y-4">
              <Field label="Paper width" htmlFor="rc-w">
                <Segmented label="Paper width" value={f.paperWidthMm} onChange={(v) => set('paperWidthMm', v)} options={[{ value: 80, label: '80 mm' }, { value: 58, label: '58 mm' }]} />
              </Field>
              <Field label={`Side margin: ${f.sideMarginMm} mm`} htmlFor="rc-m" hint="Increase if the edges are cut off" className="w-56">
                <input id="rc-m" type="range" min={0} max={8} step={1} value={f.sideMarginMm} onChange={(e) => set('sideMarginMm', Number(e.target.value))} className="w-full accent-primary" />
              </Field>
              <Field label="Text size" htmlFor="rc-fs">
                <Segmented label="Text size" value={f.fontSize} onChange={(v) => set('fontSize', v)} options={[{ value: 'SMALL', label: 'Small' }, { value: 'NORMAL', label: 'Normal' }, { value: 'LARGE', label: 'Large' }]} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><div><CardTitle>Logo</CardTitle><CardDescription>Printed at the top of every receipt.</CardDescription></div></CardHeader>
            <CardContent className="grid gap-4">
              <Toggle label="Print a logo" checked={f.showLogo} onChange={(v) => set('showLogo', v)} />
              {f.showLogo && (
                <>
                  <div className="grid gap-2">
                    <Segmented
                      label="Logo source"
                      value={f.logoSource}
                      onChange={(v) => set('logoSource', v)}
                      options={[{ value: 'BRANDING', label: 'Branding logo' }, { value: 'CUSTOM', label: 'Separate receipt logo' }]}
                    />
                    {f.logoSource === 'BRANDING' && !ctx.brandingLogo && (
                      <span className="text-xs text-muted-foreground">No branding logo yet — add one in <Link className="underline" href="/settings/organization">Organization</Link>.</span>
                    )}
                    {f.logoSource === 'CUSTOM' && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-dashed p-3">
                        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="Receipt logo file" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate(file); e.target.value = ''; }} />
                        <Button type="button" size="sm" variant="outline" loading={upload.isPending} onClick={() => fileRef.current?.click()}><ImagePlus /> {f.customLogoAttachmentId ? 'Replace logo' : 'Upload logo'}</Button>
                        <span className="min-w-0 flex-1 basis-56 text-xs text-muted-foreground">{f.customLogoAttachmentId ? 'Receipt logo uploaded.' : 'PNG, JPG or WebP.'} A black-and-white version prints sharpest on thermal paper.</span>
                      </div>
                    )}
                  </div>
                  <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <Field label={`Logo size: ${f.logoWidthPercent}% of the width`} htmlFor="rc-lw">
                      <input id="rc-lw" type="range" min={15} max={100} step={5} value={f.logoWidthPercent} onChange={(e) => set('logoWidthPercent', Number(e.target.value))} className="w-full accent-primary" />
                    </Field>
                    <Field label="Alignment" htmlFor="rc-la">
                      <Segmented
                        label="Logo alignment"
                        value={f.logoAlign}
                        onChange={(v) => set('logoAlign', v)}
                        options={[{ value: 'LEFT', label: <AlignLeft className="h-4 w-4" />, title: 'Left' }, { value: 'CENTER', label: <AlignCenter className="h-4 w-4" />, title: 'Centre' }, { value: 'RIGHT', label: <AlignRight className="h-4 w-4" />, title: 'Right' }]}
                      />
                    </Field>
                    <Toggle label="Thermal-friendly (black & white)" hint="Converts colours to sharp black and white" checked={f.logoMonochrome} onChange={(v) => set('logoMonochrome', v)} />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><div><CardTitle>Text</CardTitle><CardDescription>Shown in the header and at the bottom of the receipt.</CardDescription></div></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="Receipt title" htmlFor="rc-t" required><Input id="rc-t" value={f.title} maxLength={60} onChange={(e) => set('title', e.target.value)} /></Field>
              <Field label="Header line" htmlFor="rc-h" hint="e.g. opening hours or website"><Input id="rc-h" value={f.headerText ?? ''} maxLength={300} onChange={(e) => set('headerText', e.target.value || null)} /></Field>
              <Field label="Thank-you message" htmlFor="rc-f"><Textarea id="rc-f" rows={2} value={f.footerText ?? ''} maxLength={300} onChange={(e) => set('footerText', e.target.value || null)} /></Field>
              <Field label="Returns / policy (small print)" htmlFor="rc-p"><Textarea id="rc-p" rows={2} value={f.policyText ?? ''} maxLength={600} onChange={(e) => set('policyText', e.target.value || null)} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><div><CardTitle>What to show</CardTitle><CardDescription>Clinic and branch details come from Settings → Organization and Branches.</CardDescription></div></CardHeader>
            <CardContent className="grid gap-x-8 divide-y sm:grid-cols-2 sm:divide-y-0">
              <div className="divide-y">
                <Toggle label="Legal name" checked={f.showLegalName} onChange={(v) => set('showLegalName', v)} />
                <Toggle label="Branch address" checked={f.showBranchAddress} onChange={(v) => set('showBranchAddress', v)} />
                <Toggle label="Phone" checked={f.showPhone} onChange={(v) => set('showPhone', v)} />
                <Toggle label="Email" checked={f.showEmail} onChange={(v) => set('showEmail', v)} />
                <Toggle label="Tax number" checked={f.showTaxNumber} onChange={(v) => set('showTaxNumber', v)} />
              </div>
              <div className="divide-y">
                <Toggle label="Served by (staff name)" checked={f.showServedBy} onChange={(v) => set('showServedBy', v)} />
                <Toggle label="Customer name" checked={f.showCustomer} onChange={(v) => set('showCustomer', v)} />
                <Toggle label="Patient name" checked={f.showPatient} onChange={(v) => set('showPatient', v)} />
                <Toggle label="Item codes (SKU)" checked={f.showItemCodes} onChange={(v) => set('showItemCodes', v)} />
                <Toggle label="Subtotal and tax lines" checked={f.showTaxLine} onChange={(v) => set('showTaxLine', v)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><div><CardTitle>Printing</CardTitle><CardDescription>Receipts print on the printer chosen in the print window; browsers remember it. To print without the window, start Chrome on the counter PC with <code className="text-xs">--kiosk-printing</code>.</CardDescription></div></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Toggle label="Print automatically after each counter sale" checked={f.autoPrint} onChange={(v) => set('autoPrint', v)} />
              <Field label="Copies" htmlFor="rc-c" hint="With 2 copies: customer copy and clinic copy">
                <NativeSelect id="rc-c" className="w-32" value={f.copies} onChange={(e) => set('copies', Number(e.target.value))}>
                  {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </NativeSelect>
              </Field>
            </CardContent>
          </Card>
        </fieldset>
      </div>

      <div className="xl:sticky xl:top-20 xl:self-start">
        <Card>
          <CardHeader>
            <div><CardTitle>Preview</CardTitle><CardDescription>Actual size on a {f.paperWidthMm} mm roll, with a sample sale.</CardDescription></div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="max-h-[62vh] overflow-y-auto rounded-md bg-muted/60 p-3">
              <ReceiptPreview data={data} ctx={draftCtx} logoUrl={draftLogo} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => print(data, { ctx: draftCtx, logoUrl: draftLogo })}><Printer /> Print test receipt</Button>
              {editable && (
                <>
                  <Button variant="ghost" disabled={!dirty} onClick={() => setF(strip(ctx.settings))}><RotateCcw /> Undo changes</Button>
                  <Button className="ml-auto" loading={save.isPending} disabled={!dirty || !f.title.trim()} onClick={() => { setError(null); save.mutate(); }}><Save /> Save</Button>
                </>
              )}
            </div>
            {ctx.settings.updatedByName && <p className="text-xs text-muted-foreground">Last saved by {ctx.settings.updatedByName}.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function ReceiptSettingsPage() {
  const q = useReceiptContext();
  return (
    <RequirePermission anyOf={['settings.manage']}>
      {q.isLoading ? <LoadingRows rows={6} /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <ReceiptSettingsForm ctx={q.data} />}
    </RequirePermission>
  );
}
