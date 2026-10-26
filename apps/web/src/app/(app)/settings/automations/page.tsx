'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AUTOMATION_RECIPES, TRIGGER_INFO, type AutomationDraft, type AutomationTrigger } from '@vcms/shared';
import {
  AlertTriangle,
  Bell,
  Cake,
  CalendarX,
  CheckCircle2,
  Clock,
  BedDouble,
  Heart,
  Home,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  Repeat,
  Scissors,
  Sparkles,
  Square,
  Syringe,
  Trash2,
  UserPlus,
  Workflow,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { toast } from 'sonner';
import { describeAutomation, type AutomationOptions } from '@/components/automations/describe';
import { useConfirm } from '@/components/confirm';
import { EmptyState, ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUrlState } from '@/hooks/use-url-state';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface AutomationRow extends AutomationDraft {
  id: string;
  runCount: number;
  lastRunAt: string | null;
  waiting: number;
  last30Days: Record<string, number>;
  updatedByName: string | null;
}
interface Run {
  id: string;
  status: 'WAITING' | 'RUNNING' | 'DONE' | 'SKIPPED' | 'FAILED' | 'STOPPED';
  trigger: AutomationTrigger;
  runAt: string;
  updatedAt: string;
  createdAt: string;
  vars: Record<string, string>;
  log: { step: number; type: string; at: string; ok: boolean; note: string }[];
  error: string | null;
  automation: { name: string };
}

const RECIPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = { heart: Heart, bell: Bell, home: Home, 'calendar-x': CalendarX, 'user-plus': UserPlus, cake: Cake, syringe: Syringe, mail: Mail, receipt: Receipt, scissors: Scissors, bed: BedDouble, repeat: Repeat };

const RUN_STATUS: Record<Run['status'], { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' | 'default' }> = {
  WAITING: { label: 'Waiting', variant: 'default' },
  RUNNING: { label: 'Running', variant: 'default' },
  DONE: { label: 'Done', variant: 'success' },
  SKIPPED: { label: 'Not sent', variant: 'warning' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  STOPPED: { label: 'Stopped', variant: 'secondary' },
};

function ChannelsBar({ o }: { o?: AutomationOptions }) {
  if (!o) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl surface-flat px-4 py-3 text-sm">
      <span className="flex items-center gap-2">
        <MessageCircle className={cn('h-4 w-4', o.channels.whatsapp ? 'text-[#25D366]' : 'text-muted-foreground')} />
        {o.channels.whatsapp ? 'WhatsApp connected' : <span className="text-muted-foreground">WhatsApp not connected</span>}
        {!o.channels.whatsapp && (
          <Link href="/settings/integrations/whatsapp" className="font-semibold text-primary hover:underline">
            Connect
          </Link>
        )}
      </span>
      <span className="flex items-center gap-2">
        <Mail className={cn('h-4 w-4', o.channels.email.own ? 'text-primary' : 'text-muted-foreground')} />
        {o.channels.email.own ? `Email from ${o.channels.email.address}` : <span className="text-muted-foreground">Email from the system address</span>}
        <Link href="/settings/integrations/email" className="font-semibold text-primary hover:underline">
          {o.channels.email.own ? 'Change' : 'Use your Gmail / Outlook'}
        </Link>
      </span>
      <span className="text-xs text-muted-foreground sm:ml-auto">“Best channel” = WhatsApp when connected, otherwise email — and always what the client asked for.</span>
    </div>
  );
}

function Recipes({ title, existing }: { title: string; existing: AutomationRow[] }) {
  const used = new Set(existing.map((a) => a.name));
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> {title}
          </CardTitle>
          <CardDescription className="mt-1">Open one, change the wording if you like, and save. Nothing is sent until you save it.</CardDescription>
        </div>
      </CardHeader>
      <div className="grid gap-3 p-4 pt-0 sm:grid-cols-2 xl:grid-cols-4">
        {AUTOMATION_RECIPES.map((r) => {
          const Icon = RECIPE_ICONS[r.icon] ?? Workflow;
          return (
            <Link key={r.key} href={`/settings/automations/new?recipe=${r.key}`} className="group grid content-start gap-2 rounded-2xl surface-flat p-4 transition-colors hover:border-primary hover:bg-primary/5">
              <span className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-brand-2/15 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                {used.has(r.automation.name) && <Badge variant="secondary">Added</Badge>}
              </span>
              <span className="font-semibold leading-snug">{r.automation.name}</span>
              <span className="text-xs text-muted-foreground">{r.automation.description}</span>
              <span className="text-2xs font-semibold uppercase tracking-wide text-primary opacity-0 transition-opacity group-hover:opacity-100">Use this →</span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

function AutomationList({ rows, options }: { rows: AutomationRow[]; options?: AutomationOptions }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const router = useRouter();
  const toggle = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) => api.patch(`/automations/${v.id}/active`, { isActive: v.isActive }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success(v.isActive ? 'Switched on' : 'Switched off — runs already waiting will stop');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/automations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Automation deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="grid gap-3">
      {rows.map((a) => {
        const info = TRIGGER_INFO[a.trigger];
        const sent = a.last30Days.DONE ?? 0;
        const problems = (a.last30Days.FAILED ?? 0) + (a.last30Days.SKIPPED ?? 0);
        return (
          <Card key={a.id} className={cn('flex flex-wrap items-center gap-4 p-4 sm:p-5', !a.isActive && 'opacity-70')}>
            <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', a.isActive ? 'bg-gradient-to-br from-primary to-brand-2 text-white' : 'bg-foreground/[0.06] text-muted-foreground')}>
              <Workflow className="h-5 w-5" />
            </span>
            <Link href={`/settings/automations/${a.id}`} className="min-w-0 flex-1 basis-72">
              <p className="flex flex-wrap items-center gap-2 font-semibold hover:underline">
                {a.name} <Badge variant="outline">{info.group}</Badge>
                {a.marketing && <Badge variant="info">Marketing</Badge>}
              </p>
              <p className="text-sm text-muted-foreground">{describeAutomation(a, options)}</p>
              <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <span>
                  {sent} done in 30 days{problems > 0 && <span className="text-warning"> · {problems} not sent</span>}
                </span>
                {a.waiting > 0 && (
                  <span className="flex items-center gap-1 text-primary">
                    <Clock className="h-3 w-3" /> {a.waiting} waiting
                  </span>
                )}
                {a.lastRunAt && <span>last {fmtDateTime(a.lastRunAt)}</span>}
              </p>
            </Link>
            <div className="flex items-center gap-2">
              <Switch checked={!!a.isActive} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate({ id: a.id, isActive: v })} aria-label={`${a.name} on or off`} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label={`More for ${a.name}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => router.push(`/settings/automations/${a.id}`)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => router.push(`/settings/automations?tab=activity&automation=${a.id}`)}>
                    <Clock /> Activity
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={async () => {
                      const r = await confirm({ title: `Delete “${a.name}”?`, description: 'Runs waiting to continue are stopped. Messages already sent stay in the message log.', confirmLabel: 'Delete', destructive: true });
                      if (r.confirmed) remove.mutate(a.id);
                    }}
                  >
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Activity({ automationId }: { automationId?: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['automation-runs', automationId], queryFn: () => api.get<{ data: Run[]; meta: { total: number } }>(`/automations/runs${automationId ? `?automationId=${automationId}` : ''}`), refetchInterval: 30_000 });
  const stop = useMutation({
    mutationFn: (id: string) => api.post(`/automations/runs/${id}/stop`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation-runs'] });
      toast.success('Stopped — nothing more will be sent for this one');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const runs = q.data!.data;
  if (!runs.length) return <Card><EmptyState icon={Clock} title="Nothing yet" description="Each time an automation starts for a client, it shows here with what it sent." /></Card>;
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-foreground/[0.05]">
        {runs.map((r) => {
          const st = RUN_STATUS[r.status];
          const who = [r.vars.petName, r.vars.clientName].filter(Boolean).join(' · ');
          return (
            <li key={r.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {r.automation.name} <Badge variant={st.variant}>{st.label}</Badge>
                  <span className="font-normal text-muted-foreground">{who}</span>
                </p>
                <ol className="mt-1 grid gap-0.5 text-xs">
                  {r.log.map((l, i) => (
                    <li key={i} className={cn('flex items-start gap-1.5', l.ok ? 'text-muted-foreground' : 'text-warning')}>
                      {l.ok ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-3 w-3 shrink-0" />}
                      {l.type === 'WAIT' ? `Waiting until ${fmtDateTime(l.note.replace('Waiting until ', ''))}` : l.note}
                    </li>
                  ))}
                  {r.error && r.status !== 'SKIPPED' && (
                    <li className="flex items-start gap-1.5 text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {r.error}
                    </li>
                  )}
                </ol>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground sm:flex-col sm:items-end">
                <span>{fmtDateTime(r.createdAt)}</span>
                {r.status === 'WAITING' && (
                  <Button size="sm" variant="outline" loading={stop.isPending && stop.variables === r.id} onClick={() => stop.mutate(r.id)}>
                    <Square /> Stop
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function AutomationsPage() {
  const url = useUrlState();
  const tab = url.get('tab', 'mine');
  const q = useQuery({ queryKey: ['automations'], queryFn: () => api.get<AutomationRow[]>('/automations') });
  const options = useQuery({ queryKey: ['automation-options'], queryFn: () => api.get<AutomationOptions>('/automations/options'), staleTime: 60_000 });
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data!;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20" aria-hidden>
          <Workflow className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight">Automations</h2>
          <p className="text-sm text-muted-foreground">Your own workflows: when something happens → only if… → send a message, wait, create a task for staff. Built-in confirmations are under Client notifications.</p>
        </div>
        <Button asChild>
          <Link href="/settings/automations/new">
            <Plus /> New automation
          </Link>
        </Button>
      </div>

      <ChannelsBar o={options.data} />

      <Tabs value={tab} onValueChange={(v) => url.set({ tab: v === 'mine' ? null : v, automation: null })}>
        <TabsList className="mb-4">
          <TabsTrigger value="mine">
            Your automations {rows.length > 0 && <Badge variant="secondary">{rows.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="mine" className="grid gap-6">
          {rows.length ? <AutomationList rows={rows} options={options.data} /> : null}
          <Recipes title={rows.length ? 'Add a ready-made one' : 'Start with a ready-made automation'} existing={rows} />
        </TabsContent>
        <TabsContent value="activity">
          <Activity automationId={url.get('automation') || undefined} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function AutomationsSettingsPage() {
  return (
    <RequirePermission anyOf={['settings.manage', 'integrations.manage']}>
      <Suspense>
        <AutomationsPage />
      </Suspense>
    </RequirePermission>
  );
}
