'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AUTOMATION_RECIPES, TRIGGER_INFO, type AutomationDraft, type AutomationStep, type AutomationTrigger, type TriggerGroup } from '@vcms/shared';
import {
  Activity,
  AlertTriangle,
  BedDouble,
  Bell,
  Cake,
  CalendarX,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  FileText,
  Heart,
  Home,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pill,
  Plus,
  Receipt,
  Repeat,
  Scissors,
  Search,
  Send,
  Sparkles,
  Square,
  Syringe,
  Ticket,
  Trash2,
  UserPlus,
  Workflow,
  XCircle,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { conditionText, type AutomationOptions } from '@/components/automations/describe';
import { FlowChips, GROUP_TONE, TRIGGER_ICONS } from '@/components/automations/flow-ui';
import { useConfirm } from '@/components/confirm';
import { EmptyState, ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { PlanLockBadge, usePlanFeature } from '@/components/plan/upgrade';
import { usePlanUsage } from '@/hooks/use-plan-usage';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
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
interface Stats {
  total: number;
  active: number;
  waiting: number;
  runs: number;
  problems: number;
  sent: number;
  tasks: number;
}
interface Run {
  id: string;
  status: 'WAITING' | 'RUNNING' | 'DONE' | 'SKIPPED' | 'FAILED' | 'STOPPED';
  trigger: AutomationTrigger;
  createdAt: string;
  vars: Record<string, string>;
  log: { step: number; type: string; at: string; ok: boolean; note: string }[];
  error: string | null;
  automation: { name: string; trigger: string };
}

const RECIPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = { heart: Heart, bell: Bell, home: Home, 'calendar-x': CalendarX, 'user-plus': UserPlus, cake: Cake, syringe: Syringe, mail: Mail, receipt: Receipt, scissors: Scissors, bed: BedDouble, repeat: Repeat, ticket: Ticket, pill: Pill, 'file-text': FileText };
const GROUPS: TriggerGroup[] = ['Appointments', 'Clinical', 'Money', 'Clients & pets'];

const RUN_STATUS: Record<Run['status'], { label: string; dot: string; badge: 'success' | 'warning' | 'destructive' | 'secondary' | 'default' }> = {
  WAITING: { label: 'Waiting', dot: 'bg-primary', badge: 'default' },
  RUNNING: { label: 'Running', dot: 'bg-primary', badge: 'default' },
  DONE: { label: 'Done', dot: 'bg-success', badge: 'success' },
  SKIPPED: { label: 'Not sent', dot: 'bg-warning', badge: 'warning' },
  FAILED: { label: 'Failed', dot: 'bg-destructive', badge: 'destructive' },
  STOPPED: { label: 'Stopped', dot: 'bg-muted-foreground', badge: 'secondary' },
};

function Kpi({ icon: Icon, label, value, hint, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; hint?: string; tone: string }) {
  return (
    <Card className="relative overflow-hidden p-4 sm:p-5">
      <span aria-hidden className={cn('pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-25 blur-2xl', tone)} />
      <div className="relative flex items-center gap-3">
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm', tone)}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular tracking-tight">{value}</p>
        </div>
      </div>
      {hint && <p className="relative mt-2 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function Channels({ o }: { o?: AutomationOptions }) {
  if (!o) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className={cn('inline-flex items-center gap-2 rounded-pill px-3 py-1.5 ring-1 ring-inset', o.channels.whatsapp ? 'bg-[#25D366]/10 text-[#128C4B] ring-[#25D366]/30 dark:text-[#4ade80]' : 'bg-card/70 text-muted-foreground ring-foreground/10')}>
        <MessageCircle className="h-4 w-4" />
        {o.channels.whatsapp ? 'WhatsApp connected' : 'WhatsApp not connected'}
        {!o.channels.whatsapp && (
          <Link href="/settings/integrations/whatsapp" className="font-semibold text-primary hover:underline">
            Connect
          </Link>
        )}
      </span>
      <span className={cn('inline-flex max-w-full items-center gap-2 rounded-pill px-3 py-1.5 ring-1 ring-inset', o.channels.email.own ? 'bg-primary/[0.07] text-primary ring-primary/20' : 'bg-card/70 text-muted-foreground ring-foreground/10')}>
        <Mail className="h-4 w-4" />
        <span className="truncate">{o.channels.email.own ? o.channels.email.address : 'System email address'}</span>
        <Link href="/settings/integrations/email" className="whitespace-nowrap font-semibold text-primary hover:underline">
          {o.channels.email.own ? 'Change' : 'Use Gmail / Outlook'}
        </Link>
      </span>
    </div>
  );
}

function RecipeGallery({ existing, compact = false }: { existing: AutomationRow[]; compact?: boolean }) {
  const marketingOk = usePlanFeature('marketing');
  const [group, setGroup] = useState<TriggerGroup | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const used = new Set(existing.map((a) => a.name));
  const list = AUTOMATION_RECIPES.filter((r) => (group === 'ALL' || TRIGGER_INFO[r.automation.trigger].group === group) && (!q || `${r.automation.name} ${r.automation.description}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="grid gap-4">
      {!compact && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex flex-wrap gap-1 rounded-pill bg-foreground/[0.04] p-1" role="radiogroup" aria-label="Category">
            {(['ALL', ...GROUPS] as const).map((g) => (
              <button key={g} type="button" role="radio" aria-checked={group === g} onClick={() => setGroup(g)} className={cn('rounded-pill px-3 py-1.5 text-sm font-medium transition-all', group === g ? 'bg-card text-foreground shadow-sm ring-1 ring-foreground/10' : 'text-muted-foreground hover:text-foreground')}>
                {g === 'ALL' ? `All (${AUTOMATION_RECIPES.length})` : g}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:ml-auto sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search recipes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search recipes" />
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(compact ? list.slice(0, 6) : list).map((r) => {
          const Icon = RECIPE_ICONS[r.icon] ?? Workflow;
          const g = TRIGGER_INFO[r.automation.trigger].group;
          return (
            <Link key={r.key} href={`/settings/automations/new?recipe=${r.key}`} className="group">
              <Card className="flex h-full flex-col gap-3 p-5 transition-all group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:ring-1 group-hover:ring-primary/25">
                <div className="flex items-start justify-between gap-2">
                  <span className={cn('flex h-11 w-11 items-center justify-center rounded-2xl shadow-sm', GROUP_TONE[g].tile)}>
                    <Icon className="h-5 w-5" />
                  </span>
                  {used.has(r.automation.name) ? <Badge variant="secondary">Added</Badge> : r.automation.marketing && !marketingOk ? <PlanLockBadge /> : <Badge variant="outline">{g}</Badge>}
                </div>
                <div className="grid gap-1">
                  <p className="font-semibold leading-snug">{r.automation.name}</p>
                  <p className="text-sm text-muted-foreground">{r.automation.description}</p>
                </div>
                <FlowChips trigger={r.automation.trigger} steps={r.automation.steps as AutomationStep[]} className="mt-auto" />
                <span className="text-sm font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">Use this recipe →</span>
              </Card>
            </Link>
          );
        })}
      </div>
      {!list.length && <p className="py-6 text-center text-sm text-muted-foreground">No recipe matches.</p>}
    </div>
  );
}

function AutomationCard({ a, options, full }: { a: AutomationRow; options?: AutomationOptions; full?: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const router = useRouter();
  const info = TRIGGER_INFO[a.trigger];
  const TIcon = TRIGGER_ICONS[a.trigger] ?? Zap;
  const refresh = () => ['automations', 'automation-stats', 'automation-runs', 'clinic-plan'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const toggle = useMutation({
    mutationFn: (isActive: boolean) => api.patch(`/automations/${a.id}/active`, { isActive }),
    onSuccess: (_r, v) => {
      refresh();
      toast.success(v ? `“${a.name}” is on` : `“${a.name}” is off — runs already waiting will stop`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const duplicate = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/automations/${a.id}/duplicate`),
    onSuccess: (r) => {
      refresh();
      toast.success('Copy made (off) — adjust it and switch it on');
      router.push(`/settings/automations/${r.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/automations/${a.id}`),
    onSuccess: () => {
      refresh();
      toast.success('Automation deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const done = a.last30Days.DONE ?? 0;
  const problems = (a.last30Days.FAILED ?? 0) + (a.last30Days.SKIPPED ?? 0);
  const total = Object.values(a.last30Days).reduce((n, x) => n + x, 0);
  const conds = (a.conditions ?? []).map((c) => conditionText(c as never, options));
  return (
    <Card className={cn('group relative overflow-hidden transition-shadow hover:shadow-lg', !a.isActive && 'opacity-75')}>
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', a.isActive ? GROUP_TONE[info.group].dot : 'bg-foreground/10')} />
      <div className="grid gap-4 p-5 pl-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <Link href={`/settings/automations/${a.id}`} className="flex min-w-0 gap-4">
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm', a.isActive ? GROUP_TONE[info.group].tile : 'bg-foreground/[0.06] text-muted-foreground')}>
            <TIcon className="h-5 w-5" />
          </span>
          <div className="grid min-w-0 gap-2">
            <p className="flex flex-wrap items-center gap-2 font-semibold group-hover:underline">
              {a.name}
              {a.isActive ? <Badge variant="success">On</Badge> : <Badge variant="secondary">Off</Badge>}
              {a.marketing && <Badge variant="info">Promotional</Badge>}
            </p>
            <FlowChips trigger={a.trigger} steps={a.steps as AutomationStep[]} />
            {conds.length > 0 && <p className="text-xs text-muted-foreground">Only if: {conds.join(' · ')}</p>}
          </div>
        </Link>
        <div className="flex flex-wrap items-center gap-4 lg:justify-end">
          <div className="grid min-w-[160px] gap-1.5">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{total} in 30 days</span>
              {a.waiting > 0 && (
                <span className="flex items-center gap-1 font-medium text-primary">
                  <Clock className="h-3 w-3" /> {a.waiting} waiting
                </span>
              )}
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]" aria-label={`${done} done, ${problems} not sent`}>
              {total > 0 && <span className="bg-success" style={{ width: `${(done / total) * 100}%` }} />}
              {total > 0 && <span className="bg-warning" style={{ width: `${(problems / total) * 100}%` }} />}
            </div>
            <p className="text-xs text-muted-foreground">{a.lastRunAt ? `Last ${fmtDateTime(a.lastRunAt)}` : 'Not run yet'}</p>
          </div>
          <Switch checked={!!a.isActive} disabled={toggle.isPending || (!!full && !a.isActive)} title={full && !a.isActive ? 'Your plan’s automations are all switched on. Switch one off, or upgrade your plan.' : undefined} onCheckedChange={(v) => toggle.mutate(v)} aria-label={`${a.name} on or off`} />
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
              <DropdownMenuItem onSelect={() => duplicate.mutate()}>
                <Copy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => router.push(`/settings/automations?tab=activity&automation=${a.id}`)}>
                <Activity /> Activity
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onSelect={async () => {
                  const r = await confirm({ title: `Delete “${a.name}”?`, description: 'Runs waiting to continue are stopped. Messages already sent stay in the message log.', confirmLabel: 'Delete', destructive: true });
                  if (r.confirmed) remove.mutate();
                }}
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </Card>
  );
}

function ActivityList({ automationId }: { automationId?: string }) {
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
  if (!runs.length)
    return (
      <Card>
        <EmptyState icon={Activity} title="Nothing yet" description="Each time an automation starts for a client, it appears here with every step it took." />
      </Card>
    );
  return (
    <Card className="overflow-hidden">
      <ol>
        {runs.map((r, idx) => {
          const st = RUN_STATUS[r.status];
          const who = [r.vars.petName, r.vars.clientName].filter(Boolean).join(' · ');
          const TIcon = TRIGGER_ICONS[r.trigger as AutomationTrigger] ?? Zap;
          return (
            <li key={r.id} className={cn('grid grid-cols-[40px_minmax(0,1fr)] gap-3 px-5 py-4', idx > 0 && 'border-t border-foreground/[0.05]')}>
              <span className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-foreground/[0.05] text-muted-foreground">
                <TIcon className="h-4 w-4" />
                <span className={cn('absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ring-2 ring-card', st.dot)} />
              </span>
              <div className="grid min-w-0 gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{r.automation.name}</p>
                  <Badge variant={st.badge}>{st.label}</Badge>
                  {who && <span className="text-sm text-muted-foreground">{who}</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{fmtDateTime(r.createdAt)}</span>
                </div>
                <ol className="grid gap-1 text-sm">
                  {r.log.map((l, i) => {
                    const Icon = l.type === 'SEND_MESSAGE' ? Send : l.type === 'CREATE_TASK' ? ClipboardList : l.type === 'EMAIL_TEAM' ? Mail : l.type.startsWith('WAIT') ? Clock : CheckCircle2;
                    return (
                      <li key={i} className={cn('flex items-start gap-2', l.ok ? 'text-muted-foreground' : 'text-warning')}>
                        {l.ok ? <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                        <span>{l.type.startsWith('WAIT') ? `Waiting until ${fmtDateTime(l.note.replace('Waiting until ', ''))}` : l.note}</span>
                      </li>
                    );
                  })}
                  {r.error && r.status !== 'SKIPPED' && (
                    <li className="flex items-start gap-2 text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {r.error}
                    </li>
                  )}
                </ol>
                {r.status === 'WAITING' && (
                  <div>
                    <Button size="sm" variant="outline" loading={stop.isPending && stop.variables === r.id} onClick={() => stop.mutate(r.id)}>
                      <Square /> Stop this one
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function AutomationsPage() {
  const url = useUrlState();
  const tab = url.get('tab', 'mine');
  const q = useQuery({ queryKey: ['automations'], queryFn: () => api.get<AutomationRow[]>('/automations') });
  const stats = useQuery({ queryKey: ['automation-stats'], queryFn: () => api.get<Stats>('/automations/stats'), refetchInterval: 60_000 });
  const options = useQuery({ queryKey: ['automation-options'], queryFn: () => api.get<AutomationOptions>('/automations/options'), staleTime: 60_000 });
  const plan = usePlanUsage();
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data!;
  const s = stats.data;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-primary/[0.12] via-brand-2/[0.08] to-transparent p-6 ring-1 ring-inset ring-primary/10 sm:p-8">
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start gap-5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-brand-2 text-white shadow-lg">
            <Workflow className="h-7 w-7" />
          </span>
          <div className="min-w-0 flex-1 basis-72">
            <h2 className="text-2xl font-semibold tracking-tight">Automations</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Let the clinic follow up for you: when something happens, check the details, then message the client, wait, or give staff a task — automatically and politely.</p>
            <div className="mt-4">
              <Channels o={options.data} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => url.set({ tab: 'recipes' })}>
              <Sparkles /> Recipes
            </Button>
            <Button asChild>
              <Link href="/settings/automations/new">
                <Plus /> New automation
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Zap} label="Active automations" value={s ? s.active : '—'} hint={s ? `${s.total} in total` : undefined} tone="bg-gradient-to-br from-primary to-brand-2" />
        <Kpi icon={Send} label="Messages sent · 30 days" value={s?.sent ?? '—'} tone="bg-gradient-to-br from-emerald-500 to-teal-600" />
        <Kpi icon={ClipboardList} label="Tasks created · 30 days" value={s?.tasks ?? '—'} tone="bg-gradient-to-br from-amber-500 to-orange-600" />
        <Kpi icon={Clock} label="Waiting now" value={s?.waiting ?? '—'} hint={s?.problems ? `${s.problems} not sent in 30 days` : 'Nothing went wrong lately'} tone="bg-gradient-to-br from-sky-500 to-indigo-600" />
      </div>

      {plan.automations.max !== null && (
        <div className={cn('flex flex-wrap items-center gap-4 rounded-2xl p-4 ring-1 ring-inset sm:p-5', plan.automations.canAdd ? 'surface-flat ring-foreground/5' : 'bg-warning/10 ring-warning/30')}>
          <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white', plan.automations.canAdd ? 'bg-gradient-to-br from-primary to-brand-2' : 'bg-gradient-to-br from-amber-500 to-orange-600')}>
            <Zap className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 basis-64">
            <p className="font-semibold">
              {plan.automations.used ?? '—'} of {plan.automations.max} automations switched on{plan.plan ? ` · ${plan.plan} plan` : ''}
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-valuemin={0} aria-valuemax={plan.automations.max} aria-valuenow={plan.automations.used ?? 0}>
              <div className={cn('h-full rounded-full', plan.automations.canAdd ? 'bg-primary' : 'bg-warning')} style={{ width: `${Math.min(100, ((plan.automations.used ?? 0) / plan.automations.max) * 100)}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {plan.automations.canAdd ? 'Pick the ones that matter most to your clinic. Upgrade your plan to switch on more.' : 'You have reached your plan’s limit. Switch one off to use a different one, or upgrade your plan to switch on more.'}
            </p>
          </div>
          <Button variant={plan.automations.canAdd ? 'outline' : 'default'} asChild>
            <Link href="/settings/plan">See plans</Link>
          </Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => url.set({ tab: v === 'mine' ? null : v, automation: null })}>
        <TabsList className="mb-4">
          <TabsTrigger value="mine">
            Your automations {rows.length > 0 && <Badge variant="secondary">{rows.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="recipes">
            Recipes <Badge variant="secondary">{AUTOMATION_RECIPES.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="mine" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          {rows.length ? (
            rows.map((a) => <AutomationCard key={a.id} a={a} options={options.data} full={!plan.automations.canAdd} />)
          ) : (
            <Card className="grid gap-5 p-6">
              <div>
                <p className="text-lg font-semibold">Start with a ready-made automation</p>
                <p className="text-sm text-muted-foreground">Open one, adjust the wording, and save. Nothing is sent until you do.</p>
              </div>
              <RecipeGallery existing={rows} compact />
              <div>
                <Button variant="outline" onClick={() => url.set({ tab: 'recipes' })}>
                  See all {AUTOMATION_RECIPES.length} recipes
                </Button>
              </div>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="recipes">
          <RecipeGallery existing={rows} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityList automationId={url.get('automation') || undefined} />
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
