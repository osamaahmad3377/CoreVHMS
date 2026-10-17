'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Kbd } from '../ui/misc';
import { SHORTCUTS } from '@/lib/help-content';

/** "⌘" on a Mac, "Ctrl" on Windows and Linux. Read after mount so server and browser render the same markup. */
export function useModKey() {
  const [mod, setMod] = useState('Ctrl');
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent;
    if (/mac|iphone|ipad|ipod/i.test(platform)) setMod('⌘');
  }, []);
  return mod;
}

export function ShortcutList() {
  const mod = useModKey();
  return (
    <dl className="grid gap-2">
      {SHORTCUTS.map((s) => (
        <div key={s.action} className="flex items-center justify-between gap-3 text-sm">
          <dt className="text-muted-foreground">{s.action}</dt>
          <dd className="flex shrink-0 gap-1">{s.keys.map((k) => <Kbd key={k}>{k === 'Mod' ? mod : k}</Kbd>)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Press "?" anywhere outside a text field to see the keyboard shortcuts. */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !(e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            More help in the <Link href="/help" className="text-primary underline" onClick={() => setOpen(false)}>Help centre</Link>.
          </DialogDescription>
        </DialogHeader>
        <ShortcutList />
      </DialogContent>
    </Dialog>
  );
}
