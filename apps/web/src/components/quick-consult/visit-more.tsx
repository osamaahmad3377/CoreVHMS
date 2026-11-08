'use client';
import { useQueryClient } from '@tanstack/react-query';
import { Award, History, MoreHorizontal, Paperclip, Smile, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { IssueCertificateDialog } from '../certificates/issue-dialog';
import { useConfirm } from '../confirm';
import { NewDentalChartDialog } from '../dental/new-chart-dialog';
import { useVisitDental } from '../dental/visit-dental';
import { AttachmentsPanel } from '../shared/attachments-panel';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { api } from '@/lib/api';
import { useModuleOn, useSession } from '@/lib/session';
import type { Encounter } from '@/lib/types';

/**
 * The less frequent things done during a visit, one tap away: the full history, photos and documents, a dental chart,
 * a certificate — and cancelling the consultation (only while nothing has been signed).
 */
export function VisitMore({ enc, onOpenHistory }: { enc: Encounter; onOpenHistory: () => void }) {
  const { can } = useSession();
  const moduleOn = useModuleOn();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [files, setFiles] = useState(false);
  const [dentalOpen, setDentalOpen] = useState(false);
  const [certificateOpen, setCertificateOpen] = useState(false);
  const dentalOn = moduleOn('dental') && can('clinical.read');
  const visitDental = useVisitDental(enc.id, dentalOn);

  const openDental = () => {
    const draft = (visitDental.data?.charts ?? []).find((c) => c.status === 'DRAFT');
    if (draft) router.push(`/dental/${draft.id}`);
    else setDentalOpen(true);
  };
  const cancel = async () => {
    const r = await confirm({ title: 'Cancel this consultation?', description: 'Only possible while nothing has been signed.', requireReason: true, destructive: true, confirmLabel: 'Cancel consultation', cancelLabel: 'Keep consultation' });
    if (!r.confirmed) return;
    try {
      await api.post(`/encounters/${enc.id}/cancel`, { reason: r.reason });
      toast.success('Consultation cancelled');
      qc.invalidateQueries({ queryKey: ['encounter', enc.id] });
      qc.invalidateQueries({ queryKey: ['queue'] });
      router.push('/quick-consult');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" aria-label="More for this visit">
            <MoreHorizontal /> More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={onOpenHistory}>
            <History /> Full history
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setFiles(true)}>
            <Paperclip /> Photos & documents
          </DropdownMenuItem>
          {dentalOn && (
            <DropdownMenuItem onSelect={openDental}>
              <Smile /> Dental chart
            </DropdownMenuItem>
          )}
          {can('certificates.issue') && (
            <DropdownMenuItem onSelect={() => setCertificateOpen(true)}>
              <Award /> Certificate
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void cancel()}>
            <XCircle /> Cancel consultation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={files} onOpenChange={setFiles}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Photos & documents</DialogTitle>
            <DialogDescription>Files for this visit — X-rays, photos, referral letters, signed forms.</DialogDescription>
          </DialogHeader>
          <AttachmentsPanel entityType="Encounter" entityId={enc.id} canWrite={can('clinical.write')} />
        </DialogContent>
      </Dialog>
      {dentalOn && (
        <NewDentalChartDialog
          patient={{ id: enc.patient.id, name: enc.patient.name, patientNo: enc.patient.patientNo, species: enc.patient.species, ownerName: enc.patient.owner?.displayName ?? null }}
          suggested={visitDental.data?.suggestedDentition ?? null}
          encounterId={enc.id}
          open={dentalOpen}
          onOpenChange={setDentalOpen}
        />
      )}
      {certificateOpen && <IssueCertificateDialog open onOpenChange={setCertificateOpen} subject="PATIENT" patient={{ id: enc.patient.id, name: enc.patient.name }} encounterId={enc.id} />}
    </>
  );
}
