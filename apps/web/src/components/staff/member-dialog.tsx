'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Copy, KeyRound, Mail } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Branch } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface Member {
  id: string;
  status: string;
  jobTitle: string | null;
  isClinician: boolean;
  professionalRegistration: string | null;
  user: { id: string; email: string; name: string; mfaEnabled: boolean; lastLoginAt: string | null; mustChangePassword?: boolean; temporaryPasswordExpiresAt?: string | null };
  roles: { id: string; name: string; key: string | null }[];
  branches: { id: string; name: string }[];
}
export interface TemporaryPassword { member: Member; temporaryPassword: string; expiresAt: string }

/** Shows a generated temporary password once, with what to tell the person. */
export function TemporaryPasswordDialog({ result, onClose }: { result: TemporaryPassword | null; onClose: () => void }) {
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

/** The roles most clinics use, shown first (system role keys); everything else sits under "More roles…". */
const COMMON_ROLES = ['veterinarian', 'nurse', 'receptionist', 'practice_manager', 'pharmacy', 'accountant'];
/** Choosing one of these roles ticks "This person is a vet". */
const VET_ROLES = new Set(['veterinarian', 'surgeon', 'field_vet']);

export interface Role {
  id: string;
  name: string;
  key: string | null;
  description: string | null;
  permissions: string[];
}

export function MemberDialog({ member, open, onOpenChange, onTemporaryPassword }: { member?: Member | null; open: boolean; onOpenChange: (o: boolean) => void; onTemporaryPassword: (r: TemporaryPassword) => void }) {
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
  // Many clinics have no staff email, so a temporary password is the default.
  const [method, setMethod] = useState<'invite' | 'password'>('password');
  const mine = new Set(session.permissions);
  const commonRank = (r: Role) => (r.key ? COMMON_ROLES.indexOf(r.key) : -1);
  const common = (roles.data ?? []).filter((r) => commonRank(r) >= 0).sort((a, b) => commonRank(a) - commonRank(b));
  const others = (roles.data ?? []).filter((r) => commonRank(r) < 0);
  const [showMore, setShowMore] = useState(() => !!member?.roles.some((r) => !r.key || !COMMON_ROLES.includes(r.key)));
  const toggleRole = (r: Role) => {
    const adding = !roleIds.includes(r.id);
    setRoleIds(adding ? [...roleIds, r.id] : roleIds.filter((x) => x !== r.id));
    if (adding && r.key && VET_ROLES.has(r.key)) setClinician(true);
  };
  const roleBox = (r: Role) => {
    const assignable = r.permissions.every((p) => mine.has(p));
    return (
      <label key={r.id} className={`flex items-start gap-2 rounded p-1.5 text-sm ${assignable ? 'hover:bg-muted' : 'opacity-50'}`} title={assignable ? r.description ?? '' : 'Gives access you do not have yourself'}>
        <Checkbox disabled={!assignable} checked={roleIds.includes(r.id)} onCheckedChange={() => toggleRole(r)} className="mt-0.5" />
        <span>{r.name}</span>
      </label>
    );
  };

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
          {!member && <DialogDescription>How will they sign in the first time? (Works for 7 days.)</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-4">
          {error && <FormError message={error} />}
          {!member && (
            <div role="radiogroup" aria-label="How they get access" className="grid gap-2 sm:grid-cols-2">
              {([
                ['password', KeyRound, 'Create temporary password', 'You give them a password; they change it the first time they sign in. No email needed.'],
                ['invite', Mail, 'Send invitation email', 'They get a link by email and set their own password.'],
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
            <Checkbox checked={isClinician} onCheckedChange={(v) => setClinician(v === true)} /> This person is a vet (can be booked and can sign medical notes)
          </label>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Roles *</legend>
            <div className="grid gap-1 rounded-md border p-2 sm:grid-cols-2">
              {common.map(roleBox)}
              {others.length > 0 && (
                <div className="sm:col-span-2">
                  <button type="button" aria-expanded={showMore} className="flex items-center gap-1 p-1.5 text-sm font-medium text-primary hover:underline" onClick={() => setShowMore((v) => !v)}>
                    <ChevronDown className={cn('h-4 w-4 transition-transform', showMore && 'rotate-180')} /> {showMore ? 'Fewer roles' : 'More roles…'}
                  </button>
                  {showMore && <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">{others.map(roleBox)}</div>}
                </div>
              )}
            </div>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Works at *</legend>
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

