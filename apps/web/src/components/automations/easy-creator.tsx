'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AUTOMATION_RECIPES, AUTOMATION_TRIGGERS, AUTOMATION_VARIABLES, EASY_DELAYS, TRIGGER_DEFAULTS, TRIGGER_INFO, sampleVars, type AutomationDraft, type AutomationStep, type AutomationTrigger, type TriggerGroup } from '@vcms/shared';
import { ArrowLeft, ArrowRight, Check, ClipboardList, Clock, Mail, MessageCircle, Play, Search, Send, Settings2, Sparkles, Wand2, Workflow } from 'lucide-react';
import Link from 'next/link';
import { PlanLockBadge, usePlanFeature } from '@/components/plan/upgrade';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '../forms/form-error';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { describeAutomation, type AutomationOptions } from './describe';
import { GROUP_TONE, TRIGGER_ICONS } from './flow-ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const GROUPS: TriggerGroup[] = ['Appointments', 'Clinical', 'Money', 'Clients & pets'];
const render = (text: string, vars: Record<string, string>) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
const STEPS = ['What starts it', 'What to do', 'Check & turn on'];

type Choice = 'BEST' | 'WHATSAPP' | 'EMAIL';

/**
 * The easy way to make an automation: three plain questions, with the wording already filled in. Anything can still
 * be changed afterwards in the full editor.
 */
