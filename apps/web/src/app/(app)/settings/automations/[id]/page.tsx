'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AUTOMATION_RECIPES,
  AUTOMATION_VARIABLES,
  AUTOMATION_TRIGGERS,
  CONDITION_INFO,
  TRIGGER_INFO,
  sampleVars,
  type AutomationCondition,
  type AutomationConditionField,
  type AutomationStep,
  type AutomationTrigger,
} from '@vcms/shared';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  Cake,
  CheckCircle2,
  ClipboardList,
  Clock,
  CreditCard,
  FlaskConical,
  HeartPulse,
  Hourglass,
  Mail,
  MessageCircle,
  Play,
  Plus,
  Save,
  Send,
  Stethoscope,
  Syringe,
  Trash2,
  UserPlus,
  UserX,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { describeAutomation, hourLabel, type AutomationOptions } from '@/components/automations/describe';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Switch } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/lib/api';
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
  conditions: AutomationCondition[];
  steps: Step[];
}
interface PreviewResult {
  example: { id: string; label: string; client: string | null } | null;
  conditionsMet: boolean;
  steps: { type: string; when?: string; channel?: string | null; recipient?: string | null; subject?: string | null; body?: string; title?: string; details?: string | null; note?: string | null }[];
}

const key = () => Math.random().toString(36).slice(2);
const withKeys = (steps: AutomationStep[]): Step[] => steps.map((s) => ({ ...s, key: key() }) as Step);

const TRIGGER_ICONS: Record<AutomationTrigger, React.ComponentType<{ className?: string }>> = {
  APPOINTMENT_BOOKED: CalendarCheck,
  APPOINTMENT_RESCHEDULED: CalendarClock,
  APPOINTMENT_CANCELLED: CalendarX,
  APPOINTMENT_UPCOMING: Bell,
  APPOINTMENT_COMPLETED: Stethoscope,
  APPOINTMENT_NO_SHOW: UserX,
  LAB_RESULTS_READY: FlaskConical,
  PATIENT_DISCHARGED: HeartPulse,
  PAYMENT_RECEIVED: CreditCard,
  VACCINATION_GIVEN: Syringe,
  CARE_DUE: Syringe,
  CLIENT_REGISTERED: UserPlus,
  PET_BIRTHDAY: Cake,
};
const STEP_INFO: Record<AutomationStep['type'], { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  SEND_MESSAGE: { label: 'Send a message to the client', icon: Send, tone: 'from-primary to-brand-2 text-white' },
  WAIT: { label: 'Wait', icon: Hourglass, tone: 'bg-foreground/[0.07] text-foreground' },
  CREATE_TASK: { label: 'Create a task for staff', icon: ClipboardList, tone: 'bg-warning/15 text-warning' },
  EMAIL_TEAM: { label: 'Email the team', icon: Users, tone: 'bg-info/15 text-info' },
};
const NEW_STEP: Record<AutomationStep['type'], () => AutomationStep> = {
  SEND_MESSAGE: () => ({ type: 'SEND_MESSAGE', channel: 'BEST', subject: '', body: '' }),
  WAIT: () => ({ type: 'WAIT', amount: 1, unit: 'DAYS' }),
  CREATE_TASK: () => ({ type: 'CREATE_TASK', title: '', details: '', dueInDays: 0, assigneeId: null }),
  EMAIL_TEAM: () => ({ type: 'EMAIL_TEAM', to: '', subject: '', body: '' }),
};
const HOURS_BEFORE = [1, 2, 3, 6, 12, 24, 48, 72];
const DAYS_BEFORE = [0, 1, 2, 3, 7, 14, 30];

const blankDraft = (): Draft => ({ name: '', description: '', isActive: true, marketing: false, trigger: 'APPOINTMENT_COMPLETED', offset: null, atHour: null, conditions: [], steps: withKeys([NEW_STEP.SEND_MESSAGE()]) });

