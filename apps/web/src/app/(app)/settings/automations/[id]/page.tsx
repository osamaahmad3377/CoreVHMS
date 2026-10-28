'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AUTOMATION_RECIPES,
  AUTOMATION_TRIGGERS,
  AUTOMATION_VARIABLES,
  CHECK_INFO,
  OFFER_REPEAT_LABELS,
  TRIGGER_DEFAULTS,
  TRIGGER_INFO,
  sampleVars,
  type AutomationCondition,
  type AutomationStep,
  type AutomationTrigger,
  type OfferRepeat,
  type TriggerGroup,
  nextOfferDay,
} from '@vcms/shared';
import { ArrowDown, ArrowLeft, ArrowUp, BookmarkPlus, CheckCircle2, ChevronDown, Clock, Copy, Filter, FlaskConical, History, ShieldCheck, Mail, MessageCircle, MoreHorizontal, Play, Plus, Save, Search, Send, Settings2, Sparkles, Trash2, Workflow, X, Zap } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { VersionHistory } from '@/components/automations/automation-cards';
import { AudienceCard, ConditionRow } from '@/components/automations/conditions';
import { conditionText, describeAutomation, hourLabel, offerScheduleText, type AutomationOptions } from '@/components/automations/describe';
import { EasyCreator } from '@/components/automations/easy-creator';
import { SaveTemplateDialog, type AutomationTemplate } from '@/components/automations/templates';
import { GROUP_TONE, STEP_META, TRIGGER_ICONS } from '@/components/automations/flow-ui';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/lib/api';
import { PlanLockBadge, UpgradeCard, usePlanFeature } from '@/components/plan/upgrade';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

type Step = AutomationStep & { key: string };
interface Draft {
  name: string;
  description: string;
  isActive: boolean;
  marketing: boolean;
  trigger: AutomationTrigger;
  offset: number | null;
  atHour: number | null;
  sendFromHour: number | null;
  sendToHour: number | null;
  cooldownDays: number | null;
  /** Offer on a date (YYYY-MM-DD). */
  sendOn: string | null;
  repeat: OfferRepeat | null;
  endsOn: string | null;
  conditions: AutomationCondition[];
  steps: Step[];
}
interface PreviewResult {
  example: { id: string; label: string; client: string | null } | null;
  conditionsMet: boolean;
  steps: { type: string; when?: string; channel?: string | null; recipient?: string | null; subject?: string | null; body?: string; title?: string; details?: string | null; note?: string | null }[];
}

const newKey = () => Math.random().toString(36).slice(2);
const withKeys = (steps: AutomationStep[]): Step[] => steps.map((s) => ({ ...s, key: newKey() }) as Step);
const GROUPS: TriggerGroup[] = ['Appointments', 'Clinical', 'Money', 'Clients & pets', 'Marketing'];
const localDay = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA');
const HOURS_BEFORE = [1, 2, 3, 6, 12, 24, 48, 72];
const DAYS_BEFORE = [0, 1, 2, 3, 7, 14, 30];
const DAYS_AFTER = [1, 3, 7, 14, 30, 60];
const MONTHS_SINCE = [3, 6, 9, 12, 18, 24];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const PAUSES = ['WAIT', 'WAIT_UNTIL', 'CHECK'];

function makeStep(type: AutomationStep['type'], trigger: AutomationTrigger): AutomationStep {
  switch (type) {
    case 'SEND_MESSAGE':
      return { type, channel: 'BEST', subject: TRIGGER_DEFAULTS[trigger].subject, body: TRIGGER_DEFAULTS[trigger].body };
    case 'WAIT':
      return { type, amount: 1, unit: 'DAYS' };
    case 'WAIT_UNTIL':
      return { type, hour: 10, skipDays: [] };
    case 'CHECK':
      return { type, check: TRIGGER_INFO[trigger].checks[0] ?? 'NOT_BOOKED' };
    case 'CREATE_TASK':
      return { type, title: TRIGGER_DEFAULTS[trigger].taskTitle, details: '', dueInDays: 0, assigneeId: null };
    case 'EMAIL_TEAM':
      return { type, to: '', subject: '', body: '' };
  }
}

const NO_OFFER = { sendOn: null, repeat: null, endsOn: null };
const blankDraft = (): Draft => ({ name: '', description: '', isActive: true, marketing: false, trigger: 'APPOINTMENT_COMPLETED', offset: null, atHour: null, sendFromHour: null, sendToHour: null, cooldownDays: null, ...NO_OFFER, conditions: [], steps: withKeys([makeStep('SEND_MESSAGE', 'APPOINTMENT_COMPLETED')]) });
/** A new offer: tomorrow at 10:00, valid for two weeks, to everyone who agreed to marketing. */
const offerDraft = (): Draft => ({ ...blankDraft(), marketing: true, trigger: 'SCHEDULED_OFFER', atHour: 10, sendFromHour: 9, sendToHour: 20, sendOn: localDay(1), repeat: 'NONE', endsOn: localDay(15), steps: withKeys([makeStep('SEND_MESSAGE', 'SCHEDULED_OFFER')]) });
const render = (text: string, vars: Record<string, string>) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');

// ───────────────────────────── Small pieces ─────────────────────────────

function VariableChips({ trigger, onInsert }: { trigger: AutomationTrigger; onInsert: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TRIGGER_INFO[trigger].variables.map((v) => (
        <button key={v} type="button" onClick={() => onInsert(`{{${v}}}`)} className="rounded-pill bg-primary/[0.08] px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary/15 transition-colors hover:bg-primary/15">
          {AUTOMATION_VARIABLES[v]?.label ?? v}
        </button>
      ))}
    </div>
  );
}

