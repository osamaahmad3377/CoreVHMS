'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Edit, KeyRound, Mail, MoreHorizontal, ShieldCheck, UserCheck, UserPlus, Users, UserX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, NativeSelect } from '@/components/ui/input';
import { Avatar } from '@/components/ui/misc';
import { Tip } from '@/components/ui/tooltip';
import { api, qs } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSession } from '@/lib/session';
import type { Branch } from '@/lib/types';

interface Member {
  id: string;
  status: string;
  jobTitle: string | null;
  isClinician: boolean;
  professionalRegistration: string | null;
  user: { id: string; email: string; name: string; mfaEnabled: boolean; lastLoginAt: string | null; mustChangePassword?: boolean; temporaryPasswordExpiresAt?: string | null };
  roles: { id: string; name: string; key: string | null }[];
  branches: { id: string; name: string }[];
}
interface TemporaryPassword { member: Member; temporaryPassword: string; expiresAt: string }

/** Shows a generated temporary password once, with what to tell the person. */
function TemporaryPasswordDialog({ result, onClose }: { result: TemporaryPassword | null; onClose: () => void }) {
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
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Temporary password for {result?.member.user.name}</DialogTitle>
          <DialogDescription>Share it with them in person or by phone. It is shown only now — it cannot be looked up later.</DialogDescription>
        </DialogHeader>
        {result && (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
              <code data-testid="temporary-password" className="flex-1 select-all font-mono text-lg tracking-wide">{result.temporaryPassword}</code>
              <Button size="sm" variant="outline" onClick={copy}>{copied ? <><Check /> Copied</> : <><Copy /> Copy</>}</Button>
            </div>
            <dl className="grid gap-1 text-sm">
              <div className="flex gap-2"><dt className="w-28 text-muted-foreground">Sign in with</dt><dd className="font-medium">{result.member.user.email}</dd></div>
              <div className="flex gap-2"><dt className="w-28 text-muted-foreground">Valid until</dt><dd>{fmtDateTime(result.expiresAt)}</dd></div>
            </dl>
            <p className="text-xs text-muted-foreground">At first sign-in they must choose their own password; until then they cannot open anything else. If it expires unused, create a new one from the staff list.</p>
          </div>
        )}
        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Role {
  id: string;
  name: string;
  key: string | null;
  description: string | null;
  permissions: string[];
}

function MemberDialog({ member, open, onOpenChange, onTemporaryPassword }: { member?: Member | null; open: boolean; onOpenChange: (o: boolean) => void; onTemporaryPassword: (r: TemporaryPassword) => void }) {
  const qc = useQueryClient();
  const { session } = useSession();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/roles') });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api.get<Branch[]>('/branches') });
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [jobTitle, setJobTitle] = useState(member?.jobTitle ?? '');
  const [registration, setRegistration] = useState(member?.professionalRegistration ?? '');
  const [isClinician, setClinician] = useState(member?.isClinician ?? false);
  const [roleIds, setRoleIds] = useState<string[]>(member?.roles.map((r) => r.id) ?? []);
  const [branchIds, setBranchIds] = useState<string[]>(member?.branches.map((b) => b.id) ?? (session.branch ? [session.branch.id] : []));
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<'invite' | 'password'>('invite');
  const mine = new Set(session.permissions);

  const save = useMutation({
    mutationFn: () =>
      member
        ? api.patch(`/staff/${member.id}`, { roleIds, branchIds, jobTitle, isClinician, professionalRegistration: registration })
        : method === 'invite'
          ? api.post('/staff/invite', { email, name, roleIds, branchIds, jobTitle, isClinician })
          : api.post<TemporaryPassword>('/staff/with-temporary-password', { email, name, roleIds, branchIds, jobTitle, isClinician }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      onOpenChange(false);
      if (!member && method === 'password') onTemporaryPassword(r as TemporaryPassword);
      else toast.success(member ? 'Staff member updated' : `Invitation sent to ${email}`);
    },
    onError: (e: Error) => setError(e.message),
  });
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{member ? `Edit ${member.user.name}` : 'Add staff member'}</DialogTitle>
          {!member && <DialogDescription>Choose how they get access. Both expire after 7 days if unused.</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-4">
          {error && <FormError message={error} />}
          {!member && (
            <div role="radiogroup" aria-label="How they get access" className="grid gap-2 sm:grid-cols-2">
              {([
                ['invite', Mail, 'Send invitation email', 'They get a link by email and set their own password.'],
                ['password', KeyRound, 'Create temporary password', 'You share a generated password; they change it at first sign-in.'],
              ] as const).map(([value, Icon, title, text]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={method === value}
                  onClick={() => setMethod(value)}
                  className={cn('flex items-start gap-3 rounded-md border p-3 text-left text-sm transition-colors', method === value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted')}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span><span className="block font-medium">{title}</span><span className="text-xs text-muted-foreground">{text}</span></span>
                </button>
              ))}
            </div>
          )}
          {!member && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name" htmlFor="m-name" required>
                <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="m-email" required hint={method === 'password' ? 'Used to sign in. No email is sent.' : undefined}>
                <Input id="m-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Job title" htmlFor="m-title">
              <Input id="m-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            </Field>
            {member && (
              <Field label="Professional registration no." htmlFor="m-reg" hint="e.g. PVMC / AHPRA-equivalent board number">
                <Input id="m-reg" value={registration} onChange={(e) => setRegistration(e.target.value)} />
              </Field>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isClinician} onCheckedChange={(v) => setClinician(v === true)} /> Clinician (can be booked for appointments and sign clinical records)
          </label>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Roles *</legend>
            <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
              {roles.data?.map((r) => {
                const assignable = r.permissions.every((p) => mine.has(p));
                return (
                  <label key={r.id} className={`flex items-start gap-2 rounded p-1.5 text-sm ${assignable ? 'hover:bg-muted' : 'opacity-50'}`} title={assignable ? r.description ?? '' : 'Grants permissions you do not hold'}>
                    <Checkbox disabled={!assignable} checked={roleIds.includes(r.id)} onCheckedChange={() => toggle(roleIds, setRoleIds, r.id)} className="mt-0.5" />
                    <span>{r.name}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Branch access *</legend>
            <div className="flex flex-wrap gap-3">
              {branches.data?.filter((b) => b.isActive).map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={branchIds.includes(b.id)} onCheckedChange={() => toggle(branchIds, setBranchIds, b.id)} /> {b.name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!roleIds.length || !branchIds.length || (!member && (!email || name.length < 2))}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {member ? 'Save' : method === 'invite' ? <><Mail /> Send invitation</> : <><KeyRound /> Create account</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function StaffPage() {
  const { can, session } = useSession();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['staff', q], queryFn: () => api.get<Member[]>(`/staff${qs({ q })}`) });
  const [dlg, setDlg] = useState<{ open: boolean; member?: Member | null; key: number }>({ open: false, key: 0 });
  const [temp, setTemp] = useState<TemporaryPassword | null>(null);
  const confirm = useConfirm();
  const issue = useMutation({
    mutationFn: (m: Member) => api.post<TemporaryPassword>(`/staff/${m.id}/temporary-password`),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['staff'] }); setTemp(r); },
    onError: (e: Error) => toast.error(e.message),
  });
  const askIssue = async (m: Member) => {
    const c = await confirm({
      title: `Create a temporary password for ${m.user.name}?`,
      description: 'Their current password stops working and they are signed out everywhere. They must choose a new password when they sign in.',
      confirmLabel: 'Create temporary password',
    });
    if (c.confirmed) issue.mutate(m);
  };
  const askSuspend = async (m: Member) => {
    const c = await confirm({
      title: `Suspend ${m.user.name}?`,
      description: 'They are signed out immediately and cannot sign in until reactivated. Their records and history are kept.',
      confirmLabel: 'Suspend',
      destructive: true,
    });
    if (c.confirmed) act.mutate(() => api.patch(`/staff/${m.id}`, { status: 'SUSPENDED' }));
  };
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <RequirePermission anyOf={['users.read']}>
      <Card>
        <CardHeader className="flex-wrap">
          <CardTitle>Staff accounts</CardTitle>
          <div className="flex items-center gap-2">
            <SearchInput value={q} onChange={setQ} placeholder="Search staff" />
            {can('users.manage') && (
              <Button size="sm" onClick={() => setDlg({ open: true, member: null, key: Date.now() })}>
                <UserPlus /> Add staff
              </Button>
            )}
          </div>
        </CardHeader>
        <DataTable
          query={list}
          rowKey={(m) => m.id}
          empty={<EmptyState icon={Users} title="No staff found" />}
          columns={[
            {
              key: 'name',
              header: 'Name',
              cell: (m) => (
                <div className="flex max-w-[240px] items-center gap-2">
                  <Avatar name={m.user.name} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {m.user.name} {m.user.id === session.user.id && <span className="text-xs text-muted-foreground">(you)</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>
                  </div>
                </div>
              ),
            },
            {
              key: 'role',
              header: 'Roles',
              cell: (m) => (
                <div className="flex max-w-[200px] flex-wrap gap-1">
                  {m.roles.map((r) => (
                    <Badge key={r.id} variant="secondary" className="normal-case tracking-normal">
                      {r.name}
                    </Badge>
                  ))}
                </div>
              ),
            },
            {
              key: 'title',
              header: 'Job title',
              cell: (m) => (
                <div className="flex max-w-[180px] flex-wrap items-center gap-1 text-sm">
                  <span className="truncate">{m.jobTitle ?? '—'}</span>
                  {m.isClinician && <Badge variant="info" className="normal-case tracking-normal">Clinician</Badge>}
                </div>
              ),
            },
            {
              key: 'branches',
              header: 'Branches',
              className: 'whitespace-nowrap',
              cell: (m) =>
                m.branches.length <= 1 ? (
                  <span className="text-xs text-muted-foreground">{m.branches[0]?.name ?? '—'}</span>
                ) : (
                  <Tip label={m.branches.map((b) => b.name).join(', ')}>
                    <span tabIndex={0} className="cursor-default rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground underline decoration-dotted underline-offset-2">
                      {m.branches.length} branches
                    </span>
                  </Tip>
                ),
            },
            {
              key: 'security',
              header: 'Sign-in',
              className: 'whitespace-nowrap',
              cell: (m) => (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {m.user.mfaEnabled && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-label="MFA enabled" />}
                  {m.user.mustChangePassword ? (
                    <Badge variant="warning" className="normal-case tracking-normal" title={m.user.temporaryPasswordExpiresAt ? `Valid until ${fmtDateTime(m.user.temporaryPasswordExpiresAt)}` : undefined}>Temporary password</Badge>
                  ) : m.user.lastLoginAt ? `Seen ${fmtRelative(m.user.lastLoginAt)}` : 'Never signed in'}
                </span>
              ),
            },
            { key: 'status', header: 'Status', className: 'whitespace-nowrap', cell: (m) => <StatusBadge status={m.status} /> },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              className: 'w-10 text-right',
              cell: (m) => {
                if (!can('users.manage')) return null;
                const self = m.user.id === session.user.id;
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.user.name}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onSelect={() => setDlg({ open: true, member: m, key: Date.now() })}>
                        <Edit /> Edit roles &amp; details
                      </DropdownMenuItem>
                      {m.status === 'INVITED' && (
                        <DropdownMenuItem onSelect={() => act.mutate(() => api.post(`/staff/${m.id}/resend-invite`).then(() => toast.success('Invitation re-sent')))}>
                          <Mail /> Resend invitation
                        </DropdownMenuItem>
                      )}
                      {m.status !== 'SUSPENDED' && !self && (
                        <DropdownMenuItem disabled={issue.isPending} onSelect={() => askIssue(m)}>
                          <KeyRound /> Temporary password
                        </DropdownMenuItem>
                      )}
                      {m.status !== 'INVITED' && !self && (
                        <>
                          <DropdownMenuSeparator />
                          {m.status === 'ACTIVE' ? (
                            <DropdownMenuItem destructive onSelect={() => askSuspend(m)}>
                              <UserX /> Suspend
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => act.mutate(() => api.patch(`/staff/${m.id}`, { status: 'ACTIVE' }))}>
                              <UserCheck /> Reactivate
                            </DropdownMenuItem>
                          )}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              },
            },
          ]}
        />
      </Card>
      {dlg.open && <MemberDialog key={dlg.key} member={dlg.member} open={dlg.open} onOpenChange={(open) => setDlg((d) => ({ ...d, open }))} onTemporaryPassword={setTemp} />}
      <TemporaryPasswordDialog result={temp} onClose={() => setTemp(null)} />
    </RequirePermission>
  );
}