/** {{variable}} buttons that insert at the cursor. */
function VariableChips({ trigger, onInsert }: { trigger: AutomationTrigger; onInsert: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TRIGGER_INFO[trigger].variables.map((v) => (
        <button key={v} type="button" onClick={() => onInsert(`{{${v}}}`)} className="rounded-pill bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20" title={`Insert ${AUTOMATION_VARIABLES[v]?.label ?? v}`}>
          + {AUTOMATION_VARIABLES[v]?.label ?? v}
        </button>
      ))}
    </div>
  );
}

/** A text box with variable buttons; inserts where the cursor is. */
function TextWithVars({ id, label, value, onChange, trigger, rows = 4, placeholder, required }: { id: string; label: string; value: string; onChange: (v: string) => void; trigger: AutomationTrigger; rows?: number; placeholder?: string; required?: boolean }) {
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
        {rows > 1 ? (
          <Textarea id={id} ref={ref as React.Ref<HTMLTextAreaElement>} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Input id={id} ref={ref as React.Ref<HTMLInputElement>} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        )}
        <VariableChips trigger={trigger} onInsert={insert} />
      </div>
    </Field>
  );
}

const render = (text: string, vars: Record<string, string>) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');

function MessageEditor({ s, trigger, set, options }: { s: Extract<AutomationStep, { type: 'SEND_MESSAGE' }>; trigger: AutomationTrigger; set: (p: Partial<AutomationStep>) => void; options?: AutomationOptions }) {
  const sample = sampleVars(trigger);
  const showSubject = s.channel === 'EMAIL' || s.channel === 'BEST';
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  // The variable buttons insert into whichever box was used last (the message by default).
  const [target, setTarget] = useState<'subject' | 'body'>('body');
  const insert = (v: string) => {
    const el = target === 'subject' && showSubject ? subjectRef.current : bodyRef.current;
    const field = target === 'subject' && showSubject ? 'subject' : 'body';
    const value = (field === 'subject' ? s.subject : s.body) ?? '';
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    set({ [field]: value.slice(0, at) + v + value.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + v.length, at + v.length);
    });
  };
  const channels: { id: typeof s.channel; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'BEST', label: 'Best channel', icon: CheckCircle2 },
    { id: 'WHATSAPP', label: 'WhatsApp', icon: MessageCircle },
    { id: 'EMAIL', label: 'Email', icon: Mail },
  ];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Channel">
        {channels.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={s.channel === c.id} onClick={() => set({ channel: c.id })} className={cn('flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors', s.channel === c.id ? 'bg-primary text-primary-foreground ring-primary' : 'ring-foreground/15 hover:bg-foreground/[0.04]')}>
            <c.icon className="h-4 w-4" /> {c.label}
          </button>
        ))}
      </div>
      {s.channel === 'WHATSAPP' && options && !options.channels.whatsapp && <p className="text-xs text-warning">WhatsApp is not connected — these messages will not be sent until it is. “Best channel” would use email meanwhile.</p>}
      {showSubject && (
        <Field label="Email subject" htmlFor={`subj-${trigger}`}>
          <Input id={`subj-${trigger}`} ref={subjectRef} value={s.subject ?? ''} placeholder="e.g. Thank you for visiting {{clinicName}}" onFocus={() => setTarget('subject')} onChange={(e) => set({ subject: e.target.value })} />
        </Field>
      )}
      <Field label="Message" htmlFor={`body-${trigger}`} required>
        <Textarea id={`body-${trigger}`} ref={bodyRef} rows={4} value={s.body} placeholder="Hello {{clientName}}, …" onFocus={() => setTarget('body')} onChange={(e) => set({ body: e.target.value })} />
      </Field>
      <div className="grid gap-1.5">
        <p className="text-xs text-muted-foreground">Insert into the {target === 'subject' && showSubject ? 'subject' : 'message'}:</p>
        <VariableChips trigger={trigger} onInsert={insert} />
      </div>
      <div className="grid gap-2">
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Preview with example values</p>
        <div className="rounded-2xl bg-[#e7ddd3] p-3 dark:bg-[#1f2c33]">
          <div className="ml-auto max-w-md rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-sm text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-white">
            {showSubject && s.subject && <p className="mb-1 font-semibold">{render(s.subject, sample)}</p>}
            <p className="whitespace-pre-wrap">{render(s.body, sample) || <span className="opacity-50">Your message…</span>}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">WhatsApp more than 24 hours after the client’s last message needs an approved template — link one for “Automations” under Integrations → WhatsApp.</p>
      </div>
    </div>
  );
}

