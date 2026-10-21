'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COUNTRIES, type CreateClinicInput, type PlatformClinic, type PlatformPlan, createClinicSchema } from '@vcms/shared';
import { AlertTriangle, Building2, CheckCircle2, ExternalLink, KeyRound, Loader2, Mail, PauseCircle, Plus, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { ClinicActionsMenu, CopyButton, OwnerAccessDialog, STATUS, StatusBadge, shortAddress, useClinicActions, type OwnerAccess } from '@/components/platform/clinic-ui';
import { SearchInput } from '@/components/search-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { limitText } from '@/components/platform/plan-ui';
import { useHostInfo } from '@/lib/host';
import { cn } from '@/lib/utils';

/** Suggests a web address from the clinic name: "Happy Paws Vet" → "happy-paws-vet". */
function suggestAddress(name: string) {
  const s = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '');
  return s.slice(0, 30).replace(/-+$/, '');
}

const EMPTY: CreateClinicInput = { name: '', slug: '', country: 'PK', branchName: 'Main branch', ownerName: '', ownerEmail: '', ownerAccess: 'TEMPORARY_PASSWORD', planId: null };

function AddClinicDialog({ open, onOpenChange, onOwnerAccess }: { open: boolean; onOpenChange: (o: boolean) => void; onOwnerAccess: (r: OwnerAccess) => void }) {
  const qc = useQueryClient();
  const baseDomain = useHostInfo().data?.baseDomain;
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get<PlatformPlan[]>('/platform/plans') });
  const available = (plans.data ?? []).filter((p) => p.isActive);
  const [v, setV] = useState<CreateClinicInput>(EMPTY);
  // undefined = not touched: the first available plan is chosen for the new clinic ('' = deliberately no plan).
  const [planChoice, setPlanChoice] = useState<string | undefined>(undefined);
  const planId = planChoice ?? available[0]?.id ?? '';
  const [addressEdited, setAddressEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof CreateClinicInput>(k: K, value: CreateClinicInput[K]) => setV((p) => ({ ...p, [k]: value }));

  const reset = () => {
    setV(EMPTY);
    setPlanChoice(undefined);
    setAddressEdited(false);
    setErrors({});
    setError(null);
  };

  const save = useMutation({
    mutationFn: (input: CreateClinicInput) => api.post<OwnerAccess & { temporaryPassword: string | null }>('/platform/clinics', input),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['platform-clinics'] });
      onOpenChange(false);
      reset();
      if (r.temporaryPassword) onOwnerAccess(r as OwnerAccess);
      else toast.success(`Setting up ${r.clinic.name}. The owner gets an email when it is ready.`);
    },
    onError: (e: Error) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      setError(e.message);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = createClinicSchema.safeParse({ ...v, planId: planId || null });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Add clinic</DialogTitle>
          <DialogDescription>Four things: the clinic’s name, its web address, and who the owner is. It is ready in about a minute.</DialogDescription>
        </DialogHeader>
        <form id="add-clinic" onSubmit={submit} className="grid gap-4" noValidate>
          {error && <FormError message={error} />}
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <Field label="Clinic name" htmlFor="c-name" required error={errors.name}>
              <Input
                id="c-name"
                value={v.name}
                onChange={(e) => {
                  set('name', e.target.value);
                  if (!addressEdited) set('slug', suggestAddress(e.target.value));
                }}
                autoFocus
              />
            </Field>
            <Field label="Country" htmlFor="c-country" required>
              <NativeSelect id="c-country" value={v.country} onChange={(e) => set('country', e.target.value as 'PK' | 'AU')}>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Web address" htmlFor="c-slug" required hint="Filled in from the name. Lowercase letters, numbers and hyphens; it cannot be changed later." error={errors.slug}>
            <div className="flex items-center gap-2">
              <Input
                id="c-slug"
                value={v.slug}
                onChange={(e) => { setAddressEdited(true); set('slug', e.target.value.toLowerCase()); }}
                autoCapitalize="none"
                spellCheck={false}
                placeholder="happy-paws"
              />
              {baseDomain && <span className="shrink-0 text-sm text-muted-foreground">.{baseDomain}</span>}
            </div>
          </Field>
          <Field label="Plan" htmlFor="c-plan" hint="What the clinic may use, and its staff and branch limits. You can change it later.">
            <NativeSelect id="c-plan" value={planId} onChange={(e) => setPlanChoice(e.target.value)} disabled={plans.isLoading}>
              {available.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {limitText(p.maxStaff).toLowerCase()} staff, {limitText(p.maxBranches).toLowerCase()} branch{p.maxBranches === 1 ? '' : 'es'}</option>
              ))}
              <option value="">No plan (no limits)</option>
            </NativeSelect>
          </Field>
          <fieldset className="grid gap-3 rounded-lg surface-flat p-3">
            <legend className="px-1 text-sm font-medium">Clinic owner</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name" htmlFor="c-owner" required error={errors.ownerName}>
                <Input id="c-owner" value={v.ownerName} onChange={(e) => set('ownerName', e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="c-email" required hint="They sign in with this." error={errors.ownerEmail}>
                <Input id="c-email" type="email" value={v.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} />
              </Field>
            </div>
            <div role="radiogroup" aria-label="How the owner gets access" className="grid gap-2 sm:grid-cols-2">
              {([
                ['TEMPORARY_PASSWORD', KeyRound, 'Give them a password', 'You get a ready-made message to send by WhatsApp or SMS.'],
                ['INVITATION', Mail, 'Email them a link', 'They choose their own password when the clinic is ready.'],
              ] as const).map(([value, Icon, title, text]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={v.ownerAccess === value}
                  onClick={() => set('ownerAccess', value)}
                  className={cn('flex items-start gap-3 rounded-lg surface-flat p-3 text-left text-sm transition-colors', v.ownerAccess === value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted')}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span><span className="block font-medium">{title}</span><span className="text-xs text-muted-foreground">{text}</span></span>
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="Main branch name" htmlFor="c-branch" required hint="Change it if the clinic has a branch name, e.g. Lahore — Gulberg. They can add more branches later." error={errors.branchName}>
            <Input id="c-branch" value={v.branchName} onChange={(e) => set('branchName', e.target.value)} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="add-clinic" loading={save.isPending}><Plus /> Add clinic</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Filter = 'ALL' | PlatformClinic['status'];

export default function PlatformClinicsPage() {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [access, setAccess] = useState<OwnerAccess | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const { run, pending } = useClinicActions(setAccess);
  const clinics = useQuery({
    queryKey: ['platform-clinics'],
    queryFn: () => api.get<PlatformClinic[]>('/platform/clinics'),
    // Watch clinics that are still being set up.
    refetchInterval: (query) => (query.state.data?.some((c) => c.status === 'PROVISIONING') ? 3000 : false),
  });

  const all = useMemo(() => clinics.data ?? [], [clinics.data]);
  const count = (s: PlatformClinic['status']) => all.filter((c) => c.status === s).length;
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((c) => (filter === 'ALL' || c.status === filter) && (!term || [c.name, c.slug, c.ownerName, c.ownerEmail].some((x) => x.toLowerCase().includes(term))));
  }, [all, q, filter]);

  const tiles: { key: Filter; label: string; value: number; icon: React.ReactNode; tone: string }[] = [
    { key: 'ALL', label: 'All clinics', value: all.length, icon: <Building2 className="h-4 w-4" />, tone: 'text-primary bg-primary/10' },
    { key: 'ACTIVE', label: 'Ready', value: count('ACTIVE'), icon: <CheckCircle2 className="h-4 w-4" />, tone: 'text-success bg-success/10' },
    { key: 'SUSPENDED', label: 'Paused', value: count('SUSPENDED'), icon: <PauseCircle className="h-4 w-4" />, tone: 'text-warning bg-warning/15' },
    { key: 'FAILED', label: 'Set-up failed', value: count('FAILED'), icon: <AlertTriangle className="h-4 w-4" />, tone: 'text-destructive bg-destructive/10' },
  ];

  return (
    <>
      <PageHeader title="Clinics" description="Each clinic has its own database and web address." actions={<Button onClick={() => setAdding(true)}><Plus /> Add clinic</Button>} />
      {all.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="Show clinics">
          {tiles.map((t) => {
            const active = filter === t.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(active && t.key !== 'ALL' ? 'ALL' : t.key)}
                className={cn('flex items-center gap-3 rounded-xl surface-flat p-3 text-left shadow-card transition-colors hover:border-primary/50', active && 'border-primary ring-1 ring-primary')}
              >
                <span className={cn('rounded-md p-2', t.tone)}>{t.icon}</span>
                <span><span className="block text-xl font-semibold leading-tight">{t.value}</span><span className="text-xs text-muted-foreground">{t.label}</span></span>
              </button>
            );
          })}
        </div>
      )}
      <Card>
        {all.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <SearchInput value={q} onChange={setQ} placeholder="Search by clinic, address or owner" className="max-w-sm flex-1" />
            {filter !== 'ALL' && <Button variant="ghost" size="sm" onClick={() => setFilter('ALL')}>Show all clinics</Button>}
          </div>
        )}
        {clinics.isLoading ? (
          <LoadingRows />
        ) : clinics.error ? (
          <ErrorState error={clinics.error} onRetry={() => clinics.refetch()} />
        ) : !all.length ? (
          <EmptyState icon={Building2} title="No clinics yet" description="Add the first clinic. It gets its own database and web address, ready in about a minute." action={<Button onClick={() => setAdding(true)}><Plus /> Add clinic</Button>} />
        ) : (
          <Table>
            <THead>
              <TR><TH>Clinic</TH><TH className="hidden sm:table-cell">Web address</TH><TH className="hidden md:table-cell">Plan</TH><TH>Status</TH><TH className="hidden md:table-cell">Owner</TH><TH className="hidden lg:table-cell">Added</TH><TH className="w-px"><span className="sr-only">Actions</span></TH></TR>
            </THead>
            <TBody>
              {rows.map((c) => (
                <TR key={c.id} data-clickable="true" onClick={() => router.push(`/platform/clinics/${c.id}`)}>
                  <TD>
                    <div className="font-medium text-primary">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{COUNTRIES.find((x) => x.code === c.country)?.name ?? c.country}</div>
                    <div className="mt-0.5 break-all text-xs text-muted-foreground sm:hidden">{shortAddress(c.address)}</div>
                  </TD>
                  <TD className="hidden sm:table-cell">
                    <div className="flex items-center gap-1">
                      <span className="break-all">{shortAddress(c.address)}</span>
                      <CopyButton text={c.address} what="Address" />
                    </div>
                  </TD>
                  <TD className="hidden md:table-cell">
                    {c.planName ? <Badge variant="secondary">{c.planName}</Badge> : <span className="text-xs text-muted-foreground">No limits</span>}
                  </TD>
                  <TD>
                    <StatusBadge status={c.status} />
                    {c.status !== 'ACTIVE' && <p className="mt-1 max-w-[16rem] text-xs text-muted-foreground">{c.status === 'FAILED' && c.lastError ? c.lastError.split('\n')[0].slice(0, 120) : STATUS[c.status].hint}</p>}
                  </TD>
                  <TD className="hidden md:table-cell">
                    <div>{c.ownerName}</div>
                    <div className="text-xs text-muted-foreground">{c.ownerEmail}</div>
                  </TD>
                  <TD className="hidden lg:table-cell">{fmtDate(c.createdAt)}</TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {c.status === 'ACTIVE' && (
                        <Button asChild size="sm" variant="outline" className="hidden sm:inline-flex"><a href={`${c.address}/login`} target="_blank" rel="noreferrer"><ExternalLink /> Open</a></Button>
                      )}
                      {c.status === 'FAILED' && (
                        <Button size="sm" variant="outline" loading={pending?.id === c.id} onClick={() => run(c, 'retry')}><RotateCcw /> Try again</Button>
                      )}
                      {c.status === 'PROVISIONING' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Setting up" />}
                      <ClinicActionsMenu clinic={c} run={run} />
                    </div>
                  </TD>
                </TR>
              ))}
              {!rows.length && <TR><TD colSpan={7} className="py-8 text-center text-muted-foreground">No clinics match. <button type="button" className="text-primary hover:underline" onClick={() => { setQ(''); setFilter('ALL'); }}>Show all clinics</button></TD></TR>}
            </TBody>
          </Table>
        )}
      </Card>
      <AddClinicDialog open={adding} onOpenChange={setAdding} onOwnerAccess={setAccess} />
      <OwnerAccessDialog result={access} onClose={() => setAccess(null)} />
    </>
  );
}
