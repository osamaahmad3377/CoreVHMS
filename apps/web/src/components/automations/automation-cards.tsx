'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AUTOMATION_RECIPES, MARKETING_THEMES, TRIGGER_INFO, formatMoney, nextOfferDay, type AutomationDraft, type AutomationStep, type MarketingTheme, type TriggerGroup } from '@vcms/shared';
import {
  Activity,
  BookmarkPlus,
  History,
  RotateCcw,
  BedDouble,
  Bell,
  Cake,
  CalendarX,
  CheckCircle2,
  CalendarDays,
  Clock,
  Copy,
  FileText,
  CalendarCheck,
  Eye,
  Gift,
  Shield,
  Star,
  Stethoscope,
  Users,
  Wallet,
  Percent,
  Tag,
  Heart,
  Home,
  Mail,
  MoreHorizontal,
  Pencil,
  Pill,
  Receipt,
  Repeat,
  Scissors,
  Search,
  Send,
  Sparkles,
  Syringe,
  Ticket,
  Trash2,
  UserPlus,
  Workflow,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { conditionText, offerScheduleText, type AutomationOptions } from '@/components/automations/describe';
import { FlowChips, GROUP_TONE, TRIGGER_ICONS } from '@/components/automations/flow-ui';
import { SaveTemplateDialog } from '@/components/automations/templates';
import { useConfirm } from '@/components/confirm';
import { LoadingRows } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { PlanLockBadge, usePlanFeature } from '@/components/plan/upgrade';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSession } from '@/lib/session';
import { api } from '@/lib/api';
import { fmtDateOnly, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';


export interface AutomationRow extends AutomationDraft {
  id: string;
  runCount: number;
  lastRunAt: string | null;
  waiting: number;
  last30Days: Record<string, number>;
  updatedByName: string | null;
  /** The ready-made recipe it is (null = the clinic's own); plans limit the two separately. */
  recipeKey?: string | null;
  /** Approval (when the clinic requires it for marketing). */
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  approvalNote?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  version?: number;
}

export const RECIPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = { heart: Heart, bell: Bell, home: Home, 'calendar-x': CalendarX, 'user-plus': UserPlus, cake: Cake, syringe: Syringe, mail: Mail, receipt: Receipt, scissors: Scissors, bed: BedDouble, repeat: Repeat, ticket: Ticket, pill: Pill, 'file-text': FileText, tag: Tag, percent: Percent, gift: Gift, sparkles: Sparkles, shield: Shield, stethoscope: Stethoscope, star: Star, users: Users };
export const CARE_GROUPS: TriggerGroup[] = ['Appointments', 'Clinical', 'Money', 'Clients & pets'];
/** Promotional recipes and automations live in the Marketing tab; the others in "Your automations" and "Recipes". */
export const MARKETING_RECIPES = AUTOMATION_RECIPES.filter((r) => r.automation.marketing);
export const CARE_RECIPES = AUTOMATION_RECIPES.filter((r) => !r.automation.marketing);
export const today = () => new Date().toLocaleDateString('en-CA');

export function Kpi({ icon: Icon, label, value, hint, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; hint?: string; tone: string }) {
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

export function RecipeGallery({ existing, compact = false, recipes = CARE_RECIPES, filters = true, themes = false }: { existing: AutomationRow[]; compact?: boolean; recipes?: typeof AUTOMATION_RECIPES; filters?: boolean; themes?: boolean }) {
  const marketingOk = usePlanFeature('marketing');
  const [group, setGroup] = useState<TriggerGroup | 'ALL'>('ALL');
  const [theme, setTheme] = useState<MarketingTheme | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const used = new Set(existing.map((a) => a.name));
  const list = recipes.filter((r) => !themes || theme === 'ALL' || r.theme === theme).filter((r) => (group === 'ALL' || TRIGGER_INFO[r.automation.trigger].group === group) && (!q || `${r.automation.name} ${r.automation.description}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="grid gap-4">
      {themes && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex flex-wrap gap-1 rounded-pill bg-foreground/[0.04] p-1" role="radiogroup" aria-label="Theme">
            {(['ALL', ...MARKETING_THEMES] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={theme === t} onClick={() => setTheme(t)} className={cn('rounded-pill px-3 py-1.5 text-sm font-medium transition-all', theme === t ? 'bg-card text-foreground shadow-sm ring-1 ring-foreground/10' : 'text-muted-foreground hover:text-foreground')}>
                {t === 'ALL' ? `All (${recipes.length})` : t}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:ml-auto sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search campaigns" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search campaigns" />
          </div>
        </div>
      )}
      {!compact && filters && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex flex-wrap gap-1 rounded-pill bg-foreground/[0.04] p-1" role="radiogroup" aria-label="Category">
            {(['ALL', ...CARE_GROUPS] as const).map((g) => (
              <button key={g} type="button" role="radio" aria-checked={group === g} onClick={() => setGroup(g)} className={cn('rounded-pill px-3 py-1.5 text-sm font-medium transition-all', group === g ? 'bg-card text-foreground shadow-sm ring-1 ring-foreground/10' : 'text-muted-foreground hover:text-foreground')}>
                {g === 'ALL' ? `All (${recipes.length})` : g}
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
                  {used.has(r.automation.name) ? <Badge variant="secondary">Added</Badge> : r.automation.marketing && !marketingOk ? <PlanLockBadge /> : <Badge variant="outline">{r.theme ?? g}</Badge>}
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


export function AutomationCard({ a, options, full }: { a: AutomationRow; options?: AutomationOptions; full?: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const router = useRouter();
  const { can } = useSession();
  const [history, setHistory] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [asTemplate, setAsTemplate] = useState(false);
  const pending = a.approvalStatus === 'PENDING';
  const approve = useMutation({
    mutationFn: () => api.post(`/automations/${a.id}/approve`),
    onSuccess: () => {
      refresh();
      toast.success(`“${a.name}” approved and switched on`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const info = TRIGGER_INFO[a.trigger];
  const TIcon = TRIGGER_ICONS[a.trigger] ?? Zap;
  const refresh = () => ['automations', 'automation-stats', 'automation-runs', 'clinic-plan', 'marketing-overview'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
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
              {pending ? <Badge variant="warning">Waiting for approval</Badge> : a.approvalStatus === 'REJECTED' ? <Badge variant="destructive">Sent back</Badge> : a.isActive ? <Badge variant="success">On</Badge> : <Badge variant="secondary">Off</Badge>}
              {a.marketing && <Badge variant="info">Promotional</Badge>}
              {a.approvalStatus === 'APPROVED' && a.approvedByName && <span className="text-2xs font-normal text-muted-foreground">Approved by {a.approvedByName}</span>}
            </p>
            {a.approvalStatus === 'REJECTED' && a.approvalNote && <p className="text-xs text-destructive">Sent back by {a.approvedByName}: “{a.approvalNote}” — change it and save to send it for approval again.</p>}
            <FlowChips trigger={a.trigger} steps={a.steps as AutomationStep[]} />
            {info.timed === 'ON_DATE' && <OfferWhen a={a} />}
            {a.marketing && (a.runCount > 0 || a.lastRunAt) && <MarketingResults id={a.id} />}
            {conds.length > 0 && <p className="text-xs text-muted-foreground">{info.timed === 'ON_DATE' ? 'To' : 'Only if'}: {conds.join(' · ')}</p>}
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
          {pending && can('org.manage') && (
            <div className="flex gap-1.5">
              <Button size="sm" loading={approve.isPending} onClick={() => approve.mutate()}><CheckCircle2 /> Approve</Button>
              <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>Send back</Button>
            </div>
          )}
          <Switch checked={!!a.isActive} disabled={toggle.isPending || pending || (!!full && !a.isActive)} title={full && !a.isActive ? `Your plan’s ${a.recipeKey ? 'ready-made' : 'own'} automations are all switched on. Switch one off, or upgrade your plan.` : undefined} onCheckedChange={(v) => toggle.mutate(v)} aria-label={`${a.name} on or off`} />
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
              <DropdownMenuItem onSelect={() => setAsTemplate(true)}>
                <BookmarkPlus /> Save as template
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => router.push(`/settings/automations?tab=activity&automation=${a.id}`)}>
                <Activity /> Activity
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setHistory(true)}>
                <History /> Version history
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
      {history && <VersionHistory automationId={a.id} name={a.name} onClose={() => setHistory(false)} />}
      {asTemplate && <SaveTemplateDialog automation={a} onClose={() => setAsTemplate(false)} />}
      {rejecting && <SendBackDialog automationId={a.id} name={a.name} onClose={() => setRejecting(false)} />}
    </Card>
  );
}

interface Version {
  id: string;
  version: number;
  action: string;
  changedByName: string | null;
  createdAt: string;
  snapshot: { name: string; isActive: boolean; steps: AutomationStep[]; conditions: unknown[]; sendOn?: string | null; repeat?: string | null; endsOn?: string | null };
}

/** Every saved state of an automation: who did what and when, and "Restore" to put an earlier one back. */
export function VersionHistory({ automationId, name, onClose }: { automationId: string; name: string; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['automation-versions', automationId], queryFn: () => api.get<Version[]>(`/automations/${automationId}/versions`) });
  const restore = useMutation({
    mutationFn: (v: number) => api.post(`/automations/${automationId}/versions/${v}/restore`),
    onSuccess: (_r, v) => {
      ['automations', 'automation', 'automation-versions', 'marketing-overview'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`Version ${v} restored (saved as a new version)`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const versions = q.data ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" /> Version history</DialogTitle>
          <DialogDescription>Every change to “{name}”, newest first. Restoring an earlier version saves it as a new one — nothing is lost.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <LoadingRows rows={4} />
        ) : !versions.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No changes recorded yet. Changes made from now on appear here.</p>
        ) : (
          <ol className="grid max-h-[60vh] gap-2 overflow-y-auto pr-1">
            {versions.map((v, i) => {
              const msg = v.snapshot.steps.find((x) => x.type === 'SEND_MESSAGE') as Extract<AutomationStep, { type: 'SEND_MESSAGE' }> | undefined;
              return (
                <li key={v.id} className="flex items-start gap-3 rounded-2xl bg-foreground/[0.025] p-3 ring-1 ring-inset ring-foreground/[0.06]">
                  <span className="flex h-8 min-w-8 items-center justify-center rounded-xl bg-primary/10 px-2 text-xs font-bold text-primary">v{v.version}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold first-letter:uppercase">{v.action} {i === 0 && <Badge variant="secondary" className="ml-1">Current</Badge>}</p>
                    <p className="text-xs text-muted-foreground">{fmtDateTime(v.createdAt)}{v.changedByName ? ` · ${v.changedByName}` : ''}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {v.snapshot.name} · {v.snapshot.steps.length} step{v.snapshot.steps.length === 1 ? '' : 's'} · {v.snapshot.conditions.length} condition{v.snapshot.conditions.length === 1 ? '' : 's'}
                      {v.snapshot.sendOn ? ` · ${offerScheduleText({ sendOn: v.snapshot.sendOn, repeat: (v.snapshot.repeat ?? 'NONE') as never, endsOn: v.snapshot.endsOn ?? null })}` : ''}
                    </p>
                    {msg && <p className="mt-1 line-clamp-2 text-xs italic text-muted-foreground">“{msg.body}”</p>}
                  </div>
                  {i > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={restore.isPending && restore.variables === v.version}
                      onClick={async () => {
                        const r = await confirm({ title: `Restore version ${v.version}?`, description: 'The automation goes back to how it was then (saved as a new version). Promotional automations may need approval again.', confirmLabel: 'Restore' });
                        if (r.confirmed) restore.mutate(v.version);
                      }}
                    >
                      <RotateCcw /> Restore
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A manager sends a campaign back with what to change; it stays off until changed and approved. */
export function SendBackDialog({ automationId, name, onClose }: { automationId: string; name: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const send = useMutation({
    mutationFn: () => api.post(`/automations/${automationId}/reject`, { note }),
    onSuccess: () => {
      ['automations', 'marketing-overview'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`“${name}” sent back`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send “{name}” back</DialogTitle>
          <DialogDescription>Say what needs changing. It stays off; once changed and saved, it comes back to you for approval.</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} autoFocus maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Say when the offer ends, and use our new phone number" aria-label="What needs changing" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={note.trim().length < 3} loading={send.isPending} onClick={() => send.mutate()}>Send back</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


export interface Results {
  runs: { total: number; done: number; waiting: number; notSent: number };
  messages: { sent: number; delivered: number; read: number; failed: number; waiting: number };
  booked: number;
  revenueMinor: number;
}

/** How a promotional automation did: reached, read, booked within 14 days, paid within 30 days. */
export function MarketingResults({ id }: { id: string }) {
  const { currency } = useSession();
  const q = useQuery({ queryKey: ['automation-results', id], queryFn: () => api.get<Results>(`/automations/${id}/results`), staleTime: 60_000 });
  const r = q.data;
  if (!r) return null;
  const items: [React.ComponentType<{ className?: string }>, string, string][] = [
    [Send, `${r.messages.sent + r.messages.waiting}`, 'sent'],
    [Eye, `${r.messages.read}`, 'read'],
    [CalendarCheck, `${r.booked}`, 'booked'],
    [Wallet, formatMoney(r.revenueMinor, currency).replace(/\.00$/, ''), 'paid after'],
  ];
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Results">
      {items.map(([Icon, value, label]) => (
        <span key={label} className="inline-flex items-center gap-1 rounded-pill bg-foreground/[0.04] px-2.5 py-1 text-xs ring-1 ring-inset ring-foreground/[0.06]">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" /> <b className="tabular">{value}</b> <span className="text-muted-foreground">{label}</span>
        </span>
      ))}
      {r.runs.notSent > 0 && <span className="inline-flex items-center rounded-pill bg-warning/10 px-2.5 py-1 text-xs text-warning">{r.runs.notSent} not sent</span>}
    </div>
  );
}


/** An offer's schedule and its next send ("Next: 1 Dec 2026", or "Finished"). */
export function OfferWhen({ a }: { a: AutomationRow }) {
  const next = nextOfferDay({ sendOn: a.sendOn ?? null, repeat: a.repeat ?? 'NONE', endsOn: a.endsOn ?? null }, today());
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <CalendarDays className="h-3.5 w-3.5" />
      {offerScheduleText(a)}
      {a.isActive && next ? <Badge variant="default">Next: {next === today() ? 'today' : fmtDateOnly(next)}</Badge> : !next ? <Badge variant="secondary">Finished</Badge> : null}
    </p>
  );
}

