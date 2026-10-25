'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, ExternalLink, Megaphone, MonitorPlay, RefreshCw, Tablet } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { ErrorState, LoadingRows } from '@/components/page';
import { CopyButton } from '@/components/platform/clinic-ui';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

interface Room {
  branch: { id: string; name: string };
  displayEnabled: boolean;
  kioskEnabled: boolean;
  showPetNames: boolean;
  kioskWalkIns: boolean;
  announce: boolean;
  message: string;
  displayPath: string;
  kioskPath: string;
  updatedByName: string | null;
  rooms: string[];
}
type Draft = Pick<Room, 'displayEnabled' | 'kioskEnabled' | 'showPetNames' | 'kioskWalkIns' | 'announce' | 'message'>;
const draftOf = (r: Room): Draft => ({ displayEnabled: r.displayEnabled, kioskEnabled: r.kioskEnabled, showPetNames: r.showPetNames, kioskWalkIns: r.kioskWalkIns, announce: r.announce, message: r.message });

function Toggle({ label, text, checked, onChange }: { label: string; text: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-sm text-muted-foreground">{text}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

function DeviceLink({ icon: Icon, title, text, url, on }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string; url: string; on: boolean }) {
  return (
    <div className="grid gap-3 rounded-2xl surface-flat p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold">
            {title} {on ? <Badge variant="success">On</Badge> : <Badge variant="secondary">Off</Badge>}
          </span>
          <span className="block text-sm text-muted-foreground">{text}</span>
        </span>
      </div>
      <div className="flex gap-2">
        <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={`${title} link`} />
        <CopyButton text={url} what={`${title} link`} variant="outline" size="sm" label="Copy" />
        <Button variant="outline" size="sm" asChild>
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink /> Open
          </a>
        </Button>
      </div>
    </div>
  );
}

function BranchCard({ r }: { r: Room }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [d, setD] = useState<Draft>(draftOf(r));
  useEffect(() => setD(draftOf(r)), [r]);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(r));
  const save = useMutation({
    mutationFn: () => api.put<Room[]>(`/waiting-room/${r.branch.id}`, d),
    onSuccess: (rows) => {
      qc.setQueryData(['waiting-room'], rows);
      toast.success(`${r.branch.name}: saved`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const renew = useMutation({
    mutationFn: () => api.post<Room[]>(`/waiting-room/${r.branch.id}/new-links`),
    onSuccess: (rows) => {
      qc.setQueryData(['waiting-room'], rows);
      toast.success('New links made — open them again on the TV and the tablet');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{r.branch.name}</CardTitle>
          <CardDescription className="mt-1">Open each link once on its device; it stays signed in to this branch only.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-3 lg:grid-cols-2">
          <DeviceLink icon={MonitorPlay} title="TV screen" text="Shows “Token 12 → Room 2” with a chime, and who is waiting." url={`${origin}${r.displayPath}`} on={r.displayEnabled} />
          <DeviceLink icon={Tablet} title="Check-in tablet" text="Clients type their mobile number and get a token." url={`${origin}${r.kioskPath}`} on={r.kioskEnabled} />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="grid content-start gap-5">
            <Toggle label="TV screen on" text="Off: the screen shows “not available”." checked={d.displayEnabled} onChange={(v) => set('displayEnabled', v)} />
            <Toggle label="Read calls out loud" text="“Token number 12, please go to Room 2.”" checked={d.announce} onChange={(v) => set('announce', v)} />
            <Toggle label="Show pets’ names on the TV" text="Off: token numbers only, for privacy." checked={d.showPetNames} onChange={(v) => set('showPetNames', v)} />
          </div>
          <div className="grid content-start gap-5">
            <Toggle label="Check-in tablet on" text="Off: the tablet asks clients to see the front desk." checked={d.kioskEnabled} onChange={(v) => set('kioskEnabled', v)} />
            <Toggle label="Walk-ins at the tablet" text="Clients without an appointment can check in their animal." checked={d.kioskWalkIns} onChange={(v) => set('kioskWalkIns', v)} />
            <Field label="Message at the bottom of the TV (optional)" htmlFor={`wr-msg-${r.branch.id}`}>
              <Input id={`wr-msg-${r.branch.id}`} maxLength={200} placeholder="e.g. Emergencies are seen first. Thank you for your patience." value={d.message} onChange={(e) => set('message', e.target.value)} />
            </Field>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-foreground/[0.03] p-3 text-sm">
          <DoorOpen className="h-4 w-4 text-muted-foreground" />
          {r.rooms.length ? (
            <span>
              Rooms to call to: <strong>{r.rooms.join(', ')}</strong>
            </span>
          ) : (
            <span className="text-warning">No rooms yet — patients are called without a room.</span>
          )}
          <Link href="/settings/resources" className="ml-auto font-semibold text-primary hover:underline">
            Rooms & equipment
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="ghost"
            className="mr-auto"
            loading={renew.isPending}
            onClick={async () => {
              const c = await confirm({ title: 'Make new links?', description: 'The current TV and tablet links stop working at once. Use this if a link was shared by mistake.', confirmLabel: 'Make new links' });
              if (c.confirmed) renew.mutate();
            }}
          >
            <RefreshCw /> New links
          </Button>
          <Button variant="outline" disabled={!dirty} onClick={() => setD(draftOf(r))}>
            Undo
          </Button>
          <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WaitingRoomSettingsPage() {
  const q = useQuery({ queryKey: ['waiting-room'], queryFn: () => api.get<Room[]>('/waiting-room') });
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20" aria-hidden>
          <Megaphone className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight">Waiting room</h2>
          <p className="text-sm text-muted-foreground">Every check-in gets a token number. Press Call on the waiting list and the TV shows and reads out “Token 12 → Room 2”.</p>
        </div>
      </div>
      {q.data!.map((r) => (
        <BranchCard key={r.branch.id} r={r} />
      ))}
    </div>
  );
}

export default function WaitingRoomPage() {
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <WaitingRoomSettingsPage />
    </RequirePermission>
  );
}