function ValuesPicker({ list, values, onChange, label }: { list: { id: string; name: string }[]; values: string[]; onChange: (v: string[]) => void; label: string }) {
  const names = values.map((v) => list.find((x) => x.id === v)?.name).filter(Boolean);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="min-w-0 flex-1 justify-start font-normal" aria-label={label}>
          <span className="truncate">{names.length ? names.join(', ') : <span className="text-muted-foreground">Choose…</span>}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-64 overflow-y-auto p-2">
        {list.map((x) => (
          <label key={x.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-foreground/[0.04]">
            <Checkbox checked={values.includes(x.id)} onCheckedChange={(v) => onChange(v ? [...values, x.id] : values.filter((y) => y !== x.id))} /> {x.name}
          </label>
        ))}
        {!list.length && <p className="px-2 py-3 text-sm text-muted-foreground">Nothing to choose yet.</p>}
      </PopoverContent>
    </Popover>
  );
}

function ConditionRow({ c, trigger, options, onChange, onRemove, currency }: { c: AutomationCondition; trigger: AutomationTrigger; options?: AutomationOptions; onChange: (c: AutomationCondition) => void; onRemove: () => void; currency: string }) {
  const fields = TRIGGER_INFO[trigger].conditions;
  const toggleValue = (v: string) => onChange({ ...c, values: c.values.includes(v) ? c.values.filter((x) => x !== v) : [...c.values, v] });
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl surface-flat p-2">
      <NativeSelect aria-label="Condition" className="h-9 w-auto" value={c.field} onChange={(e) => onChange({ field: e.target.value as AutomationConditionField, op: 'IS', values: [] })}>
        {fields.map((f) => (
          <option key={f} value={f}>
            {CONDITION_INFO[f].label}
          </option>
        ))}
      </NativeSelect>
      {c.field !== 'amountAtLeast' && c.field !== 'contact' && (
        <NativeSelect aria-label="Is or is not" className="h-9 w-auto" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as 'IS' | 'IS_NOT' })}>
          <option value="IS">is</option>
          <option value="IS_NOT">is not</option>
        </NativeSelect>
      )}
      {c.field === 'species' && <ValuesPicker label="Species" list={options?.species ?? []} values={c.values} onChange={(values) => onChange({ ...c, values })} />}
      {c.field === 'branch' && <ValuesPicker label="Branches" list={options?.branches ?? []} values={c.values} onChange={(values) => onChange({ ...c, values })} />}
      {c.field === 'appointmentType' && <ValuesPicker label="Appointment types" list={options?.appointmentTypes ?? []} values={c.values} onChange={(values) => onChange({ ...c, values })} />}
      {c.field === 'contact' &&
        (['WHATSAPP', 'EMAIL'] as const).map((v) => (
          <label key={v} className="flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm ring-1 ring-inset ring-foreground/15">
            <Checkbox checked={c.values.includes(v)} onCheckedChange={() => toggleValue(v)} /> {v === 'WHATSAPP' ? 'WhatsApp' : 'Email'}
          </label>
        ))}
      {c.field === 'source' &&
        (['ONLINE', 'STAFF'] as const).map((v) => (
          <label key={v} className="flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm ring-1 ring-inset ring-foreground/15">
            <Checkbox checked={c.values.includes(v)} onCheckedChange={() => toggleValue(v)} /> {v === 'ONLINE' ? 'Online' : 'By staff'}
          </label>
        ))}
      {c.field === 'amountAtLeast' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{currency}</span>
          <Input aria-label="Amount" inputMode="decimal" className="h-9 w-32" value={c.values[0] ? String(Number(c.values[0]) / 100) : ''} onChange={(e) => onChange({ ...c, values: e.target.value ? [String(Math.round(Number(e.target.value.replace(/[^\d.]/g, '')) * 100))] : [] })} />
        </div>
      )}
      <Button type="button" size="icon-sm" variant="ghost" className="ml-auto" aria-label="Remove condition" onClick={onRemove}>
        <X />
      </Button>
    </div>
  );
}

