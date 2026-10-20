'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NOTE_PHRASE_FIELDS, NOTE_PHRASE_FIELD_LABELS, phraseText, type NotePhraseField } from '@vcms/shared';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import type { NotePhraseRow } from '@/lib/types';
import { cn } from '@/lib/utils';

function Page() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['note-phrases', 'all'], queryFn: () => api.get<NotePhraseRow[]>('/note-phrases?all=true') });
  const [f, setF] = useState({ field: 'subjective' as NotePhraseField, groupName: '', label: '', text: '' });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['note-phrases'] });
  };
  const add = useMutation({
    mutationFn: () => api.post('/note-phrases', { field: f.field, groupName: f.groupName || null, label: f.label, text: f.text || null }),
    onSuccess: () => {
      toast.success('Button added');
      setF({ ...f, label: '', text: '' });
      setError(null);
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<{ label: string; text: string | null; groupName: string | null; isActive: boolean; isDefault: boolean }>) => api.patch(`/note-phrases/${id}`, body),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/note-phrases/${id}`),
    onSuccess: () => {
      toast.success('Button removed');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const restore = useMutation({
    mutationFn: () => api.post<{ added: number }>('/note-phrases/restore-starter'),
    onSuccess: (r) => {
      toast.success(r.added ? `${r.added} starter buttons put back` : 'All the starter buttons are already there');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data ?? [];
  const groupsForField = [...new Set(rows.filter((r) => r.field === f.field && r.groupName).map((r) => r.groupName as string))];

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold">Quick note phrases</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          The buttons vets tap under each consultation note field instead of typing. Change the wording to match how your clinic writes, add your own, or switch off the ones you do not use. The vet still reads, edits and signs every note.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Add a button</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {error && <FormError message={error} />}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Note field" htmlFor="np-field">
              <NativeSelect id="np-field" value={f.field} onChange={(e) => setF({ ...f, field: e.target.value as NotePhraseField, groupName: '' })}>
                {NOTE_PHRASE_FIELDS.map((k) => <option key={k} value={k}>{NOTE_PHRASE_FIELD_LABELS[k]}</option>)}
              </NativeSelect>
            </Field>
            <Field
              label="Question (optional)"
              htmlFor="np-group"
              hint="Buttons under the same question replace each other, like Eating: normal / less / not eating."
              help="Leave this empty for a button that can be combined with others. Give several buttons the same question name when only one answer makes sense, for example Appetite."
            >
              <Input id="np-group" list="np-groups" value={f.groupName} maxLength={40} onChange={(e) => setF({ ...f, groupName: e.target.value })} />
              <datalist id="np-groups">{groupsForField.map((g) => <option key={g} value={g} />)}</datalist>
            </Field>
            <Field label="Button says" htmlFor="np-label" required>
              <Input id="np-label" value={f.label} maxLength={60} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. Not eating" />
            </Field>
            <Field label="Adds this text (optional)" htmlFor="np-text" hint="Leave empty to add the button text itself.">
              <Input id="np-text" value={f.text} maxLength={300} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="e.g. Not eating since yesterday." />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button loading={add.isPending} disabled={!f.label.trim()} onClick={() => { setError(null); add.mutate(); }}>
              <Plus /> Add button
            </Button>
            <Button
              variant="outline"
              loading={restore.isPending}
              onClick={async () => {
                const r = await confirm({ title: 'Put back the starter buttons?', description: 'Any starter button you removed comes back. Your own buttons and changes stay as they are.', confirmLabel: 'Put them back' });
                if (r.confirmed) restore.mutate();
              }}
            >
              <RotateCcw /> Put back starter buttons
            </Button>
          </div>
        </CardContent>
      </Card>

      {q.isLoading ? (
        <LoadingRows rows={6} />
      ) : (
        NOTE_PHRASE_FIELDS.map((field) => {
          const mine = rows.filter((r) => r.field === field);
          return (
            <Card key={field}>
              <CardHeader>
                <CardTitle>{NOTE_PHRASE_FIELD_LABELS[field]}</CardTitle>
                <span className="text-xs text-muted-foreground">{mine.filter((r) => r.isActive).length} showing</span>
              </CardHeader>
              {mine.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-muted-foreground">No buttons for this field. Add one above.</p>
              ) : (
                <ul className="divide-y">
                  <li className="hidden gap-2 px-4 py-1.5 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[auto_1fr_1fr_9rem_4rem_auto]" aria-hidden>
                    <span className="w-4">Show</span>
                    <span>Button says</span>
                    <span>Adds this to the note</span>
                    <span>Question</span>
                    <span title="The usual answer of its question, added by “Fill in the normal answers”">Normal</span>
                    <span className="w-8" />
                  </li>
                  {mine.map((r) => (
                    <li key={r.id} className={cn('grid items-center gap-2 px-4 py-2 sm:grid-cols-[auto_1fr_1fr_9rem_4rem_auto]', !r.isActive && 'opacity-55')}>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground" title="Show this button in notes">
                        <Checkbox checked={r.isActive} onCheckedChange={(v) => patch.mutate({ id: r.id, isActive: v === true })} aria-label={`Show “${r.label}”`} />
                        <span className="sm:hidden">Show</span>
                      </label>
                      <Input aria-label="Button text" defaultValue={r.label} maxLength={60} className="h-8" onBlur={(e) => e.target.value.trim() && e.target.value !== r.label && patch.mutate({ id: r.id, label: e.target.value })} />
                      <Input aria-label="Text added to the note" defaultValue={r.text ?? ''} placeholder={phraseText(r)} maxLength={300} className="h-8" onBlur={(e) => e.target.value !== (r.text ?? '') && patch.mutate({ id: r.id, text: e.target.value || null })} />
                      <Input aria-label="Question" defaultValue={r.groupName ?? ''} placeholder="No question" maxLength={40} className="h-8" onBlur={(e) => e.target.value !== (r.groupName ?? '') && patch.mutate({ id: r.id, groupName: e.target.value || null })} />
                      <label className="flex items-center gap-2 text-xs text-muted-foreground" title="The usual (normal) answer of its question">
                        <Checkbox checked={r.isDefault} disabled={!r.groupName && false} onCheckedChange={(v) => patch.mutate({ id: r.id, isDefault: v === true })} aria-label={`“${r.label}” is the normal answer`} />
                        <span className="sm:hidden">Normal answer</span>
                      </label>
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove “${r.label}”`} onClick={() => remove.mutate(r.id)}>
                        <Trash2 className="text-destructive" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}

export default function NotePhrasesPage() {
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <Page />
    </RequirePermission>
  );
}