/** An input or text box with variable buttons that insert where the cursor is. */
function TextWithVars({ id, label, value, onChange, trigger, rows = 3, placeholder, required }: { id: string; label: string; value: string; onChange: (v: string) => void; trigger: AutomationTrigger; rows?: number; placeholder?: string; required?: boolean }) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const insert = (v: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    onChange(value.slice(0, at) + v + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + v.length, at + v.length);
    });
  };
  return (
    <Field label={label} htmlFor={id} required={required}>
      <div className="grid gap-2">
        {rows > 1 ? <Textarea id={id} ref={ref as React.Ref<HTMLTextAreaElement>} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /> : <Input id={id} ref={ref as React.Ref<HTMLInputElement>} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
        <VariableChips trigger={trigger} onInsert={insert} />
      </div>
    </Field>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-pill bg-foreground/[0.04] p-1">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cn('flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm font-medium transition-all', value === o.value ? 'bg-card text-foreground shadow-sm ring-1 ring-foreground/10' : 'text-muted-foreground hover:text-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────────── Step editors ─────────────────────────────

function MessageEditor({ s, trigger, set, options }: { s: Extract<AutomationStep, { type: 'SEND_MESSAGE' }>; trigger: AutomationTrigger; set: (p: Partial<AutomationStep>) => void; options?: AutomationOptions }) {
  const sample = sampleVars(trigger);
  const showSubject = s.channel === 'EMAIL' || s.channel === 'BEST';
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [target, setTarget] = useState<'subject' | 'body'>('body');
  const insert = (v: string) => {
    const toSubject = target === 'subject' && showSubject;
    const el = toSubject ? subjectRef.current : bodyRef.current;
    const value = (toSubject ? s.subject : s.body) ?? '';
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    set({ [toSubject ? 'subject' : 'body']: value.slice(0, at) + v + value.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + v.length, at + v.length);
    });
  };
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid content-start gap-4">
        <Segmented
          label="Channel"
          value={s.channel}
          onChange={(v) => set({ channel: v })}
          options={[
            { value: 'BEST', label: <><Sparkles className="h-3.5 w-3.5" /> Best channel</> },
            { value: 'WHATSAPP', label: <><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</> },
            { value: 'EMAIL', label: <><Mail className="h-3.5 w-3.5" /> Email</> },
          ]}
        />
        {s.channel === 'BEST' && <p className="-mt-2 text-xs text-muted-foreground">WhatsApp when connected, otherwise email — always what the client prefers.</p>}
        {s.channel === 'WHATSAPP' && options && !options.channels.whatsapp && <p className="-mt-2 text-xs text-warning">WhatsApp is not connected — these will not be sent until it is.</p>}
        {showSubject && (
          <Field label="Email subject" htmlFor={`subj-${trigger}`}>
            <Input id={`subj-${trigger}`} ref={subjectRef} value={s.subject ?? ''} placeholder="e.g. Thank you for visiting {{clinicName}}" onFocus={() => setTarget('subject')} onChange={(e) => set({ subject: e.target.value })} />
          </Field>
        )}
        <Field label="Message" htmlFor={`body-${trigger}`} required>
          <Textarea id={`body-${trigger}`} ref={bodyRef} rows={5} value={s.body} placeholder="Hello {{clientName}}, …" onFocus={() => setTarget('body')} onChange={(e) => set({ body: e.target.value })} />
        </Field>
        <div className="grid gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">Insert into the {target === 'subject' && showSubject ? 'subject' : 'message'}</p>
          <VariableChips trigger={trigger} onInsert={insert} />
        </div>
      </div>
      <div className="grid content-start gap-2">
        <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Live preview</p>
        <div className="rounded-[1.25rem] bg-[#efeae2] p-3 shadow-inner dark:bg-[#0b141a]">
          <div className="ml-auto max-w-[250px] rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-[13px] leading-snug text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]">
            {showSubject && s.subject && <p className="mb-1 font-semibold">{render(s.subject, sample)}</p>}
            <p className="whitespace-pre-wrap">{render(s.body, sample) || <span className="opacity-50">Your message…</span>}</p>
            <p className="mt-1 text-right text-[10px] opacity-60">10:30 ✓✓</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Example values. On WhatsApp, more than 24 hours after the client last wrote, an approved template for “Automations” is needed.</p>
      </div>
    </div>
  );
}

