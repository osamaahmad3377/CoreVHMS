'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BellOff, CheckCircle2, MailX } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';

interface Info {
  clinicName: string;
  offersOn: boolean;
}

/**
 * "Stop offers" — the link at the bottom of every promotional email. No sign-in: the signed link names the client.
 * Only offers stop; reminders and messages about their animals carry on.
 */
function Unsubscribe() {
  const token = useSearchParams().get('t') ?? '';
  const q = useQuery({ queryKey: ['unsubscribe', token], queryFn: () => api.get<Info>(`/public/marketing/unsubscribe?t=${encodeURIComponent(token)}`), enabled: !!token, retry: false });
  const stop = useMutation({ mutationFn: () => api.post<Info>('/public/marketing/unsubscribe', { t: token }) });
  const done = stop.data ?? (q.data && !q.data.offersOn ? q.data : null);
  const name = q.data?.clinicName;

  return (
    <div className="app-canvas grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-md p-8 text-center">
        {!token || q.isError ? (
          <>
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><MailX className="h-7 w-7" /></span>
            <h1 className="mt-4 text-xl font-semibold tracking-tight">This link does not work</h1>
            <p className="mt-2 text-sm text-muted-foreground">It may have been copied only in part. Use the link in the email again, or reply to the clinic and ask them to stop offers.</p>
          </>
        ) : q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : done ? (
          <>
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10 text-success"><CheckCircle2 className="h-7 w-7" /></span>
            <h1 className="mt-4 text-xl font-semibold tracking-tight">Offers stopped</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You will not get offers or promotions from {name} any more. Appointment reminders and messages about your animals carry on. To get offers again, just tell the clinic.
            </p>
          </>
        ) : (
          <>
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><BellOff className="h-7 w-7" /></span>
            <h1 className="mt-4 text-xl font-semibold tracking-tight">Stop offers from {name}?</h1>
            <p className="mt-2 text-sm text-muted-foreground">You will no longer get discounts, offers or promotions. Appointment reminders and messages about your animals are not affected.</p>
            <Button className="mt-6 w-full" loading={stop.isPending} onClick={() => stop.mutate()}>
              <BellOff /> Stop offers
            </Button>
            {stop.isError && <p className="mt-3 text-sm text-destructive">{(stop.error as Error).message}</p>}
          </>
        )}
      </Card>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense>
      <Unsubscribe />
    </Suspense>
  );
}
