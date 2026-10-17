'use client';
import { useQuery } from '@tanstack/react-query';
import { enumLabel, type Paginated } from '@vcms/shared';
import { Download, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { DataTable } from '@/components/data-table';
import { EmptyState, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { ChangeList } from '@/components/shared/history-panel';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { AuditEvent } from '@/lib/types';

const ENTITY_LINKS: Record<string, string> = {
  Client: '/clients/',
  Patient: '/patients/',
  Invoice: '/billing/invoices/',
  DiagnosticOrder: '/lab/orders/',
  Encounter: '/consultations/',
  Surgery: '/surgery/',
  Admission: '/hospital/admissions/',
  Product: '/inventory/products/',
  PurchaseOrder: '/inventory/purchase-orders/',
  Farm: '/livestock/farms/',
};

/** Display names for stored model names. Unknown ones are split from CamelCase ("GoodsReceipt" → "Goods receipt"). */
const ENTITY_LABELS: Record<string, string> = {
  DiagnosticOrder: 'Lab order',
  Membership: 'Staff account',
  User: 'User account',
  Session: 'Sign-in session',
  Encounter: 'Consultation',
  LabTest: 'Lab test',
  
  ClinicalTemplate: 'Consultation template',
  InsuranceProvider: 'Insurer',
  ReferralContact: 'Referral contact',
};
const SUBJECT_LABELS: Record<string, string> = { lab_order: 'Lab order', lab_results: 'Lab results', membership: 'Staff account', encounter: 'Consultation', preauth: 'Pre-authorisation' };
/** Whole-action names where "Subject verb" would read badly. */
const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.login_failed': 'Sign-in failed',
  'auth.account_locked': 'Account locked',
  'auth.mfa_enabled': 'Two-factor sign-in turned on',
  'auth.mfa_disabled': 'Two-factor sign-in turned off',
  'auth.mfa_recovery_code_used': 'Recovery code used',
  'auth.password_changed': 'Password changed',
  'auth.password_reset': 'Password reset',
  'auth.password_reset_requested': 'Password reset requested',
  'auth.session_revoked': 'Session signed out',
  'auth.temporary_password_expired': 'Temporary password expired',
  'portal.login': 'Client signed in to portal',
  'membership.invited': 'Staff member invited',
  'membership.invite_resent': 'Staff invitation re-sent',
  'membership.invitation_accepted': 'Staff invitation accepted',
  'membership.created_with_temporary_password': 'Staff account created (temporary password)',
  'membership.temporary_password_issued': 'Temporary password issued',
  'audit.exported': 'Audit log exported',
  'report.exported': 'Report exported',
  'livestock.mortality': 'Batch deaths recorded',
};

const words = (s: string) => s.replace(/_/g, ' ').trim();
const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function actionLabel(action: string) {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const [subject, ...rest] = action.split('.');
  const verb = words(rest.join(' '));
  const who = SUBJECT_LABELS[subject] ?? sentence(words(subject));
  return verb ? `${who} ${verb}` : who;
}

function entityLabel(type: string) {
  return ENTITY_LABELS[type] ?? sentence(type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
}

/**
 * Display-only clean-up of a stored summary: amounts in minor units become money and enum codes become words.
 * Patterns follow the summaries the API writes; anything unrecognised is shown as stored.
 */
function humaniseSummary(action: string, summary: string, money: (minor: number) => string): string {
  const m = (v: string) => money(Number(v));
  const label = (v: string) => enumLabel(v);
  const rules: Record<string, [RegExp, (...g: string[]) => string]> = {
    'invoice.issued': [/^(\S+) total (-?\d+)$/, (no, t) => `${no} · total ${m(t)}`],
    'invoice.voided': [/^(.*) — (-?\d+) moved to client credit$/, (head, t) => `${head} — ${m(t)} moved to client credit`],
    'invoice.credited': [/^(\S+) (-?\d+): (.*)$/, (no, t, r) => `${no} · ${m(t)}: ${r}`],
    'payment.received': [/^(\S+) ([A-Z_]+) (-?\d+)$/, (no, method, t) => `${no} · ${label(method)} ${m(t)}`],
    'payment.refunded': [/^(\S+) ([A-Z_]+) (-?\d+): (.*)$/, (no, method, t, r) => `${no} · ${label(method)} ${m(t)}: ${r}`],
    'payment.allocated': [/^(-?\d+(?:, -?\d+)*)$/, (list) => list.split(', ').map(m).join(', ')],
    'claim.payment_recorded': [/^(\S+) (-?\d+)(.*)$/, (no, t, rest) => `${no} · ${m(t)}${rest}`],
    'cash_session.opened': [/^(.*) float (-?\d+)$/, (reg, t) => `${reg} · float ${m(t)}`],
    'cash_session.closed': [/^expected (-?\d+), counted (-?\d+), variance (-?\d+)$/, (e, c, v) => `Expected ${m(e)}, counted ${m(c)}, variance ${m(v)}`],
    'estimate.created': [/^(\S+) (-?\d+)$/, (no, t) => `${no} · ${m(t)}`],
    'expense.recorded': [/^([A-Z_]+) (-?\d+): (.*)$/, (cat, t, d) => `${label(cat)} ${m(t)}: ${d}`],
  };
  const rule = rules[action];
  const match = rule && summary.match(rule[0]);
  const out = match ? rule[1](...match.slice(1)) : summary;
  // Remaining enum-style codes (contain an underscore, e.g. IN_PROGRESS) → "In progress".
  return out.replace(/\b[A-Z]+(?:_[A-Z]+)+\b/g, (code) => enumLabel(code));
}

const ACTION_FILTERS: [string, string][] = [
  ['auth.', 'Sign-ins & security'],
  ['client.', 'Clients'],
  ['patient.', 'Patients'],
  ['patient.viewed', 'Patient record views'],
  ['encounter.,note.,diagnosis.,problem.,vitals.', 'Consultations & notes'],
  ['lab_,imaging.', 'Laboratory & imaging'],
  ['prescription.', 'Prescriptions'],
  ['invoice.,payment.,charge.,estimate.,cash_session.,expense.', 'Billing & payments'],
  ['stock.,product.,purchase_order.,stock_count.', 'Inventory'],
  ['attachment.', 'Files'],
  ['membership.', 'Staff accounts'],
  ['role.', 'Roles'],
  ['organization.,branch.', 'Organization & branches'],
  ['client.exported,client.data_exported,client.statement_exported,report.exported,audit.exported', 'Exports (all)'],
  ['client.data_exported,client.anonymised', 'Privacy requests'],
];
const ENTITY_FILTERS = ['Client', 'Patient', 'Encounter', 'DiagnosticOrder', 'Invoice', 'Payment', 'Product', 'User', 'Membership', 'Role', 'Branch', 'Organization', 'Session'];

interface StaffMember { id: string; user: { id: string; name: string } }

function AuditLog() {
  const url = useUrlState();
  const { can, currency } = useSession();
  const staff = useQuery({ queryKey: ['staff', ''], queryFn: () => api.get<StaffMember[]>('/staff'), enabled: can('users.read'), staleTime: 120_000 });
  const params = {
    q: url.get('q'),
    actorId: url.get('actorId'),
    action: url.get('action'),
    entityType: url.get('entityType'),
    from: url.get('from'),
    to: url.get('to'),
    page: Number(url.get('page', '1')),
    pageSize: Number(url.get('pageSize', '50')),
  };
  const query = useQuery({
    queryKey: ['audit-log', params],
    queryFn: () =>
      api.get<Paginated<AuditEvent>>(
        `/audit-events${qs({ ...params, q: params.q || undefined, actorId: params.actorId || undefined, from: params.from ? new Date(params.from).toISOString() : undefined, to: params.to ? new Date(params.to + 'T23:59:59').toISOString() : undefined })}`,
      ),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of sign-ins, record access, changes, exports and administrative actions."
        actions={
          <Button size="sm" variant="outline" asChild>
            <a href={`/api/v1/audit-events/export.csv${qs({ q: params.q || undefined, actorId: params.actorId || undefined, action: params.action || undefined, entityType: params.entityType || undefined, from: params.from ? new Date(params.from).toISOString() : undefined, to: params.to ? new Date(params.to + 'T23:59:59').toISOString() : undefined })}`} download>
              <Download /> Export CSV
            </a>
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchInput
            value={params.q}
            onChange={(v) => url.set({ q: v, page: 1 })}
            placeholder="Search summaries or names"
            className="w-full sm:w-56"
          />
          {can('users.read') && (
            <NativeSelect aria-label="Who" className="w-full sm:w-44" value={params.actorId} onChange={(e) => url.set({ actorId: e.target.value, page: 1 })}>
              <option value="">Everyone</option>
              {(staff.data ?? []).map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name}</option>)}
            </NativeSelect>
          )}
          <NativeSelect aria-label="Action" className="w-full sm:w-52" value={params.action} onChange={(e) => url.set({ action: e.target.value, page: 1 })}>
            <option value="">All actions</option>
            {ACTION_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Record type" className="w-full sm:w-44" value={params.entityType} onChange={(e) => url.set({ entityType: e.target.value, page: 1 })}>
            <option value="">All records</option>
            {ENTITY_FILTERS.map((t) => <option key={t} value={t}>{entityLabel(t)}</option>)}
          </NativeSelect>
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From date" value={params.from} onChange={(e) => url.set({ from: e.target.value, page: 1 })} />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" aria-label="To date" value={params.to} onChange={(e) => url.set({ to: e.target.value, page: 1 })} />
          </div>
        </div>
        <DataTable
          query={query}
          rowKey={(e) => e.id}
          page={params.page}
          pageSize={params.pageSize}
          onPage={(page) => url.set({ page })}
          onPageSize={(pageSize) => url.set({ pageSize, page: 1 })}
          empty={<EmptyState icon={ScrollText} title="No events match these filters" />}
          columns={[
            { key: 'at', header: 'When', className: 'whitespace-nowrap text-xs', cell: (e) => fmtDateTime(e.createdAt) },
            { key: 'who', header: 'Who', cell: (e) => <span className="whitespace-nowrap text-sm">{e.actorName ?? 'System'}</span> },
            {
              key: 'what',
              header: 'Action',
              cell: (e) => (
                <div className="max-w-[520px]">
                  <Badge variant={e.action.includes('failed') || e.action.includes('locked') ? 'destructive' : 'secondary'} className="normal-case tracking-normal" title={e.action}>
                    {actionLabel(e.action)}
                  </Badge>
                  {e.summary && <p className="mt-1 text-sm">{humaniseSummary(e.action, e.summary, (minor) => fmtMoney(minor, currency))}</p>}
                  <ChangeList changes={e.changes} />
                </div>
              ),
            },
            {
              key: 'record',
              header: 'Record',
              cell: (e) =>
                e.entityId && ENTITY_LINKS[e.entityType] ? (
                  <Link href={`${ENTITY_LINKS[e.entityType]}${e.entityId}`} className="whitespace-nowrap text-sm text-primary hover:underline">
                    {entityLabel(e.entityType)}
                  </Link>
                ) : (
                  <span className="whitespace-nowrap text-sm text-muted-foreground">{entityLabel(e.entityType)}</span>
                ),
            },
            { key: 'ip', header: 'IP', cell: (e) => <span className="font-mono text-xs text-muted-foreground">{e.ip ?? '—'}</span> },
          ]}
        />
      </Card>
    </>
  );
}

export default function AuditPage() {
  return (
    <RequirePermission anyOf={['audit.read']}>
      <Suspense>
        <AuditLog />
      </Suspense>
    </RequirePermission>
  );
}
