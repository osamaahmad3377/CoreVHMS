'use client';
import { useQuery } from '@tanstack/react-query';
import { FilePen, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import type { ClinicalNote } from '@/lib/types';
import { cn } from '@/lib/utils';

const SECTIONS: { key: keyof ClinicalNote; label: string }[] = [
  { key: 'presentingComplaint', label: 'Presenting complaint' },
  { key: 'history', label: 'History' },
  { key: 'subjective', label: 'Subjective' },
  { key: 'objective', label: 'Objective' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'plan', label: 'Plan' },
  { key: 'followUpInstructions', label: 'Client instructions' },
];

/** Read-only rendering of a signed or superseded note, with tamper-evidence check. */
export function NoteView({ note, onAmend, compact }: { note: ClinicalNote; onAmend?: () => void; compact?: boolean }) {
  const verify = useQuery({
    queryKey: ['note-verify', note.id],
    queryFn: () => api.get<{ signed: boolean; valid: boolean | null }>(`/notes/${note.id}/verify`),
    enabled: note.status === 'SIGNED' || note.status === 'SUPERSEDED',
    staleTime: Infinity,
  });
  const superseded = note.status === 'SUPERSEDED';
  return (
    <article className={cn('grid gap-3', superseded && 'opacity-70')}>
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant={superseded ? 'secondary' : 'success'}>{superseded ? `Superseded · v${note.version}` : `Signed · v${note.version}`}</Badge>
        <span className="text-xs text-muted-foreground">
          {note.signedByName} · {fmtDateTime(note.signedAt)}
          {note.authorName !== note.signedByName && ` · drafted by ${note.authorName}`}
          {note.reviewedByName && ` · reviewed by ${note.reviewedByName}`}
        </span>
        {verify.data?.valid === true && (
          <span className="flex items-center gap-1 text-xs text-success" title={`SHA-256 ${note.contentHash}`}>
            <ShieldCheck className="h-3.5 w-3.5" /> Integrity verified
          </span>
        )}
        {verify.data?.valid === false && (
          <span className="flex items-center gap-1 text-xs font-medium text-destructive">
            <ShieldAlert className="h-3.5 w-3.5" /> Content does not match signature
          </span>
        )}
        {onAmend && !superseded && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={onAmend}>
            <FilePen /> Amend
          </Button>
        )}
      </header>
      {note.amendmentReason && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">
          <span className="font-medium">Amendment reason:</span> {note.amendmentReason}
        </p>
      )}
      <dl className={cn('grid gap-3', !compact && 'md:grid-cols-2')}>
        {SECTIONS.filter((s) => note[s.key]).map((s) => (
          <div key={s.key} className={cn((s.key === 'assessment' || s.key === 'plan') && !compact ? '' : '')}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-sm">{String(note[s.key])}</dd>
          </div>
        ))}
      </dl>
      {!!note.examFindings?.length && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Physical examination</p>
          <ul className="mt-1 grid gap-0.5 text-sm sm:grid-cols-2">
            {note.examFindings
              .filter((f) => f.status !== 'NOT_EXAMINED')
              .map((f) => (
                <li key={f.system}>
                  <span className={f.status === 'ABNORMAL' ? 'font-medium text-warning' : 'text-success'}>{f.status === 'ABNORMAL' ? '✗' : '✓'}</span> {f.system}
                  {f.notes && <span className="text-muted-foreground"> — {f.notes}</span>}
                </li>
              ))}
          </ul>
        </div>
      )}
    </article>
  );
}
