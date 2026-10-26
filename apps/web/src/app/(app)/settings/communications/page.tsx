import { redirect } from 'next/navigation';

/** Reminder wording and timing now live in Settings → Automations. */
export default function Page() {
  redirect('/settings/automations');
}
