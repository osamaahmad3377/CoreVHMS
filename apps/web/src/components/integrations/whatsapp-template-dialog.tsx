'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WHATSAPP_PURPOSE_LABELS, WHATSAPP_VARIABLES, type WhatsAppPurpose } from '@vcms/shared';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { ErrorState, LoadingRows } from '../page';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { NativeSelect } from '../ui/input';
import { api } from '@/lib/api';
import type { WhatsAppOverview, WhatsAppTemplate } from '@/lib/types';
import { cn } from '@/lib/utils';

const keyOf = (t: { name: string; language: string }) => `${t.name}|${t.language}`;

/** The template text with each {{n}} replaced by the chosen value's example (or highlighted when not chosen yet). */
function Preview({ text, values }: { text: string; values: (string | null)[] }) {
  const parts = text.split(/(\{\{\s*\d+\s*\}\})/g);
  return (
    <p className="whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-[#dcf8c6] px-4 py-3 text-sm leading-relaxed text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]">
      {parts.map((p, i) => {
        const m = p.match(/^\{\{\s*(\d+)\s*\}\}$/);
        if (!m) return <span key={i}>{p}</span>;
        const v = values[Number(m[1]) - 1];
        return v ? (
          <strong key={i} className="font-semibold">
            {v}
          </strong>
        ) : (
          <mark key={i} className="rounded bg-warning/25 px-1 text-inherit">
            {p}
          </mark>
        );
      })}
    </p>
  );
}

/**
 * Chooses which approved WhatsApp template a kind of message uses, and which value fills each {{1}}, {{2}}…
 * with a live preview in a WhatsApp-style bubble.
 */
export function WhatsAppTemplateDialog({ purpose, current, open, onOpenChange }: { purpose: WhatsAppPurpose | null; current?: WhatsAppOverview['links'][number]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['whatsapp-templates'], queryFn: () => api.get<WhatsAppTemplate[]>('/integrations/whatsapp/templates'), enabled: open, staleTime: 60_000 });
  const [choice, setChoice] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (open) {
      setChoice(current ? keyOf({ name: current.templateName, language: current.language }) : '');
      setParams(current?.params ?? []);
      setError(null);
      setTried(false);
    }
  }, [open, current]);

  const template = useMemo(() => templates.data?.find((t) => keyOf(t) === choice), [templates.data, choice]);
  // Keep the chosen values in step with the template's number of {{n}}.
  useEffect(() => {
    if (template) setParams((p) => Array.from({ length: template.paramCount }, (_, i) => p[i] ?? ''));
  }, [template]);

  const vars = purpose ? WHATSAPP_VARIABLES[purpose] : [];
  const examples = params.map((k) => vars.find((v) => v.key === k)?.example ?? null);
  const missing = !!template && params.some((p) => !p);

  const save = useMutation({
    mutationFn: (remove?: boolean) =>
      api.put<WhatsAppOverview>('/integrations/whatsapp/template-links', remove ? { purpose, templateName: '', params: [] } : { purpose, templateName: template!.name, language: template!.language, params }),
    onSuccess: (_r, remove) => {
      toast.success(remove ? 'Template link removed' : 'Template linked');
      qc.invalidateQueries({ queryKey: ['whatsapp'] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!purpose) return null;
  const approved = (templates.data ?? []).filter((t) => t.status === 'APPROVED');
  const other = (templates.data ?? []).filter((t) => t.status !== 'APPROVED');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{WHATSAPP_PURPOSE_LABELS[purpose].title}: WhatsApp template</DialogTitle>
          <DialogDescription>Choose one of your Meta-approved templates and which value goes into each {'{{1}}, {{2}}…'}. WhatsApp sends the template’s own wording.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        {templates.isLoading ? (
          <LoadingRows rows={3} />
        ) : templates.error ? (
          <ErrorState error={templates.error} onRetry={() => templates.refetch()} />
        ) : !templates.data?.length ? (
          <p className="rounded-xl surface-flat p-4 text-sm text-muted-foreground">
            No templates on this WhatsApp account yet. Create one in WhatsApp Manager → Message templates (category “Utility”), wait for Meta to approve it, then come back.
          </p>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="grid content-start gap-4">
              <Field label="Template" htmlFor="wt-template" error={tried && !template ? 'Choose a template' : undefined}>
                <div className="flex gap-2">
                  <NativeSelect id="wt-template" value={choice} onChange={(e) => setChoice(e.target.value)} aria-invalid={tried && !template}>
                    <option value="">Choose…</option>
                    {approved.length > 0 && (
                      <optgroup label="Approved">
                        {approved.map((t) => (
                          <option key={keyOf(t)} value={keyOf(t)} disabled={!t.supported}>
                            {t.name} ({t.language}){t.supported ? '' : ' — not supported'}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {other.length > 0 && (
                      <optgroup label="Waiting for approval or rejected">
                        {other.map((t) => (
                          <option key={keyOf(t)} value={keyOf(t)} disabled>
                            {t.name} ({t.language}) — {t.status.toLowerCase()}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </NativeSelect>
                  <Button type="button" variant="outline" size="icon" aria-label="Reload templates from Meta" title="Reload templates from Meta" onClick={() => templates.refetch()}>
                    <RefreshCw className={cn(templates.isFetching && 'animate-spin')} />
                  </Button>
                </div>
              </Field>
              {template && (
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="success">
                    <CheckCircle2 className="h-3 w-3" /> Approved
                  </Badge>
                  <Badge variant="secondary">{template.category.toLowerCase()}</Badge>
                  <Badge variant="secondary">{template.paramCount ? `${template.paramCount} value${template.paramCount === 1 ? '' : 's'}` : 'No values'}</Badge>
                </div>
              )}
              {template &&
                params.map((p, i) => (
                  <Field key={i} label={`Value for {{${i + 1}}}`} htmlFor={`wt-p${i}`} error={tried && !p ? 'Choose what goes here' : undefined}>
                    <NativeSelect id={`wt-p${i}`} value={p} aria-invalid={tried && !p} onChange={(e) => setParams((all) => all.map((x, j) => (j === i ? e.target.value : x)))}>
                      <option value="">Choose…</option>
                      {vars.map((v) => (
                        <option key={v.key} value={v.key}>
                          {v.label} (e.g. {v.example})
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                ))}
            </div>
            <div className="grid content-start gap-2">
              <span className="text-sm font-medium">Preview</span>
              <div className="rounded-2xl bg-[#efeae2] p-4 dark:bg-[#0b141a]">
                {template ? (
                  <>
                    {template.header && <p className="mb-1 text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">{template.header}</p>}
                    <Preview text={template.body} values={examples} />
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-[#54656f]">Choose a template to see the message.</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Example values are shown; each client gets their own.</p>
            </div>
          </div>
        )}
        <DialogFooter className="sm:items-center">
          {current && (
            <Button type="button" variant="ghost" className="mr-auto text-destructive" loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>
              Remove link
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={save.isPending && save.variables !== true}
            onClick={() => {
              setTried(true);
              setError(null);
              if (template && !missing) save.mutate(false);
            }}
          >
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
