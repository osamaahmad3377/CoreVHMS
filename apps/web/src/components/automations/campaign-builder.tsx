'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AUTOMATION_VARIABLES,
  EASY_DELAYS,
  OFFER_REPEAT_LABELS,
  TRIGGER_INFO,
  fitsWithoutBuilder,
  formatMoney,
  nextOfferDay,
  sampleVars,
  type AutomationCondition,
  type AutomationDraft,
  type AutomationStep,
  type AutomationTrigger,
  type OfferRepeat,
} from '@vcms/shared';
import { ArrowLeft, ArrowRight, BookmarkPlus, CalendarDays, Check, Clock, FlaskConical, Gift, Mail, Megaphone, MessageCircle, Newspaper, Percent, Plus, Rocket, Save, ShieldCheck, Sparkles, Tag, Users, Wallet, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AudienceCard, ConditionRow } from '@/components/automations/conditions';
import { conditionText, describeAutomation, hourLabel, offerScheduleText, type AutomationOptions } from '@/components/automations/describe';
import { GROUP_TONE, TRIGGER_ICONS } from '@/components/automations/flow-ui';
import { SaveTemplateDialog } from '@/components/automations/templates';
import { FormError } from '@/components/forms/form-error';
import { UpgradeCard, usePlanFeature } from '@/components/plan/upgrade';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDateOnly } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

type Kind = 'DATE' | 'EVENT';
type OfferType = 'PERCENT' | 'AMOUNT' | 'FREE' | 'NEWS';
interface Offer {
  type: OfferType;
  value: string;
  on: string;
  code: string;
  validDays: number;
}

const STEPS = ['Type', 'Audience', 'Offer & message', 'Schedule', 'Review'];
const localDay = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA');
const render = (text: string, vars: Record<string, string>) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Campaigns that start on something happening (each client, when it happens). */
const EVENTS: { trigger: AutomationTrigger; title: string; text: string; lead: string }[] = [
  { trigger: 'PET_BIRTHDAY', title: 'Birthday treat', text: 'On each pet’s birthday', lead: 'Happy birthday to {{petName}} from all of us at {{clinicName}}! Our gift to you:' },
  { trigger: 'CLIENT_REGISTERED', title: 'Welcome offer', text: 'When a new client joins', lead: 'Hello {{clientName}}, welcome to {{clinicName}}! As a new client you get' },
  { trigger: 'APPOINTMENT_COMPLETED', title: 'After a visit', text: 'A thank-you with an offer for next time', lead: 'Hello {{clientName}}, thank you for bringing {{petName}} to {{clinicName}}. For your next visit:' },
  { trigger: 'PATIENT_LAPSED', title: 'Win back', text: 'When a pet has not been seen for months', lead: 'Hello {{clientName}}, we have not seen {{petName}} for {{monthsSince}} months and would love to. Come back for' },
  { trigger: 'CARE_DUE', title: 'Care due', text: 'A reason to book the vaccination or check-up', lead: 'Hello {{clientName}}, {{petName}}’s {{careName}} is due on {{dueDate}}. Book now and get' },
  { trigger: 'VACCINATION_GIVEN', title: 'After a vaccination', text: 'Suggest what comes next, e.g. tick and flea care', lead: 'Hello {{clientName}}, thank you for vaccinating {{petName}} with us. To keep {{petName}} protected:' },
  { trigger: 'PAYMENT_RECEIVED', title: 'Loyalty reward', text: 'After a payment, thank them with a reward', lead: 'Hello {{clientName}}, thank you for choosing {{clinicName}}. As a thank-you:' },
];
const DATE_LEAD = 'Hello {{clientName}}, a special offer from {{clinicName}} for {{petNames}}:';

const OFFER_TYPES: { value: OfferType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'PERCENT', label: '% off', icon: Percent },
  { value: 'AMOUNT', label: 'Amount off', icon: Wallet },
  { value: 'FREE', label: 'Something free', icon: Gift },
  { value: 'NEWS', label: 'News, no discount', icon: Newspaper },
];

function offerText(o: Offer, currency: string) {
  const on = o.on.trim();
  switch (o.type) {
    case 'PERCENT':
      return `${o.value || '…'}% off${on ? ` ${on}` : ''}`;
    case 'AMOUNT':
      return `${o.value ? formatMoney(Math.round(Number(o.value) * 100), currency).replace(/\.00$/, '') : '…'} off${on ? ` ${on}` : ''}`;
    case 'FREE':
      return `a free ${o.value.trim() || '…'}${on ? ` with ${on}` : ''}`;
    case 'NEWS':
      return on;
  }
}

