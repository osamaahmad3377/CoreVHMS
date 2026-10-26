'use client';
import { CHECK_INFO, TRIGGER_INFO, type AutomationStep, type AutomationTrigger, type TriggerGroup } from '@vcms/shared';
import {
  BedDouble,
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  Cake,
  ClipboardList,
  Clock,
  CreditCard,
  FileText,
  Filter,
  FlaskConical,
  HeartPulse,
  Hourglass,
  Mail,
  MessageCircle,
  Pill,
  Receipt,
  Repeat,
  Scissors,
  Send,
  Stethoscope,
  Syringe,
  Ticket,
  UserPlus,
  Users,
  UserX,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Icon = React.ComponentType<{ className?: string }>;

export const TRIGGER_ICONS: Record<AutomationTrigger, Icon> = {
  APPOINTMENT_BOOKED: CalendarCheck,
  APPOINTMENT_RESCHEDULED: CalendarClock,
  APPOINTMENT_CANCELLED: CalendarX,
  APPOINTMENT_UPCOMING: Bell,
  APPOINTMENT_CHECKED_IN: Ticket,
  APPOINTMENT_COMPLETED: Stethoscope,
  APPOINTMENT_NO_SHOW: UserX,
  LAB_RESULTS_READY: FlaskConical,
  PATIENT_DISCHARGED: HeartPulse,
  PAYMENT_RECEIVED: CreditCard,
  VACCINATION_GIVEN: Syringe,
  CARE_DUE: Syringe,
  CLIENT_REGISTERED: UserPlus,
  PET_BIRTHDAY: Cake,
  PATIENT_ADMITTED: BedDouble,
  SURGERY_UPCOMING: Scissors,
  SURGERY_COMPLETED: Scissors,
  PRESCRIPTION_DISPENSED: Pill,
  INVOICE_OVERDUE: Receipt,
  ESTIMATE_SENT: FileText,
  PATIENT_LAPSED: Repeat,
};

/** One colour family per group of triggers, used for icon tiles and chips. */
export const GROUP_TONE: Record<TriggerGroup, { tile: string; chip: string; dot: string }> = {
  Appointments: { tile: 'bg-gradient-to-br from-primary to-brand-2 text-white', chip: 'bg-primary/10 text-primary ring-primary/20', dot: 'bg-primary' },
  Clinical: { tile: 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white', chip: 'bg-success/10 text-success ring-success/20', dot: 'bg-success' },
  Money: { tile: 'bg-gradient-to-br from-amber-500 to-orange-600 text-white', chip: 'bg-warning/10 text-warning ring-warning/25', dot: 'bg-warning' },
  'Clients & pets': { tile: 'bg-gradient-to-br from-sky-500 to-indigo-600 text-white', chip: 'bg-info/10 text-info ring-info/20', dot: 'bg-info' },
};

export const STEP_META: Record<AutomationStep['type'], { label: string; short: string; icon: Icon; tile: string; text: string }> = {
  SEND_MESSAGE: { label: 'Send a message to the client', short: 'Message', icon: Send, tile: 'bg-gradient-to-br from-primary to-brand-2 text-white', text: 'WhatsApp or email, in your words' },
  WAIT: { label: 'Wait', short: 'Wait', icon: Hourglass, tile: 'bg-foreground/[0.08] text-foreground', text: 'Minutes, hours or days' },
  WAIT_UNTIL: { label: 'Wait until a time of day', short: 'Wait until', icon: Clock, tile: 'bg-foreground/[0.08] text-foreground', text: 'e.g. 10:00, skipping closed days' },
  CHECK: { label: 'Only continue if…', short: 'Check', icon: Filter, tile: 'bg-success/15 text-success', text: 'Stop quietly when no longer needed' },
  CREATE_TASK: { label: 'Create a task for staff', short: 'Task', icon: ClipboardList, tile: 'bg-warning/15 text-warning', text: 'A call or job on the task list' },
  EMAIL_TEAM: { label: 'Email the team', short: 'Email team', icon: Users, tile: 'bg-info/15 text-info', text: 'Tell a manager or the front desk' },
};

/** "Message (best channel)", "Wait 2 hours", "Only if not booked" — short text for a step chip. */
export function stepChip(s: AutomationStep): { icon: Icon; text: string } {
  switch (s.type) {
    case 'SEND_MESSAGE':
      return { icon: s.channel === 'WHATSAPP' ? MessageCircle : s.channel === 'EMAIL' ? Mail : Send, text: s.channel === 'WHATSAPP' ? 'WhatsApp' : s.channel === 'EMAIL' ? 'Email' : 'Message' };
    case 'WAIT':
      return { icon: Hourglass, text: `${s.amount} ${s.unit === 'MINUTES' ? 'min' : s.unit === 'HOURS' ? (s.amount === 1 ? 'hour' : 'hours') : s.amount === 1 ? 'day' : 'days'}` };
    case 'WAIT_UNTIL':
      return { icon: Clock, text: `until ${String(s.hour).padStart(2, '0')}:00` };
    case 'CHECK':
      return { icon: Filter, text: s.check === 'NOT_BOOKED' ? 'if not booked' : s.check === 'STILL_UNPAID' ? 'if unpaid' : s.check === 'STILL_DUE' ? 'if still due' : 'if not answered' };
    case 'CREATE_TASK':
      return { icon: ClipboardList, text: 'Task' };
    case 'EMAIL_TEAM':
      return { icon: Users, text: 'Email team' };
  }
}

/** Trigger chip → step chips, the at-a-glance shape of an automation. */
export function FlowChips({ trigger, steps, className }: { trigger: AutomationTrigger; steps: AutomationStep[]; className?: string }) {
  const info = TRIGGER_INFO[trigger];
  const TIcon = TRIGGER_ICONS[trigger] ?? Zap;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className={cn('inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', GROUP_TONE[info.group].chip)}>
        <TIcon className="h-3.5 w-3.5" /> {info.label}
      </span>
      {steps.map((s, i) => {
        const c = stepChip(s);
        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground/60" aria-hidden>
              →
            </span>
            <span className={cn('inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-medium ring-1 ring-inset', s.type === 'CHECK' ? 'bg-success/[0.07] text-success ring-success/20' : s.type.startsWith('WAIT') ? 'bg-foreground/[0.04] text-muted-foreground ring-foreground/10' : 'bg-card text-foreground ring-foreground/10')}>
              <c.icon className="h-3.5 w-3.5" /> {c.text}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export const checkLabel = (c: keyof typeof CHECK_INFO) => CHECK_INFO[c].label;
