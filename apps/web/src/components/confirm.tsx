'use client';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Textarea } from './ui/input';
import { Label } from './ui/label';

interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  /** Label of the dismiss button (defaults to "Cancel"). Use it when "Cancel" would be ambiguous, e.g. "Keep appointment". */
  cancelLabel?: string;
  destructive?: boolean;
  /** Ask for a mandatory reason (returned to the caller and usually stored in the audit trail). */
  requireReason?: boolean;
  reasonLabel?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<{ confirmed: boolean; reason?: string }>;
const Ctx = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [reason, setReason] = useState('');
  const resolver = useRef<((v: { confirmed: boolean; reason?: string }) => void) | undefined>(undefined);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    setReason('');
    return new Promise((resolve) => (resolver.current = resolve));
  }, []);

  const close = (confirmed: boolean) => {
    resolver.current?.({ confirmed, reason: reason.trim() || undefined });
    setOpts(null);
  };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Dialog open={!!opts} onOpenChange={(o) => !o && close(false)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{opts?.title}</DialogTitle>
            {opts?.description && <DialogDescription asChild><div>{opts.description}</div></DialogDescription>}
          </DialogHeader>
          {opts?.requireReason && (
            <div className="grid gap-1.5">
              <Label htmlFor="confirm-reason">{opts.reasonLabel ?? 'Reason'} *</Label>
              <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus maxLength={500} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              {opts?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button
              variant={opts?.destructive ? 'destructive' : 'default'}
              disabled={opts?.requireReason && !reason.trim()}
              onClick={() => close(true)}
            >
              {opts?.confirmLabel ?? 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useConfirm must be used inside ConfirmProvider');
  return c;
}
