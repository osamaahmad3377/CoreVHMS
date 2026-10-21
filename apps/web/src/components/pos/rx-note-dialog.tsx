'use client';
import { useEffect, useState } from 'react';
import { Field } from '../forms/field';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';

/**
 * Asked when a prescription-only item is added to a sale without a prescription (a clinic setting allows it).
 * Who approved it, or why, can be written down but is not required; the sale is marked either way.
 */
export function RxNoteDialog({ itemName, open, onCancel, onConfirm }: { itemName: string; open: boolean; onCancel: () => void; onConfirm: (note: string | undefined) => void }) {
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
            {itemName} is normally given on a prescription. The sale is marked as made without one. You can write who approved it, or why. Controlled medicines can never be sold this way.
          </DialogDescription>
        </DialogHeader>
        <Field label="Approved by, or reason (optional)" htmlFor="rx-note">
          <Input id="rx-note" autoFocus value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Dr Raza agreed by phone" onKeyDown={(e) => e.key === 'Enter' && onConfirm(note.trim() || undefined)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onConfirm(note.trim() || undefined)}>Add to sale</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
