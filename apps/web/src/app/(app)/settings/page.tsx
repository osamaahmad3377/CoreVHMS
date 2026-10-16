'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { SETTINGS_NAV } from '@/lib/navigation';
import { useSession } from '@/lib/session';

export default function SettingsIndex() {
  const router = useRouter();
  const { canAny } = useSession();
  useEffect(() => {
    const first = SETTINGS_NAV.find((i) => canAny(...i.anyOf));
    if (first) router.replace(first.href);
  }, [canAny, router]);
  return null;
}