function StepCard({ s, i, count, trigger, options, set, move, remove }: { s: Step; i: number; count: number; trigger: AutomationTrigger; options?: AutomationOptions; set: (p: Partial<AutomationStep>) => void; move: (d: -1 | 1) => void; remove: () => void }) {
  const info = STEP_INFO[s.type];
  const appointmentTrigger = trigger.startsWith('APPOINTMENT_');
  return (
    <div className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-3">
      <div className="flex flex-col items-center">
        <span className={cn('z-10 flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br', info.tone)}>
          <info.icon className="h-4 w-4" />
        </span>
        {i < count - 1 && <span className="w-px flex-1 bg-foreground/15" />}
      </div>
      <Card className="mb-3 min-w-0">
        <div className="flex items-center gap-2 border-b border-foreground/[0.06] px-4 py-2.5">
          <p className="min-w-0 flex-1 text-sm font-semibold">
            <span className="mr-2 text-muted-foreground">{i + 1}.</span>
            {info.label}
          </p>
          <Button type="button" size="icon-sm" variant="ghost" disabled={i === 0} aria-label="Move up" onClick={() => move(-1)}>
            <ArrowUp />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" disabled={i === count - 1} aria-label="Move down" onClick={() => move(1)}>
            <ArrowDown />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" className="text-destructive" disabled={count === 1} aria-label="Remove step" onClick={remove}>
            <Trash2 />
          </Button>
        </div>
        <CardContent className="pt-4">
          {s.type === 'SEND_MESSAGE' && <MessageEditor s={s} trigger={trigger} set={set} options={options} />}
          {s.type === 'WAIT' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Wait</span>
              <Input aria-label="How long" inputMode="numeric" className="h-9 w-20" value={String(s.amount)} onChange={(e) => set({ amount: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })} />
              <NativeSelect aria-label="Unit" className="h-9 w-auto" value={s.unit} onChange={(e) => set({ unit: e.target.value as 'MINUTES' | 'HOURS' | 'DAYS' })}>
                <option value="MINUTES">minutes</option>
                <option value="HOURS">hours</option>
                <option value="DAYS">days</option>
              </NativeSelect>
              <span className="text-sm text-muted-foreground">then carry on. {appointmentTrigger ? 'It stops by itself if the appointment is cancelled meanwhile.' : 'It stops by itself if it no longer applies.'}</span>
            </div>
          )}
          {s.type === 'CREATE_TASK' && (
            <div className="grid gap-4">
              <TextWithVars id={`task-${s.key}`} label="Task" rows={1} required value={s.title} onChange={(v) => set({ title: v })} trigger={trigger} placeholder="e.g. Call to check on {{petName}}" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Due" htmlFor={`due-${s.key}`}>
                  <NativeSelect id={`due-${s.key}`} value={String(s.dueInDays)} onChange={(e) => set({ dueInDays: Number(e.target.value) })}>
                    {[0, 1, 2, 3, 7, 14].map((d) => (
                      <option key={d} value={d}>
                        {d === 0 ? 'The same day' : d === 1 ? 'The next day' : `${d} days later`}
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
          )}
          {s.type === 'EMAIL_TEAM' && (
            <div className="grid gap-4">
              <Field label="To" htmlFor={`to-${s.key}`} required hint="e.g. the manager or the front desk">
                <Input id={`to-${s.key}`} type="email" value={s.to} onChange={(e) => set({ to: e.target.value })} placeholder="manager@yourclinic.com" />
              </Field>
              <TextWithVars id={`ts-${s.key}`} label="Subject" rows={1} required value={s.subject} onChange={(v) => set({ subject: v })} trigger={trigger} />
              <TextWithVars id={`tb-${s.key}`} label="Message" required value={s.body} onChange={(v) => set({ body: v })} trigger={trigger} />
            </div>
          )}
        </CardContent>
      </Card>
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
            {result.steps.map((s, i) => (
              <div key={i} className="rounded-xl surface-flat p-3 text-sm">
                <p className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {i + 1}. {STEP_INFO[s.type as AutomationStep['type']]?.label ?? s.type}
                  {s.when && <Badge variant="outline">{s.when}</Badge>}
                  {s.channel && <Badge>{s.channel === 'WHATSAPP' ? 'WhatsApp' : s.channel === 'EMAIL' ? 'Email' : s.channel}</Badge>}
                </p>
                {s.type === 'WAIT' && <p>{s.note}</p>}
                {s.recipient && <p className="text-xs text-muted-foreground">To {s.recipient}</p>}
                {s.subject && <p className="font-semibold">{s.subject}</p>}
                {s.body && <p className="whitespace-pre-wrap">{s.body}</p>}
                {s.title && <p className="font-semibold">{s.title}</p>}
                {s.details && <p>{s.details}</p>}
                {s.note && s.type !== 'WAIT' && <p className="mt-1 text-xs text-warning">{s.note}</p>}
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Builder() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { currency } = useSession();
  const isNew = id === 'new';
  const existing = useQuery({ queryKey: ['automation', id], queryFn: () => api.get<Draft & { steps: AutomationStep[] }>(`/automations/${id}`), enabled: !isNew });
  const options = useQuery({ queryKey: ['automation-options'], queryFn: () => api.get<AutomationOptions>('/automations/options'), staleTime: 60_000 });
  const [d, setD] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  useEffect(() => {
    if (d) return;
    if (isNew) {
      const r = AUTOMATION_RECIPES.find((x) => x.key === params.get('recipe'));
      if (r) {
        const a = r.automation;
        setD({ name: a.name, description: a.description ?? '', isActive: true, marketing: !!a.marketing, trigger: a.trigger, offset: a.offset ?? null, atHour: a.atHour ?? null, conditions: (a.conditions ?? []) as AutomationCondition[], steps: withKeys(a.steps as AutomationStep[]) });
      } else setD(blankDraft());
    } else if (existing.data) {
      const a = existing.data;
      setD({ name: a.name, description: a.description ?? '', isActive: a.isActive, marketing: a.marketing, trigger: a.trigger, offset: a.offset, atHour: a.atHour, conditions: a.conditions, steps: withKeys(a.steps) });
    }
  }, [isNew, params, existing.data, d]);

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
        conditions: d.conditions.filter((c) => c.values.length),
        steps: d.steps.map((s) => {
          const copy: Partial<Step> = { ...s };
          delete copy.key;
          return copy as AutomationStep;
        }),
      },
    [d],
  );
  const save = useMutation({
    mutationFn: () => (isNew ? api.post<{ id: string }>('/automations', payload) : api.put<{ id: string }>(`/automations/${id}`, payload)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      qc.invalidateQueries({ queryKey: ['automation', id] });
      toast.success(d!.isActive ? `“${d!.name}” is on` : `“${d!.name}” saved (off)`);
      router.push('/settings/automations');
    },
    onError: (e: Error) => {
      setError(e.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });
  const tryIt = useMutation({
    mutationFn: () => api.post<PreviewResult>('/automations/preview', { automation: payload }),
    onSuccess: (r) => setPreview(r),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isNew && existing.isLoading) return <LoadingRows rows={8} />;
  if (existing.error) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;
  if (!d) return <LoadingRows rows={8} />;

  const info = TRIGGER_INFO[d.trigger];
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const setStep = (i: number, p: Partial<AutomationStep>) => set({ steps: d.steps.map((s, j) => (j === i ? ({ ...s, ...p } as Step) : s)) });
  const move = (i: number, dir: -1 | 1) => {
    const steps = [...d.steps];
    [steps[i], steps[i + dir]] = [steps[i + dir], steps[i]];
    set({ steps });
  };
  const chooseTrigger = (t: AutomationTrigger) => {
    const timed = TRIGGER_INFO[t].timed;
    const allowed = new Set(TRIGGER_INFO[t].conditions);
    set({ trigger: t, offset: timed === 'HOURS_BEFORE' ? (d.offset ?? 24) : timed === 'DAYS_BEFORE' ? (d.offset ?? 7) : null, atHour: timed && timed !== 'HOURS_BEFORE' ? (d.atHour ?? 10) : null, conditions: d.conditions.filter((c) => allowed.has(c.field)) });
  };
  const groups = [...new Set(AUTOMATION_TRIGGERS.map((t) => TRIGGER_INFO[t].group))];
  const missing = !d.name.trim() ? 'Give the automation a name' : d.steps.some((s) => (s.type === 'SEND_MESSAGE' && !s.body.trim()) || (s.type === 'CREATE_TASK' && !s.title.trim()) || (s.type === 'EMAIL_TEAM' && (!s.to.trim() || !s.subject.trim() || !s.body.trim()))) ? 'Fill in every step' : !d.steps.some((s) => s.type !== 'WAIT') ? 'Add a message or a task' : d.steps[d.steps.length - 1]?.type === 'WAIT' ? 'A wait cannot be the last step' : null;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings/automations">
            <ArrowLeft /> Automations
          </Link>
        </Button>
        <h2 className="min-w-0 flex-1 text-xl font-semibold tracking-tight">{isNew ? 'New automation' : d.name || 'Automation'}</h2>
      </div>
      {error && <FormError message={error} />}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="order-2 grid content-start gap-6 2xl:order-1">
          <Card>
            <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
              <Field label="Name" htmlFor="au-name" required>
                <Input id="au-name" value={d.name} placeholder="e.g. Thank you after a visit" onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="Description (optional)" htmlFor="au-desc">
                <Input id="au-desc" value={d.description} onChange={(e) => set({ description: e.target.value })} />
              </Field>
            </CardContent>
          </Card>

          {/* 1. When */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Badge>1</Badge> When
                </CardTitle>
                <CardDescription className="mt-1">What starts it.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5">
              {groups.map((g) => (
                <div key={g} className="grid gap-2">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {AUTOMATION_TRIGGERS.filter((t) => TRIGGER_INFO[t].group === g).map((t) => {
                      const Icon = TRIGGER_ICONS[t];
                      const on = d.trigger === t;
                      return (
                        <button key={t} type="button" role="radio" aria-checked={on} onClick={() => chooseTrigger(t)} className={cn('flex items-center gap-2.5 rounded-xl p-3 text-left text-sm ring-1 ring-inset transition-colors', on ? 'bg-primary/10 font-semibold text-primary ring-primary' : 'ring-foreground/10 hover:bg-foreground/[0.03]')}>
                          <Icon className="h-4 w-4 shrink-0" />
                          {TRIGGER_INFO[t].label}
                          {TRIGGER_INFO[t].timed && <Clock className="ml-auto h-3.5 w-3.5 opacity-60" aria-label="At a set time" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {info.timed && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-primary/[0.05] p-3 text-sm">
                  {info.timed === 'HOURS_BEFORE' && (
                    <>
                      <NativeSelect aria-label="Hours before" className="h-9 w-auto" value={String(d.offset ?? 24)} onChange={(e) => set({ offset: Number(e.target.value) })}>
                        {HOURS_BEFORE.map((h) => (
                          <option key={h} value={h}>
                            {h === 1 ? '1 hour' : `${h} hours`}
                          </option>
                        ))}
                      </NativeSelect>
                      before the appointment
                    </>
                  )}
                  {info.timed === 'DAYS_BEFORE' && (
                    <>
                      <NativeSelect aria-label="Days before" className="h-9 w-auto" value={String(d.offset ?? 7)} onChange={(e) => set({ offset: Number(e.target.value) })}>
                        {DAYS_BEFORE.map((n) => (
                          <option key={n} value={n}>
                            {n === 0 ? 'On the day' : n === 1 ? '1 day before' : `${n} days before`}
                          </option>
                        ))}
                      </NativeSelect>
                      it is due,
                    </>
                  )}
                  {info.timed !== 'HOURS_BEFORE' && (
                    <>
                      at
                      <NativeSelect aria-label="Time of day" className="h-9 w-auto" value={String(d.atHour ?? 10)} onChange={(e) => set({ atHour: Number(e.target.value) })}>
                        {Array.from({ length: 15 }, (_, k) => k + 7).map((h) => (
                          <option key={h} value={h}>
                            {hourLabel(h)}
                          </option>
                        ))}
                      </NativeSelect>
                      clinic time
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 2. Only if */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Badge>2</Badge> Only if <span className="text-sm font-normal text-muted-foreground">(optional)</span>
                </CardTitle>
                <CardDescription className="mt-1">Leave empty to run for everyone.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {d.conditions.map((c, i) => (
                <ConditionRow key={i} c={c} trigger={d.trigger} options={options.data} currency={currency} onChange={(nc) => set({ conditions: d.conditions.map((x, j) => (j === i ? nc : x)) })} onRemove={() => set({ conditions: d.conditions.filter((_, j) => j !== i) })} />
              ))}
              <div>
                <Button type="button" size="sm" variant="outline" onClick={() => set({ conditions: [...d.conditions, { field: info.conditions[0], op: 'IS', values: [] }] })}>
                  <Plus /> Add a condition
                </Button>
              </div>
              <label className="flex items-start justify-between gap-4 border-t border-foreground/[0.06] pt-4">
                <span>
                  <span className="block text-sm font-semibold">Promotional message</span>
                  <span className="block text-sm text-muted-foreground">Only clients who agreed to marketing messages get it (e.g. birthday offers). Clients who asked for no messages never get any.</span>
                </span>
                <Switch checked={d.marketing} onCheckedChange={(v) => set({ marketing: v })} aria-label="Promotional message" />
              </label>
            </CardContent>
          </Card>

          {/* 3. Then */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Badge>3</Badge> Then
                </CardTitle>
                <CardDescription className="mt-1">The steps, in order.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {d.steps.map((s, i) => (
                <StepCard key={s.key} s={s} i={i} count={d.steps.length} trigger={d.trigger} options={options.data} set={(p) => setStep(i, p)} move={(dir) => move(i, dir)} remove={() => set({ steps: d.steps.filter((_, j) => j !== i) })} />
              ))}
              <div className="ml-[52px] flex flex-wrap gap-2">
                {(Object.keys(NEW_STEP) as AutomationStep['type'][]).map((t) => {
                  const Icon = STEP_INFO[t].icon;
                  return (
                    <Button key={t} type="button" size="sm" variant="outline" disabled={d.steps.length >= 12} onClick={() => set({ steps: [...d.steps, { ...NEW_STEP[t](), key: key() } as Step] })}>
                      <Icon /> {t === 'SEND_MESSAGE' ? 'Message' : t === 'WAIT' ? 'Wait' : t === 'CREATE_TASK' ? 'Task' : 'Email the team'}
                    </Button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="order-1 grid content-start gap-4 2xl:sticky 2xl:top-24 2xl:order-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Workflow className="h-4 w-4 text-primary" /> Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <p className="text-sm leading-relaxed">{payload && describeAutomation(payload, options.data)}</p>
              <label className="flex items-center justify-between gap-3 rounded-xl surface-flat px-3 py-2.5 text-sm font-medium">
                Switched on
                <Switch checked={d.isActive} onCheckedChange={(v) => set({ isActive: v })} aria-label="Switched on" />
              </label>
              {missing && <p className="text-sm text-muted-foreground">{missing}</p>}
              <Button className="w-full" disabled={!!missing} loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>
                <Save /> {isNew ? 'Save automation' : 'Save changes'}
              </Button>
              <Button className="w-full" variant="outline" disabled={!!missing} loading={tryIt.isPending} onClick={() => tryIt.mutate()}>
                <Play /> Try it on a real record
              </Button>
              <p className="text-xs text-muted-foreground">Messages respect each client’s choices, go once per record, and are listed under Messages. Waiting runs stop by themselves when they no longer apply.</p>
            </CardContent>
          </Card>
        </div>
      </div>
      {preview && <PreviewDialog result={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

export default function AutomationBuilderPage() {
  return (
    <RequirePermission anyOf={['settings.manage', 'integrations.manage']}>
      <Suspense>
        <Builder />
      </Suspense>
    </RequirePermission>
  );
}
