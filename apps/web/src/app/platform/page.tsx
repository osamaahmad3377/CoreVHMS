'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COUNTRIES, type CreateClinicInput, type PlatformClinic, createClinicSchema } from '@vcms/shared';
import { Building2, Check, Copy, ExternalLink, KeyRound, Mail, MoreHorizontal, Pause, Play, Plus, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { SearchInput } from '@/components/search-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, NativeSelect } from '@/components/ui/input';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useHostInfo } from '@/lib/host';
import { cn } from '@/lib/utils';

const STATUS: Record<PlatformClinic['status'], { label: string; variant: 'success' | 'info' | 'warning' | 'destructive' }> = {
  ACTIVE: { label: 'Ready', variant: 'success' },
  PROVISIONING: { label: 'Setting up…', variant: 'info' },
  SUSPENDED: { label: 'Paused', variant: 'warning' },
  FAILED: { label: 'Set-up failed', variant: 'destructive' },
};

interface OwnerPassword {
  clinic: PlatformClinic;
  temporaryPassword: string;
  expiresAt: string;
}

/** Suggests a web address from the clinic name: "Happy Paws Vet" → "happy-paws-vet". */
function suggestAddress(name: string) {
  const s = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '');
  return s.slice(0, 30).replace(/-+$/, '');
}

