'use client';
import { ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Shown while NextCore support is signed in as the clinic's System account, so it is never mistaken for staff. */
export function SystemBar() {
  const { session } = useSession();
  if (!session.user.isSystemAccount) return null;
  const signOut = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      window.location.href = '/login';
    }
  };
  return (
    <div role="status" className="no-print mx-3 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-warning px-4 py-2 text-sm text-warning-foreground shadow sm:mx-4 lg:mx-6">
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <b>NextCore support — signed in as System{session.user.supportBy ? ` (${session.user.supportBy.replace(/\s*<.*>$/, '')})` : ''}.</b> Full access to {session.organization?.name}. Everything you do is in the clinic’s audit log.
      </span>
      <button type="button" onClick={signOut} className="rounded-pill bg-black/10 px-3 py-1 font-semibold transition-colors hover:bg-black/20">
        Sign out
      </button>
    </div>
  );
}
