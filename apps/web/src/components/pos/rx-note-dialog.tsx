'use client';
import { useEffect, useState } from 'react';
import { Field } from '../forms/field';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';

/**
 * Asked when a prescription-only item is added to a sale without a prescription (a clinic setting allows it):
 * who approved it, or why. The answer is kept on the invoice and in the activity log.
 */
export function RxNoteDialog({ itemName, open, onCancel, onConfirm }: { itemName: string; open: boolean; onCancel: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) setNote('');
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Sell without a prescription?</DialogTitle>
          <DialogDescription>
            {itemName} is normally given on a prescription. Say who approved selling it without one, or why. This is written on the invoice. Controlled medicines can never be sold this way.
          </DialogDescription>
        </DialogHeader>
        <Field label="Approved by, or reason" htmlFor="rx-note" required>
          <Input id="rx-note" autoFocus value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Dr Raza agreed by phone" onKeyDown={(e) => e.key === 'Enter' && note.trim() && onConfirm(note.trim())} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={!note.trim()} onClick={() => onConfirm(note.trim())}>Add to sale</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
