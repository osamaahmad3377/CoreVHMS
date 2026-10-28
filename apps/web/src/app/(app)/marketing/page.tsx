'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TRIGGER_INFO, formatMoney, nextOfferDay, type OfferRepeat } from '@vcms/shared';
import {
  BellOff,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Download,
  Eye,
  Layers,
  Mail,
  Megaphone,
  MessageCircle,
  PauseCircle,
  Play,
  Send,
  Settings2,
  Shield,
  ShieldCheck,
  Tag,
  UserMinus,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { Suspense, useMemo } from 'react';
import { toast } from 'sonner';
import { AutomationCard, MARKETING_RECIPES, RecipeGallery, today, type AutomationRow } from '@/components/automations/automation-cards';
import { CreateChooser } from '@/components/automations/create-chooser';
import { TemplateGallery } from '@/components/automations/templates';
import { hourLabel, offerScheduleText, type AutomationOptions } from '@/components/automations/describe';
import { BarChartCard } from '@/components/charts';
import { useConfirm } from '@/components/confirm';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { FeatureLockedPage, usePlanFeature } from '@/components/plan/upgrade';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/input';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePlanUsage } from '@/hooks/use-plan-usage';
import { useUrlState } from '@/hooks/use-url-state';
import { api } from '@/lib/api';
import { fmtDateOnly, fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

interface MarketingSettingsState {
  capDays: number | null;
  paused: boolean;
  approval: boolean;
}
interface Overview {
  days: number;
  campaigns: { total: number; active: number; pendingApproval: number };
  audience: { clients: number; consented: number };
  messages: { sent: number; delivered: number; read: number; failed: number };
  booked: number;
  revenueMinor: number;
  optOuts: number;
  weekly: { week: string; sent: number }[];
  byCampaign: { id: string; name: string; isActive: boolean; approvalStatus: string | null; trigger: string; sent: number; read: number; failed: number; booked: number; revenueMinor: number }[];
  settings: MarketingSettingsState;
}
interface OptOut {
  clientId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  how: string;
  at: string;
  offersOnAgain: boolean;
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');
const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function useMarketingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Partial<MarketingSettingsState>) => api.put<MarketingSettingsState>('/automations/marketing-settings', v),
    onSuccess: (_r, v) => {
      ['automation-options', 'marketing-overview', 'automations'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(
        v.paused !== undefined ? (v.paused ? 'All marketing paused — nothing promotional goes out' : 'Marketing resumed') : v.approval !== undefined ? (v.approval ? 'Campaigns now need a manager’s approval' : 'Campaigns no longer need approval') : 'Saved',
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function Stat({ icon: Icon, label, value, sub, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; sub?: React.ReactNode; tone: string }) {
  return (
    <Card className="relative overflow-hidden p-4">
      <span aria-hidden className={cn('pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl', tone)} />
      <div className="relative flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg text-white', tone)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        {label}
      </div>
      <p className="relative mt-2 text-2xl font-semibold tabular tracking-tight">{value}</p>
      {sub && <p className="relative mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

// ── Overview ──

function OverviewTab({ days, setDays }: { days: number; setDays: (d: number) => void }) {
  const { currency } = useSession();
  const q = useQuery({ queryKey: ['marketing-overview', days], queryFn: () => api.get<Overview>(`/automations/marketing/overview?days=${days}`), refetchInterval: 120_000 });
  const money = (m: number) => formatMoney(m, currency).replace(/\.00$/, '');
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data!;
  const chart = o.weekly.map((w) => ({ name: fmtDateOnly(w.week).replace(/ \d{4}$/, ''), value: w.sent }));
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Period</span>
        <NativeSelect aria-label="Period" className="h-9 w-auto" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last 12 months</option>
        </NativeSelect>
        <span className="ml-auto text-xs text-muted-foreground">Bookings within 14 days and payments within 30 days of a campaign reaching a client.</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat icon={Megaphone} label="Campaigns running" value={o.campaigns.active} sub={`${o.campaigns.total} in total${o.campaigns.pendingApproval ? ` · ${o.campaigns.pendingApproval} to approve` : ''}`} tone="bg-gradient-to-br from-pink-500 to-rose-600" />
        <Stat icon={Users} label="Can get offers" value={o.audience.consented.toLocaleString()} sub={`${pct(o.audience.consented, o.audience.clients)} of ${o.audience.clients.toLocaleString()} clients`} tone="bg-gradient-to-br from-primary to-brand-2" />
        <Stat icon={Send} label="Messages sent" value={o.messages.sent.toLocaleString()} sub={o.messages.failed ? `${o.messages.failed} failed` : 'None failed'} tone="bg-gradient-to-br from-sky-500 to-indigo-600" />
        <Stat icon={Eye} label="Read" value={pct(o.messages.read, o.messages.sent)} sub={`${o.messages.read.toLocaleString()} read · ${pct(o.messages.delivered, o.messages.sent)} delivered`} tone="bg-gradient-to-br from-emerald-500 to-teal-600" />
        <Stat icon={CalendarCheck} label="Booked after" value={o.booked.toLocaleString()} sub={`${pct(o.booked, o.messages.sent)} of messages`} tone="bg-gradient-to-br from-amber-500 to-orange-600" />
        <Stat icon={Wallet} label="Paid after" value={money(o.revenueMinor)} sub={`${o.optOuts} stopped offers`} tone="bg-gradient-to-br from-violet-500 to-purple-600" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Messages sent each week</CardTitle>
          </CardHeader>
          <CardContent>
            {chart.length ? (
              <div className="h-56">
                <BarChartCard data={chart} name="Sent" integers />
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">No campaign messages in this period yet.</p>
            )}
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Campaigns compared</CardTitle>
          </CardHeader>
          {o.byCampaign.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Campaign</TH>
                  <TH className="text-right">Sent</TH>
                  <TH className="hidden text-right sm:table-cell">Read</TH>
                  <TH className="text-right">Booked</TH>
                  <TH className="text-right">Paid after</TH>
                </TR>
              </THead>
              <TBody>
                {o.byCampaign.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <Link href={`/settings/automations/${c.id}`} className="font-medium text-primary hover:underline">{c.name}</Link>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {c.approvalStatus === 'PENDING' ? <Badge variant="warning">To approve</Badge> : c.isActive ? <Badge variant="success">On</Badge> : <Badge variant="secondary">Off</Badge>}
                        <span className="text-2xs text-muted-foreground">{TRIGGER_INFO[c.trigger as keyof typeof TRIGGER_INFO]?.label}</span>
                      </div>
                    </TD>
                    <TD className="text-right tabular">{c.sent}</TD>
                    <TD className="hidden text-right tabular sm:table-cell">{pct(c.read, c.sent)}</TD>
                    <TD className="text-right tabular">{c.booked}</TD>
                    <TD className="whitespace-nowrap text-right tabular">{money(c.revenueMinor)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <CardContent><p className="text-sm text-muted-foreground">No campaigns yet.</p></CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── Campaigns ──

function CampaignsTab({ rows, options }: { rows: AutomationRow[]; options?: AutomationOptions }) {
  const plan = usePlanUsage();
  const { can } = useSession();
  const mine = rows.filter((a) => a.marketing);
  const pending = mine.filter((a) => a.approvalStatus === 'PENDING');
  const others = mine.filter((a) => a.approvalStatus !== 'PENDING');
  const full = (a: AutomationRow) => (a.recipeKey ? !plan.automations.canAdd : !plan.customAutomations.canAdd);
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      {pending.length > 0 && (
        <div className="grid gap-3 rounded-[1.5rem] bg-warning/[0.07] p-4 ring-1 ring-inset ring-warning/25">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-warning" /> {pending.length} waiting for approval
            <span className="font-normal text-muted-foreground">{can('org.manage') ? '— approve to switch on, or send back with a note.' : '— a manager approves them.'}</span>
          </p>
          {pending.map((a) => <AutomationCard key={a.id} a={a} options={options} full={full(a)} />)}
        </div>
      )}
      <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your campaigns ({others.length})</h3>
      {others.length ? (
        others.map((a) => <AutomationCard key={a.id} a={a} options={options} full={full(a)} />)
      ) : (
        <Card>
          <EmptyState icon={Megaphone} title="No campaigns yet" description="Create your own with the campaign builder, or start from a ready-made one below. Nothing is sent until it is switched on." action={<Button asChild><Link href="/marketing/new"><Megaphone /> Create a campaign</Link></Button>} />
        </Card>
      )}
      <div id="templates" className="mt-2 grid scroll-mt-24 gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your templates</h3>
        <TemplateGallery marketing compact />
      </div>
      <div id="ready-made" className="mt-2 grid scroll-mt-24 gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">Ready-made campaigns</h3>
        <RecipeGallery existing={rows} recipes={MARKETING_RECIPES} filters={false} themes />
      </div>
    </div>
  );
}

// ── Calendar ──

function CalendarTab({ rows }: { rows: AutomationRow[] }) {
  const start = today();
  const end = plusDays(start, 60);
  const offers = rows.filter((a) => a.marketing && TRIGGER_INFO[a.trigger].timed === 'ON_DATE');
  const always = rows.filter((a) => a.marketing && TRIGGER_INFO[a.trigger].timed !== 'ON_DATE');
  const byDay = useMemo(() => {
    const map = new Map<string, AutomationRow[]>();
    for (const a of offers) {
      if (!a.isActive && a.approvalStatus !== 'PENDING') continue;
      const o = { sendOn: a.sendOn ?? null, repeat: (a.repeat ?? 'NONE') as OfferRepeat, endsOn: a.endsOn ?? null };
      let d = nextOfferDay(o, start);
      let guard = 0;
      while (d && d <= end && guard++ < 70) {
        map.set(d, [...(map.get(d) ?? []), a]);
        d = nextOfferDay(o, plusDays(d, 1));
      }
    }
    return [...map.entries()].sort(([x], [y]) => x.localeCompare(y));
  }, [offers, start, end]);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /> Next 60 days</CardTitle>
        </CardHeader>
        {byDay.length ? (
          <ol className="divide-y">
            {byDay.map(([day, list]) => {
              const d = new Date(`${day}T00:00:00`);
              return (
                <li key={day} className="flex gap-4 px-5 py-3.5">
                  <div className={cn('flex w-14 shrink-0 flex-col items-center rounded-2xl py-1.5 ring-1 ring-inset', day === start ? 'bg-rose-500 text-white ring-rose-500' : 'bg-foreground/[0.03] ring-foreground/10')}>
                    <span className="text-2xs font-semibold uppercase">{d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                    <span className="text-xl font-semibold leading-tight">{d.getDate()}</span>
                    <span className="text-2xs">{d.toLocaleDateString('en-GB', { month: 'short' })}</span>
                  </div>
                  <ul className="grid min-w-0 flex-1 content-center gap-1.5">
                    {list.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <Link href={`/settings/automations/${a.id}`} className="font-medium text-primary hover:underline">{a.name}</Link>
                        <span className="text-xs text-muted-foreground">{a.atHour != null ? hourLabel(Number(a.atHour)) : 'any time'}{a.repeat && a.repeat !== 'NONE' ? ` · ${a.repeat === 'WEEKLY' ? 'weekly' : 'monthly'}` : ''}</span>
                        {a.approvalStatus === 'PENDING' && <Badge variant="warning">Waiting for approval</Badge>}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        ) : (
          <CardContent><EmptyState icon={CalendarDays} title="Nothing scheduled" description="Offers you schedule appear here on the days they go out." action={<Button asChild><Link href="/marketing/new?type=date"><Tag /> Schedule an offer</Link></Button>} /></CardContent>
        )}
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> Always running</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {always.length ? (
            always.map((a) => (
              <Link key={a.id} href={`/settings/automations/${a.id}`} className="rounded-xl bg-foreground/[0.03] p-3 text-sm ring-1 ring-inset ring-foreground/[0.06] hover:bg-foreground/[0.05]">
                <span className="flex items-center gap-2 font-medium">{a.name} {a.isActive ? <Badge variant="success">On</Badge> : <Badge variant="secondary">Off</Badge>}</span>
                <span className="text-xs text-muted-foreground">When {TRIGGER_INFO[a.trigger].when}</span>
              </Link>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Promotional automations that run on events (like birthdays) appear here.</p>
          )}
          {offers.filter((a) => !nextOfferDay({ sendOn: a.sendOn ?? null, repeat: (a.repeat ?? 'NONE') as OfferRepeat, endsOn: a.endsOn ?? null }, start)).length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Finished: {offers.filter((a) => !nextOfferDay({ sendOn: a.sendOn ?? null, repeat: (a.repeat ?? 'NONE') as OfferRepeat, endsOn: a.endsOn ?? null }, start)).map((a) => `${a.name} (${offerScheduleText(a)})`).join(' · ')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Opt-outs ──

function OptOutsTab() {
  const q = useQuery({ queryKey: ['marketing-opt-outs'], queryFn: () => api.get<OptOut[]>('/automations/marketing/opt-outs') });
  const download = (rows: OptOut[]) => {
    const cell = (v: string | null) => (v == null ? '' : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [['Client', 'Email', 'Phone', 'How', 'When', 'Offers on again'], ...rows.map((r) => [r.name, r.email, r.phone, r.how, r.at.slice(0, 16).replace('T', ' '), r.offersOnAgain ? 'Yes' : 'No'])].map((r) => r.map(cell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stopped-offers.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  if (q.isLoading) return <LoadingRows rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data!;
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2"><UserMinus className="h-4 w-4 text-primary" /> Clients who stopped offers</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">From the link in an offer email or by replying STOP on WhatsApp. They still get reminders about their animals.</p>
        </div>
        {rows.length > 0 && <Button size="sm" variant="outline" onClick={() => download(rows)}><Download /> CSV</Button>}
      </CardHeader>
      {rows.length ? (
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH className="hidden md:table-cell">Contact</TH>
              <TH>How</TH>
              <TH>When</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR key={`${r.clientId}${i}`}>
                <TD>
                  {r.clientId ? <Link href={`/clients/${r.clientId}`} className="font-medium text-primary hover:underline">{r.name}</Link> : r.name}
                  {r.offersOnAgain && <Badge variant="success" className="ml-2">Agreed again</Badge>}
                </TD>
                <TD className="hidden text-sm text-muted-foreground md:table-cell">{[r.email, r.phone].filter(Boolean).join(' · ') || '—'}</TD>
                <TD className="text-sm">{r.how}</TD>
                <TD className="whitespace-nowrap text-sm">{fmtDateTime(r.at)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <CardContent><EmptyState icon={BellOff} title="Nobody has stopped offers" description="When a client uses the stop link or replies STOP, they appear here." /></CardContent>
      )}
    </Card>
  );
}

// ── Settings ──

function SettingsTab({ settings }: { settings?: MarketingSettingsState }) {
  const save = useMarketingSettings();
  const confirm = useConfirm();
  const { can } = useSession();
  const manager = can('org.manage');
  if (!settings) return <LoadingRows rows={4} />;
  const row = (icon: React.ReactNode, title: string, text: string, control: React.ReactNode, note?: string) => (
    <div className="flex flex-wrap items-start gap-4 p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">{icon}</span>
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="divide-y overflow-hidden">
        {row(
          <PauseCircle className="h-5 w-5" />,
          'Pause all marketing',
          'Stops every offer and promotional message at once — for example during a holiday or if something went wrong. Runs already started wait; nothing promotional goes out until you resume.',
          <Switch
            checked={settings.paused}
            disabled={!manager || save.isPending}
            aria-label="Pause all marketing"
            onCheckedChange={async (v) => {
              if (v) {
                const r = await confirm({ title: 'Pause all marketing?', description: 'No offer or promotional message goes out until you resume. Reminders and other messages are not affected.', confirmLabel: 'Pause marketing', destructive: true });
                if (!r.confirmed) return;
              }
              save.mutate({ paused: v });
            }}
          />,
          manager ? undefined : 'Only the clinic’s managers can pause or resume marketing.',
        )}
        {row(
          <ShieldCheck className="h-5 w-5" />,
          'Approval before sending',
          'A new or changed campaign stays off until a manager — not the person who made the change — approves it. Every approval is recorded.',
          <Switch checked={settings.approval} disabled={!manager || save.isPending} aria-label="Require approval" onCheckedChange={(v) => save.mutate({ approval: v })} />,
          manager ? 'Campaigns already running when you switch this on keep running.' : 'Only the clinic’s managers can change this.',
        )}
        {row(
          <Shield className="h-5 w-5" />,
          'Not too often',
          'However many campaigns run, each client gets at most one promotional message in this period. Those who already had one wait for the next send.',
          <NativeSelect aria-label="At most one offer per client" className="h-10 w-auto" value={settings.capDays == null ? '' : String(settings.capDays)} disabled={save.isPending} onChange={(e) => save.mutate({ capDays: e.target.value ? Number(e.target.value) : null })}>
            <option value="">No limit</option>
            {[3, 7, 14, 30].map((n) => <option key={n} value={n}>One every {n} days</option>)}
          </NativeSelect>,
        )}
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BellOff className="h-4 w-4 text-primary" /> Consent and opting out</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-muted-foreground">
          <p>Offers go only to active clients who agreed to marketing — the “Marketing allowed” tick on the client, or “News and offers” in their portal.</p>
          <ul className="grid gap-1.5">
            <li className="flex gap-2"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Every offer email ends with a one-click “stop offers” link.</li>
            <li className="flex gap-2"><MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#25D366]" /> On WhatsApp, offers end with “Reply STOP to stop offers”.</li>
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> Only offers stop — reminders about their animals carry on.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page ──

function MarketingPage() {
  const url = useUrlState();
  const tab = url.get('tab', 'overview');
  const days = Number(url.get('days', '30')) || 30;
  const marketingOk = usePlanFeature('marketing');
  const { can } = useSession();
  const save = useMarketingSettings();
  const q = useQuery({ queryKey: ['automations'], queryFn: () => api.get<AutomationRow[]>('/automations'), enabled: marketingOk });
  const options = useQuery({ queryKey: ['automation-options'], queryFn: () => api.get<AutomationOptions>('/automations/options'), staleTime: 60_000, enabled: marketingOk });
  if (!marketingOk) return <FeatureLockedPage feature="marketing" />;
  const rows = q.data ?? [];
  const settings = options.data?.marketing;
  const pending = rows.filter((a) => a.marketing && a.approvalStatus === 'PENDING').length;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Marketing"
        description="Offers, discounts and campaigns to clients who agreed to hear from you — with results, approvals and opt-outs in one place."
        actions={
          <>
            <Button variant="outline" asChild><Link href="/settings/automations"><Settings2 /> Automations</Link></Button>
            <CreateChooser kind="campaign" />
          </>
        }
      />
      {settings?.paused && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-destructive/[0.08] p-4 ring-1 ring-inset ring-destructive/20">
          <PauseCircle className="h-5 w-5 text-destructive" />
          <p className="min-w-0 flex-1 text-sm"><b>All marketing is paused.</b> No offer or promotional message goes out until it is resumed.</p>
          {can('org.manage') && <Button size="sm" loading={save.isPending} onClick={() => save.mutate({ paused: false })}><Play /> Resume</Button>}
        </div>
      )}
      <Tabs value={tab} onValueChange={(v) => url.set({ tab: v === 'overview' ? null : v })}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="campaigns">
            Campaigns {pending > 0 ? <Badge variant="warning">{pending} to approve</Badge> : rows.filter((a) => a.marketing).length > 0 && <Badge variant="secondary">{rows.filter((a) => a.marketing).length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="opt-outs">Opt-outs</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab days={days} setDays={(d) => url.set({ days: d === 30 ? null : String(d) })} />
        </TabsContent>
        <TabsContent value="campaigns">{q.isLoading ? <LoadingRows rows={5} /> : <CampaignsTab rows={rows} options={options.data} />}</TabsContent>
        <TabsContent value="calendar">{q.isLoading ? <LoadingRows rows={5} /> : <CalendarTab rows={rows} />}</TabsContent>
        <TabsContent value="opt-outs">
          <OptOutsTab />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab settings={settings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function MarketingRoute() {
  return (
    <RequirePermission anyOf={['settings.manage', 'integrations.manage']}>
      <Suspense>
        <MarketingPage />
      </Suspense>
    </RequirePermission>
  );
}