export function EasyCreator() {
  const builder = usePlanFeature('automationBuilder');
  const router = useRouter();
  const qc = useQueryClient();
  const options = useQuery({ queryKey: ['automation-options'], queryFn: () => api.get<AutomationOptions>('/automations/options'), staleTime: 60_000 });
  const [step, setStep] = useState(0);
  const [trigger, setTrigger] = useState<AutomationTrigger | null>(null);
  const [group, setGroup] = useState<TriggerGroup | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  // What to do
  const [message, setMessage] = useState(true);
  const [channel, setChannel] = useState<Choice>('BEST');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [delayIdx, setDelayIdx] = useState(0);
  const [task, setTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [species, setSpecies] = useState<string[]>([]);
  const [offset, setOffset] = useState<number | null>(null);
  const [atHour, setAtHour] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const choose = (t: AutomationTrigger) => {
    const d = TRIGGER_DEFAULTS[t];
    const timed = TRIGGER_INFO[t].timed;
    setTrigger(t);
    setSubject(d.subject);
    setBody(d.body);
    setTaskTitle(d.taskTitle);
    setDelayIdx(Math.max(0, EASY_DELAYS.findIndex((e) => JSON.stringify(e.value) === JSON.stringify(d.delay))));
    setTask(false);
    setMessage(true);
    setSpecies([]);
    setOffset(timed === 'HOURS_BEFORE' ? 24 : timed === 'DAYS_BEFORE' || timed === 'DAYS_AFTER' ? 7 : timed === 'MONTHS_SINCE' ? 12 : null);
    setAtHour(timed && timed !== 'HOURS_BEFORE' ? 10 : null);
    setName(TRIGGER_INFO[t].label);
    setStep(1);
  };

  const info = trigger ? TRIGGER_INFO[trigger] : null;
  const canFilterSpecies = !!info?.conditions.includes('species');
  const delay = EASY_DELAYS[delayIdx]?.value ?? null;
  const draft: AutomationDraft | null = useMemo(() => {
    if (!trigger) return null;
    const steps: AutomationStep[] = [];
    if (delay) steps.push({ type: 'WAIT', amount: delay.amount, unit: delay.unit });
    if (message) steps.push({ type: 'SEND_MESSAGE', channel, subject: subject || null, body });
    if (task) steps.push({ type: 'CREATE_TASK', title: taskTitle, details: null, dueInDays: 0, assigneeId: null });
    return {
      name: name.trim(),
      description: null,
      isActive: true,
      trigger,
      offset: offset ?? undefined,
      atHour: atHour ?? undefined,
      conditions: species.length ? [{ field: 'species', op: 'IS', values: species }] : [],
      steps,
    } as AutomationDraft;
  }, [trigger, delay, message, channel, subject, body, task, taskTitle, species, offset, atHour, name]);

  const problem = !message && !task ? 'Choose at least one thing to do' : message && !body.trim() ? 'Write the message' : task && !taskTitle.trim() ? 'Give the task a title' : !name.trim() ? 'Give it a name' : null;
  const save = useMutation({
    mutationFn: (isActive: boolean) => api.post<{ id: string }>('/automations', { ...draft, isActive }),
    onSuccess: (r, isActive) => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      qc.invalidateQueries({ queryKey: ['automation-stats'] });
      toast.success(isActive ? `“${name}” is on` : 'Saved (off) — fine-tune it here');
      router.push(isActive ? '/settings/automations' : `/settings/automations/${r.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });
  const tryIt = useMutation({
    mutationFn: () => api.post<{ example: { label: string } | null; steps: { type: string; body?: string; subject?: string | null; title?: string; recipient?: string | null }[] }>('/automations/preview', { automation: draft }),
    onError: (e: Error) => toast.error(e.message),
  });

  // Offers on a date (a group of clients, a date to choose) are made in the full editor, from the Marketing tab.
  const list = AUTOMATION_TRIGGERS.filter((t) => TRIGGER_INFO[t].group !== 'Marketing' && (group === 'ALL' || TRIGGER_INFO[t].group === group) && (!q || `${TRIGGER_INFO[t].label} ${TRIGGER_INFO[t].when}`.toLowerCase().includes(q.toLowerCase())));
  const sample = trigger ? sampleVars(trigger) : {};
  const insert = (v: string) => {
    const el = bodyRef.current;
    const at = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? at;
    setBody(body.slice(0, at) + v + body.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + v.length, at + v.length);
    });
  };

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings/automations">
            <ArrowLeft /> Automations
          </Link>
        </Button>
        {builder ? (
          <Link href="/settings/automations/new?mode=advanced" className="ml-auto text-sm font-semibold text-primary hover:underline">
            <Settings2 className="mr-1 inline h-3.5 w-3.5" />
            Open the full editor instead
          </Link>
        ) : (
          <Link href="/settings/plan?unlock=automationBuilder" className="ml-auto inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-primary">
            Full editor <PlanLockBadge />
          </Link>
        )}
      </div>

      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Make an automation</h2>
        <p className="text-sm text-muted-foreground">Three quick questions. The wording is already written for you — change anything you like.</p>
      </div>

      <ol className="flex items-center gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <button type="button" disabled={i > step || (i > 0 && !trigger)} onClick={() => setStep(i)} className={cn('flex items-center gap-2 text-left text-sm font-medium', i === step ? 'text-foreground' : i < step ? 'text-primary' : 'text-muted-foreground')}>
              <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', i < step ? 'bg-primary text-primary-foreground' : i === step ? 'bg-gradient-to-br from-primary to-brand-2 text-white shadow' : 'bg-foreground/[0.07]')}>{i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
              <span className="hidden sm:inline">{s}</span>
            </button>
            {i < STEPS.length - 1 && <span className={cn('h-px flex-1', i < step ? 'bg-primary' : 'bg-foreground/15')} />}
          </li>
        ))}
      </ol>
      {error && <FormError message={error} />}

      {step === 0 && (
        <div className="grid gap-5">
          <Card className="grid gap-3 p-5">
            <p className="flex items-center gap-2 font-semibold">
              <Sparkles className="h-4 w-4 text-primary" /> Quickest: start from a ready-made one
            </p>
            <div className="flex flex-wrap gap-2">
              {AUTOMATION_RECIPES.slice(0, 8).map((r) => (
                <Link key={r.key} href={`/settings/automations/new?recipe=${r.key}`} className="rounded-pill bg-primary/[0.07] px-3 py-1.5 text-sm font-medium text-primary ring-1 ring-inset ring-primary/15 transition-colors hover:bg-primary/15">
                  {r.automation.name}
                </Link>
              ))}
              <Link href="/settings/automations?tab=recipes" className="rounded-pill px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                See all {AUTOMATION_RECIPES.length} →
              </Link>
            </div>
          </Card>
          <div className="grid gap-3">
            <p className="text-lg font-semibold">When should it happen?</p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex flex-wrap gap-1 rounded-pill bg-foreground/[0.04] p-1" role="radiogroup" aria-label="Group">
                {(['ALL', ...GROUPS] as const).map((g) => (
                  <button key={g} type="button" role="radio" aria-checked={group === g} onClick={() => setGroup(g)} className={cn('rounded-pill px-3 py-1.5 text-sm font-medium', group === g ? 'bg-card shadow-sm ring-1 ring-foreground/10' : 'text-muted-foreground')}>
                    {g === 'ALL' ? 'All' : g}
                  </button>
                ))}
              </div>
              <div className="relative w-full sm:ml-auto sm:w-56">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {list.map((t) => {
                const i = TRIGGER_INFO[t];
                const Icon = TRIGGER_ICONS[t];
                return (
                  <button key={t} type="button" onClick={() => choose(t)} className="flex items-start gap-3 rounded-2xl bg-card p-3.5 text-left ring-1 ring-inset ring-foreground/10 transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-primary/40">
                    <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', GROUP_TONE[i.group].tile)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="flex items-center gap-1.5 font-semibold">
                        {i.label}
                        {i.timed && <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-label="At a set time" />}
                      </span>
                      <span className="block text-sm text-muted-foreground">When {i.when}</span>
                    </span>
                  </button>
                );
              })}
              {!list.length && <p className="col-span-full py-6 text-center text-sm text-muted-foreground">Nothing matches “{q}”.</p>}
            </div>
          </div>
        </div>
      )}

      {step === 1 && trigger && info && (
        <div className="grid gap-5">
          <div className="flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-inset ring-foreground/10">
            <span className={cn('flex h-11 w-11 items-center justify-center rounded-2xl', GROUP_TONE[info.group].tile)}>
              {(() => {
                const Icon = TRIGGER_ICONS[trigger];
                return <Icon className="h-5 w-5" />;
              })()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">When</p>
              <p className="font-semibold">{info.label}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setStep(0)}>
              Change
            </Button>
          </div>

          {info.timed && (
            <Card className="flex flex-wrap items-center gap-2 p-4 text-sm">
              <Clock className="h-4 w-4 text-primary" />
              {info.timed === 'HOURS_BEFORE' && (
                <>
                  <NativeSelect aria-label="Hours before" className="h-10 w-auto font-semibold" value={String(offset)} onChange={(e) => setOffset(Number(e.target.value))}>
                    {[1, 2, 3, 6, 12, 24, 48, 72].map((h) => (
                      <option key={h} value={h}>
                        {h === 1 ? '1 hour' : h === 24 ? '1 day (24 hours)' : `${h} hours`}
                      </option>
                    ))}
                  </NativeSelect>
                  before it starts
                </>
              )}
              {(info.timed === 'DAYS_BEFORE' || info.timed === 'DAYS_AFTER') && (
                <>
                  <NativeSelect aria-label="Days" className="h-10 w-auto font-semibold" value={String(offset)} onChange={(e) => setOffset(Number(e.target.value))}>
                    {(info.timed === 'DAYS_BEFORE' ? [0, 1, 2, 3, 7, 14, 30] : [1, 3, 7, 14, 30]).map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? 'On the day' : n === 1 ? '1 day' : `${n} days`}
                      </option>
                    ))}
                  </NativeSelect>
                  {info.timed === 'DAYS_BEFORE' ? 'before it is due' : 'after the due date, if still unpaid'}
                </>
              )}
              {info.timed === 'MONTHS_SINCE' && (
                <>
                  <NativeSelect aria-label="Months" className="h-10 w-auto font-semibold" value={String(offset)} onChange={(e) => setOffset(Number(e.target.value))}>
                    {[3, 6, 9, 12, 18, 24].map((n) => (
                      <option key={n} value={n}>
                        {n} months
                      </option>
                    ))}
                  </NativeSelect>
                  after the last visit, if nothing is booked
                </>
              )}
              {info.timed !== 'HOURS_BEFORE' && (
                <>
                  at
                  <NativeSelect aria-label="Time of day" className="h-10 w-auto font-semibold" value={String(atHour ?? 10)} onChange={(e) => setAtHour(Number(e.target.value))}>
                    {Array.from({ length: 15 }, (_, k) => k + 7).map((h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00
                      </option>
                    ))}
                  </NativeSelect>
                </>
              )}
            </Card>
          )}

          <p className="text-lg font-semibold">What should happen?</p>

          <Card className={cn('grid gap-4 p-5 transition-shadow', message && 'ring-1 ring-primary/30')}>
            <label className="flex cursor-pointer items-center gap-3">
              <input type="checkbox" className="h-5 w-5 accent-[hsl(var(--primary))]" checked={message} onChange={(e) => setMessage(e.target.checked)} />
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-brand-2 text-white">
                <Send className="h-4 w-4" />
              </span>
              <span className="font-semibold">Send the client a message</span>
            </label>
            {message && (
              <div className="grid gap-4 pl-1 sm:pl-12">
                <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                  <span className="text-sm text-muted-foreground">Send it</span>
                  <NativeSelect aria-label="When to send" className="h-10 sm:w-56" value={String(delayIdx)} onChange={(e) => setDelayIdx(Number(e.target.value))}>
                    {EASY_DELAYS.map((e, i) => (
                      <option key={e.label} value={i}>
                        {e.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Through</span>
                  {([['BEST', 'Best channel', Sparkles], ['WHATSAPP', 'WhatsApp', MessageCircle], ['EMAIL', 'Email', Mail]] as const).map(([v, label, Icon]) => (
                    <button key={v} type="button" aria-pressed={channel === v} onClick={() => setChannel(v)} className={cn('flex items-center gap-1.5 rounded-pill px-3 py-1.5 font-medium ring-1 ring-inset', channel === v ? 'bg-primary text-primary-foreground ring-primary' : 'ring-foreground/15 hover:bg-foreground/[0.04]')}>
                      <Icon className="h-3.5 w-3.5" /> {label}
                    </button>
                  ))}
                  {channel === 'BEST' && <span className="basis-full text-xs text-muted-foreground">WhatsApp if connected, otherwise email — whatever the client prefers.</span>}
                  {channel === 'WHATSAPP' && options.data && !options.data.channels.whatsapp && <span className="basis-full text-xs text-warning">WhatsApp is not connected yet, so these would not be sent.</span>}
                </div>
                {channel !== 'WHATSAPP' && <Input aria-label="Email subject" value={subject} placeholder="Email subject" onChange={(e) => setSubject(e.target.value)} />}
                <Textarea ref={bodyRef} aria-label="Message" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Add:</span>
                  {info.variables.slice(0, 10).map((v) => (
                    <button key={v} type="button" onClick={() => insert(`{{${v}}}`)} className="rounded-pill bg-primary/[0.08] px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary/15 hover:bg-primary/15">
                      {AUTOMATION_VARIABLES[v]?.label ?? v}
                    </button>
                  ))}
                  <button type="button" onClick={() => { setSubject(TRIGGER_DEFAULTS[trigger].subject); setBody(TRIGGER_DEFAULTS[trigger].body); }} className="ml-auto flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    <Wand2 className="h-3 w-3" /> Use the suggested wording again
                  </button>
                </div>
                <div className="rounded-2xl bg-[#efeae2] p-3 dark:bg-[#0b141a]">
                  <div className="ml-auto max-w-sm whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-[13px] leading-snug text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]">{render(body, sample) || 'Your message…'}</div>
                </div>
              </div>
            )}
          </Card>

          <Card className={cn('grid gap-3 p-5 transition-shadow', task && 'ring-1 ring-warning/40')}>
            <label className="flex cursor-pointer items-center gap-3">
              <input type="checkbox" className="h-5 w-5 accent-[hsl(var(--primary))]" checked={task} onChange={(e) => setTask(e.target.checked)} />
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning/15 text-warning">
                <ClipboardList className="h-4 w-4" />
              </span>
              <span className="font-semibold">Give staff a task (for example, a call)</span>
            </label>
            {task && (
              <div className="pl-1 sm:pl-12">
                <Input aria-label="Task" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">Appears on the task list — for the vet where there is one, otherwise for everyone.</p>
              </div>
            )}
          </Card>

          {canFilterSpecies && options.data && options.data.species.length > 0 && (
            <Card className="grid gap-3 p-5">
              <p className="font-semibold">For which animals?</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" aria-pressed={!species.length} onClick={() => setSpecies([])} className={cn('rounded-pill px-3 py-1.5 text-sm font-medium ring-1 ring-inset', !species.length ? 'bg-primary text-primary-foreground ring-primary' : 'ring-foreground/15')}>
                  All animals
                </button>
                {options.data.species.map((s) => (
                  <button key={s.id} type="button" aria-pressed={species.includes(s.id)} onClick={() => setSpecies(species.includes(s.id) ? species.filter((x) => x !== s.id) : [...species, s.id])} className={cn('rounded-pill px-3 py-1.5 text-sm font-medium ring-1 ring-inset', species.includes(s.id) ? 'bg-primary text-primary-foreground ring-primary' : 'ring-foreground/15 hover:bg-foreground/[0.04]')}>
                    {s.name}
                  </button>
                ))}
              </div>
            </Card>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setStep(0)}>
              <ArrowLeft /> Back
            </Button>
            <div className="flex items-center gap-3">
              {problem && <span className="text-sm text-muted-foreground">{problem}</span>}
              <Button disabled={!!problem && problem !== 'Give it a name'} onClick={() => setStep(2)}>
                Next <ArrowRight />
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && trigger && draft && (
        <div className="grid gap-5">
          <Card className="grid gap-4 p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-brand-2 text-white">
                <Workflow className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold">Here is what will happen</p>
                <p className="text-sm text-muted-foreground">Read it through, then turn it on.</p>
              </div>
            </div>
            <p className="rounded-2xl bg-primary/[0.05] p-4 text-sm leading-relaxed ring-1 ring-inset ring-primary/10">{describeAutomation(draft, options.data)}.</p>
            <label className="grid gap-1.5 text-sm font-medium">
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Thank you after a visit" />
            </label>
          </Card>

          <Card className="grid gap-3 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="mr-auto">
                <p className="font-semibold">Try it first</p>
                <p className="text-sm text-muted-foreground">See exactly what a real client would get. Nothing is sent.</p>
              </div>
              <Button variant="outline" loading={tryIt.isPending} disabled={!!problem} onClick={() => tryIt.mutate()}>
                <Play /> Show me
              </Button>
            </div>
            {tryIt.data &&
              (tryIt.data.example ? (
                <div className="grid gap-2">
                  <p className="text-xs text-muted-foreground">On a recent real record: {tryIt.data.example.label}</p>
                  {tryIt.data.steps
                    .filter((s) => s.body || s.title)
                    .map((s, i) => (
                      <div key={i} className="rounded-xl bg-foreground/[0.03] p-3 text-sm ring-1 ring-inset ring-foreground/[0.06]">
                        {s.recipient && <p className="text-xs text-muted-foreground">To {s.recipient}</p>}
                        {s.subject && <p className="font-semibold">{s.subject}</p>}
                        <p className="whitespace-pre-wrap">{s.body ?? s.title}</p>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">There is no record of this kind yet to try it on — it will work as soon as one happens.</p>
              ))}
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ArrowLeft /> Back
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" disabled={!!problem} loading={save.isPending && save.variables === false} onClick={() => { setError(null); save.mutate(false); }}>
                <Settings2 /> Save and fine-tune
              </Button>
              <Button disabled={!!problem} loading={save.isPending && save.variables === true} onClick={() => { setError(null); save.mutate(true); }}>
                <Check /> Turn it on
              </Button>
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            <Badge variant="outline">Safe</Badge> Each client gets it once, only if they agreed to messages, and it stops by itself if it no longer applies.
          </p>
        </div>
      )}
    </div>
  );
}
