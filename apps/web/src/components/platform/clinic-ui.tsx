'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlatformClinic } from '@vcms/shared';
import { Check, Copy, ExternalLink, KeyRound, Loader2, MessageCircle, MoreHorizontal, Pause, Play, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

export const STATUS: Record<PlatformClinic['status'], { label: string; hint: string; variant: 'success' | 'info' | 'warning' | 'destructive' }> = {
  ACTIVE: { label: 'Ready', hint: 'Staff can sign in.', variant: 'success' },
  PROVISIONING: { label: 'Setting up', hint: 'Creating its database. Usually under a minute.', variant: 'info' },
  SUSPENDED: { label: 'Paused', hint: 'Nobody can sign in until you reactivate it.', variant: 'warning' },
  FAILED: { label: 'Set-up failed', hint: 'Fix the cause, then try again.', variant: 'destructive' },
};

export function StatusBadge({ status }: { status: PlatformClinic['status'] }) {
  return (
    <Badge variant={STATUS[status].variant} title={STATUS[status].hint}>
      {status === 'PROVISIONING' && <Loader2 className="h-3 w-3 animate-spin" />}
      {STATUS[status].label}
    </Badge>
  );
}

/** "happy-paws.nextcore.net.au" — the address without http(s)://. */
export const shortAddress = (url: string) => url.replace(/^https?:\/\//, '');

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
    return true;
  } catch {
    toast.error('Could not copy — select the text and copy it manually');
    return false;
  }
}

export function CopyButton({ text, what, label, size = 'icon-sm', variant = 'ghost' }: { text: string; what: string; label?: string; size?: 'icon-sm' | 'sm'; variant?: 'ghost' | 'outline' }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size={label ? 'sm' : size}
      variant={variant}
      aria-label={`Copy ${what.toLowerCase()}`}
      title={`Copy ${what.toLowerCase()}`}
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(text, what)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <Check /> : <Copy />} {label}
    </Button>
  );
}

export interface OwnerAccess {
  clinic: PlatformClinic;
  temporaryPassword: string;
  expiresAt: string;
}

/** Everything the owner needs, ready to paste into WhatsApp, SMS or an email. */
export function welcomeMessage(r: OwnerAccess) {
  return [
    `Hello ${r.clinic.ownerName},`,
    '',
    `${r.clinic.name} is ready on NextCore.`,
    `Open: ${r.clinic.address}`,
    `Email: ${r.clinic.ownerEmail}`,
    `Temporary password: ${r.temporaryPassword}`,
    '',
    `You will choose your own password the first time you sign in. This password works until ${fmtDateTime(r.expiresAt)}.`,
  ].join('\n');
}

/** Shows the owner's temporary password once, with a ready-made message to send them. */
export function OwnerAccessDialog({ result: current, onClose }: { result: OwnerAccess | null; onClose: () => void }) {
  // Keep showing the last details while the dialog animates closed.
  const last = useRef<OwnerAccess | null>(null);
  if (current) last.current = current;
  const result = current ?? last.current;
  return (
    <Dialog open={!!current} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Send the owner their sign-in details</DialogTitle>
          <DialogDescription>The password is shown only now — it cannot be looked up later. Send the message below to {result?.clinic.ownerName}.</DialogDescription>
        </DialogHeader>
        {result && (
          <div className="grid gap-3">
            <pre data-testid="welcome-message" className="max-h-60 select-all overflow-auto whitespace-pre-wrap rounded-lg surface-flat p-3 font-sans text-sm">{welcomeMessage(result)}</pre>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={welcomeMessage(result)} what="Message" label="Copy message" variant="outline" />
              <Button asChild size="sm" variant="outline">
                <a href={`https://wa.me/?text=${encodeURIComponent(welcomeMessage(result))}`} target="_blank" rel="noreferrer"><MessageCircle /> Send on WhatsApp</a>
              </Button>
              <CopyButton text={result.temporaryPassword} what="Password" label="Copy password only" variant="outline" />
            </div>
            <p className="text-xs text-muted-foreground">
              Password: <code data-testid="temporary-password" className="font-mono">{result.temporaryPassword}</code>. At first sign-in the owner chooses their own password, then adds their staff.
            </p>
          </div>
        )}
        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type ClinicAction = 'suspend' | 'reactivate' | 'retry' | 'owner-password';

/** Pause, reactivate, retry and new owner password, with the confirmations each needs. */
export function useClinicActions(onOwnerAccess: (r: OwnerAccess) => void) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: ClinicAction }) => api.post<PlatformClinic | OwnerAccess>(`/platform/clinics/${id}/${action}`),
    onSuccess: (r, { action }) => {
      qc.invalidateQueries({ queryKey: ['platform-clinics'] });
      qc.invalidateQueries({ queryKey: ['platform-clinic'] });
      if (action === 'owner-password') onOwnerAccess(r as OwnerAccess);
      else toast.success({ suspend: 'Clinic paused', reactivate: 'Clinic reactivated — staff can sign in again', retry: 'Trying the set-up again' }[action]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const run = async (c: PlatformClinic, action: ClinicAction) => {
    if (action === 'suspend') {
      const { confirmed } = await confirm({
        title: `Pause ${c.name}?`,
        description: 'Nobody at this clinic can sign in or use the system until you reactivate it. No data is deleted.',
        confirmLabel: 'Pause clinic',
        destructive: true,
      });
      if (!confirmed) return;
    }
    if (action === 'owner-password') {
      const { confirmed } = await confirm({
        title: `New password for ${c.ownerName}?`,
        description: `${c.ownerEmail} gets a new temporary password. Their current password and any open sign-ins stop working.`,
        confirmLabel: 'Create password',
      });
      if (!confirmed) return;
    }
    act.mutate({ id: c.id, action });
  };
  return { run, pending: act.isPending ? act.variables : undefined };
}

/** The ⋯ menu for a clinic. */
export function ClinicActionsMenu({ clinic: c, run }: { clinic: PlatformClinic; run: (c: PlatformClinic, a: ClinicAction) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${c.name}`} onClick={(e) => e.stopPropagation()}><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {c.status === 'ACTIVE' && (
          <>
            <DropdownMenuItem asChild><a href={`${c.address}/login`} target="_blank" rel="noreferrer"><ExternalLink /> Open sign-in page</a></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run(c, 'owner-password')}><KeyRound /> New owner password</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => run(c, 'suspend')}><Pause /> Pause clinic</DropdownMenuItem>
          </>
        )}
        {c.status === 'SUSPENDED' && <DropdownMenuItem onSelect={() => run(c, 'reactivate')}><Play /> Reactivate clinic</DropdownMenuItem>}
        {c.status === 'FAILED' && <DropdownMenuItem onSelect={() => run(c, 'retry')}><RotateCcw /> Try set-up again</DropdownMenuItem>}
        {c.status === 'PROVISIONING' && <DropdownMenuItem disabled>Setting up — please wait</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
