'use client';
import { ArrowRight, Bookmark, Hammer, Megaphone, Plus, Sparkles, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useTemplates } from '@/components/automations/templates';
import { PlanLockBadge, usePlanFeature } from '@/components/plan/upgrade';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface Choice {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  title: string;
  text: string;
  badge?: string;
  locked?: boolean;
}

/**
 * "New automation" / "New campaign": how to start — guided, from scratch in the full builder, from a ready-made one,
 * or from one of the clinic's own templates.
 */
export function CreateChooser({ kind, label, variant = 'default' }: { kind: 'automation' | 'campaign'; label?: string; variant?: 'default' | 'outline' }) {
  const [open, setOpen] = useState(false);
  const builder = usePlanFeature('automationBuilder');
  const templates = useTemplates();
  const marketing = kind === 'campaign';
  const mine = (templates.data ?? []).filter((t) => t.marketing === marketing).length;
  const choices: Choice[] = marketing
    ? [
        { href: '/marketing/new', icon: Megaphone, tone: 'bg-gradient-to-br from-pink-500 to-rose-600', title: 'Campaign builder', text: 'Choose when it goes out, who gets it and the offer — the message is written for you. You can change every word.', badge: 'Recommended' },
        { href: builder ? '/settings/automations/new?mode=advanced&marketing=1' : '/settings/plan?unlock=automationBuilder', icon: Hammer, tone: 'bg-gradient-to-br from-slate-600 to-slate-800', title: 'Build from scratch', text: 'The full builder: any trigger, your own rules, several messages, waits, checks and tasks for staff.', locked: !builder },
        { href: '/marketing?tab=campaigns#ready-made', icon: Sparkles, tone: 'bg-gradient-to-br from-amber-500 to-orange-600', title: 'Ready-made campaign', text: 'Birthdays, Eid, tick season, win-back and more — written and ready to adjust.' },
        { href: '/marketing?tab=campaigns#templates', icon: Bookmark, tone: 'bg-gradient-to-br from-primary to-brand-2', title: 'Your templates', text: mine ? `Start from one of the ${mine} campaign${mine === 1 ? '' : 's'} your clinic saved.` : 'Campaigns your clinic saved to reuse. Save one from its ⋯ menu.', badge: mine ? String(mine) : undefined },
      ]
    : [
        { href: '/settings/automations/new', icon: Wand2, tone: 'bg-gradient-to-br from-primary to-brand-2', title: 'Guided', text: 'Three quick questions — when, what to send, and check. The wording is already written for you.', badge: 'Quickest' },
        { href: builder ? '/settings/automations/new?mode=advanced' : '/settings/plan?unlock=automationBuilder', icon: Hammer, tone: 'bg-gradient-to-br from-slate-600 to-slate-800', title: 'Build from scratch', text: 'The full builder: choose the trigger, add conditions, several messages, waits, checks and tasks for staff.', locked: !builder },
        { href: '/settings/automations?tab=recipes', icon: Sparkles, tone: 'bg-gradient-to-br from-amber-500 to-orange-600', title: 'From a recipe', text: 'Reminders, follow-ups and thank-yous that vet clinics use most — ready to adjust.' },
        { href: '/settings/automations?tab=templates', icon: Bookmark, tone: 'bg-gradient-to-br from-emerald-500 to-teal-600', title: 'Your templates', text: mine ? `Start from one of the ${mine} automation${mine === 1 ? '' : 's'} your clinic saved.` : 'Automations your clinic saved to reuse. Save one from its ⋯ menu.', badge: mine ? String(mine) : undefined },
      ];
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus /> {label ?? (marketing ? 'New campaign' : 'New automation')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{marketing ? 'Create a campaign' : 'Create an automation'}</DialogTitle>
            <DialogDescription>How would you like to start? Nothing is sent until you switch it on{marketing ? ' (or a manager approves it)' : ''}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {choices.map((c) => (
              <Link
                key={c.title}
                href={c.href}
                onClick={() => setOpen(false)}
                className={cn('group flex flex-col gap-3 rounded-2xl bg-card p-4 ring-1 ring-inset ring-foreground/10 transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-primary/40', c.badge === 'Recommended' && 'ring-2 ring-primary/30')}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm', c.tone)}>
                    <c.icon className="h-5 w-5" />
                  </span>
                  {c.locked ? <PlanLockBadge /> : c.badge && <Badge variant={c.badge === 'Recommended' ? 'default' : 'secondary'}>{c.badge}</Badge>}
                </div>
                <div className="grid gap-1">
                  <p className="font-semibold">{c.title}</p>
                  <p className="text-sm text-muted-foreground">{c.text}</p>
                </div>
                <span className="mt-auto flex items-center gap-1 text-sm font-semibold text-primary">
                  {c.locked ? 'See plans' : 'Start'} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
