'use client';
import { useQuery } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { CalendarDays, MessageSquare, PawPrint, Receipt, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { LoadingRows } from '@/components/page';
import { usePortal } from '@/components/portal/shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtAge, fmtDate, fmtMoney } from '@/lib/format';
import { portalApi } from '@/lib/portal-api';
import { branchTime } from '@/lib/time';

interface Overview {
  client: { displayName: string; balanceMinor: number };
  pets: { id: string; name: string; sex: string; dateOfBirth: string | null; status: string; species: { name: string }; breed: { name: string } | null }[];
  upcomingAppointments: { id: string; startsAt: string; patient: string | null; type: string; branch: string; timezone: string }[];
  careDue: { id: string; pet: string; title: string; dueDate: string; overdue: boolean }[];
  unreadMessages: number;
  pendingRequests: number;
}

export default function PortalHome() {
  const s = usePortal();
  const q = useQuery({ queryKey: ['portal', 'overview'], queryFn: () => portalApi.get<Overview>('/overview') });
  if (!q.data) return <LoadingRows />;
  const d = q.data;
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Hello {s.user.name.split(' ')[0]}</h1>
        <p className="text-sm text-muted-foreground">Welcome to {s.clinic.name}’s client portal.</p>
      </div>
      {d.unreadMessages > 0 && (
        <Link href="/portal/messages" className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm font-medium text-primary"><MessageSquare className="h-4 w-4" /> You have {d.unreadMessages} new message{d.unreadMessages === 1 ? '' : 's'} from the clinic</Link>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><PawPrint className="h-4 w-4 text-primary" /> My animals</CardTitle></CardHeader>
          <ul className="divide-y border-t">
            {d.pets.map((p) => (
              <li key={p.id}>
                <Link href={`/portal/pets/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted/50">
                  <span><span className="font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{p.species.name}{p.breed ? ` · ${p.breed.name}` : ''} · {fmtAge(p.dateOfBirth)}</span></span>
                  {p.status !== 'ACTIVE' && <Badge variant="secondary">{enumLabel(p.status)}</Badge>}
                </Link>
              </li>
            ))}
            {!d.pets.length && <li className="px-4 py-3 text-sm text-muted-foreground">No animals linked to your account yet.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Care due</CardTitle></CardHeader>
          <ul className="divide-y border-t">
            {d.careDue.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span><span className="font-medium">{c.pet}</span> · {c.title}</span>
                <span className={c.overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}>{c.overdue ? 'Overdue since ' : ''}{fmtDate(c.dueDate)}</span>
              </li>
            ))}
            {!d.careDue.length && <li className="px-4 py-3 text-sm text-muted-foreground">Nothing due at the moment.</li>}
          </ul>
          {!!d.careDue.length && <CardContent className="pt-3"><Button size="sm" asChild><Link href="/portal/appointments?request=1">Request an appointment</Link></Button></CardContent>}
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /> Upcoming appointments</CardTitle></CardHeader>
          <ul className="divide-y border-t">
            {d.upcomingAppointments.map((a) => (
              <li key={a.id} className="px-4 py-2.5 text-sm">
                <p className="font-medium">{fmtDate(a.startsAt)} at {branchTime(a.startsAt, a.timezone)}</p>
                <p className="text-xs text-muted-foreground">{a.patient ?? ''}{a.patient ? ' · ' : ''}{a.type} · {a.branch}</p>
              </li>
            ))}
            {!d.upcomingAppointments.length && <li className="px-4 py-3 text-sm text-muted-foreground">No upcoming appointments.{d.pendingRequests ? ` ${d.pendingRequests} request(s) waiting for the clinic.` : ''}</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Receipt className="h-4 w-4 text-primary" /> Account</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{d.client.balanceMinor > 0 ? 'Balance to pay' : d.client.balanceMinor < 0 ? 'Credit on your account' : 'Your account is up to date'}</p>
            <p className="text-2xl font-semibold tabular">{fmtMoney(Math.abs(d.client.balanceMinor), s.clinic.currency)}</p>
            <Link href="/portal/invoices" className="text-sm text-primary hover:underline">See invoices and payments</Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
