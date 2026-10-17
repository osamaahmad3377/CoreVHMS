'use client';
import { CheckCircle2, X } from 'lucide-react';
import { Button } from '../ui/button';

/**
 * Shown once after a new client or patient is saved, with the usual next steps as buttons, so new staff are
 * not left wondering what to do. Dismissed with the ✕ (and gone when the page is reloaded without ?registered).
 */
export function SavedNextSteps({ message = 'Saved. What next?', onDismiss, children }: { message?: string; onDismiss: () => void; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-success/40 bg-success/10 px-4 py-3 text-sm" role="status">
      <span className="flex items-center gap-2 font-medium text-success">
        <CheckCircle2 className="h-4 w-4" /> {message}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
      <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Close" onClick={onDismiss}>
        <X />
      </Button>
    </div>
  );
}
