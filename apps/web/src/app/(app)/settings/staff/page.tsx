'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit, KeyRound, Mail, MoreHorizontal, ShieldCheck, UserCheck, UserPlus, Users, UserX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { MemberDialog, TemporaryPasswordDialog, type Member, type TemporaryPassword } from '@/components/staff/member-dialog';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar } from '@/components/ui/misc';
import { Tip } from '@/components/ui/tooltip';
import { api, qs } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { useSession } from '@/lib/session';

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
