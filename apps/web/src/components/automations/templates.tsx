'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TRIGGER_INFO, type AutomationDraft, type AutomationStep, type AutomationTrigger } from '@vcms/shared';
import { BookmarkPlus, Bookmark, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { FlowChips, GROUP_TONE, TRIGGER_ICONS } from '@/components/automations/flow-ui';
import { useConfirm } from '@/components/confirm';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, LoadingRows } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A clinic's own template: an automation or campaign it made, saved to start new ones from. */
export interface AutomationTemplate {
  id: string;
  name: string;
  description: string | null;
  marketing: boolean;
  trigger: AutomationTrigger;
  draft: AutomationDraft;
  timesUsed: number;
  createdByName: string | null;
  createdAt: string;
}

export const templateHref = (id: string) => `/settings/automations/new?template=${id}`;

export function useTemplates() {
  return useQuery({ queryKey: ['automation-templates'], queryFn: () => api.get<AutomationTemplate[]>('/automations/templates'), staleTime: 30_000 });
}

/** The fields of an automation that a template keeps (not whether it is on, nor approval). */
export function templateDraft(a: AutomationDraft): AutomationDraft {
  return {
    name: a.name,
    description: a.description ?? null,
    isActive: false,
    marketing: !!a.marketing,
    trigger: a.trigger,
    offset: a.offset ?? null,
    atHour: a.atHour ?? null,
    sendFromHour: a.sendFromHour ?? null,
    sendToHour: a.sendToHour ?? null,
    cooldownDays: a.cooldownDays ?? null,
    sendOn: a.sendOn ?? null,
    repeat: a.repeat ?? null,
    endsOn: a.endsOn ?? null,
    conditions: a.conditions ?? [],
    steps: a.steps,
    recipeKey: a.recipeKey ?? null,
  };
}

/** "Save as template": name it, and it appears under Templates (Automations) or in Marketing → Campaigns. */
export function SaveTemplateDialog({ automation, onClose }: { automation: AutomationDraft; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(automation.name.replace(/\s*\(copy\)$/, ''));
  const [description, setDescription] = useState(automation.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.post<AutomationTemplate>('/automations/templates', { name: name.trim(), description: description.trim() || null, automation: templateDraft(automation) }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['automation-templates'] });
      toast.success(`Template “${t.name}” saved — find it under ${t.marketing ? 'Marketing → Campaigns' : 'Automations → Templates'}`);
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><BookmarkPlus className="h-5 w-5 text-primary" /> Save as a template</DialogTitle>
          <DialogDescription>Keep this {automation.marketing ? 'campaign' : 'automation'} as your clinic’s own starting point. Anyone who manages automations can make a new one from it — the original is not changed.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-sm font-medium">
            Template name
            <Input autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Eid grooming offer" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            What it is for <span className="font-normal text-muted-foreground">(optional)</span>
            <Textarea rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Use before each Eid; change the dates and the discount" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim()} loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>
            <BookmarkPlus /> Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The clinic's own templates (promotional ones in Marketing, the others in Automations). */
export function TemplateGallery({ marketing, compact = false }: { marketing: boolean; compact?: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useTemplates();
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/automations/templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation-templates'] });
      toast.success('Template deleted — automations already made from it are not affected');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows rows={3} />;
  const list = (q.data ?? []).filter((t) => t.marketing === marketing);
  if (!list.length)
    return (
      <Card className={cn(compact && 'border-dashed')}>
        <EmptyState
          icon={Bookmark}
          title={marketing ? 'No campaign templates yet' : 'No templates yet'}
          description={`Made ${marketing ? 'a campaign' : 'an automation'} that works well? Open its ⋯ menu (or the editor) and choose “Save as template” to reuse it whenever you need it.`}
        />
      </Card>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {list.map((t) => {
        const info = TRIGGER_INFO[t.trigger];
        const Icon = TRIGGER_ICONS[t.trigger];
        return (
          <Card key={t.id} className="group flex h-full flex-col gap-3 p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:ring-1 hover:ring-primary/25">
            <div className="flex items-start justify-between gap-2">
              <span className={cn('flex h-11 w-11 items-center justify-center rounded-2xl shadow-sm', GROUP_TONE[info.group].tile)}>
                <Icon className="h-5 w-5" />
              </span>
              <div className="flex items-center gap-1">
                <Badge variant="outline"><Bookmark className="mr-1 h-3 w-3" /> Your template</Badge>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete template ${t.name}`}
                  onClick={async () => {
                    const r = await confirm({ title: `Delete the template “${t.name}”?`, description: 'Automations and campaigns already made from it stay as they are.', confirmLabel: 'Delete', destructive: true });
                    if (r.confirmed) remove.mutate(t.id);
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            <div className="grid gap-1">
              <p className="font-semibold leading-snug">{t.name}</p>
              {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
              <p className="text-xs text-muted-foreground">When {info.when}</p>
            </div>
            <FlowChips trigger={t.trigger} steps={t.draft.steps as AutomationStep[]} className="mt-auto" />
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <span className="mr-auto text-xs text-muted-foreground">
                {t.createdByName ? `${t.createdByName} · ` : ''}
                {fmtDate(t.createdAt)}
                {t.timesUsed > 0 ? ` · used ${t.timesUsed} time${t.timesUsed === 1 ? '' : 's'}` : ''}
              </span>
              <Button size="sm" asChild>
                <Link href={templateHref(t.id)}>Use template</Link>
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
