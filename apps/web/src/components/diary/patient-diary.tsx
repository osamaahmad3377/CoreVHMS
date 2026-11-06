'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DiaryLinkInfo } from '@vcms/shared';
import { BookOpen, Copy, ExternalLink, Printer, RefreshCw, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { useConfirm } from '../confirm';
import { SendToOwner } from './send-buttons';
import { SerologyCard } from './serology';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

/** The owner's online diary: the private link, who has opened it, sending it, and replacing it. */
function OnlineDiary({ patientId, patientName }: { patientId: string; patientName: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['diary-link', patientId], queryFn: () => api.get<DiaryLinkInfo>(`/patients/${patientId}/diary/link`) });
  const reset = useMutation({
    mutationFn: () => api.post<DiaryLinkInfo>(`/patients/${patientId}/diary/link/reset`),
    onSuccess: (l) => {
      qc.setQueryData(['diary-link', patientId], l);
      qc.invalidateQueries({ queryKey: ['diary-booklet', patientId] });
      toast.success('New link made — the old one no longer works');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const link = q.data;
  return (
    <Card>
      <CardContent className="grid gap-4 py-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Smartphone className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Online diary for the owner</p>
            <p className="text-sm text-muted-foreground">{patientName}’s owner can read the diary on their phone — always up to date, nothing to sign in to. The same link is on the QR code printed in the booklet.</p>
          </div>
        </div>
        {link && (
          <div className="grid gap-3 rounded-xl bg-muted/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md border bg-background px-3 py-2 font-mono text-xs">{link.url}</code>
              <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(link.url).then(() => toast.success('Link copied'))}><Copy /> Copy</Button>
              <Button variant="outline" size="sm" asChild><a href={link.url} target="_blank" rel="noreferrer"><ExternalLink /> Open</a></Button>
            </div>
            <p className="text-xs text-muted-foreground">{link.viewCount ? `Opened ${link.viewCount} time${link.viewCount === 1 ? '' : 's'} · last ${fmtDateTime(link.lastViewedAt!)}` : 'Not opened yet'}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <SendToOwner path={`/patients/${patientId}/diary/send`} />
          {can('preventive.write') && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground"
              loading={reset.isPending}
              onClick={async () => (await confirm({ title: 'Make a new link?', description: 'The old link and the QR code on printed diaries will stop working. Use this only if the link was shared by mistake.', confirmLabel: 'Make new link' })) && reset.mutate()}
            >
              <RefreshCw /> New link
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** The patient's Diary tab: open or print the pet diary, share it with the owner, and keep the rabies antibody tests. */
export function PatientDiary({ patientId, patientName }: { patientId: string; patientName: string }) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><BookOpen className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{patientName}’s pet diary</p>
            <p className="text-sm text-muted-foreground">A printed health book in the clinic’s design: owner, description, identification, rabies, other vaccinations, deworming, tick and flea, treatments and procedures — filled in from the records.</p>
          </div>
          <Button asChild><Link href={`/patients/${patientId}/diary`}><Printer /> Open and print</Link></Button>
        </CardContent>
      </Card>
      <OnlineDiary patientId={patientId} patientName={patientName} />
      <SerologyCard patientId={patientId} />
    </div>
  );
}
