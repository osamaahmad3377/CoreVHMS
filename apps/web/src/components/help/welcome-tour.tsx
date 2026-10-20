'use client';
import { CircleHelp, ClipboardList, LayoutList, Plus, Search, Smile } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { useOptionalSession } from '@/lib/session';

export const TOUR_EVENT = 'vcms:welcome-tour';

const STEPS: { icon: React.ComponentType<{ className?: string }>; title: string; text: string }[] = [
  { icon: Smile, title: 'Welcome! Here is a 1-minute tour', text: 'Everything you need for the day is a click or two away. You cannot break anything by looking around, and you can open this tour again any time from the Help centre.' },
  { icon: Search, title: 'Find anything with Search', text: 'The search bar at the top finds clients, patients and phone numbers as you type. Press / on the keyboard to jump to it from any page.' },
  { icon: Plus, title: 'The green “New” button', text: 'Use it to start the common jobs: book an appointment, add a client or patient, or start a consultation. You do not need to hunt through the menu.' },
  { icon: ClipboardList, title: 'Front desk shows who is here', text: 'Open Front desk to see who has arrived, who is waiting and who is next, and to check people in. Vets start consultations from the same list.' },
  { icon: LayoutList, title: 'The menu on the left', text: 'It is grouped by job: Front desk, Clinical, Money & stock. You only see the parts your role is allowed to use, so a short menu is normal.' },
  { icon: CircleHelp, title: 'Stuck? Help is always close', text: 'Look for the small “?” next to a field for a plain explanation. The Help centre has step-by-step guides for every everyday task.' },
];

const keyFor = (userId: string) => `vcms.tour.done.${userId}`;

/**
 * A short welcome tour shown once to each person the first time they sign in on this computer.
 * It never appears in automated browsers, and can be reopened from the Help centre.
 */
export function WelcomeTour() {
  const session = useOptionalSession();
  const userId = session?.session.user.id;
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!userId || navigator.webdriver) return;
    try {
      if (!localStorage.getItem(keyFor(userId))) setOpen(true);
    } catch {
      /* storage unavailable: skip the tour rather than show it on every page */
    }
  }, [userId]);

  useEffect(() => {
    const again = () => {
      setI(0);
      setOpen(true);
    };
    window.addEventListener(TOUR_EVENT, again);
    return () => window.removeEventListener(TOUR_EVENT, again);
  }, []);

  const close = () => {
    setOpen(false);
    try {
      if (userId) localStorage.setItem(keyFor(userId), '1');
    } catch {
      /* ignore */
    }
  };

  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent size="md">
        <DialogHeader>
          <div className="mb-2 grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <step.icon className="h-6 w-6" />
          </div>
          <DialogTitle>{step.title}</DialogTitle>
          <DialogDescription className="text-base leading-relaxed">{step.text}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center gap-1.5" aria-hidden>
          {STEPS.map((_, n) => (
            <span key={n} className={`h-1.5 rounded-full transition-all ${n === i ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30'}`} />
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>Skip tour</Button>
          {i > 0 && <Button variant="outline" onClick={() => setI(i - 1)}>Back</Button>}
          <Button onClick={() => (last ? close() : setI(i + 1))}>{last ? 'Start using the system' : 'Next'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