/** The message written from the offer: a greeting that fits the moment, the offer, the code, how long it lasts. */
function compose(kind: Kind, trigger: AutomationTrigger, o: Offer, currency: string, endsOn: string | null, repeat: OfferRepeat) {
  const what = offerText(o, currency);
  const ev = EVENTS.find((e) => e.trigger === trigger);
  if (o.type === 'NEWS') {
    const opener = trigger === 'PET_BIRTHDAY' ? 'Happy birthday to {{petName}} from all of us at {{clinicName}}!' : 'Hello {{clientName}}, news from {{clinicName}}:';
    return { subject: what ? capital(what) : trigger === 'PET_BIRTHDAY' ? 'Happy birthday, {{petName}}!' : 'News from {{clinicName}}', body: `${opener} ${what || '…'}\nReply here or call {{clinicPhone}} if you have questions.\n{{bookingLine}}` };
  }
  const lines = [`${kind === 'DATE' ? DATE_LEAD : ev?.lead ?? DATE_LEAD} ${what}.`];
  if (o.code.trim()) lines.push(`Use code ${o.code.trim().toUpperCase()} when you book.`);
  if (kind === 'DATE' && (endsOn || repeat !== 'NONE')) lines.push('The offer ends on {{offerEnds}}.');
  if (kind === 'EVENT' && o.validDays) lines.push(`Valid for ${o.validDays} days.`);
  lines.push('Reply here or call {{clinicPhone}} to book.\n{{bookingLine}}');
  const subject = trigger === 'PET_BIRTHDAY' ? 'Happy birthday, {{petName}}!' : trigger === 'CLIENT_REGISTERED' ? 'Welcome to {{clinicName}}' : `${capital(what)} at {{clinicName}}`;
  return { subject, body: lines.join(' ').replace(' Reply here', '\nReply here') };
}

function reminderText(kind: Kind, o: Offer, currency: string) {
  const what = offerText(o, currency);
  return `Hello {{clientName}}, a quick reminder: ${what}${o.code.trim() ? ` with code ${o.code.trim().toUpperCase()}` : ''}${kind === 'DATE' ? ' — the offer ends on {{offerEnds}}' : ''}. Reply here or call {{clinicPhone}} to book.\n{{bookingLine}}`;
}

/** Who the "Audience" presets pick (offers on a date): each sets one condition. */
function presets(options?: AutomationOptions) {
  const species = (re: RegExp) => options?.species.find((s) => re.test(s.name));
  const dog = species(/^dog|canine/i);
  const cat = species(/^cat|feline/i);
  return [
    ...(dog ? [{ key: 'dogs', label: 'Dog owners', c: { field: 'species', op: 'IS', values: [dog.id] } as AutomationCondition }] : []),
    ...(cat ? [{ key: 'cats', label: 'Cat owners', c: { field: 'species', op: 'IS', values: [cat.id] } as AutomationCondition }] : []),
    { key: 'lapsed', label: 'Not seen in 6+ months', c: { field: 'lastVisit', op: 'IS_NOT', values: ['6'] } as AutomationCondition },
    { key: 'active', label: 'Seen in the last year', c: { field: 'lastVisit', op: 'IS', values: ['12'] } as AutomationCondition },
    { key: 'new', label: 'New clients (90 days)', c: { field: 'newClient', op: 'IS', values: ['90'] } as AutomationCondition },
    { key: 'loyal', label: 'Loyal (3+ visits a year)', c: { field: 'visitsAtLeast', op: 'IS', values: ['3'] } as AutomationCondition },
    { key: 'care', label: 'Care due in 30 days', c: { field: 'careDue', op: 'IS', values: ['30'] } as AutomationCondition },
    { key: 'senior', label: 'Senior pets (8+ years)', c: { field: 'ageAtLeast', op: 'IS', values: ['8'] } as AutomationCondition },
    { key: 'young', label: 'Young pets (under 1)', c: { field: 'ageUnder', op: 'IS', values: ['1'] } as AutomationCondition },
  ];
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cn('inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors', active ? 'bg-primary text-primary-foreground ring-primary' : 'ring-foreground/15 hover:bg-foreground/[0.04]')}>
      {children}
    </button>
  );
}

function Section({ title, text, children, icon: Icon }: { title: string; text?: string; children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <Card className="grid gap-4 p-5">
      <div>
        <p className="flex items-center gap-2 font-semibold">{Icon && <Icon className="h-4 w-4 text-primary" />} {title}</p>
        {text && <p className="text-sm text-muted-foreground">{text}</p>}
      </div>
      {children}
    </Card>
  );
}

