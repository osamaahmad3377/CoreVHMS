'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import {
  Archive,
  ArchiveRestore,
  Edit,
  GitMerge,
  Mail,
  MapPin,
  MoreHorizontal,
  PawPrint,
  Phone,
  Pin,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { ClientAccount } from '@/components/billing/client-account';
import { ClientCommunications, PortalCard } from '@/components/comms/client-comms';
import { ClientFarms } from '@/components/livestock/client-farms';
import { ClientPrivacy } from '@/components/clients/client-privacy';
import { ClientForm } from '@/components/clients/client-form';
import { ClientPicker, type PickedClient } from '@/components/clients/client-picker';
import { AddressDialog, ContactDialog } from '@/components/clients/contact-dialogs';
import { useConfirm } from '@/components/confirm';
import { DescriptionList, EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { AttachmentsPanel } from '@/components/shared/attachments-panel';
import { HistoryPanel } from '@/components/shared/history-panel';
import { AlertChip, StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError, api } from '@/lib/api';
import { fmtAge, fmtCountry, fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Address, ClientContact, ClientDetail } from '@/lib/types';

function ClientRecord() {
  const { id } = useParams<{ id: string }>();
  const initialTab = useSearchParams().get('tab') ?? 'animals';
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can, currency, session } = useSession();
  const portal = session.features?.clientPortal === true;
  const key = ['client', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<ClientDetail>(`/clients/${id}`) });
  const [editing, setEditing] = useState(false);
  const [contactDlg, setContactDlg] = useState<{ open: boolean; contact?: ClientContact | null }>({ open: false });
  const [addressDlg, setAddressDlg] = useState<{ open: boolean; address?: Address | null }>({ open: false });
  const [mergeOpen, setMergeOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data!;
  const writable = can('clients.write') && c.status !== 'MERGED';
  const primaryAddress = c.addresses.find((a) => a.isPrimary) ?? c.addresses[0];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Clients', href: '/clients' }, { label: c.clientNo }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {/* displayName is surname-first ("Qureshi, Bilal"), so the title goes after it rather than reading "Mr Qureshi, …". */}
            <span>
              {c.displayName}
              {c.title && <span className="font-normal text-muted-foreground"> ({c.title})</span>}
            </span>
            <StatusBadge status={c.status} />
            {c.type !== 'INDIVIDUAL' && <Badge variant="secondary">{enumLabel(c.type)}</Badge>}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>{c.clientNo}</span>
            {c.mobilePhone && (
              <a href={`tel:${c.mobilePhone}`} className="flex items-center gap-1 hover:text-foreground">
                <Phone className="h-3.5 w-3.5" /> {c.mobilePhone}
              </a>
            )}
            {c.email && (
              <a href={`mailto:${c.email}`} className="flex items-center gap-1 hover:text-foreground">
                <Mail className="h-3.5 w-3.5" /> {c.email}
              </a>
            )}
            {primaryAddress && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {[primaryAddress.line1, primaryAddress.city].filter(Boolean).join(', ')}
              </span>
            )}
          </span>
        }
        actions={
          <>
            {can('patients.write') && c.status === 'ACTIVE' && (
              <Button size="sm" asChild>
                <Link href={`/patients/new?ownerId=${c.id}`}>
                  <PawPrint /> Add patient
                </Link>
              </Button>
            )}
            {writable && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Edit /> Edit
              </Button>
            )}
            {(can('clients.archive') || can('clients.merge')) && c.status !== 'MERGED' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="outline" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {can('clients.merge') && (
                    <DropdownMenuItem onSelect={() => setMergeOpen(true)}>
                      <GitMerge /> Merge a duplicate into this client
                    </DropdownMenuItem>
                  )}
                  {can('clients.archive') && <DropdownMenuSeparator />}
                  {can('clients.archive') && c.status === 'ACTIVE' && (
                    <DropdownMenuItem
                      destructive
                      onSelect={async () => {
                        const r = await confirm({
                          title: `Archive ${c.displayName}?`,
                          description: 'Archived clients are hidden from searches and lists but their records are kept. You can restore them later.',
                          requireReason: true,
                          destructive: true,
                          confirmLabel: 'Archive client',
                        });
                        if (r.confirmed) action.mutate(() => api.post(`/clients/${c.id}/archive`, { reason: r.reason }));
                      }}
                    >
                      <Archive /> Archive client
                    </DropdownMenuItem>
                  )}
                  {can('clients.archive') && c.status === 'ARCHIVED' && (
                    <DropdownMenuItem onSelect={() => action.mutate(() => api.post(`/clients/${c.id}/restore`))}>
                      <ArchiveRestore /> Restore client
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      {c.status === 'MERGED' && c.mergedInto && (
        <div className="mb-4 rounded-md border border-info/30 bg-info/10 px-4 py-3 text-sm">
          This record was merged into{' '}
          <Link href={`/clients/${c.mergedInto.id}`} className="font-medium underline">
            {c.mergedInto.displayName}
          </Link>
          . It is kept read-only for audit purposes.
        </div>
      )}
      {c.status === 'ARCHIVED' && (
        <div className="mb-4 rounded-md border bg-muted px-4 py-3 text-sm">
          Archived {fmtDate(c.archivedAt)}: {c.archivedReason}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Tabs defaultValue={initialTab} className="min-w-0">
          <TabsList>
            <TabsTrigger value="animals">Animals ({c.patients.length})</TabsTrigger>
            <TabsTrigger value="contacts">Contacts & addresses</TabsTrigger>
            <TabsTrigger value="notes">Notes ({c.clientNotes.length})</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            {can('billing.read') && <TabsTrigger value="account">Account</TabsTrigger>}
            {can('communications.read') && <TabsTrigger value="comms">Communication</TabsTrigger>}
            {can('audit.read') && <TabsTrigger value="history">History</TabsTrigger>}
          </TabsList>

          <TabsContent value="animals">
            {c.patients.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {c.patients.map((p) => (
                  <Link key={p.id} href={`/patients/${p.id}`} className="block rounded-lg focus-visible:ring-2 focus-visible:ring-ring">
                    <Card className="h-full p-4 transition-colors hover:border-primary/40 hover:bg-accent/30">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.species}
                            {p.breed && ` · ${p.breed}`} · {enumLabel(p.sex)} · {fmtAge(p.dateOfBirth)}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {p.status !== 'ACTIVE' && <StatusBadge status={p.status} />}
                          {!p.isPrimaryOwner && <Badge variant="info">Co-owner</Badge>}
                        </div>
                      </div>
                      {p.alerts.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {p.alerts.map((a) => (
                            <AlertChip key={a.id} alert={a} />
                          ))}
                        </div>
                      )}
                    </Card>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={PawPrint}
                title="No animals registered"
                action={
                  can('patients.write') &&
                  c.status === 'ACTIVE' && (
                    <Button size="sm" asChild>
                      <Link href={`/patients/new?ownerId=${c.id}`}>
                        <Plus /> Add patient
                      </Link>
                    </Button>
                  )
                }
              />
            )}
          </TabsContent>

          <TabsContent value="contacts" className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Authorized, emergency and co-owner contacts</CardTitle>
                {writable && (
                  <Button size="sm" variant="outline" onClick={() => setContactDlg({ open: true, contact: null })}>
                    <Plus /> Add contact
                  </Button>
                )}
              </CardHeader>
              {c.contacts.length ? (
                <ul className="divide-y">
                  {c.contacts.map((ct) => (
                    <li key={ct.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {ct.name} <Badge variant="secondary" className="ml-1">{enumLabel(ct.role, 'contactRole')}</Badge>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[ct.relationship, ct.phone, ct.email].filter(Boolean).join(' · ')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {ct.canAuthorizeTreatment && 'May authorize treatment. '}
                          {ct.canCollectAnimal && 'May collect animal.'}
                        </p>
                      </div>
                      {writable && (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon-sm" aria-label="Edit contact" onClick={() => setContactDlg({ open: true, contact: ct })}>
                            <Edit />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Remove contact"
                            onClick={async () => {
                              const r = await confirm({ title: `Remove ${ct.name}?`, destructive: true, confirmLabel: 'Remove' });
                              if (r.confirmed) action.mutate(() => api.del(`/clients/${c.id}/contacts/${ct.id}`));
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No additional contacts" className="py-8" />
              )}
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Addresses</CardTitle>
                {writable && (
                  <Button size="sm" variant="outline" onClick={() => setAddressDlg({ open: true, address: null })}>
                    <Plus /> Add address
                  </Button>
                )}
              </CardHeader>
              {c.addresses.length ? (
                <ul className="divide-y">
                  {c.addresses.map((a) => (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-medium">
                          {a.label ?? 'Address'} {a.isPrimary && <Badge className="ml-1">Primary</Badge>}
                        </p>
                        <p className="text-muted-foreground">
                          {[a.line1, a.line2, a.city, a.state, a.postcode, fmtCountry(a.country)].filter(Boolean).join(', ')}
                        </p>
                      </div>
                      {writable && (
                        <div className="flex gap-1">
                          {!a.isPrimary && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Make primary"
                              onClick={() => action.mutate(() => api.patch(`/clients/${c.id}/addresses/${a.id}`, { isPrimary: true }))}
                            >
                              <Star />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon-sm" aria-label="Edit address" onClick={() => setAddressDlg({ open: true, address: a })}>
                            <Edit />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Remove address"
                            onClick={async () => {
                              const r = await confirm({ title: 'Remove this address?', destructive: true, confirmLabel: 'Remove' });
                              if (r.confirmed) action.mutate(() => api.del(`/clients/${c.id}/addresses/${a.id}`));
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No address on file" className="py-8" />
              )}
            </Card>
          </TabsContent>

          <TabsContent value="notes">
            <NotesTab client={c} writable={writable} onChange={refresh} />
          </TabsContent>

          <TabsContent value="documents">
            <Card>
              <CardContent>
                <AttachmentsPanel entityType="Client" entityId={c.id} canWrite={writable} />
              </CardContent>
            </Card>
          </TabsContent>

          {can('communications.read') && (
            <TabsContent value="comms">
              <ClientCommunications client={c} />
            </TabsContent>
          )}

          {can('billing.read') && (
            <TabsContent value="account">
              <ClientAccount clientId={c.id} />
            </TabsContent>
          )}

          {can('audit.read') && (
            <TabsContent value="history">
              <Card>
                <CardContent>
                  <HistoryPanel entityId={c.id} />
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>

        <div className="grid content-start gap-4">
          {portal && <PortalCard client={c} />}
          {can('livestock.read') && <ClientFarms client={c} />}
          <ClientPrivacy client={c} />
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{c.balanceMinor < 0 ? 'Account credit' : 'Outstanding balance'}</p>
              <p className={`text-2xl font-semibold tabular ${c.balanceMinor > 0 ? 'text-warning' : c.balanceMinor < 0 ? 'text-success' : ''}`}>{fmtMoney(Math.abs(c.balanceMinor), currency)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList
                className="sm:grid-cols-1"
                items={[
                  { label: 'Preferred channel', value: enumLabel(c.preferredChannel) },
                  {
                    label: 'Consent',
                    value: (
                      <span className="flex flex-wrap gap-1">
                        <Badge variant={c.remindersConsent ? 'success' : 'secondary'}>{c.remindersConsent ? 'Reminders allowed' : 'No reminders'}</Badge>
                        <Badge variant={c.marketingConsent ? 'success' : 'secondary'}>{c.marketingConsent ? 'Marketing allowed' : 'No marketing'}</Badge>
                      </span>
                    ),
                  },
                  { label: 'Other phones', value: [c.homePhone, c.workPhone].filter(Boolean).join(', ') },
                  { label: 'National ID', value: c.nationalId },
                  { label: 'Tax number', value: c.taxNumber },
                  { label: 'Home branch', value: session.branches.find((b) => b.id === c.primaryBranchId)?.name },
                  { label: 'Referral source', value: c.referralSource },
                  { label: 'Client since', value: fmtDate(c.createdAt) },
                  { label: 'Notes', value: c.notes && <span className="whitespace-pre-wrap">{c.notes}</span> },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Edit client</DialogTitle>
          </DialogHeader>
          <ClientForm
            client={c}
            onSaved={() => {
              toast.success('Client updated');
              setEditing(false);
              refresh();
            }}
            onCancel={() => setEditing(false)}
          />
        </DialogContent>
      </Dialog>
      <ContactDialog clientId={c.id} contact={contactDlg.contact} open={contactDlg.open} onOpenChange={(open) => setContactDlg({ open })} onSaved={refresh} />
      <AddressDialog
        clientId={c.id}
        address={addressDlg.address}
        country={session.organization?.country ?? 'PK'}
        open={addressDlg.open}
        onOpenChange={(open) => setAddressDlg({ open })}
        onSaved={refresh}
      />
      <MergeDialog
        survivor={c}
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        onMerged={() => {
          refresh();
          router.refresh();
        }}
      />
    </>
  );
}

function NotesTab({ client, writable, onChange }: { client: ClientDetail; writable: boolean; onChange: () => void }) {
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const add = useMutation({
    mutationFn: () => api.post(`/clients/${client.id}/notes`, { body, category, isPinned: false }),
    onSuccess: () => {
      setBody('');
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const pin = useMutation({
    mutationFn: (n: { id: string; isPinned: boolean }) => api.patch(`/clients/${client.id}/notes/${n.id}`, { isPinned: !n.isPinned }),
    onSuccess: onChange,
  });
  return (
    <Card>
      {writable && (
        <div className="grid gap-2 border-b p-4">
          <Label htmlFor="note">Add a note</Label>
          <Textarea id="note" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Phone call summary, complaint, payment arrangement…" />
          <div className="flex justify-end gap-2">
            <NativeSelect aria-label="Category" className="h-8 w-44 text-xs" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="GENERAL">General</option>
              <option value="COMMUNICATION">Communication</option>
              <option value="COMPLAINT">Complaint</option>
              <option value="FINANCIAL">Financial</option>
            </NativeSelect>
            <Button size="sm" disabled={!body.trim()} loading={add.isPending} onClick={() => add.mutate()}>
              Save note
            </Button>
          </div>
        </div>
      )}
      {client.clientNotes.length ? (
        <ul className="divide-y">
          {client.clientNotes.map((n) => (
            <li key={n.id} className="flex gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {n.category !== 'GENERAL' && <Badge variant={n.category === 'COMPLAINT' ? 'destructive' : 'secondary'} className="mr-1">{enumLabel(n.category)}</Badge>}
                  {n.authorName} · {fmtDateTime(n.createdAt)}
                </p>
              </div>
              {writable && (
                <Button variant="ghost" size="icon-sm" aria-label={n.isPinned ? 'Unpin note' : 'Pin note'} onClick={() => pin.mutate(n)}>
                  <Pin className={n.isPinned ? 'fill-current text-primary' : ''} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No notes" className="py-8" />
      )}
    </Card>
  );
}

function MergeDialog({ survivor, open, onOpenChange, onMerged }: { survivor: ClientDetail; open: boolean; onOpenChange: (o: boolean) => void; onMerged: () => void }) {
  const [dupe, setDupe] = useState<PickedClient | null>(null);
  const [reason, setReason] = useState('');
  const merge = useMutation({
    mutationFn: () => api.post<{ moved: Record<string, number> }>('/clients/merge', { survivorId: survivor.id, mergedId: dupe!.id, reason }),
    onSuccess: (r) => {
      toast.success(`Merged. Moved ${r.moved.patientOwnerships ?? 0} animal(s).`);
      onOpenChange(false);
      setDupe(null);
      setReason('');
      onMerged();
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : 'Merge failed'),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge duplicate client</DialogTitle>
          <DialogDescription>
            The duplicate's animals, contacts, addresses, notes and documents move into <b>{survivor.displayName}</b>. The duplicate is kept read-only and cannot be un-merged.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Duplicate record to merge away</Label>
            <ClientPicker value={dupe} onChange={setDupe} excludeId={survivor.id} placeholder="Find the duplicate…" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="merge-reason">Reason *</Label>
            <Textarea id="merge-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Registered twice with different phone formats" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!dupe || !reason.trim()} loading={merge.isPending} onClick={() => merge.mutate()}>
            <GitMerge /> Merge records
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ClientPage() {
  return (
    <RequirePermission anyOf={['clients.read']}>
      <Suspense>
        <ClientRecord />
      </Suspense>
    </RequirePermission>
  );
}
