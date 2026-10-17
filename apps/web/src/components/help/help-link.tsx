import { CircleHelp } from 'lucide-react';
import Link from 'next/link';

/** Small "Help" link from a page to its guide in the Help centre. */
export function HelpLink({ topic, label = 'Help' }: { topic: string; label?: string }) {
  return (
    <Link href={`/help#${topic}`} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
      <CircleHelp className="h-4 w-4" /> {label}
    </Link>
  );
}