/** What the client sees: the WhatsApp bubble and the email, with the "stop offers" line every offer carries. */
function MessagePreview({ subject, body, vars, channel }: { subject: string; body: string; vars: Record<string, string>; channel: 'BEST' | 'WHATSAPP' | 'EMAIL' }) {
  const text = render(body, vars) || 'Your message…';
  return (
    <div className="grid gap-3">
      {channel !== 'EMAIL' && (
        <div className="rounded-2xl bg-[#efeae2] p-3 dark:bg-[#0b141a]">
          <p className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-[#54656f] dark:text-[#8696a0]"><MessageCircle className="h-3 w-3" /> WhatsApp</p>
          <div className="ml-auto max-w-sm whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-[13px] leading-snug text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]">
            {text}
            {'\n\n'}
            <span className="opacity-70">Reply STOP to stop offers.</span>
          </div>
        </div>
      )}
      {channel !== 'WHATSAPP' && (
        <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-inset ring-foreground/10">
          <div className="border-b bg-foreground/[0.03] px-4 py-2">
            <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground"><Mail className="h-3 w-3" /> Email</p>
            <p className="truncate text-sm font-semibold">{render(subject, vars) || 'Subject'}</p>
          </div>
          <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed">
            {text}
            {'\n\n'}
            <span className="text-xs text-muted-foreground">— Don’t want offers from us? Stop them here (link)</span>
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The guided way to make a marketing campaign of the clinic's own: what kind, who gets it, the offer (the message is
 * written from it), when, then check and launch. Everything can still be changed later in the full builder.
 */
export function CampaignBuilder() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { currency } = useSession();
  const builder = usePlanFeature('automationBuilder');
  const options = useQuery({ queryKey: ['automation-options'], queryFn: () => api.get<AutomationOptions>('/automations/options'), staleTime: 60_000 });
  const preEvent = EVENTS.find((e) => e.trigger === params.get('event'))?.trigger;
  const preKind: Kind | null = preEvent ? 'EVENT' : params.get('type') === 'date' ? 'DATE' : null;

  const [step, setStep] = useState(preKind ? 1 : 0);
  const [kind, setKind] = useState<Kind | null>(preKind);
  const [event, setEvent] = useState<AutomationTrigger>(preEvent ?? 'PET_BIRTHDAY');
  const trigger: AutomationTrigger = kind === 'DATE' ? 'SCHEDULED_OFFER' : event;
  const [conditions, setConditions] = useState<AutomationCondition[]>([]);
  const [offer, setOffer] = useState<Offer>({ type: 'PERCENT', value: '10', on: '', code: '', validDays: 14 });
  const [channel, setChannel] = useState<'BEST' | 'WHATSAPP' | 'EMAIL'>('BEST');
  const [custom, setCustom] = useState<{ subject: string; body: string } | null>(null);
  const [followUp, setFollowUp] = useState(false);
  const [followDays, setFollowDays] = useState(5);
  const [followCustom, setFollowCustom] = useState<string | null>(null);
  // Schedule
  const [sendOn, setSendOn] = useState(localDay(1));
  const [atHour, setAtHour] = useState(10);
  const [repeat, setRepeat] = useState<OfferRepeat>('NONE');
  const [endsOn, setEndsOn] = useState<string | null>(localDay(15));
  const [offset, setOffset] = useState<number | null>(null);
  const [delayIdx, setDelayIdx] = useState(0);
  const [hours, setHours] = useState(true);
  const [cooldown, setCooldown] = useState<number | null>(null);
  // Review
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saveTemplate, setSaveTemplate] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const info = TRIGGER_INFO[trigger];
  const composed = compose(kind ?? 'DATE', trigger, offer, currency, endsOn, repeat);
  const subject = custom?.subject ?? composed.subject;
  const body = custom?.body ?? composed.body;
  const canFollowUp = info.checks.includes('NOT_BOOKED');
  const reminder = followCustom ?? reminderText(kind ?? 'DATE', offer, currency);
  const delay = EASY_DELAYS[delayIdx]?.value ?? null;
  const ev = EVENTS.find((e) => e.trigger === event);
  const suggestedName = kind === 'DATE' ? capital(offerText(offer, currency) || 'Offer') : `${ev?.title ?? 'Campaign'}${offer.type === 'NEWS' ? '' : `: ${offerText(offer, currency)}`}`;

  const draft: AutomationDraft = useMemo(() => {
    const steps: AutomationStep[] = [];
    if (kind === 'EVENT' && delay) steps.push({ type: 'WAIT', amount: delay.amount, unit: delay.unit });
    steps.push({ type: 'SEND_MESSAGE', channel, subject: channel === 'WHATSAPP' ? null : subject, body });
    if (followUp && canFollowUp) {
      steps.push({ type: 'WAIT', amount: followDays, unit: 'DAYS' }, { type: 'CHECK', check: 'NOT_BOOKED' }, { type: 'SEND_MESSAGE', channel, subject: channel === 'WHATSAPP' ? null : `Reminder: ${subject}`, body: reminder });
    }
    const timed = info.timed;
    return {
      name: (name.trim() || suggestedName).slice(0, 120),
      description: description.trim() || null,
      isActive: true,
      marketing: true,
      trigger,
      offset: timed === 'DAYS_BEFORE' || timed === 'MONTHS_SINCE' ? (offset ?? (timed === 'MONTHS_SINCE' ? 12 : 7)) : null,
      atHour: timed && timed !== 'HOURS_BEFORE' ? atHour : null,
      sendFromHour: hours ? 9 : null,
      sendToHour: hours ? 20 : null,
      cooldownDays: cooldown,
      sendOn: kind === 'DATE' ? sendOn : null,
      repeat: kind === 'DATE' ? repeat : null,
      endsOn: kind === 'DATE' ? endsOn : null,
      conditions: conditions.filter((c) => c.values.length),
      steps,
    };
  }, [kind, delay, channel, subject, body, followUp, canFollowUp, followDays, reminder, info.timed, name, suggestedName, description, trigger, offset, atHour, hours, cooldown, sendOn, repeat, endsOn, conditions]);

  const approval = !!options.data?.marketing?.approval;
  const needsBuilder = !builder && !fitsWithoutBuilder(draft as never);
  const problems: (string | null)[] = [
    !kind ? 'Choose the kind of campaign' : null,
    null,
    offer.type === 'PERCENT' && !(Number(offer.value) > 0 && Number(offer.value) <= 100) ? 'Enter a discount between 1 and 100%' : offer.type === 'AMOUNT' && !(Number(offer.value) > 0) ? 'Enter the amount off' : offer.type === 'FREE' && !offer.value.trim() ? 'Say what is free' : offer.type === 'NEWS' && !offer.on.trim() ? 'Write the headline' : !body.trim() ? 'Write the message' : followUp && !reminder.trim() ? 'Write the reminder' : null,
    kind === 'DATE' && !sendOn ? 'Choose the day to send it' : kind === 'DATE' && endsOn && endsOn < sendOn ? 'The offer must end on or after the day it is sent' : null,
    !draft.name ? 'Give the campaign a name' : null,
  ];
  const firstProblem = problems.slice(0, 4).find(Boolean) ?? null;

  const save = useMutation({
    mutationFn: (isActive: boolean) => api.post<{ id: string; approvalStatus?: string | null }>('/automations', { ...draft, isActive }),
    onSuccess: (r, isActive) => {
      ['automations', 'automation-stats', 'marketing-overview', 'clinic-plan'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(r.approvalStatus === 'PENDING' ? `“${draft.name}” sent for approval — a manager switches it on` : isActive ? `“${draft.name}” is live` : `“${draft.name}” saved as a draft (off)`);
      router.push('/marketing?tab=campaigns');
    },
    onError: (e: Error) => {
      setError(e.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });
  const testSend = useMutation({
    mutationFn: () => api.post<{ to: string; example: string | null }>('/automations/test-send', { automation: draft }),
    onSuccess: (r) => toast.success(`Test email sent to ${r.to}${r.example ? ` — filled in as for ${r.example}` : ''}. No client gets anything.`),
    onError: (e: Error) => toast.error(e.message),
  });

  const vars = useMemo(() => {
    const v = { ...sampleVars(trigger) };
    if (kind === 'DATE') {
      // As the server does: a one-off offer ends on its end date; a repeating one the day before its next send.
      const o = { sendOn, repeat, endsOn };
      const next = nextOfferDay(o, localDay()) ?? sendOn;
      const after = repeat === 'NONE' ? null : nextOfferDay(o, plusDays(next, 1));
      v.offerEnds = after ? fmtDateOnly(plusDays(after, -1)) : endsOn ? fmtDateOnly(endsOn) : '';
    }
    return v;
  }, [trigger, kind, sendOn, repeat, endsOn]);

  const insert = (v: string) => {
    const el = bodyRef.current;
    const at = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? at;
    setCustom({ subject, body: body.slice(0, at) + v + body.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + v.length, at + v.length);
    });
  };
  const chooseKind = (k: Kind, t?: AutomationTrigger) => {
    setKind(k);
    if (t) setEvent(t);
    const tt = k === 'DATE' ? 'SCHEDULED_OFFER' : (t ?? event);
    const allowed = new Set(TRIGGER_INFO[tt].conditions);
    setConditions((cs) => cs.filter((c) => allowed.has(c.field)));
    setOffset(TRIGGER_INFO[tt].timed === 'MONTHS_SINCE' ? 12 : TRIGGER_INFO[tt].timed === 'DAYS_BEFORE' ? 7 : null);
    setCooldown(k === 'EVENT' ? 30 : null);
    setFollowUp(false);
    setStep(1);
  };
  const setCond = (c: AutomationCondition) => setConditions((cs) => [...cs.filter((x) => x.field !== c.field), c]);
  const hasPreset = (c: AutomationCondition) => conditions.some((x) => x.field === c.field && x.op === c.op && x.values.join() === c.values.join());

  const summary: [string, React.ReactNode][] = [
    ['Type', kind === 'DATE' ? 'Offer on a date' : kind === 'EVENT' ? `${ev?.title} — when ${TRIGGER_INFO[event].when}` : '—'],
    ['Who', draft.conditions?.length ? (draft.conditions as AutomationCondition[]).map((c) => conditionText(c, options.data)).join(' · ') : 'Everyone who agreed to offers'],
    ['Offer', offer.type === 'NEWS' ? offer.on || '—' : `${capital(offerText(offer, currency))}${offer.code.trim() ? ` · code ${offer.code.trim().toUpperCase()}` : ''}`],
    ['When', kind === 'DATE' ? `${offerScheduleText({ sendOn, repeat, endsOn })} at ${hourLabel(atHour)}` : kind === 'EVENT' ? (info.timed ? describeAutomation(draft, options.data).split(' → ')[0] : delay ? `${EASY_DELAYS[delayIdx].label.toLowerCase()} after it happens` : 'Straight away') : '—'],
    ['Channel', channel === 'BEST' ? 'WhatsApp, else email' : channel === 'WHATSAPP' ? 'WhatsApp' : 'Email'],
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/marketing?tab=campaigns">
            <ArrowLeft /> Marketing
          </Link>
        </Button>
        {builder && (
          <Link href="/settings/automations/new?mode=advanced&marketing=1" className="ml-auto text-sm font-semibold text-primary hover:underline">
            Build from scratch in the full builder instead
          </Link>
        )}
      </div>

      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-rose-500/[0.12] via-primary/[0.08] to-transparent p-6 ring-1 ring-inset ring-rose-500/10 sm:p-7">
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 text-white shadow-lg">
            <Megaphone className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1 basis-64">
            <h2 className="text-2xl font-semibold tracking-tight">Create your own campaign</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Five short steps. Only clients who agreed to offers get it, every message carries a “stop offers” option, and nothing goes out until you launch it{approval ? ' and a manager approves it' : ''}.</p>
          </div>
        </div>
        <ol className="mt-6 flex items-center gap-2" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2">
              <button type="button" disabled={i > step && (!!problems.slice(0, i).find(Boolean) || !kind)} onClick={() => setStep(i)} className={cn('flex items-center gap-2 text-left text-sm font-medium disabled:cursor-not-allowed', i === step ? 'text-foreground' : i < step ? 'text-primary' : 'text-muted-foreground')}>
                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', i < step ? 'bg-primary text-primary-foreground' : i === step ? 'bg-gradient-to-br from-pink-500 to-rose-600 text-white shadow' : 'bg-foreground/[0.07]')}>{i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
                <span className="hidden md:inline">{s}</span>
              </button>
              {i < STEPS.length - 1 && <span className={cn('h-px flex-1', i < step ? 'bg-primary' : 'bg-foreground/15')} />}
            </li>
          ))}
        </ol>
      </div>

      {error && <FormError message={error} />}
      {needsBuilder && step > 0 && <UpgradeCard feature="automationBuilder" compact text="Campaigns with your own audience rules, follow-ups and limits need the full automation builder. You can prepare it now; saving needs an upgrade." />}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 content-start gap-5">
          {step === 0 && (
            <>
              <Section title="Send on a date" text="A one-off or repeating offer to a group of clients — Eid, a seasonal discount, an offer of the month." icon={CalendarDays}>
                <button type="button" onClick={() => chooseKind('DATE')} className={cn('flex items-center gap-4 rounded-2xl p-4 text-left ring-1 ring-inset transition-all hover:-translate-y-0.5 hover:shadow-md', kind === 'DATE' ? 'bg-primary/[0.06] ring-primary/40' : 'bg-card ring-foreground/10 hover:ring-primary/40')}>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 text-white"><Tag className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">Offer on a date</span>
                    <span className="block text-sm text-muted-foreground">You pick the day and the group; each client gets it once per send.</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-primary" />
                </button>
              </Section>
              <Section title="Send when something happens" text="Runs by itself for each client at the right moment — always on, until you switch it off." icon={Sparkles}>
                <div className="grid gap-2 sm:grid-cols-2">
                  {EVENTS.map((e) => {
                    const Icon = TRIGGER_ICONS[e.trigger];
                    const g = TRIGGER_INFO[e.trigger].group;
                    return (
                      <button key={e.trigger} type="button" onClick={() => chooseKind('EVENT', e.trigger)} className={cn('flex items-start gap-3 rounded-2xl p-3.5 text-left ring-1 ring-inset transition-all hover:-translate-y-0.5 hover:shadow-md', kind === 'EVENT' && event === e.trigger ? 'bg-primary/[0.06] ring-primary/40' : 'bg-card ring-foreground/10 hover:ring-primary/40')}>
                        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', GROUP_TONE[g].tile)}><Icon className="h-4 w-4" /></span>
                        <span>
                          <span className="block font-semibold">{e.title}</span>
                          <span className="block text-sm text-muted-foreground">{e.text}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Section>
            </>
          )}

          {step === 1 && kind && (
            <>
              {kind === 'DATE' ? (
                <Section title="Who gets it" text="Start with everyone who agreed to offers, then narrow it. Choose one or more groups — a client must match all of them." icon={Users}>
                  <div className="flex flex-wrap gap-1.5">
                    <Pill active={!conditions.length} onClick={() => setConditions([])}>Everyone who agreed</Pill>
                    {presets(options.data).map((p) => (
                      <Pill key={p.key} active={hasPreset(p.c)} onClick={() => (hasPreset(p.c) ? setConditions(conditions.filter((x) => x.field !== p.c.field)) : setCond(p.c))}>
                        {p.label}
                      </Pill>
                    ))}
                  </div>
                </Section>
              ) : (
                <Section title="Who gets it" text={`Each time ${TRIGGER_INFO[event].when}, the client gets it if they agreed to offers. Add rules to narrow it — for example only dogs, or only one branch.`} icon={Users}>
                  <p className="text-xs text-muted-foreground">No rules = every client who agreed to offers.</p>
                </Section>
              )}
              <Section title="Your own rules" text="Fine-tune the group with exact rules: species, branch, age, visits, spending, services, care due…">
                <div className="grid gap-2.5">
                  {conditions.map((c, i) => (
                    <ConditionRow key={`${c.field}${i}`} c={c} trigger={trigger} options={options.data} currency={currency} onChange={(nc) => setConditions(conditions.map((x, j) => (j === i ? nc : x)))} onRemove={() => setConditions(conditions.filter((_, j) => j !== i))} />
                  ))}
                  <div>
                    <Button type="button" size="sm" variant="outline" disabled={conditions.length >= 10} onClick={() => setConditions([...conditions, { field: info.conditions.find((f) => !conditions.some((c) => c.field === f)) ?? info.conditions[0], op: 'IS', values: [] }])}>
                      <Plus /> Add a rule
                    </Button>
                  </div>
                </div>
              </Section>
            </>
          )}

          {step === 2 && kind && (
            <>
              <Section title="The offer" text="What are you offering? The message below is written from this." icon={Tag}>
                <div className="flex flex-wrap gap-1.5">
                  {OFFER_TYPES.map((t) => (
                    <Pill key={t.value} active={offer.type === t.value} onClick={() => setOffer({ ...offer, type: t.value, value: t.value === 'PERCENT' ? '10' : t.value === 'AMOUNT' ? '500' : t.value === 'FREE' ? '' : offer.value })}>
                      <t.icon className="h-3.5 w-3.5" /> {t.label}
                    </Pill>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {offer.type === 'PERCENT' && (
                    <label className="grid gap-1.5 text-sm font-medium">
                      Discount
                      <div className="flex items-center gap-2">
                        <Input inputMode="numeric" className="w-28" value={offer.value} onChange={(e) => setOffer({ ...offer, value: e.target.value.replace(/[^\d]/g, '').slice(0, 3) })} aria-label="Discount percent" />
                        <span className="text-muted-foreground">% off</span>
                      </div>
                    </label>
                  )}
                  {offer.type === 'AMOUNT' && (
                    <label className="grid gap-1.5 text-sm font-medium">
                      Amount off
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{currency}</span>
                        <Input inputMode="decimal" className="w-32" value={offer.value} onChange={(e) => setOffer({ ...offer, value: e.target.value.replace(/[^\d.]/g, '') })} aria-label="Amount off" />
                      </div>
                    </label>
                  )}
                  {offer.type === 'FREE' && (
                    <label className="grid gap-1.5 text-sm font-medium">
                      What is free
                      <Input value={offer.value} maxLength={60} onChange={(e) => setOffer({ ...offer, value: e.target.value })} placeholder="e.g. nail trim, deworming tablet" />
                    </label>
                  )}
                  <label className="grid gap-1.5 text-sm font-medium">
                    {offer.type === 'NEWS' ? 'Headline' : offer.type === 'FREE' ? 'With' : 'On'} <span className="sr-only">(optional)</span>
                    <Input value={offer.on} maxLength={120} onChange={(e) => setOffer({ ...offer, on: e.target.value })} placeholder={offer.type === 'NEWS' ? 'e.g. our new grooming room is open' : offer.type === 'FREE' ? 'e.g. every bath and groom' : 'e.g. dental cleaning, all vaccinations (optional)'} />
                  </label>
                  {offer.type !== 'NEWS' && (
                    <label className="grid gap-1.5 text-sm font-medium">
                      Offer code <span className="text-xs font-normal text-muted-foreground">Optional — staff see it in the message</span>
                      <Input value={offer.code} maxLength={20} onChange={(e) => setOffer({ ...offer, code: e.target.value.replace(/\s/g, '') })} placeholder="e.g. EID15" className="uppercase" />
                    </label>
                  )}
                  {offer.type !== 'NEWS' && kind === 'EVENT' && (
                    <label className="grid gap-1.5 text-sm font-medium">
                      Valid for
                      <NativeSelect value={String(offer.validDays)} onChange={(e) => setOffer({ ...offer, validDays: Number(e.target.value) })} aria-label="Valid for">
                        <option value="0">Don’t say</option>
                        {[7, 14, 30, 60, 90].map((n) => <option key={n} value={n}>{n} days</option>)}
                      </NativeSelect>
                    </label>
                  )}
                </div>
                {offer.type !== 'NEWS' && <p className="text-xs text-muted-foreground">The discount is not applied automatically — staff give it at the counter when the client mentions the offer{offer.code.trim() ? ' or the code' : ''}.</p>}
              </Section>

              <Section title="The message" text={custom ? 'You changed the wording — it no longer follows the offer above.' : 'Written for you from the offer. Change anything you like.'} icon={MessageCircle}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Send by</span>
                  {([['BEST', 'Best channel', Sparkles], ['WHATSAPP', 'WhatsApp', MessageCircle], ['EMAIL', 'Email', Mail]] as const).map(([v, label, Icon]) => (
                    <Pill key={v} active={channel === v} onClick={() => setChannel(v)}>
                      <Icon className="h-3.5 w-3.5" /> {label}
                    </Pill>
                  ))}
                  {channel === 'BEST' && <span className="basis-full text-xs text-muted-foreground">WhatsApp when connected and the client has a mobile, otherwise email.</span>}
                  {channel === 'WHATSAPP' && options.data && !options.data.channels.whatsapp && <span className="basis-full text-xs text-warning">WhatsApp is not connected yet, so these would not be sent.</span>}
                </div>
                {channel !== 'WHATSAPP' && <Input aria-label="Email subject" value={subject} placeholder="Email subject" onChange={(e) => setCustom({ subject: e.target.value, body })} />}
                <Textarea ref={bodyRef} aria-label="Message" rows={6} value={body} onChange={(e) => setCustom({ subject, body: e.target.value })} />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Add:</span>
                  {info.variables.map((v) => (
                    <button key={v} type="button" onClick={() => insert(`{{${v}}}`)} className="rounded-pill bg-primary/[0.08] px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary/15 hover:bg-primary/15">
                      {AUTOMATION_VARIABLES[v]?.label ?? v}
                    </button>
                  ))}
                  {custom && (
                    <button type="button" onClick={() => setCustom(null)} className="ml-auto flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                      <Wand2 className="h-3 w-3" /> Write it again from the offer
                    </button>
                  )}
                </div>
                {canFollowUp && (
                  <div className="grid gap-3 rounded-2xl bg-foreground/[0.025] p-4 ring-1 ring-inset ring-foreground/[0.06]">
                    <label className="flex items-start justify-between gap-4">
                      <span>
                        <span className="block text-sm font-semibold">Follow-up reminder</span>
                        <span className="block text-xs text-muted-foreground">A second message to those who have not booked yet. Clients who booked in the meantime don’t get it.</span>
                      </span>
                      <Switch checked={followUp} onCheckedChange={setFollowUp} aria-label="Follow-up reminder" />
                    </label>
                    {followUp && (
                      <>
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          After
                          <NativeSelect aria-label="Days until the reminder" className="h-9 w-auto" value={String(followDays)} onChange={(e) => setFollowDays(Number(e.target.value))}>
                            {[2, 3, 5, 7, 10, 14].map((n) => <option key={n} value={n}>{n} days</option>)}
                          </NativeSelect>
                          if they have not booked
                        </div>
                        <Textarea aria-label="Reminder" rows={3} value={reminder} onChange={(e) => setFollowCustom(e.target.value)} />
                      </>
                    )}
                  </div>
                )}
              </Section>
            </>
          )}

          {step === 3 && kind && (
            <Section title="When it goes out" text={kind === 'DATE' ? 'The day and time it is sent, whether it repeats, and when the offer ends.' : 'When, after it happens, the client gets it.'} icon={Clock}>
              {kind === 'DATE' ? (
                <div className="grid gap-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    Send on
                    <Input type="date" aria-label="Send on" className="h-10 w-auto font-semibold" min={localDay()} value={sendOn} onChange={(e) => setSendOn(e.target.value)} />
                    at
                    <NativeSelect aria-label="Time of day" className="h-10 w-auto font-semibold" value={String(atHour)} onChange={(e) => setAtHour(Number(e.target.value))}>
                      {Array.from({ length: 15 }, (_, k) => k + 7).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                    </NativeSelect>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    Repeat
                    {(['NONE', 'WEEKLY', 'MONTHLY'] as const).map((r) => (
                      <Pill key={r} active={repeat === r} onClick={() => { setRepeat(r); if (r !== 'NONE' && endsOn && endsOn <= sendOn) setEndsOn(null); }}>{OFFER_REPEAT_LABELS[r]}</Pill>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {repeat === 'NONE' ? 'The offer ends on' : 'Stop after'}
                    <Input type="date" aria-label={repeat === 'NONE' ? 'Offer ends on' : 'Stop after'} className="h-10 w-auto font-semibold" min={sendOn} value={endsOn ?? ''} onChange={(e) => setEndsOn(e.target.value || null)} />
                    {endsOn && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setEndsOn(null)}>{repeat === 'NONE' ? 'No end date' : 'Keep repeating'}</button>}
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {info.timed === 'ON_DAY' && <>On the birthday, at</>}
                  {info.timed === 'DAYS_BEFORE' && (
                    <>
                      <NativeSelect aria-label="Days before" className="h-10 w-auto font-semibold" value={String(offset ?? 7)} onChange={(e) => setOffset(Number(e.target.value))}>
                        {[0, 3, 7, 14, 30].map((n) => <option key={n} value={n}>{n === 0 ? 'On the day' : `${n} days before`}</option>)}
                      </NativeSelect>
                      it is due, at
                    </>
                  )}
                  {info.timed === 'MONTHS_SINCE' && (
                    <>
                      <NativeSelect aria-label="Months" className="h-10 w-auto font-semibold" value={String(offset ?? 12)} onChange={(e) => setOffset(Number(e.target.value))}>
                        {[3, 6, 9, 12, 18, 24].map((n) => <option key={n} value={n}>{n} months</option>)}
                      </NativeSelect>
                      after the last visit, with nothing booked, at
                    </>
                  )}
                  {info.timed ? (
                    <NativeSelect aria-label="Time of day" className="h-10 w-auto font-semibold" value={String(atHour)} onChange={(e) => setAtHour(Number(e.target.value))}>
                      {Array.from({ length: 15 }, (_, k) => k + 7).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                    </NativeSelect>
                  ) : (
                    <>
                      Send it
                      <NativeSelect aria-label="When to send" className="h-10 w-auto font-semibold" value={String(delayIdx)} onChange={(e) => setDelayIdx(Number(e.target.value))}>
                        {EASY_DELAYS.map((e, i) => <option key={e.label} value={i}>{e.label}</option>)}
                      </NativeSelect>
                      after {TRIGGER_INFO[event].when}
                    </>
                  )}
                </div>
              )}
              <div className="grid gap-4 border-t pt-4">
                <label className="flex items-start justify-between gap-4">
                  <span>
                    <span className="block text-sm font-semibold">Polite hours only</span>
                    <span className="block text-xs text-muted-foreground">Messages go out between 09:00 and 20:00, clinic time; outside those hours they wait for the morning.</span>
                  </span>
                  <Switch checked={hours} onCheckedChange={setHours} aria-label="Polite hours only" />
                </label>
                {kind === 'EVENT' && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      <span className="block text-sm font-semibold">Not too often</span>
                      <span className="block text-xs text-muted-foreground">At most once per client in a period, even with several pets.</span>
                    </span>
                    <NativeSelect aria-label="At most once every" className="h-9 w-auto" value={cooldown == null ? '' : String(cooldown)} onChange={(e) => setCooldown(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">No limit</option>
                      {[7, 14, 30, 60, 90, 180, 365].map((n) => <option key={n} value={n}>Once every {n} days</option>)}
                    </NativeSelect>
                  </div>
                )}
                {options.data?.marketing?.capDays && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> Clinic rule: each client gets at most one offer every {options.data.marketing.capDays} days, whatever the campaign.</p>
                )}
              </div>
            </Section>
          )}

          {step === 4 && kind && (
            <>
              <Section title="Name it" text="For your team — clients don’t see it.">
                <div className="grid gap-3">
                  <Input aria-label="Campaign name" maxLength={120} value={name} placeholder={suggestedName} onChange={(e) => setName(e.target.value)} />
                  <Input aria-label="Goal or note" maxLength={300} value={description} placeholder="Goal or note (optional) — e.g. fill quiet weekday mornings" onChange={(e) => setDescription(e.target.value)} />
                </div>
              </Section>
              <Section title="In one sentence" icon={Sparkles}>
                <p className="rounded-2xl bg-primary/[0.05] p-4 text-sm leading-relaxed ring-1 ring-inset ring-primary/10">{describeAutomation(draft, options.data)}.</p>
                <ul className="grid gap-1.5 text-sm text-muted-foreground">
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /> Only clients who agreed to offers; those who asked for no messages never get any.</li>
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /> Every message ends with a way to stop offers (link by email, “STOP” on WhatsApp).</li>
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /> Results — read, booked and paid after — appear in Marketing → Overview.</li>
                  {approval && <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warning" /> Your clinic requires approval: a manager other than you switches it on.</li>}
                </ul>
              </Section>
              <Section title="Try it first" text="Email the message to yourself, filled in as for a real client. No client gets anything." icon={FlaskConical}>
                <div>
                  <Button variant="outline" loading={testSend.isPending} disabled={!!firstProblem} onClick={() => testSend.mutate()}>
                    <FlaskConical /> Send me a test
                  </Button>
                </div>
              </Section>
            </>
          )}

          {kind && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))}>
                <ArrowLeft /> Back
              </Button>
              {step < 4 ? (
                <div className="flex items-center gap-3">
                  {problems[step] && <span className="text-sm text-muted-foreground">{problems[step]}</span>}
                  <Button disabled={!!problems[step]} onClick={() => setStep(step + 1)}>
                    Next <ArrowRight />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {firstProblem && <span className="text-sm text-warning">{firstProblem}</span>}
                  <Button variant="ghost" disabled={!!firstProblem} onClick={() => setSaveTemplate(true)}>
                    <BookmarkPlus /> Save as template
                  </Button>
                  <Button variant="outline" disabled={!!firstProblem || needsBuilder} loading={save.isPending && save.variables === false} onClick={() => { setError(null); save.mutate(false); }}>
                    <Save /> Save as draft
                  </Button>
                  <Button disabled={!!firstProblem || needsBuilder} loading={save.isPending && save.variables === true} onClick={() => { setError(null); save.mutate(true); }}>
                    {approval ? <><ShieldCheck /> Send for approval</> : <><Rocket /> Launch campaign</>}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid content-start gap-4 xl:sticky xl:top-24">
          <Card className="grid gap-3 p-5">
            <p className="flex items-center gap-2 font-semibold"><Megaphone className="h-4 w-4 text-rose-500" /> Campaign summary</p>
            <dl className="grid gap-2.5 text-sm">
              {summary.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            {followUp && canFollowUp && <Badge variant="info" className="w-fit">+ reminder after {followDays} days</Badge>}
          </Card>
          {kind === 'DATE' && step >= 1 && <AudienceCard conditions={conditions} />}
          {kind && step >= 2 && (
            <Card className="grid gap-3 p-5">
              <p className="text-sm font-semibold">What the client sees</p>
              <MessagePreview subject={subject} body={body} vars={vars} channel={channel} />
              <p className="text-2xs text-muted-foreground">Example names and dates — real ones are filled in for each client.</p>
            </Card>
          )}
        </div>
      </div>
      {saveTemplate && <SaveTemplateDialog automation={draft} onClose={() => setSaveTemplate(false)} />}
    </div>
  );
}
