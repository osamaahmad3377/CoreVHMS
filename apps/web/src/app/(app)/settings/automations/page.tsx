'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AutomationTrigger } from '@vcms/shared';
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Clock, HeartPulse, Mail, Megaphone, MessageCircle, RotateCcw, Send, Sparkles, Square, Workflow, XCircle, Zap } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { AutomationCard, CARE_RECIPES, Kpi, RecipeGallery, type AutomationRow } from '@/components/automations/automation-cards';
import { CreateChooser } from '@/components/automations/create-chooser';
import { type AutomationOptions } from '@/components/automations/describe';
import { TemplateGallery, useTemplates } from '@/components/automations/templates';
import { TRIGGER_ICONS } from '@/components/automations/flow-ui';
import { EmptyState, ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePlanUsage } from '@/hooks/use-plan-usage';
import { NativeSelect } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUrlState } from '@/hooks/use-url-state';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

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


const RUN_STATUS: Record<Run['status'], { label: string; dot: string; badge: 'success' | 'warning' | 'destructive' | 'secondary' | 'default' }> = {
  WAITING: { label: 'Waiting', dot: 'bg-primary', badge: 'default' },
  RUNNING: { label: 'Running', dot: 'bg-primary', badge: 'default' },
  DONE: { label: 'Done', dot: 'bg-success', badge: 'success' },
  SKIPPED: { label: 'Not sent', dot: 'bg-warning', badge: 'warning' },
  FAILED: { label: 'Failed', dot: 'bg-destructive', badge: 'destructive' },
  STOPPED: { label: 'Stopped', dot: 'bg-muted-foreground', badge: 'secondary' },
};


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

