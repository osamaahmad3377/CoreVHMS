'use client';
import { useQuery } from '@tanstack/react-query';
import { CONDITION_INFO, TRIGGER_INFO, type AutomationCondition, type AutomationConditionField, type AutomationTrigger } from '@vcms/shared';
import { ChevronDown, Mail, MessageCircle, Users, X } from 'lucide-react';
import { type AutomationOptions } from '@/components/automations/describe';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, NativeSelect } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Conditions ("only if" / "to"): one editable row each, and who an offer reaches with them. */

export interface AudienceCounts {
  clients: number;
  consented: number;
  matching: number;
  reach: { whatsapp: number; email: number; none: number };
}

function ValuesPicker({ list, values, onChange, label }: { list: { id: string; name: string }[]; values: string[]; onChange: (v: string[]) => void; label: string }) {
  const names = values.map((v) => list.find((x) => x.id === v)?.name).filter(Boolean);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="min-w-0 flex-1 justify-between font-normal" aria-label={label}>
          <span className="truncate">{names.length ? names.join(', ') : <span className="text-muted-foreground">Choose…</span>}</span>
          <ChevronDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-64 overflow-y-auto p-2">
        {list.map((x) => (
          <label key={x.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-foreground/[0.04]">
            <Checkbox checked={values.includes(x.id)} onCheckedChange={(v) => onChange(v ? [...values, x.id] : values.filter((y) => y !== x.id))} /> {x.name}
          </label>
        ))}
        {!list.length && <p className="px-2 py-3 text-sm text-muted-foreground">Nothing to choose yet.</p>}
      </PopoverContent>
    </Popover>
  );
}

