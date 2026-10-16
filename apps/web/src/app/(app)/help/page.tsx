'use client';
import { BookOpen, ChevronRight, Keyboard, Lightbulb, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShortcutList } from '@/components/help/shortcuts';
import { GLOSSARY, GUIDES, type HelpGuide } from '@/lib/help-content';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

function Guide({ g, open, onToggle }: { g: HelpGuide; open: boolean; onToggle: () => void }) {
  return (
    <Card id={g.id} className={cn('scroll-mt-20 transition-shadow', open && 'ring-1 ring-primary/40')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 p-4 text-left">
        <ChevronRight className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{g.title}</span>
          <span className="block text-sm text-muted-foreground">{g.summary}</span>
        </span>
        <span className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground sm:inline">{g.area}</span>
      </button>
      {open && (
        <CardContent className="grid gap-3 pl-11">
          <ol className="grid list-decimal gap-2 pl-4 text-sm marker:font-semibold marker:text-primary">
            {g.steps.map((s, i) => <li key={i} className="pl-1">{s}</li>)}
          </ol>
          {g.tips?.map((t, i) => (
            <p key={i} className="flex gap-2 rounded-md bg-info/10 px-3 py-2 text-sm text-info"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />{t}</p>
          ))}
          <div className="flex flex-wrap gap-2">
            {g.links.map((l) => (
              <Link key={l.href} href={l.href} className="inline-flex items-center gap-1 rounded-md border bg-card px-3 py-1.5 text-sm font-medium text-primary hover:bg-muted">
                Go to {l.label} <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function HelpPage() {
  const { canAny, session } = useSession();
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [open, setOpen] = useState<string | null>(null);

  // Deep links from "How to" buttons: /help#guide-id opens that guide.
  useEffect(() => {
    const openFromHash = () => {
      const id = window.location.hash.slice(1);
      if (id && GUIDES.some((g) => g.id === id)) {
        setOpen(id);
        setScope('all');
        setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 50);
      }
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);

  const term = q.trim().toLowerCase();
  const guides = useMemo(
    () =>
      GUIDES.filter((g) => !g.feature || session.features?.[g.feature])
        .filter((g) => scope === 'all' || !g.anyOf.length || canAny(...g.anyOf))
        .filter(
        (g) => !term || [g.title, g.summary, g.area, ...g.steps].some((t) => t.toLowerCase().includes(term)),
      ),
    [scope, term, canAny, session.features],
  );
  const glossary = GLOSSARY.filter((g) => !term || `${g.term} ${g.meaning}`.toLowerCase().includes(term));
  const areas = [...new Set(guides.map((g) => g.area))];

  return (
    <>
      <PageHeader title="Help centre" description="Step-by-step guides for everyday tasks, a glossary of terms and keyboard shortcuts." />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="grid content-start gap-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="What do you want to do? e.g. refund, vaccine, stock count"
                aria-label="Search help"
                className="h-11 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex rounded-lg border bg-card p-1" role="tablist">
              {(['mine', 'all'] as const).map((s) => (
                <button key={s} role="tab" aria-selected={scope === s} onClick={() => setScope(s)} className={cn('rounded-md px-3 py-1.5 text-sm', scope === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
                  {s === 'mine' ? 'For my role' : 'All guides'}
                </button>
              ))}
            </div>
          </div>
          {!guides.length && <p className="py-8 text-center text-sm text-muted-foreground">No guide matches “{q}”. Try another word, or check the glossary.</p>}
          {areas.map((area) => (
            <section key={area} className="grid gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><BookOpen className="h-4 w-4" /> {area}</h2>
              {guides.filter((g) => g.area === area).map((g) => (
                <Guide key={g.id} g={g} open={open === g.id || (!!term && guides.length <= 3)} onToggle={() => setOpen((o) => (o === g.id ? null : g.id))} />
              ))}
            </section>
          ))}
        </div>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader><CardTitle>Glossary</CardTitle></CardHeader>
            <CardContent>
              {glossary.length ? (
                <dl className="grid gap-3">
                  {glossary.map((g) => (
                    <div key={g.term}>
                      <dt className="text-sm font-medium">{g.term}</dt>
                      <dd className="text-sm text-muted-foreground">{g.meaning}</dd>
                    </div>
                  ))}
                </dl>
              ) : <p className="text-sm text-muted-foreground">No matching terms.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Keyboard className="h-4 w-4" /> Keyboard shortcuts</CardTitle></CardHeader>
            <CardContent>
              <ShortcutList />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
