'use client';
import { useCallback } from 'react';
import { useConfirm } from '@/components/confirm';

/**
 * Asks "Discard what you typed?" before a form with unsaved input is closed. Resolves true when it is fine to
 * close (nothing typed, or the user chose Discard).
 */
export function useDiscardConfirm() {
  const confirm = useConfirm();
  return useCallback(
    async (dirty: boolean) => {
      if (!dirty) return true;
      const r = await confirm({
        title: 'Discard what you typed?',
        description: 'What you entered in this form has not been saved.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        destructive: true,
      });
      return r.confirmed;
    },
    [confirm],
  );
}
