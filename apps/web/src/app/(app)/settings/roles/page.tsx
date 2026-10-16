'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Shield, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

interface Role {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  memberCount: number;
  permissions: string[];
}
interface Group {
  key: string;
  label: string;
  permissions: { permission: string; description: string }[];
}

function RoleEditor({ role, groups, onDone }: { role: Role | null; groups: Group[]; onDone: (id?: string) => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can, session } = useSession();
  const mine = useMemo(() => new Set(session.permissions), [session.permissions]);
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setPerms(new Set(role?.permissions ?? []));
    setError(null);
  }, [role]);

  const locked = role?.key === 'owner' || !can('roles.manage');
  const save = useMutation({
    mutationFn: () =>
      role
        ? api.patch<Role>(`/roles/${role.id}`, { name: role.isSystem ? undefined : name, description, permissions: [...perms] })
        : api.post<Role>('/roles', { name, description, permissions: [...perms] }),
    onSuccess: (r) => {
      toast.success('Role saved');
      qc.invalidateQueries({ queryKey: ['roles'] });
      onDone(r.id);
    },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/roles/${role!.id}`),
    onSuccess: () => {
      toast.success('Role deleted');
      qc.invalidateQueries({ queryKey: ['roles'] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = (p: string) => setPerms((s) => {
    const n = new Set(s);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    return n;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {role ? role.name : 'New custom role'} {role?.isSystem && <Badge variant="secondary">System</Badge>}
          {locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
        </CardTitle>
        {role && !role.isSystem && can('roles.manage') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              const r = await confirm({ title: `Delete role “${role.name}”?`, destructive: true, confirmLabel: 'Delete' });
              if (r.confirmed) remove.mutate();
            }}
          >
            <Trash2 /> Delete
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {error && <FormError message={error} />}
        {role?.key === 'owner' && <p className="text-sm text-muted-foreground">The owner role always holds every permission so the organization can never be locked out.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Role name" htmlFor="r-name" required>
            <Input id="r-name" value={name} disabled={locked || role?.isSystem} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="r-desc">
            <Textarea id="r-desc" rows={1} value={description} disabled={locked} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => (
            <fieldset key={g.key} className="rounded-md border p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</legend>
              <div className="grid gap-1.5">
                {g.permissions.map((p) => {
                  const grantable = mine.has(p.permission);
                  return (
                    <label key={p.permission} className={cn('flex items-start gap-2 text-sm', (!grantable || locked) && 'opacity-60')} title={grantable ? p.permission : 'You do not hold this permission'}>
                      <Checkbox className="mt-0.5" checked={perms.has(p.permission)} disabled={locked || !grantable} onCheckedChange={() => toggle(p.permission)} />
                      <span>
                        {p.description}
                        <span className="ml-1 font-mono text-2xs text-muted-foreground">{p.permission}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        {!locked && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onDone(role?.id)}>
              Reset
            </Button>
            <Button loading={save.isPending} disabled={!name.trim()} onClick={() => { setError(null); save.mutate(); }}>
              Save role
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function RolesPage() {
  const { can } = useSession();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/roles') });
  const groups = useQuery({ queryKey: ['permission-groups'], queryFn: () => api.get<Group[]>('/roles/permissions'), staleTime: Infinity });
  const [selected, setSelected] = useState<string | 'new' | null>(null);

  if (roles.isLoading || groups.isLoading) return <LoadingRows />;
  if (roles.error || groups.error) return <ErrorState error={roles.error ?? groups.error} onRetry={() => roles.refetch()} />;
  const list = roles.data!;
  const current = selected === 'new' ? null : list.find((r) => r.id === selected) ?? list[0];

  return (
    <RequirePermission anyOf={['roles.manage', 'users.read']}>
      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Roles</CardTitle>
            {can('roles.manage') && (
              <Button size="sm" variant="outline" onClick={() => setSelected('new')}>
                <Plus /> New
              </Button>
            )}
          </CardHeader>
          {list.length ? (
            <ul className="p-1">
              {list.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelected(r.id)}
                    className={cn('flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted', current?.id === r.id && selected !== 'new' && 'bg-muted font-medium')}
                  >
                    <span className="truncate">{r.name}</span>
                    <span className="text-xs text-muted-foreground">{r.memberCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Shield} title="No roles" />
          )}
        </Card>
        <RoleEditor role={selected === 'new' ? null : current ?? null} groups={groups.data!} onDone={(id) => setSelected(id ?? null)} />
      </div>
    </RequirePermission>
  );
}