export function Pills({ options, values, onToggle }: { options: { value: string; label: string }[]; values: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={values.includes(o.value)} onClick={() => onToggle(o.value)} className={cn('rounded-pill px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors', values.includes(o.value) ? 'bg-primary text-primary-foreground ring-primary' : 'ring-foreground/15 hover:bg-foreground/[0.04]')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ConditionRow({ c, trigger, options, onChange, onRemove, currency }: { c: AutomationCondition; trigger: AutomationTrigger; options?: AutomationOptions; onChange: (c: AutomationCondition) => void; onRemove: () => void; currency: string }) {
  const toggle = (v: string, single = false) => onChange({ ...c, values: single ? [v] : c.values.includes(v) ? c.values.filter((x) => x !== v) : [...c.values, v] });
  const money = c.field === 'amountAtLeast' || c.field === 'spentAtLeast';
  const numberField = money || ['ageAtLeast', 'ageUnder', 'lastVisit', 'newClient', 'visitsAtLeast', 'careDue'].includes(c.field);
  const unit: Partial<Record<AutomationConditionField, string>> = { ageAtLeast: 'years', ageUnder: 'years', lastVisit: 'months', newClient: 'days', visitsAtLeast: 'visits', careDue: 'days' };
  const ops: Partial<Record<AutomationConditionField, [string, string]>> = {
    newClient: ['joined in the last', 'joined more than'],
    visitsAtLeast: ['at least', 'fewer than'],
    spentAtLeast: ['at least', 'less than'],
    careDue: ['has care due within', 'has no care due within'],
    boughtService: ['had', 'did not have'],
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-foreground/[0.025] p-2.5 ring-1 ring-inset ring-foreground/[0.06]">
      <NativeSelect aria-label="Condition" className="h-9 w-auto font-medium" value={c.field} onChange={(e) => onChange({ field: e.target.value as AutomationConditionField, op: 'IS', values: [] })}>
        {TRIGGER_INFO[trigger].conditions.map((f) => (
          <option key={f} value={f}>
            {CONDITION_INFO[f].label}
          </option>
        ))}
      </NativeSelect>
      {ops[c.field] && (
        <NativeSelect aria-label="Which way" className="h-9 w-auto" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as 'IS' | 'IS_NOT' })}>
          <option value="IS">{ops[c.field]![0]}</option>
          <option value="IS_NOT">{ops[c.field]![1]}</option>
        </NativeSelect>
      )}
      {c.field === 'boughtService' && <ValuesPicker label="Services" list={options?.services ?? []} values={c.values} onChange={(values) => onChange({ ...c, values })} />}
      {c.field === 'lastVisit' && (
        <NativeSelect aria-label="Seen or not seen" className="h-9 w-auto" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as 'IS' | 'IS_NOT' })}>
          <option value="IS">seen in the last</option>
          <option value="IS_NOT">not seen in the last</option>
        </NativeSelect>
      )}
      {['species', 'branch', 'appointmentType', 'source', 'patientSex'].includes(c.field) && (
        <NativeSelect aria-label="Is or is not" className="h-9 w-auto" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as 'IS' | 'IS_NOT' })}>
          <option value="IS">is</option>
          <option value="IS_NOT">is not</option>
        </NativeSelect>
      )}
      {c.field === 'species' && <ValuesPicker label="Species" list={options?.species ?? []} values={c.values} onChange={(values) => onChange({ ...c, values })} />}
      {c.field === 'branch' && <ValuesPicker label="Branches" list={options?.branches ?? []} values={c.values} onChange={(values) => onChange({ ...c, values })} />}
      {c.field === 'appointmentType' && <ValuesPicker label="Appointment types" list={options?.appointmentTypes ?? []} values={c.values} onChange={(values) => onChange({ ...c, values })} />}
      {c.field === 'contact' && <Pills options={[{ value: 'WHATSAPP', label: 'WhatsApp' }, { value: 'EMAIL', label: 'Email' }]} values={c.values} onToggle={(v) => toggle(v)} />}
      {c.field === 'source' && <Pills options={[{ value: 'ONLINE', label: 'Online' }, { value: 'STAFF', label: 'By staff' }]} values={c.values} onToggle={(v) => toggle(v)} />}
      {c.field === 'patientSex' && <Pills options={[{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }]} values={c.values} onToggle={(v) => toggle(v)} />}
      {c.field === 'firstVisit' && <Pills options={[{ value: 'FIRST', label: 'First visit' }, { value: 'RETURNING', label: 'Returning client' }]} values={c.values} onToggle={(v) => toggle(v, true)} />}
      {numberField && (
        <div className="flex items-center gap-2">
          {money && <span className="text-sm text-muted-foreground">{currency}</span>}
          <Input
            aria-label={CONDITION_INFO[c.field].label}
            inputMode="decimal"
            className="h-9 w-28"
            value={c.values[0] ? (money ? String(Number(c.values[0]) / 100) : c.values[0]) : ''}
            onChange={(e) => {
              const n = e.target.value.replace(/[^\d.]/g, '');
              onChange({ ...c, values: n ? [money ? String(Math.round(Number(n) * 100)) : String(Math.floor(Number(n)))] : [] });
            }}
          />
          {unit[c.field] && <span className="text-sm text-muted-foreground">{unit[c.field]}</span>}
        </div>
      )}
      <Button type="button" size="icon-sm" variant="ghost" className="ml-auto" aria-label="Remove condition" onClick={onRemove}>
        <X />
      </Button>
    </div>
  );
}

/** Who an offer reaches with its conditions: clients who agreed to marketing, and how each is reached. */
export function AudienceCard({ conditions }: { conditions: AutomationCondition[] }) {
  const ready = conditions.filter((c) => c.values.length);
  const q = useQuery({ queryKey: ['automation-audience', ready], queryFn: () => api.post<AudienceCounts>('/automations/audience', { conditions: ready }), staleTime: 30_000 });
  const c = q.data;
  return (
    <Card className="grid gap-3 p-5">
      <p className="flex items-center gap-2 font-semibold">
        <Users className="h-4 w-4 text-primary" /> Who gets it
      </p>
      {q.isLoading || !c ? (
        <p className="text-sm text-muted-foreground">Counting…</p>
      ) : (
        <>
          <p className="text-3xl font-semibold tabular tracking-tight">{c.matching.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">client{c.matching === 1 ? '' : 's'}</span></p>
          <div className="grid gap-1 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5 text-[#25D366]" /> {c.reach.whatsapp} by WhatsApp</p>
            <p className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-primary" /> {c.reach.email} by email</p>
            {c.reach.none > 0 && <p className="text-warning">{c.reach.none} without WhatsApp or email — they will not get it</p>}
          </div>
          <p className="border-t pt-3 text-xs text-muted-foreground">
            Only clients who agreed to marketing: {c.consented.toLocaleString()} of {c.clients.toLocaleString()}. Staff tick “Marketing allowed” on a client; clients can switch “News and offers” on or off in their portal.
          </p>
        </>
      )}
    </Card>
  );
}

