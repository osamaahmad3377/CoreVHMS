'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { LoadingRows } from '@/components/page';
import { usePortal } from '@/components/portal/shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Input, NativeSelect } from '@/components/ui/input';
import { portalApi } from '@/lib/portal-api';

interface Prefs { remindersConsent: boolean; marketingConsent: boolean; preferredChannel: 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PHONE'; email: string | null; mobilePhone: string | null }

export default function PortalSettings() {
  const s = usePortal();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['portal', 'preferences'], queryFn: () => portalApi.get<Prefs>('/preferences') });
  const [p, setP] = useState<Prefs | null>(null);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  useEffect(() => { if (q.data) setP(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: () => portalApi.patch<Prefs>('/preferences', { remindersConsent: p!.remindersConsent, marketingConsent: p!.marketingConsent, preferredChannel: p!.preferredChannel }),
    onSuccess: (d) => { qc.setQueryData(['portal', 'preferences'], d); toast.success('Preferences saved'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const change = useMutation({
    mutationFn: () => portalApi.post('/auth/password', { current: pw.current, next: pw.next }),
    onSuccess: () => { setPw({ current: '', next: '', confirm: '' }); toast.success('Password changed. Other devices have been signed out.'); },
    onError: (e: Error) => setPwError(e.message),
  });
  const switchClinic = async (accessId: string) => {
    await portalApi.post('/auth/switch', { accessId });
    qc.clear();
    window.location.href = '/portal';
  };
  if (!p) return <LoadingRows />;
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card>
        <CardHeader><CardTitle>How we contact you</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <label className="flex items-center justify-between gap-3 text-sm"><span>Vaccination and appointment reminders<span className="block text-xs text-muted-foreground">Recommended — we only send reminders about your animals’ care.</span></span><Switch checked={p.remindersConsent} onCheckedChange={(v) => setP({ ...p, remindersConsent: v })} aria-label="Reminders" /></label>
          <label className="flex items-center justify-between gap-3 text-sm"><span>News and offers</span><Switch checked={p.marketingConsent} onCheckedChange={(v) => setP({ ...p, marketingConsent: v })} aria-label="News and offers" /></label>
          <Field label="Preferred way to contact you" htmlFor="pp-ch">
            <NativeSelect id="pp-ch" value={p.preferredChannel} onChange={(e) => setP({ ...p, preferredChannel: e.target.value as Prefs['preferredChannel'] })}>
              <option value="EMAIL">Email{p.email ? ` (${p.email})` : ''}</option>
              <option value="SMS">SMS{p.mobilePhone ? ` (${p.mobilePhone})` : ''}</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="PHONE">Phone call</option>
            </NativeSelect>
          </Field>
          <p className="text-xs text-muted-foreground">To change your email address or phone number, please contact the clinic.</p>
          <div><Button loading={save.isPending} onClick={() => save.mutate()}>Save preferences</Button></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Password</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {pwError && <div className="sm:col-span-3"><FormError message={pwError} /></div>}
          <Field label="Current password" htmlFor="pp-cur"><Input id="pp-cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="New password" htmlFor="pp-new"><Input id="pp-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="Confirm" htmlFor="pp-conf" error={pw.confirm && pw.confirm !== pw.next ? 'Does not match' : undefined}><Input id="pp-conf" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          <div className="sm:col-span-3"><Button variant="outline" disabled={!pw.current || !pw.next || pw.next !== pw.confirm} loading={change.isPending} onClick={() => { setPwError(null); change.mutate(); }}>Change password</Button></div>
        </CardContent>
      </Card>
      {s.clinics.length > 1 && (
        <Card>
          <CardHeader><CardTitle>Your clinics</CardTitle></CardHeader>
          <ul className="divide-y border-t">
            {s.clinics.map((c) => (
              <li key={c.accessId} className="flex items-center justify-between px-4 py-2.5 text-sm">{c.name}{c.name === s.clinic.name ? <span className="text-xs text-muted-foreground">Current</span> : <Button size="sm" variant="outline" onClick={() => switchClinic(c.accessId)}>Switch</Button>}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