function StepEditor({ s, trigger, set, options }: { s: Step; trigger: AutomationTrigger; set: (p: Partial<AutomationStep>) => void; options?: AutomationOptions }) {
  const appointmentTrigger = trigger.startsWith('APPOINTMENT_');
  switch (s.type) {
    case 'SEND_MESSAGE':
      return <MessageEditor s={s} trigger={trigger} set={set} options={options} />;
    case 'WAIT':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Wait</span>
          <Input aria-label="How long" inputMode="numeric" className="h-10 w-20 text-center text-base font-semibold" value={String(s.amount)} onChange={(e) => set({ amount: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })} />
          <Segmented label="Unit" value={s.unit} onChange={(v) => set({ unit: v })} options={[{ value: 'MINUTES', label: 'minutes' }, { value: 'HOURS', label: 'hours' }, { value: 'DAYS', label: 'days' }]} />
          <p className="basis-full text-sm text-muted-foreground">{appointmentTrigger ? 'Stops by itself if the appointment is cancelled meanwhile.' : 'Stops by itself if it no longer applies.'}</p>
        </div>
      );
    case 'WAIT_UNTIL':
      return (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            Wait until
            <NativeSelect aria-label="Time of day" className="h-10 w-auto font-semibold" value={String(s.hour)} onChange={(e) => set({ hour: Number(e.target.value) })}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </NativeSelect>
            clinic time — today if it is still ahead, otherwise the next day.
          </div>
          <div className="grid gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">Not on these days (e.g. when you are closed)</p>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((day, i) => {
                const off = s.skipDays.includes(i);
                return (
                  <button key={day} type="button" aria-pressed={off} onClick={() => set({ skipDays: off ? s.skipDays.filter((x) => x !== i) : [...s.skipDays, i] })} className={cn('h-9 w-12 rounded-xl text-sm font-medium ring-1 ring-inset transition-colors', off ? 'bg-destructive/10 text-destructive line-through ring-destructive/25' : 'ring-foreground/12 hover:bg-foreground/[0.04]')}>
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      );
    case 'CHECK':
      return (
        <div className="grid gap-2">
          <NativeSelect aria-label="Only continue if" className="h-10" value={s.check} onChange={(e) => set({ check: e.target.value as typeof s.check })}>
            {TRIGGER_INFO[trigger].checks.map((c) => (
              <option key={c} value={c}>
                Only continue if {CHECK_INFO[c].label}
              </option>
            ))}
          </NativeSelect>
          <p className="text-sm text-muted-foreground">Checked when this step is reached. If not, the automation ends here quietly — nothing more is sent.</p>
        </div>
      );
    case 'CREATE_TASK':
      return (
        <div className="grid gap-4">
          <TextWithVars id={`task-${s.key}`} label="Task" rows={1} required value={s.title} onChange={(v) => set({ title: v })} trigger={trigger} placeholder="e.g. Call to check on {{petName}}" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Due" htmlFor={`due-${s.key}`}>
              <NativeSelect id={`due-${s.key}`} value={String(s.dueInDays)} onChange={(e) => set({ dueInDays: Number(e.target.value) })}>
                {[0, 1, 2, 3, 7, 14].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? 'The same day' : n === 1 ? 'The next day' : `${n} days later`}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="For" htmlFor={`who-${s.key}`}>
              <NativeSelect id={`who-${s.key}`} value={s.assigneeId ?? ''} onChange={(e) => set({ assigneeId: e.target.value || null })}>
                <option value="">{appointmentTrigger ? 'The vet of the appointment' : 'Anyone (shared task list)'}</option>
                {(options?.staff ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.jobTitle ? ` — ${m.jobTitle}` : ''}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Notes (optional)" htmlFor={`det-${s.key}`}>
            <Textarea id={`det-${s.key}`} rows={2} value={s.details ?? ''} onChange={(e) => set({ details: e.target.value })} />
          </Field>
        </div>
      );
    case 'EMAIL_TEAM':
      return (
        <div className="grid gap-4">
          <Field label="To" htmlFor={`to-${s.key}`} required hint="e.g. the manager or the front desk">
            <Input id={`to-${s.key}`} type="email" value={s.to} onChange={(e) => set({ to: e.target.value })} placeholder="manager@yourclinic.com" />
          </Field>
          <TextWithVars id={`ts-${s.key}`} label="Subject" rows={1} required value={s.subject} onChange={(v) => set({ subject: v })} trigger={trigger} />
          <TextWithVars id={`tb-${s.key}`} label="Message" required value={s.body} onChange={(v) => set({ body: v })} trigger={trigger} />
        </div>
      );
  }
}

/** One line that says what a step does, for the collapsed card. */
function stepSummary(s: AutomationStep, staff?: AutomationOptions['staff']) {
  switch (s.type) {
    case 'SEND_MESSAGE':
      return `${s.channel === 'WHATSAPP' ? 'WhatsApp' : s.channel === 'EMAIL' ? 'Email' : 'Best channel'} · ${s.body ? `${s.body.slice(0, 90)}${s.body.length > 90 ? '…' : ''}` : 'No message yet'}`;
    case 'WAIT':
      return `${s.amount} ${s.unit.toLowerCase()}`;
    case 'WAIT_UNTIL':
      return `Until ${hourLabel(s.hour)}${s.skipDays.length ? ` · not on ${s.skipDays.map((n) => WEEKDAYS[n]).join(', ')}` : ''}`;
    case 'CHECK':
      return CHECK_INFO[s.check].label.replace(/^the /, '');
    case 'CREATE_TASK':
      return `${s.title || 'No title yet'} · ${s.assigneeId ? (staff?.find((m) => m.id === s.assigneeId)?.name ?? 'staff') : 'vet / shared list'}`;
    case 'EMAIL_TEAM':
      return `${s.to || 'No address yet'} · ${s.subject || 'No subject'}`;
  }
}

// ───────────────────────────── Conditions ─────────────────────────────

// ───────────────────────────── Flow nodes ─────────────────────────────

function Node({ kicker, title, subtitle, icon: Icon, tile, open, onToggle, actions, children, highlight }: { kicker: string; title: React.ReactNode; subtitle?: React.ReactNode; icon: React.ComponentType<{ className?: string }>; tile: string; open: boolean; onToggle: () => void; actions?: React.ReactNode; children?: React.ReactNode; highlight?: boolean }) {
  return (
    <Card className={cn('relative overflow-hidden transition-shadow', open && 'shadow-lg ring-1 ring-primary/25', highlight && 'ring-1 ring-warning/50')}>
      <div className="flex items-center gap-3 p-4">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={open}>
          <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-sm', tile)}>
            <Icon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{kicker}</span>
            <span className="block truncate font-semibold">{title}</span>
            {subtitle && <span className="block truncate text-sm text-muted-foreground">{subtitle}</span>}
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
        {actions}
      </div>
      {open && <div className="border-t border-foreground/[0.06] p-4 sm:p-5">{children}</div>}
    </Card>
  );
}

/** The line between nodes, with a "+" to insert a step there. */
function Connector({ onAdd, trigger, label }: { onAdd?: (t: AutomationStep['type']) => void; trigger: AutomationTrigger; label?: string }) {
  const [open, setOpen] = useState(false);
  const types = (Object.keys(STEP_META) as AutomationStep['type'][]).filter((t) => t !== 'CHECK' || TRIGGER_INFO[trigger].checks.length > 0);
  return (
    <div className="relative flex h-12 items-center justify-center">
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/20" aria-hidden />
      {label && <span className="absolute left-1/2 ml-6 text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</span>}
      {onAdd && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Add a step here" className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-card text-primary shadow-md ring-1 ring-primary/25 transition-all hover:scale-110 hover:bg-primary hover:text-primary-foreground">
              <Plus className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="center" className="w-80 p-2">
            <p className="px-2 pb-1 pt-1 text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Add a step</p>
            {types.map((t) => {
              const m = STEP_META[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    onAdd(t);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-foreground/[0.04]"
                >
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', m.tile)}>
                    <m.icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{m.label}</span>
                    <span className="block text-xs text-muted-foreground">{m.text}</span>
                  </span>
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function TriggerDialog({ value, onPick, onClose }: { value: AutomationTrigger; onPick: (t: AutomationTrigger) => void; onClose: () => void }) {
  const marketingOk = usePlanFeature('marketing');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<TriggerGroup | 'ALL'>('ALL');
  const list = AUTOMATION_TRIGGERS.filter((t) => (group === 'ALL' || TRIGGER_INFO[t].group === group) && (!q || `${TRIGGER_INFO[t].label} ${TRIGGER_INFO[t].when}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>What starts the automation?</DialogTitle>
          <DialogDescription>Something that happens in the clinic, or a date coming round.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus placeholder="Search: booked, surgery, invoice, birthday…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search triggers" />
          </div>
          <Segmented label="Group" value={group} onChange={setGroup} options={[{ value: 'ALL' as const, label: 'All' }, ...GROUPS.map((g) => ({ value: g, label: g }))]} />
          <div className="grid max-h-[55vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {list.map((t) => {
              const info = TRIGGER_INFO[t];
              const Icon = TRIGGER_ICONS[t];
              const locked = info.group === 'Marketing' && !marketingOk;
              return (
                <button key={t} type="button" onClick={() => onPick(t)} className={cn('flex items-start gap-3 rounded-2xl p-3 text-left ring-1 ring-inset transition-all hover:-translate-y-0.5 hover:shadow-md', value === t ? 'bg-primary/[0.06] ring-primary' : 'bg-card ring-foreground/10')}>
                  <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', GROUP_TONE[info.group].tile)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-semibold">
                      {info.label}
                      {info.timed && <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-label="At a set time" />}
                      {locked && <PlanLockBadge />}
                    </span>
                    <span className="block text-xs text-muted-foreground">When {info.when}</span>
                  </span>
                </button>
              );
            })}
            {!list.length && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Nothing matches “{q}”.</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TimingControls({ d, set }: { d: Draft; set: (p: Partial<Draft>) => void }) {
  const t = TRIGGER_INFO[d.trigger].timed;
  if (!t) return null;
  const hourSelect = (
    <>
      at
      <NativeSelect aria-label="Time of day" className="h-10 w-auto font-semibold" value={String(d.atHour ?? 10)} onChange={(e) => set({ atHour: Number(e.target.value) })}>
        {HOURS.filter((h) => h >= 6 && h <= 22).map((h) => (
          <option key={h} value={h}>
            {hourLabel(h)}
          </option>
        ))}
      </NativeSelect>
      clinic time
    </>
  );
  const select = (list: number[], fmt: (n: number) => string, aria: string, fallback: number) => (
    <NativeSelect aria-label={aria} className="h-10 w-auto font-semibold" value={String(d.offset ?? fallback)} onChange={(e) => set({ offset: Number(e.target.value) })}>
      {list.map((n) => (
        <option key={n} value={n}>
          {fmt(n)}
        </option>
      ))}
    </NativeSelect>
  );
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-primary/[0.05] p-3 text-sm ring-1 ring-inset ring-primary/10">
      <Clock className="h-4 w-4 text-primary" />
      {t === 'HOURS_BEFORE' && (
        <>
          {select(HOURS_BEFORE, (h) => (h === 1 ? '1 hour' : `${h} hours`), 'Hours before', 24)}
          {d.trigger === 'SURGERY_UPCOMING' ? 'before the surgery' : 'before the appointment'}
        </>
      )}
      {t === 'DAYS_BEFORE' && (
        <>
          {select(DAYS_BEFORE, (n) => (n === 0 ? 'On the day' : n === 1 ? '1 day before' : `${n} days before`), 'Days before', 7)} it is due,{' '}
          {hourSelect}
        </>
      )}
      {t === 'DAYS_AFTER' && (
        <>
          {select(DAYS_AFTER, (n) => (n === 1 ? '1 day' : `${n} days`), 'Days after the due date', 7)} after the due date, while still unpaid,{' '}
          {hourSelect}
        </>
      )}
      {t === 'MONTHS_SINCE' && (
        <>
          {select(MONTHS_SINCE, (n) => `${n} months`, 'Months since the last visit', 12)} after the last visit, with nothing booked,{' '}
          {hourSelect}
        </>
      )}
      {t === 'ON_DAY' && <>On the day, {hourSelect}</>}
      {t === 'ON_DATE' && <OfferSchedule d={d} set={set} hourSelect={hourSelect} />}
    </div>
  );
}

/** When an offer goes out: the day, how often, the time, and when the offer ends. */
function OfferSchedule({ d, set, hourSelect }: { d: Draft; set: (p: Partial<Draft>) => void; hourSelect: React.ReactNode }) {
  const repeat = d.repeat ?? 'NONE';
  const next = nextOfferDay({ sendOn: d.sendOn, repeat, endsOn: d.endsOn }, localDay());
  return (
    <div className="grid w-full gap-3">
      <div className="flex flex-wrap items-center gap-2">
        Send on
        <Input type="date" aria-label="Send on" className="h-10 w-auto font-semibold" min={d.sendOn && d.sendOn < localDay() ? undefined : localDay()} value={d.sendOn ?? ''} onChange={(e) => set({ sendOn: e.target.value || null })} />
        {hourSelect}
        <Button type="button" size="sm" variant="outline" onClick={() => set({ sendOn: localDay(), atHour: new Date().getHours(), repeat: 'NONE' })}>
          <Send /> Send now
        </Button>
      </div>
      {d.sendOn === localDay() && d.atHour != null && d.atHour <= new Date().getHours() && (
        <p className="rounded-xl bg-rose-500/[0.07] px-3 py-2 text-xs text-rose-700 ring-1 ring-inset ring-rose-500/15 dark:text-rose-300">Goes out within a few minutes of saving (switched on), within your sending hours.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span>Repeat</span>
        <Segmented label="Repeat" value={repeat} onChange={(v) => set({ repeat: v })} options={(['NONE', 'WEEKLY', 'MONTHLY'] as const).map((r) => ({ value: r, label: OFFER_REPEAT_LABELS[r] }))} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {repeat === 'NONE' ? 'The offer ends on' : 'Stop after'}
        <Input type="date" aria-label={repeat === 'NONE' ? 'Offer ends on' : 'Stop after'} className="h-10 w-auto font-semibold" min={d.sendOn ?? undefined} value={d.endsOn ?? ''} onChange={(e) => set({ endsOn: e.target.value || null })} />
        {d.endsOn && <button type="button" className="text-xs text-primary hover:underline" onClick={() => set({ endsOn: null })}>{repeat === 'NONE' ? 'No end date' : 'Keep repeating'}</button>}
      </div>
      <p className="text-xs text-muted-foreground">
        {repeat === 'NONE' ? '“Offer ends” in the message shows this date.' : '“Offer ends” in the message shows the day before the next send (e.g. the end of that month’s offer).'}{' '}
        {next ? `Next send: ${offerScheduleText({ sendOn: next, repeat: 'NONE', endsOn: null }).replace('Once on ', '')}.` : d.sendOn ? 'It will not go out again.' : ''}
      </p>
    </div>
  );
}

function PreviewDialog({ result, onClose }: { result: PreviewResult; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Try it — nothing is sent</DialogTitle>
          <DialogDescription>{result.example ? `On a recent real record: ${result.example.label}${result.example.client ? ` (${result.example.client})` : ''}.` : 'There is no record of this kind yet to try it on.'}</DialogDescription>
        </DialogHeader>
        {result.example && (
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto">
            <p className={cn('flex items-center gap-2 rounded-xl px-3 py-2 text-sm', result.conditionsMet ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
              {result.conditionsMet ? <CheckCircle2 className="h-4 w-4" /> : <X className="h-4 w-4" />}
              {result.conditionsMet ? 'The conditions are met — this record would start the automation.' : 'The conditions are not met for this record, so it would not start. This is what it would do otherwise:'}
            </p>
            {result.steps.map((s, i) => {
              const m = STEP_META[s.type as AutomationStep['type']];
              return (
                <div key={i} className="flex gap-3 rounded-2xl bg-foreground/[0.025] p-3 text-sm ring-1 ring-inset ring-foreground/[0.06]">
                  {m && (
                    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', m.tile)}>
                      <m.icon className="h-4 w-4" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
                      {m?.label ?? s.type}
                      {s.when && <Badge variant="outline">{s.when}</Badge>}
                      {s.channel && <Badge>{s.channel === 'WHATSAPP' ? 'WhatsApp' : s.channel === 'EMAIL' ? 'Email' : s.channel}</Badge>}
                    </p>
                    {PAUSES.includes(s.type) && <p>{s.note}</p>}
                    {s.recipient && <p className="text-xs text-muted-foreground">To {s.recipient}</p>}
                    {s.subject && <p className="font-semibold">{s.subject}</p>}
                    {s.body && <p className="whitespace-pre-wrap">{s.body}</p>}
                    {s.title && <p className="font-semibold">{s.title}</p>}
                    {s.details && <p>{s.details}</p>}
                    {s.note && !PAUSES.includes(s.type) && <p className="mt-1 text-xs text-warning">{s.note}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingToggle({ title, text, checked, onChange, children, locked }: { title: string; text: string; checked: boolean; onChange: (v: boolean) => void; children?: React.ReactNode; locked?: boolean }) {
  return (
    <div className="grid gap-2">
      <label className="flex items-start justify-between gap-4">
        <span>
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">{title} {locked && <PlanLockBadge />}</span>
          <span className="block text-xs text-muted-foreground">{text}</span>
        </span>
        <Switch checked={checked} disabled={locked && !checked} onCheckedChange={onChange} aria-label={title} />
      </label>
      {checked && children}
    </div>
  );
}

// ───────────────────────────── The builder ─────────────────────────────

function Builder() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { currency } = useSession();
  const isNew = id === 'new';
  const existing = useQuery({ queryKey: ['automation', id], queryFn: () => api.get<Omit<Draft, 'steps' | 'description'> & { description: string | null; steps: AutomationStep[]; approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null; approvalNote?: string | null; approvedByName?: string | null; version?: number }>(`/automations/${id}`), enabled: !isNew });
  const [history, setHistory] = useState(false);
  const [asTemplate, setAsTemplate] = useState(false);
  const templateId = isNew ? params.get('template') : null;
  const tpl = useQuery({ queryKey: ['automation-template', templateId], queryFn: () => api.get<AutomationTemplate>(`/automations/templates/${templateId}`), enabled: !!templateId });
  const options = useQuery({ queryKey: ['automation-options'], queryFn: () => api.get<AutomationOptions>('/automations/options'), staleTime: 60_000 });
  const [d, setD] = useState<Draft | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const planBuilder = usePlanFeature('automationBuilder');
  const planMarketing = usePlanFeature('marketing');

  useEffect(() => {
    if (d) return;
    if (isNew) {
      const r = AUTOMATION_RECIPES.find((x) => x.key === params.get('recipe'));
      if (templateId) {
        if (!tpl.data) return;
        // From the clinic's own template: an offer whose day has passed moves to tomorrow, keeping its length.
        const a = tpl.data.draft;
        const offer = TRIGGER_INFO[a.trigger].timed === 'ON_DATE';
        let sendOn = offer ? (a.sendOn ?? localDay(1)) : null;
        let endsOn = offer ? (a.endsOn ?? null) : null;
        if (sendOn && sendOn < localDay()) {
          const days = endsOn ? Math.round((Date.parse(endsOn) - Date.parse(sendOn)) / 86_400_000) : null;
          sendOn = localDay(1);
          endsOn = days != null ? localDay(1 + days) : null;
        }
        setD({ name: a.name, description: a.description ?? '', isActive: true, marketing: !!a.marketing, trigger: a.trigger, offset: a.offset ?? null, atHour: a.atHour ?? null, sendFromHour: a.sendFromHour ?? null, sendToHour: a.sendToHour ?? null, cooldownDays: a.cooldownDays ?? null, sendOn, repeat: offer ? (a.repeat ?? 'NONE') : null, endsOn, conditions: (a.conditions ?? []) as AutomationCondition[], steps: withKeys(a.steps as AutomationStep[]) });
        if (offer) setOpen('trigger');
      } else if (r) {
        const a = r.automation;
        const offer = TRIGGER_INFO[a.trigger].timed === 'ON_DATE';
        setD({ name: a.name, description: a.description ?? '', isActive: true, marketing: !!a.marketing, trigger: a.trigger, offset: a.offset ?? null, atHour: a.atHour ?? null, sendFromHour: a.sendFromHour ?? null, sendToHour: a.sendToHour ?? null, cooldownDays: a.cooldownDays ?? null, sendOn: offer ? (a.sendOn ?? localDay(1)) : null, repeat: offer ? (a.repeat ?? 'NONE') : null, endsOn: offer ? (a.endsOn ?? (a.repeat && a.repeat !== 'NONE' ? null : localDay(15))) : null, conditions: (a.conditions ?? []) as AutomationCondition[], steps: withKeys(a.steps as AutomationStep[]) });
        if (offer) setOpen('trigger');
      } else if (params.get('trigger') === 'SCHEDULED_OFFER') {
        setD(offerDraft());
        setOpen('trigger');
      } else {
        // "Build from scratch" from Marketing starts promotional.
        setD({ ...blankDraft(), marketing: params.get('marketing') === '1' && planMarketing });
        setPicking(true);
      }
    } else if (existing.data) {
      const a = existing.data;
      setD({ name: a.name, description: a.description ?? '', isActive: a.isActive, marketing: a.marketing, trigger: a.trigger, offset: a.offset, atHour: a.atHour, sendFromHour: a.sendFromHour, sendToHour: a.sendToHour, cooldownDays: a.cooldownDays, sendOn: a.sendOn ?? null, repeat: a.repeat ?? null, endsOn: a.endsOn ?? null, conditions: a.conditions, steps: withKeys(a.steps) });
    }
  }, [isNew, params, existing.data, d, templateId, tpl.data, planMarketing]);

  const payload = useMemo(
    () =>
      d && {
        name: d.name.trim(),
        description: d.description.trim() || null,
        isActive: d.isActive,
        marketing: d.marketing,
        trigger: d.trigger,
        offset: d.offset,
        atHour: d.atHour,
        sendFromHour: d.sendFromHour,
        sendToHour: d.sendToHour,
        cooldownDays: d.cooldownDays,
        sendOn: d.sendOn,
        repeat: d.repeat,
        endsOn: d.endsOn,
        conditions: d.conditions.filter((c) => c.values.length),
        steps: d.steps.map((s) => {
          const copy: Partial<Step> = { ...s };
          delete copy.key;
          return copy as AutomationStep;
        }),
        // Made from a recipe: counts as ready-made while it keeps the recipe's shape (the API checks).
        ...(isNew && params.get('recipe') ? { recipeKey: params.get('recipe') } : isNew && tpl.data?.draft.recipeKey ? { recipeKey: tpl.data.draft.recipeKey } : {}),
      },
    [d, isNew, params, tpl.data],
  );
  const save = useMutation({
    mutationFn: () => (isNew ? api.post<{ id: string }>('/automations', payload) : api.put<{ id: string }>(`/automations/${id}`, payload)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      qc.invalidateQueries({ queryKey: ['automation-stats'] });
      qc.invalidateQueries({ queryKey: ['automation', id] });
      toast.success(d!.marketing && options.data?.marketing?.approval ? `“${d!.name}” sent for approval — a manager switches it on` : d!.isActive ? `“${d!.name}” is on` : `“${d!.name}” saved (off)`);
      if (templateId) api.post(`/automations/templates/${templateId}/used`).then(() => qc.invalidateQueries({ queryKey: ['automation-templates'] }), () => undefined);
      router.push(d!.marketing ? '/marketing?tab=campaigns' : '/settings/automations');
    },
    onError: (e: Error) => {
      setError(e.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });
  const tryIt = useMutation({ mutationFn: () => api.post<PreviewResult>('/automations/preview', { automation: payload }), onSuccess: setPreview, onError: (e: Error) => toast.error(e.message) });
  const testSend = useMutation({
    mutationFn: () => api.post<{ to: string; example: string | null }>('/automations/test-send', { automation: payload }),
    onSuccess: (r) => toast.success(`Test email sent to ${r.to}${r.example ? ` — filled in as for ${r.example}` : ''}. No client gets anything.`),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isNew && existing.isLoading) return <LoadingRows rows={8} />;
  if (existing.error) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;
  if (tpl.error) return <ErrorState error={tpl.error} onRetry={() => tpl.refetch()} />;
  if (!d || !payload) return <LoadingRows rows={8} />;

  const info = TRIGGER_INFO[d.trigger];
  const TIcon = TRIGGER_ICONS[d.trigger] ?? Zap;
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const setStep = (i: number, p: Partial<AutomationStep>) => set({ steps: d.steps.map((s, j) => (j === i ? ({ ...s, ...p } as Step) : s)) });
  const insertStep = (at: number, type: AutomationStep['type']) => {
    const s = { ...makeStep(type, d.trigger), key: newKey() } as Step;
    set({ steps: [...d.steps.slice(0, at), s, ...d.steps.slice(at)] });
    setOpen(s.key);
  };
  const move = (i: number, dir: -1 | 1) => {
    const steps = [...d.steps];
    [steps[i], steps[i + dir]] = [steps[i + dir], steps[i]];
    set({ steps });
  };
  const pickTrigger = (t: AutomationTrigger) => {
    const timed = TRIGGER_INFO[t].timed;
    const allowed = new Set(TRIGGER_INFO[t].conditions);
    const checks = TRIGGER_INFO[t].checks;
    const offset = timed === 'HOURS_BEFORE' ? 24 : timed === 'DAYS_BEFORE' || timed === 'DAYS_AFTER' ? 7 : timed === 'MONTHS_SINCE' ? 12 : null;
    const offer = timed === 'ON_DATE';
    set({
      trigger: t,
      offset: timed && TRIGGER_INFO[d.trigger].timed === timed ? d.offset : offset,
      atHour: timed && timed !== 'HOURS_BEFORE' ? (d.atHour ?? 10) : null,
      // An offer is always promotional, and needs its day.
      ...(offer ? { marketing: true, sendOn: d.sendOn ?? localDay(1), repeat: d.repeat ?? 'NONE', endsOn: d.endsOn ?? localDay(15) } : NO_OFFER),
      conditions: d.conditions.filter((c) => allowed.has(c.field)),
      steps: d.steps.filter((s) => s.type !== 'CHECK' || checks.includes(s.check)),
    });
    setPicking(false);
    if (timed) setOpen('trigger');
  };
  const stepMissing = (s: Step) => (s.type === 'SEND_MESSAGE' && !s.body.trim()) || (s.type === 'CREATE_TASK' && !s.title.trim()) || (s.type === 'EMAIL_TEAM' && (!s.to.trim() || !s.subject.trim() || !s.body.trim()));
  const lastType = d.steps[d.steps.length - 1]?.type;
  const isOffer = info.timed === 'ON_DATE';
  const missing = !d.name.trim()
    ? 'Give the automation a name (at the top)'
    : isOffer && !d.sendOn
      ? 'Choose the day to send the offer'
      : isOffer && d.endsOn && d.sendOn && d.endsOn < d.sendOn
        ? 'The offer must end on or after the day it is sent'
    : d.steps.some(stepMissing)
      ? 'Fill in every step (marked in amber)'
      : !d.steps.some((s) => !PAUSES.includes(s.type))
        ? 'Add a message or a task'
        : lastType === 'WAIT' || lastType === 'WAIT_UNTIL'
          ? 'A wait cannot be the last step'
          : lastType === 'CHECK'
            ? 'A check needs a step after it'
            : d.sendFromHour != null && d.sendToHour != null && d.sendToHour <= d.sendFromHour
              ? 'The sending hours must end after they start'
              : null;
  const builder = planBuilder;
  const needsApproval = d.marketing && !!options.data?.marketing?.approval;
  const marketingOk = planMarketing;
  const sentence = describeAutomation(payload, options.data);
  const conditionsText = d.conditions.filter((c) => c.values.length).map((c) => conditionText(c, options.data)).join(' · ') || null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={d.marketing ? '/marketing?tab=campaigns' : '/settings/automations'}>
            <ArrowLeft /> {d.marketing ? 'Marketing' : 'Automations'}
          </Link>
        </Button>
        {tpl.data && <Badge variant="outline">From your template “{tpl.data.name}”</Badge>}
        <div className="ml-auto flex items-center gap-2">
          {!isNew && (
            <Button variant="ghost" size="sm" onClick={() => setHistory(true)}>
              <History /> Version history{existing.data?.version ? ` (v${existing.data.version})` : ''}
            </Button>
          )}
          <Badge variant={d.isActive ? 'success' : 'secondary'}>{d.isActive ? 'On' : 'Off'}</Badge>
        </div>
      </div>
      {error && <FormError message={error} />}
      {existing.data?.approvalStatus === 'PENDING' && (
        <div className="flex items-start gap-3 rounded-2xl bg-warning/10 p-4 text-sm ring-1 ring-inset ring-warning/25">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span><b>Waiting for approval.</b> A manager (not the last person who changed it) approves it in Marketing → Campaigns; it switches on then.</span>
        </div>
      )}
      {existing.data?.approvalStatus === 'REJECTED' && (
        <div className="flex items-start gap-3 rounded-2xl bg-destructive/[0.07] p-4 text-sm ring-1 ring-inset ring-destructive/20">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span><b>Sent back by {existing.data.approvedByName}:</b> “{existing.data.approvalNote}”. Change it and save to send it for approval again.</span>
        </div>
      )}
      {isOffer && !marketingOk && (
        <UpgradeCard feature="marketing" compact text="Offers and discounts for your clients are part of marketing automations. You can prepare one now and save it once your plan includes marketing." />
      )}
      {!builder && (
        <UpgradeCard
          feature="automationBuilder"
          compact
          text="Your plan includes the ready-made automations and the easy creator: you can change the wording, the timing and who it is for. Adding waits, checks, conditions and more steps needs the full builder."
        />
      )}

      <div className="grid gap-1">
        <input aria-label="Automation name" className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50 sm:text-3xl" placeholder="Name your automation…" value={d.name} onChange={(e) => set({ name: e.target.value })} />
        <input aria-label="Description" className="w-full bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/50" placeholder="Add a short description (optional)" value={d.description} onChange={(e) => set({ description: e.target.value })} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 rounded-[2rem] bg-[radial-gradient(hsl(var(--foreground)/0.07)_1px,transparent_1px)] p-3 [background-size:18px_18px] sm:p-6">
          <div className="mx-auto max-w-3xl">
            <Node
              kicker="When"
              title={info.label}
              subtitle={sentence.split(' → ')[0].replace(/\s*\((?!still)[^)]*\)$/, '')}
              icon={TIcon}
              tile={GROUP_TONE[info.group].tile}
              open={open === 'trigger'}
              onToggle={() => setOpen(open === 'trigger' ? null : 'trigger')}
              actions={
                <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
                  Change
                </Button>
              }
            >
              <p className="text-sm text-muted-foreground">{isOffer ? 'On the day, it goes to every client in the group (see below) who agreed to marketing — once each.' : `Starts ${info.timed ? 'at the time you choose' : `the moment ${info.when}`}. Each record starts it once.`}</p>
              <TimingControls d={d} set={set} />
            </Node>
            <Connector trigger={d.trigger} />
            <Node kicker={isOffer ? 'To' : 'Only if'} title={d.conditions.length ? `${d.conditions.length} ${d.conditions.length === 1 ? 'condition' : 'conditions'}` : isOffer ? 'Every client who agreed to marketing' : 'Everyone'} subtitle={conditionsText ?? (isOffer ? 'Narrow it: dog owners, one branch, clients not seen for a while…' : 'No conditions — runs for every client')} icon={Filter} tile="bg-foreground/[0.07] text-foreground" open={open === 'conditions'} onToggle={() => setOpen(open === 'conditions' ? null : 'conditions')}>
              <div className="grid gap-2.5">
                {d.conditions.map((c, i) => (
                  <ConditionRow key={i} c={c} trigger={d.trigger} options={options.data} currency={currency} onChange={(nc) => set({ conditions: d.conditions.map((x, j) => (j === i ? nc : x)) })} onRemove={() => set({ conditions: d.conditions.filter((_, j) => j !== i) })} />
                ))}
                <div>
                  <Button type="button" size="sm" variant="outline" onClick={() => set({ conditions: [...d.conditions, { field: info.conditions[0], op: 'IS', values: [] }] })}>
                    <Plus /> Add a condition
                  </Button>
                </div>
              </div>
            </Node>
            <Connector trigger={d.trigger} onAdd={d.steps.length < 12 ? (t) => insertStep(0, t) : undefined} label="Then" />
            {d.steps.map((s, i) => {
              const m = STEP_META[s.type];
              return (
                <div key={s.key}>
                  <Node
                    kicker={`Step ${i + 1}`}
                    title={m.label}
                    subtitle={stepSummary(s, options.data?.staff)}
                    icon={m.icon}
                    tile={m.tile}
                    open={open === s.key}
                    highlight={stepMissing(s) && open !== s.key}
                    onToggle={() => setOpen(open === s.key ? null : s.key)}
                    actions={
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" aria-label={`More for step ${i + 1}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled={i === 0} onSelect={() => move(i, -1)}>
                            <ArrowUp /> Move up
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={i === d.steps.length - 1} onSelect={() => move(i, 1)}>
                            <ArrowDown /> Move down
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={d.steps.length >= 12} onSelect={() => set({ steps: [...d.steps.slice(0, i + 1), { ...s, key: newKey() }, ...d.steps.slice(i + 1)] })}>
                            <Copy /> Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" disabled={d.steps.length === 1} onSelect={() => set({ steps: d.steps.filter((_, j) => j !== i) })}>
                            <Trash2 /> Delete step
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    }
                  >
                    <StepEditor s={s} trigger={d.trigger} set={(p) => setStep(i, p)} options={options.data} />
                  </Node>
                  <Connector trigger={d.trigger} onAdd={d.steps.length < 12 ? (t) => insertStep(i + 1, t) : undefined} />
                </div>
              );
            })}
            <div className="flex justify-center">
              <span className="rounded-pill bg-foreground/[0.06] px-4 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">End</span>
            </div>
          </div>
        </div>

        <div className="grid content-start gap-4 2xl:sticky 2xl:top-24">
          <Card className="grid gap-5 p-5">
            <p className="flex items-center gap-2 font-semibold">
              <Settings2 className="h-4 w-4 text-primary" /> Settings
            </p>
            <SettingToggle title="Switched on" text="Off: nothing starts; runs already waiting stop." checked={d.isActive} onChange={(v) => set({ isActive: v })} />
            <SettingToggle title="Sending hours" text="No messages at night — they wait for the morning." checked={d.sendFromHour != null} onChange={(v) => set(v ? { sendFromHour: 9, sendToHour: 20 } : { sendFromHour: null, sendToHour: null })}>
              <div className="flex items-center gap-2 text-sm">
                <NativeSelect aria-label="From" className="h-9 w-auto" value={String(d.sendFromHour ?? 9)} onChange={(e) => set({ sendFromHour: Number(e.target.value) })}>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </NativeSelect>
                to
                <NativeSelect aria-label="To" className="h-9 w-auto" value={String(d.sendToHour ?? 20)} onChange={(e) => set({ sendToHour: Number(e.target.value) })}>
                  {[...HOURS.slice(1), 24].map((h) => (
                    <option key={h} value={h}>
                      {h === 24 ? '24:00' : hourLabel(h)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </SettingToggle>
            <SettingToggle title="Not too often" text="At most once per client in a period, even with several pets or visits." checked={d.cooldownDays != null} onChange={(v) => set({ cooldownDays: v ? 30 : null })}>
              <div className="flex items-center gap-2 text-sm">
                Once every
                <NativeSelect aria-label="Days" className="h-9 w-auto" value={String(d.cooldownDays ?? 30)} onChange={(e) => set({ cooldownDays: Number(e.target.value) })}>
                  {[1, 3, 7, 14, 30, 60, 90, 180, 365].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? 'day' : `${n} days`}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </SettingToggle>
            {isOffer ? (
              <div className="grid gap-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">Promotional {!marketingOk && <PlanLockBadge />}</span>
                <span className="text-xs text-muted-foreground">An offer always goes only to clients who agreed to marketing. Clients who asked for no messages never get any.</span>
              </div>
            ) : (
              <SettingToggle title="Promotional" text="Only to clients who agreed to marketing. Clients who asked for no messages never get any." checked={d.marketing} locked={!marketingOk} onChange={(v) => set({ marketing: v })} />
            )}
          </Card>
          {isOffer && <AudienceCard conditions={d.conditions} />}
          <Card className="grid gap-3 p-5">
            <p className="flex items-center gap-2 font-semibold">
              <Workflow className="h-4 w-4 text-primary" /> In one sentence
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">{sentence}</p>
          </Card>
        </div>
      </div>

      <div className="action-bar -mx-4 flex flex-wrap items-center gap-3 rounded-t-2xl px-4 py-3 sm:-mx-6 sm:px-6">
        <p className={cn('mr-auto text-sm', missing ? 'text-muted-foreground' : 'font-medium text-success')}>{missing ?? 'Ready to save'}</p>
        {d.steps.some((s) => s.type === 'SEND_MESSAGE') && (
          <Button variant="outline" disabled={!!missing} loading={testSend.isPending} onClick={() => testSend.mutate()} title="Email the first message to yourself">
            <FlaskConical /> Send me a test
          </Button>
        )}
        <Button variant="ghost" disabled={!!missing} onClick={() => setAsTemplate(true)} title="Keep it as your clinic’s own starting point">
          <BookmarkPlus /> Save as template
        </Button>
        <Button variant="outline" disabled={!!missing} loading={tryIt.isPending} onClick={() => tryIt.mutate()}>
          <Play /> Try it
        </Button>
        <Button disabled={!!missing} loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>
          {needsApproval ? <><ShieldCheck /> Send for approval</> : <><Save /> {isNew ? 'Save automation' : 'Save changes'}</>}
        </Button>
      </div>

      {picking && <TriggerDialog value={d.trigger} onPick={pickTrigger} onClose={() => setPicking(false)} />}
      {preview && <PreviewDialog result={preview} onClose={() => setPreview(null)} />}
      {asTemplate && <SaveTemplateDialog automation={payload} onClose={() => setAsTemplate(false)} />}
      {history && <VersionHistory automationId={id} name={d.name} onClose={() => { setHistory(false); setD(null); existing.refetch(); }} />}
    </div>
  );
}

/** New automations start in the easy three-question creator; recipes and "advanced" open the full editor. */
function Entry() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  if (id === 'new' && !params.get('recipe') && !params.get('template') && params.get('mode') !== 'advanced') return <EasyCreator />;
  return <Builder />;
}

export default function AutomationBuilderPage() {
  return (
    <RequirePermission anyOf={['settings.manage', 'integrations.manage']}>
      <Suspense>
        <Entry />
      </Suspense>
    </RequirePermission>
  );
}