function ActivityList({ automationId }: { automationId?: string }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'' | Run['status']>('');
  const qs = new URLSearchParams({ ...(automationId ? { automationId } : {}), ...(status ? { status } : {}) }).toString();
  const q = useQuery({ queryKey: ['automation-runs', automationId, status], queryFn: () => api.get<{ data: Run[]; meta: { total: number } }>(`/automations/runs${qs ? `?${qs}` : ''}`), refetchInterval: 30_000 });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/automations/runs/${id}/retry`),
    onSuccess: () => {
      ['automation-runs', 'automation-problems', 'automation-stats'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success('Trying again — it continues from the step where it stopped');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const filter = (
    <div className="mb-3 flex items-center gap-2">
      <NativeSelect aria-label="Show" className="h-9 w-auto" value={status} onChange={(e) => setStatus(e.target.value as '' | Run['status'])}>
        <option value="">Everything</option>
        <option value="WAITING">Waiting</option>
        <option value="DONE">Done</option>
        <option value="SKIPPED">Not sent</option>
        <option value="FAILED">Failed</option>
        <option value="STOPPED">Stopped</option>
      </NativeSelect>
      {q.data && <span className="text-xs text-muted-foreground">{q.data.meta.total} in total</span>}
    </div>
  );
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
      <>
        {filter}
        <Card>
          <EmptyState icon={Activity} title="Nothing here" description="Each time an automation starts for a client, it appears here with every step it took." />
        </Card>
      </>
    );
  return (
    <>
    {filter}
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
                {r.status === 'FAILED' && (
                  <div>
                    <Button size="sm" variant="outline" loading={retry.isPending && retry.variables === r.id} onClick={() => retry.mutate(r.id)}>
                      <RotateCcw /> Try again
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
    </>
  );
}

interface Problem {
  automationId: string;
  name: string;
  trigger: AutomationTrigger | null;
  status: 'FAILED' | 'SKIPPED';
  reason: string;
  count: number;
  lastAt: string;
}

/** Health: what went wrong in the last 7 days, grouped by automation and reason, with what to do about it. */
function HealthPanel({ onShow }: { onShow: (automationId: string) => void }) {
  const q = useQuery({ queryKey: ['automation-problems'], queryFn: () => api.get<Problem[]>('/automations/problems?days=7'), refetchInterval: 60_000 });
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data!;
  if (!rows.length)
    return (
      <Card className="flex items-center gap-4 p-6">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-success/10 text-success"><CheckCircle2 className="h-6 w-6" /></span>
        <div>
          <p className="font-semibold">Everything is running smoothly</p>
          <p className="text-sm text-muted-foreground">No failed or unsent messages in the last 7 days.</p>
        </div>
      </Card>
    );
  const hint = (r: Problem) =>
    /agreed to marketing/.test(r.reason) ? 'Expected: these clients did not agree to offers.'
    : /asked not to receive/.test(r.reason) ? 'Expected: these clients asked for no messages.'
    : /template/i.test(r.reason) ? 'Link an approved WhatsApp template in Settings → WhatsApp.'
    : /not connected|switched off|not included/i.test(r.reason) ? 'Check Settings → WhatsApp or Email.'
    : r.status === 'FAILED' ? 'Fix the cause, then use “Try again” in Activity.'
    : '';
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b bg-warning/[0.07] px-5 py-3">
        <AlertTriangle className="h-4 w-4 text-warning" />
        <p className="text-sm font-semibold">{rows.reduce((n, r) => n + r.count, 0)} not sent or failed in the last 7 days</p>
      </div>
      <ul className="divide-y">
        {rows.map((r) => {
          const Icon = (r.trigger && TRIGGER_ICONS[r.trigger]) || Zap;
          return (
            <li key={`${r.automationId}${r.reason}${r.status}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', r.status === 'FAILED' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning')}>
                {r.status === 'FAILED' ? <XCircle className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1 basis-64">
                <p className="font-medium">{r.name} <Badge variant={r.status === 'FAILED' ? 'destructive' : 'warning'} className="ml-1">{r.count} {r.status === 'FAILED' ? 'failed' : 'not sent'}</Badge></p>
                <p className="text-sm text-muted-foreground">{r.reason}</p>
                {hint(r) && <p className="text-xs text-muted-foreground">{hint(r)}</p>}
              </div>
              <span className="text-xs text-muted-foreground">Last {fmtDateTime(r.lastAt)}</span>
              <Button size="sm" variant="ghost" onClick={() => onShow(r.automationId)}>See runs <ArrowRight /></Button>
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
  const stats = useQuery({ queryKey: ['automation-stats'], queryFn: () => api.get<Stats>('/automations/stats'), refetchInterval: 60_000 });
  const options = useQuery({ queryKey: ['automation-options'], queryFn: () => api.get<AutomationOptions>('/automations/options'), staleTime: 60_000 });
  const problems = useQuery({ queryKey: ['automation-problems'], queryFn: () => api.get<Problem[]>('/automations/problems?days=7'), staleTime: 60_000 });
  const plan = usePlanUsage();
  const templates = useTemplates();
  const myTemplates = (templates.data ?? []).filter((t) => !t.marketing).length;
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data!;
  const marketing = rows.filter((a) => a.marketing);
  const care = rows.filter((a) => !a.marketing);
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
            <CreateChooser kind="automation" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Zap} label="Active automations" value={s ? s.active : '—'} hint={s ? `${s.total} in total` : undefined} tone="bg-gradient-to-br from-primary to-brand-2" />
        <Kpi icon={Send} label="Messages sent · 30 days" value={s?.sent ?? '—'} tone="bg-gradient-to-br from-emerald-500 to-teal-600" />
        <Kpi icon={ClipboardList} label="Tasks created · 30 days" value={s?.tasks ?? '—'} tone="bg-gradient-to-br from-amber-500 to-orange-600" />
        <Kpi icon={Clock} label="Waiting now" value={s?.waiting ?? '—'} hint={s?.problems ? `${s.problems} not sent in 30 days` : 'Nothing went wrong lately'} tone="bg-gradient-to-br from-sky-500 to-indigo-600" />
      </div>

      {(plan.automations.max !== null || plan.customAutomations.max !== null) && (
        <div className={cn('flex flex-wrap items-center gap-4 rounded-2xl p-4 ring-1 ring-inset sm:p-5', plan.automations.canAdd && plan.customAutomations.canAdd ? 'surface-flat ring-foreground/5' : 'bg-warning/10 ring-warning/30')}>
          <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white', plan.automations.canAdd && plan.customAutomations.canAdd ? 'bg-gradient-to-br from-primary to-brand-2' : 'bg-gradient-to-br from-amber-500 to-orange-600')}>
            <Zap className="h-5 w-5" />
          </span>
          <div className="grid min-w-0 flex-1 basis-72 gap-3 sm:grid-cols-2">
            {([
              ['Ready-made automations on', plan.automations],
              ['Your own automations on', plan.customAutomations],
            ] as const).map(([label, u]) => (
              <div key={label} className="min-w-0">
                <p className="text-sm font-semibold">
                  {label}: {u.used ?? '—'} <span className="font-normal text-muted-foreground">of {u.max ?? 'unlimited'}</span>
                </p>
                {u.max !== null && (
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={u.max} aria-valuenow={u.used ?? 0}>
                    <div className={cn('h-full rounded-full', u.canAdd ? 'bg-primary' : 'bg-warning')} style={{ width: `${Math.min(100, ((u.used ?? 0) / u.max) * 100)}%` }} />
                  </div>
                )}
              </div>
            ))}
            <p className="text-sm text-muted-foreground sm:col-span-2">
              {plan.automations.canAdd && plan.customAutomations.canAdd
                ? `Your ${plan.plan ?? ''} plan: pick the ones that matter most. Upgrade your plan to switch on more.`
                : 'You have reached your plan’s limit. Switch one off to use a different one, or upgrade your plan to switch on more.'}
            </p>
          </div>
          <Button variant={plan.automations.canAdd && plan.customAutomations.canAdd ? 'outline' : 'default'} asChild>
            <Link href="/settings/plan">See plans</Link>
          </Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => url.set({ tab: v === 'mine' ? null : v, automation: null })}>
        <TabsList className="mb-4">
          <TabsTrigger value="mine">
            Your automations {care.length > 0 && <Badge variant="secondary">{care.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="recipes">
            Recipes <Badge variant="secondary">{CARE_RECIPES.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="templates">
            Your templates {myTemplates > 0 && <Badge variant="secondary">{myTemplates}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="health">
            <HeartPulse className="h-4 w-4" /> Health {problems.data && problems.data.length > 0 && <Badge variant="warning">{problems.data.reduce((n, r) => n + r.count, 0)}</Badge>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="mine" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          <Link href="/marketing" className="flex flex-wrap items-center gap-2 rounded-2xl bg-rose-500/[0.06] px-4 py-3 text-sm ring-1 ring-inset ring-rose-500/15 hover:bg-rose-500/10">
            <Megaphone className="h-4 w-4 text-rose-500" />
            {marketing.length ? <>{marketing.length} offer{marketing.length === 1 ? '' : 's'} and promotional automation{marketing.length === 1 ? '' : 's'} are managed in <b className="text-primary">Marketing</b>.</> : <>Offers, discounts and campaigns are in <b className="text-primary">Marketing</b>.</>}
            <ArrowRight className="ml-auto h-4 w-4 text-primary" />
          </Link>
          {care.length ? (
            care.map((a) => <AutomationCard key={a.id} a={a} options={options.data} full={a.recipeKey ? !plan.automations.canAdd : !plan.customAutomations.canAdd} />)
          ) : (
            <Card className="grid gap-5 p-6">
              <div>
                <p className="text-lg font-semibold">Start with a ready-made automation</p>
                <p className="text-sm text-muted-foreground">Open one, adjust the wording, and save. Nothing is sent until you do.</p>
              </div>
              <RecipeGallery existing={rows} compact />
              <div>
                <Button variant="outline" onClick={() => url.set({ tab: 'recipes' })}>
                  See all {CARE_RECIPES.length} recipes
                </Button>
              </div>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="recipes">
          <RecipeGallery existing={rows} />
        </TabsContent>
        <TabsContent value="templates" className="grid gap-4">
          <p className="text-sm text-muted-foreground">Your clinic’s own automations, saved to reuse. Save any automation as a template from its ⋯ menu or the editor; making a new one from it never changes the template.</p>
          <TemplateGallery marketing={false} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityList automationId={url.get('automation') || undefined} />
        </TabsContent>
        <TabsContent value="health">
          <HealthPanel onShow={(id) => url.set({ tab: 'activity', automation: id })} />
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