/** Shows the owner's temporary password once, with the clinic address to give them. */
function OwnerPasswordDialog({ result, onClose }: { result: OwnerPassword | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result!.temporaryPassword);
      setCopied(true);
    } catch {
      toast.error('Could not copy — select the password and copy it manually');
    }
  };
  return (
    <Dialog open={!!result} onOpenChange={(o) => { if (!o) { setCopied(false); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Owner’s temporary password</DialogTitle>
          <DialogDescription>Give these details to the clinic owner. The password is shown only now — it cannot be looked up later.</DialogDescription>
        </DialogHeader>
        {result && (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
              <code data-testid="temporary-password" className="flex-1 select-all break-all font-mono text-lg tracking-wide">{result.temporaryPassword}</code>
              <Button size="sm" variant="outline" onClick={copy}>{copied ? <><Check /> Copied</> : <><Copy /> Copy</>}</Button>
            </div>
            <dl className="grid gap-1 text-sm">
              <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">Clinic address</dt><dd className="break-all font-medium">{result.clinic.address}</dd></div>
              <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">Sign in with</dt><dd className="break-all font-medium">{result.clinic.ownerEmail}</dd></div>
              <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">Valid until</dt><dd>{fmtDateTime(result.expiresAt)}</dd></div>
            </dl>
            <p className="text-xs text-muted-foreground">At first sign-in the owner must choose their own password. They can then add their staff.</p>
          </div>
        )}
        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const EMPTY: CreateClinicInput = { name: '', slug: '', country: 'PK', branchName: '', ownerName: '', ownerEmail: '', ownerAccess: 'TEMPORARY_PASSWORD' };

function AddClinicDialog({ open, onOpenChange, onPassword }: { open: boolean; onOpenChange: (o: boolean) => void; onPassword: (r: OwnerPassword) => void }) {
  const qc = useQueryClient();
  const baseDomain = useHostInfo().data?.baseDomain;
  const [v, setV] = useState<CreateClinicInput>(EMPTY);
  const [addressEdited, setAddressEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof CreateClinicInput>(k: K, value: CreateClinicInput[K]) => setV((p) => ({ ...p, [k]: value }));

  const reset = () => {
    setV(EMPTY);
    setAddressEdited(false);
    setErrors({});
    setError(null);
  };

  const save = useMutation({
    mutationFn: (input: CreateClinicInput) => api.post<OwnerPassword & { temporaryPassword: string | null }>('/platform/clinics', input),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['platform-clinics'] });
      onOpenChange(false);
      reset();
      if (r.temporaryPassword) onPassword(r as OwnerPassword);
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
    const parsed = createClinicSchema.safeParse(v);
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
          <DialogDescription>The clinic gets its own database and web address. Set-up takes about a minute.</DialogDescription>
        </DialogHeader>
        <form id="add-clinic" onSubmit={submit} className="grid gap-4" noValidate>
          {error && <FormError message={error} />}
          <div className="grid gap-3 sm:grid-cols-2">
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
          <Field label="Web address" htmlFor="c-slug" required hint="Lowercase letters, numbers and hyphens. Cannot be changed later." error={errors.slug}>
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
          <Field label="Main branch name" htmlFor="c-branch" required hint="e.g. Lahore — Gulberg. More branches can be added later." error={errors.branchName}>
            <Input id="c-branch" value={v.branchName} onChange={(e) => set('branchName', e.target.value)} />
          </Field>
          <fieldset className="grid gap-3 rounded-md border p-3">
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
                ['TEMPORARY_PASSWORD', KeyRound, 'Create temporary password', 'You give it to the owner; they change it at first sign-in.'],
                ['INVITATION', Mail, 'Send invitation email', 'The owner gets a link to choose their password when the clinic is ready.'],
              ] as const).map(([value, Icon, title, text]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={v.ownerAccess === value}
                  onClick={() => set('ownerAccess', value)}
                  className={cn('flex items-start gap-3 rounded-md border p-3 text-left text-sm transition-colors', v.ownerAccess === value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted')}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span><span className="block font-medium">{title}</span><span className="text-xs text-muted-foreground">{text}</span></span>
                </button>
              ))}
            </div>
          </fieldset>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="add-clinic" loading={save.isPending}><Plus /> Add clinic</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PlatformClinicsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState<OwnerPassword | null>(null);
  const [q, setQ] = useState('');
  const clinics = useQuery({
    queryKey: ['platform-clinics'],
    queryFn: () => api.get<PlatformClinic[]>('/platform/clinics'),
    // Watch clinics that are still being set up.
    refetchInterval: (query) => (query.state.data?.some((c) => c.status === 'PROVISIONING') ? 3000 : false),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'suspend' | 'reactivate' | 'retry' | 'owner-password' }) => api.post<PlatformClinic | OwnerPassword>(`/platform/clinics/${id}/${action}`),
    onSuccess: (r, { action }) => {
      qc.invalidateQueries({ queryKey: ['platform-clinics'] });
      if (action === 'owner-password') setPassword(r as OwnerPassword);
      else toast.success({ suspend: 'Clinic paused', reactivate: 'Clinic reactivated', retry: 'Trying the set-up again' }[action]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pause = async (c: PlatformClinic) => {
    const { confirmed } = await confirm({
      title: `Pause ${c.name}?`,
      description: 'Nobody at this clinic can sign in or use the system until you reactivate it. No data is deleted.',
      confirmLabel: 'Pause clinic',
      destructive: true,
    });
    if (confirmed) act.mutate({ id: c.id, action: 'suspend' });
  };

  const ownerPassword = async (c: PlatformClinic) => {
    const { confirmed } = await confirm({
      title: `New password for ${c.ownerName}?`,
      description: `${c.ownerEmail} gets a new temporary password. Their current password and any open sign-ins stop working.`,
      confirmLabel: 'Create password',
    });
    if (confirmed) act.mutate({ id: c.id, action: 'owner-password' });
  };

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (clinics.data ?? []).filter((c) => !term || [c.name, c.slug, c.ownerName, c.ownerEmail].some((x) => x.toLowerCase().includes(term)));
  }, [clinics.data, q]);
  const count = (s: PlatformClinic['status']) => clinics.data?.filter((c) => c.status === s).length ?? 0;

  return (
    <>
      <PageHeader
        title="Clinics"
        description={clinics.data ? `${count('ACTIVE')} ready${count('SUSPENDED') ? `, ${count('SUSPENDED')} paused` : ''}${count('PROVISIONING') ? `, ${count('PROVISIONING')} setting up` : ''}. Each clinic has its own database and web address.` : 'Each clinic has its own database and web address.'}
        actions={<Button onClick={() => setAdding(true)}><Plus /> Add clinic</Button>}
      />
      <Card>
        {(clinics.data?.length ?? 0) > 5 && (
          <div className="border-b p-3"><SearchInput value={q} onChange={setQ} placeholder="Search clinics, addresses or owners" className="max-w-sm" /></div>
        )}
        {clinics.isLoading ? (
          <LoadingRows />
        ) : clinics.error ? (
          <ErrorState error={clinics.error} onRetry={() => clinics.refetch()} />
        ) : !clinics.data?.length ? (
          <EmptyState icon={Building2} title="No clinics yet" description="Add the first clinic. It gets its own database and web address." action={<Button onClick={() => setAdding(true)}><Plus /> Add clinic</Button>} />
        ) : (
          <Table>
            <THead>
              <TR><TH>Clinic</TH><TH className="hidden sm:table-cell">Web address</TH><TH>Status</TH><TH className="hidden md:table-cell">Owner</TH><TH className="hidden lg:table-cell">Added</TH><TH className="w-10"><span className="sr-only">Actions</span></TH></TR>
            </THead>
            <TBody>
              {rows.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{COUNTRIES.find((x) => x.code === c.country)?.name ?? c.country} · {c.databaseName}</div>
                    <div className="mt-0.5 break-all text-xs text-muted-foreground sm:hidden">{c.address.replace(/^https?:\/\//, '')}</div>
                  </TD>
                  <TD className="hidden sm:table-cell">
                    {c.status === 'ACTIVE' ? (
                      <a href={c.address} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-primary hover:underline">{c.address.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3 shrink-0" /></a>
                    ) : (
                      <span className="break-all text-muted-foreground">{c.address.replace(/^https?:\/\//, '')}</span>
                    )}
                  </TD>
                  <TD>
                    <Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
                    {c.status === 'FAILED' && c.lastError && <p className="mt-1 max-w-xs truncate text-xs text-destructive" title={c.lastError}>{c.lastError}</p>}
                  </TD>
                  <TD className="hidden md:table-cell">
                    <div>{c.ownerName}</div>
                    <div className="text-xs text-muted-foreground">{c.ownerEmail}</div>
                  </TD>
                  <TD className="hidden lg:table-cell">{fmtDate(c.createdAt)}</TD>
                  <TD>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}><MoreHorizontal /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {c.status === 'ACTIVE' && (
                          <>
                            <DropdownMenuItem asChild><a href={`${c.address}/login`} target="_blank" rel="noreferrer"><ExternalLink /> Open sign-in page</a></DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => ownerPassword(c)}><KeyRound /> New owner password</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => pause(c)}><Pause /> Pause clinic</DropdownMenuItem>
                          </>
                        )}
                        {c.status === 'SUSPENDED' && <DropdownMenuItem onSelect={() => act.mutate({ id: c.id, action: 'reactivate' })}><Play /> Reactivate clinic</DropdownMenuItem>}
                        {c.status === 'FAILED' && <DropdownMenuItem onSelect={() => act.mutate({ id: c.id, action: 'retry' })}><RotateCcw /> Try set-up again</DropdownMenuItem>}
                        {c.status === 'PROVISIONING' && <DropdownMenuItem disabled>Setting up — please wait</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TD>
                </TR>
              ))}
              {!rows.length && <TR><TD colSpan={6} className="py-8 text-center text-muted-foreground">No clinics match “{q}”.</TD></TR>}
            </TBody>
          </Table>
        )}
      </Card>
      <AddClinicDialog open={adding} onOpenChange={setAdding} onPassword={setPassword} />
      <OwnerPasswordDialog result={password} onClose={() => setPassword(null)} />
    </>
  );
}
