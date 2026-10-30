'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { FileText,
  Archive,
  ArchiveRestore,
  BedDouble,
  Scissors,
  Camera,
  CalendarPlus,
  CheckCircle2,
  LogIn,
  PawPrint,
  ShieldAlert,
  Siren,
  Stethoscope,
  Cross,
  Edit,
  GitMerge,
  MoreHorizontal,
  Plus,
  Repeat,
  Trash2,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useRef, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { DescriptionList, EmptyState, ErrorState, LoadingRows } from '@/components/page';
import { PatientBanner } from '@/components/patients/patient-banner';
import {
  AlertDialog,
  CoOwnerDialog,
  DeceasedDialog,
  IdentifierDialog,
  TransferDialog,
  WeightDialog,
} from '@/components/patients/patient-dialogs';
import { PatientForm } from '@/components/patients/patient-form';
import { PatientNextStep } from '@/components/patients/patient-next-step';
import { SavedNextSteps } from '@/components/patients/saved-next-steps';
import { PatientPicker, type PickedPatient } from '@/components/patients/patient-picker';
import { AdministrationsPanel, LabOrdersPanel, PrescriptionsPanel, WithdrawalBanner } from '@/components/clinical/orders-panels';
import { ProblemsPanel } from '@/components/clinical/problems-panel';
import { StartConsultationDialog } from '@/components/clinical/start-consultation-dialog';
import { PatientAppointments, PatientVisits } from '@/components/patients/patient-clinical-tabs';
import { RequirePermission } from '@/components/require';
import { BookingDialog } from '@/components/scheduling/booking-dialog';
import { TriageDialog } from '@/components/scheduling/triage-dialog';
import { AdmitDialog } from '@/components/hospital/admit-dialog';
import { CarePlan } from '@/components/preventive/care-plan';
import { AttachmentsPanel } from '@/components/shared/attachments-panel';
import { HistoryPanel } from '@/components/shared/history-panel';
import { AlertChip } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtWeight } from '@/lib/format';
import { useModuleOn, useSession } from '@/lib/session';
import type { PatientDetail } from '@/lib/types';
import { PatientLivestock } from '@/components/livestock/patient-livestock';
import { PatientInsurance } from '@/components/insurance/patient-insurance';
import { cn } from '@/lib/utils';
import { TimelineTab } from '@/components/patients/patient-timeline';
import { PatientDental } from '@/components/dental/patient-dental';
import { PatientWellnessTab } from '@/components/wellness/patient-wellness';

function PatientRecord() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const moduleOn = useModuleOn();
  const key = ['patient', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<PatientDetail>(`/patients/${id}`) });
  // A current hospital stay replaces "Admit" with a link to the treatment sheet.
  const inpatient = useQuery({
    queryKey: ['admissions', 'current', id],
    queryFn: () => api.get<{ data: { id: string; admissionNo: string }[] }>(`/admissions?patientId=${id}&status=ADMITTED&pageSize=1`),
    enabled: can('hospital.read'),
  });
  const [admitOpen, setAdmitOpen] = useState(false);
  const params = useSearchParams();
  const initialTab = params.get('tab') ?? 'overview';
  // Just registered (from Add patient): offer the usual next steps once.
  const [justSaved, setJustSaved] = useState(params.get('registered') === '1');
  const [dlg, setDlg] = useState<null | 'edit' | 'weight' | 'alert' | 'identifier' | 'deceased' | 'transfer' | 'coowner' | 'merge' | 'book' | 'consult' | 'triage'>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['timeline', id] });
  };
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const photo = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('entityType', 'Patient');
      fd.append('entityId', id);
      fd.append('category', 'photo');
      fd.append('file', file);
      const a = await api.upload<{ id: string }>('/attachments', fd);
      await api.post(`/patients/${id}/photo`, { attachmentId: a.id });
    },
    onSuccess: () => {
      toast.success('Photo updated');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data!;
  const stay = inpatient.data?.data[0];
  const editable = can('patients.write') && p.status !== 'MERGED';
  const active = p.status === 'ACTIVE';
  const farmAnimal = !!p.farmId || ['LIVESTOCK', 'POULTRY', 'EQUINE'].includes(p.species.category);
  const banner = { ...p, alerts: p.alerts.filter((a) => a.isActive) };

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/patients" className="hover:text-foreground hover:underline">
          Patients
        </Link>
        <span>/</span>
        <span>{p.patientNo}</span>
      </nav>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start">
        <PatientBanner patient={banner} className="flex-1" hideRecordLink />
        <div className="flex flex-wrap gap-2">
          {active && can('appointments.write') && (
            <Button size="sm" onClick={() => setDlg('book')}>
              <CalendarPlus /> Book appointment
            </Button>
          )}
          {stay ? (
            <Button size="sm" variant="outline" asChild className="border-info/40 text-info">
              <Link href={`/hospital/admissions/${stay.id}`}>
                <BedDouble /> In hospital · {stay.admissionNo}
              </Link>
            </Button>
          ) : (
            active && can('hospital.write') && (
              <Button size="sm" variant="outline" onClick={() => setAdmitOpen(true)}>
                <BedDouble /> Admit
              </Button>
            )
          )}
          {active && can('surgery.write') && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/surgery?schedule=${p.id}`}>
                <Scissors /> Surgery
              </Link>
            </Button>
          )}
          {active && can('clinical.write') && (
            <Button size="sm" variant="outline" onClick={() => setDlg('consult')}>
              <Stethoscope /> Consult
            </Button>
          )}
          {active && can('triage.write') && (
            <Button size="sm" variant="outline" onClick={() => setDlg('triage')}>
              <Siren /> Triage
            </Button>
          )}
          <Button size="sm" variant="outline" asChild title="Opens everything recorded about this patient in a new tab">
            <a href={`/patients/${p.id}/record`} target="_blank" rel="noopener noreferrer">
              <FileText /> Complete record
            </a>
          </Button>
          {editable && (
            <Button size="sm" variant="outline" onClick={() => setDlg('edit')}>
              <Edit /> Edit
            </Button>
          )}
          {editable && active && (
            <Button size="sm" variant="outline" onClick={() => setDlg('weight')}>
              <Plus /> Weight
            </Button>
          )}
          {editable && (
            <Button size="sm" variant="outline" onClick={() => setDlg('alert')}>
              <ShieldAlert /> Add medical alert
            </Button>
          )}
          {editable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" aria-label="More actions" title="More actions: photo, microchip or tag, change client, archive">
                  <MoreHorizontal /> More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => photoRef.current?.click()}>
                  <Camera /> {p.photoAttachmentId ? 'Change photo' : 'Add photo'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDlg('identifier')}>
                  <Plus /> Add identifier
                </DropdownMenuItem>
                {can('clients.read') && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setDlg('transfer')}>
                      <Repeat /> Transfer ownership
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDlg('coowner')}>
                      <UserPlus /> Add co-owner
                    </DropdownMenuItem>
                  </>
                )}
                {can('patients.merge') && (
                  <DropdownMenuItem onSelect={() => setDlg('merge')}>
                    <GitMerge /> Merge a duplicate into this record
                  </DropdownMenuItem>
                )}
                {can('patients.archive') && (
                  <>
                    <DropdownMenuSeparator />
                    {active && (
                      <DropdownMenuItem destructive onSelect={() => setDlg('deceased')}>
                        <Cross /> Record death
                      </DropdownMenuItem>
                    )}
                    {(active || p.status === 'DECEASED') && (
                      <DropdownMenuItem
                        onSelect={async () => {
                          const r = await confirm({ title: `Archive ${p.name}?`, requireReason: true, destructive: true, confirmLabel: 'Archive' });
                          if (r.confirmed) act.mutate(() => api.post(`/patients/${p.id}/archive`, { reason: r.reason }));
                        }}
                      >
                        <Archive /> Archive
                      </DropdownMenuItem>
                    )}
                    {['ARCHIVED', 'TRANSFERRED'].includes(p.status) && (
                      <DropdownMenuItem onSelect={() => act.mutate(() => api.post(`/patients/${p.id}/restore`))}>
                        <ArchiveRestore /> Restore
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <input
            ref={photoRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) photo.mutate(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {justSaved && (
        <SavedNextSteps onDismiss={() => setJustSaved(false)}>
          {active && can('appointments.write') && (
            <Button size="sm" onClick={() => setDlg('book')}>
              <CalendarPlus /> Book appointment
            </Button>
          )}
          {active && can('appointments.checkin') && p.owner && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/front-desk?walkIn=${p.id}`}>
                <LogIn /> Check in now
              </Link>
            </Button>
          )}
          {can('patients.write') && p.owner && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/patients/new?ownerId=${p.owner.id}`}>
                <PawPrint /> Add another patient
              </Link>
            </Button>
          )}
        </SavedNextSteps>
      )}
      {!justSaved && <PatientNextStep patient={p} onBook={() => setDlg('book')} />}
      <WithdrawalBanner patientId={p.id} />
      {p.status === 'MERGED' && p.mergedInto && (
        <div className="mb-4 rounded-md border border-info/30 bg-info/10 px-4 py-3 text-sm">
          Merged into{' '}
          <Link href={`/patients/${p.mergedInto.id}`} className="font-medium underline">
            {p.mergedInto.name}
          </Link>
          . This record is read-only.
        </div>
      )}
      {p.status === 'DECEASED' && (
        <div className="mb-4 rounded-md border bg-muted px-4 py-3 text-sm">
          {p.euthanasia ? 'Euthanased' : 'Deceased'} {fmtDateTime(p.deceasedAt)}
          {p.causeOfDeath && ` — ${p.causeOfDeath}`}
          {p.aftercare && ` · Aftercare: ${p.aftercare}`}
        </div>
      )}

      <Tabs defaultValue={initialTab}>
        <TabsList className="h-auto flex-wrap overflow-visible">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          {can('clinical.read') && <TabsTrigger value="visits">Consultations</TabsTrigger>}
          {can('appointments.read') && <TabsTrigger value="appointments">Appointments</TabsTrigger>}
          {can('prescriptions.read') && <TabsTrigger value="medications">Medications</TabsTrigger>}
          {can('lab.read') && <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>}
          {can('preventive.read') && <TabsTrigger value="care">Care plan</TabsTrigger>}
          {moduleOn('wellness') && can('wellness.read') && <TabsTrigger value="wellness">Wellness plan</TabsTrigger>}
          {moduleOn('dental') && can('clinical.read') && <TabsTrigger value="dental">Dental</TabsTrigger>}
          {farmAnimal && can('livestock.read') && <TabsTrigger value="farm">Farm</TabsTrigger>}
          {can('insurance.read') && <TabsTrigger value="insurance">Insurance</TabsTrigger>}
          <TabsTrigger value="weight">Weight</TabsTrigger>
          <TabsTrigger value="alerts">
            Alerts {p.alerts.filter((a) => a.isActive).length > 0 && <Badge variant="destructive">{p.alerts.filter((a) => a.isActive).length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="owners">Owners</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          {can('audit.read') && <TabsTrigger value="history">History</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          {can('clinical.read') && (
            <div className="xl:col-span-2">
              <ProblemsPanel patientId={p.id} editable={can('clinical.write') && p.status !== 'MERGED'} />
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Basic details</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList
                items={[
                  { label: 'Species', value: p.species.name },
                  { label: 'Breed', value: [p.breed?.name, p.breedText].filter(Boolean).join(' — ') },
                  { label: 'Sex', value: enumLabel(p.sex) },
                  {
                    label: 'Identification number',
                    value: p.identifiers.length ? p.identifiers.map((i) => `${i.value} (${enumLabel(i.type)})`).join(', ') : 'Not recorded',
                  },
                  { label: 'Date of birth', value: p.dateOfBirth && `${fmtDate(p.dateOfBirth)}${p.dobEstimated ? ' (estimated)' : ''}` },
                  { label: 'Colour', value: p.colour },
                  { label: 'Markings', value: p.markings },
                  { label: 'Blood type', value: p.bloodType },
                  { label: 'Latest weight', value: p.latestWeightKg == null ? 'Not recorded' : fmtWeight(p.latestWeightKg) },
                  { label: 'Insurance', value: [p.insuranceProvider, p.insurancePolicyNumber].filter(Boolean).join(' · ') },
                  { label: 'Registered', value: fmtDate(p.createdAt) },
                  { label: 'Notes', value: p.notes && <span className="whitespace-pre-wrap">{p.notes}</span> },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Identification</CardTitle>
              {editable && (
                <Button size="sm" variant="ghost" onClick={() => setDlg('identifier')}>
                  <Plus /> Add
                </Button>
              )}
            </CardHeader>
            {p.identifiers.length ? (
              <ul className="divide-y">
                {p.identifiers.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm">{i.value}</p>
                      <p className="text-xs text-muted-foreground">
                        {enumLabel(i.type)}
                        {i.issuedAt && ` · ${fmtDate(i.issuedAt)}`}
                      </p>
                    </div>
                    {editable && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove identifier"
                        onClick={async () => {
                          const r = await confirm({ title: `Remove ${enumLabel(i.type)} ${i.value}?`, destructive: true, confirmLabel: 'Remove' });
                          if (r.confirmed) act.mutate(() => api.del(`/patients/${p.id}/identifiers/${i.id}`));
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No microchip or tag recorded" className="py-6" />
            )}
          </Card>
        </TabsContent>

        {can('clinical.read') && (
          <TabsContent value="visits">
            <PatientVisits patientId={p.id} />
          </TabsContent>
        )}
        {can('appointments.read') && (
          <TabsContent value="appointments">
            <PatientAppointments patientId={p.id} onBook={active && can('appointments.write') ? () => setDlg('book') : undefined} />
          </TabsContent>
        )}

        {can('prescriptions.read') && (
          <TabsContent value="medications" className="grid gap-4 xl:grid-cols-2">
            <PrescriptionsPanel patient={p} editable={active} />
            <AdministrationsPanel patient={p} editable={active} />
          </TabsContent>
        )}
        {can('lab.read') && (
          <TabsContent value="diagnostics">
            <LabOrdersPanel patient={p} editable={active} />
          </TabsContent>
        )}

        <TabsContent value="timeline">
          <TimelineTab patientId={p.id} />
        </TabsContent>

        {can('preventive.read') && (
          <TabsContent value="care">
            <CarePlan patientId={p.id} active={active} />
          </TabsContent>
        )}
        {moduleOn('wellness') && can('wellness.read') && (
          <TabsContent value="wellness">
            <PatientWellnessTab patientId={p.id} patientName={p.name} active={active} />
          </TabsContent>
        )}
        {moduleOn('dental') && can('clinical.read') && (
          <TabsContent value="dental">
            <PatientDental patientId={p.id} patientName={p.name} active={active} />
          </TabsContent>
        )}

        {farmAnimal && can('livestock.read') && (
          <TabsContent value="farm">
            <PatientLivestock patient={{ id: p.id, name: p.name, sex: p.sex, speciesId: p.species.id, farmId: p.farmId, groupId: p.groupId }} ownerId={p.owner?.id ?? null} active={active} />
          </TabsContent>
        )}
        {can('insurance.read') && (
          <TabsContent value="insurance">
            <PatientInsurance patient={{ id: p.id, name: p.name }} active={active} />
          </TabsContent>
        )}

        <TabsContent value="weight">
          <WeightTab patient={p} onAdd={editable && active ? () => setDlg('weight') : undefined} />
        </TabsContent>

        <TabsContent value="alerts">
          <Card>
            <CardHeader>
              <CardTitle>Medical alerts, allergies and warnings</CardTitle>
              {editable && (
                <Button size="sm" variant="outline" onClick={() => setDlg('alert')}>
                  <Plus /> Add alert
                </Button>
              )}
            </CardHeader>
            {p.alerts.length ? (
              <ul className="divide-y">
                {p.alerts.map((a) => (
                  <li key={a.id} className={cn('flex items-start gap-3 px-4 py-3', !a.isActive && 'opacity-60')}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertChip alert={a} />
                        <Badge variant="secondary">{enumLabel(a.type)}</Badge>
                        {!a.isActive && <Badge variant="outline">Resolved {fmtDate(a.resolvedAt)}</Badge>}
                      </div>
                      {(a.substance || a.reaction) && (
                        <p className="mt-1 text-sm">
                          {a.substance && <>Substance: {a.substance}. </>}
                          {a.reaction && <>Reaction: {a.reaction}</>}
                        </p>
                      )}
                      {a.details && <p className="mt-1 text-sm text-muted-foreground">{a.details}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {a.createdByName} · {fmtDate(a.createdAt)}
                      </p>
                    </div>
                    {editable && a.isActive && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const r = await confirm({ title: `Resolve “${a.title}”?`, description: 'The alert stays in the record as resolved.', confirmLabel: 'Resolve' });
                          if (r.confirmed) act.mutate(() => api.patch(`/patients/${p.id}/alerts/${a.id}`, { isActive: false }));
                        }}
                      >
                        <CheckCircle2 /> Resolve
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No alerts recorded" description="Record allergies, chronic conditions and handling warnings." className="py-8" />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="owners" className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Current owners</CardTitle>
              {editable && can('clients.read') && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDlg('coowner')}>
                    <UserPlus /> Co-owner
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDlg('transfer')}>
                    <Repeat /> Transfer
                  </Button>
                </div>
              )}
            </CardHeader>
            <ul className="divide-y">
              {p.owner && (
                <li className="flex items-center justify-between px-4 py-3">
                  <div>
                    <Link href={`/clients/${p.owner.id}`} className="text-sm font-medium hover:underline">
                      {p.owner.displayName}
                    </Link>
                    <p className="text-xs text-muted-foreground">{[p.owner.mobilePhone, p.owner.email].filter(Boolean).join(' · ')}</p>
                  </div>
                  <Badge>Legal owner</Badge>
                </li>
              )}
              {p.coOwners.map((o) => (
                <li key={o.ownershipId} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <Link href={`/clients/${o.id}`} className="text-sm font-medium hover:underline">
                      {o.displayName}
                    </Link>
                    <p className="text-xs text-muted-foreground">{o.mobilePhone}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="info">Co-owner</Badge>
                    {editable && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Remove co-owner"
                        onClick={async () => {
                          const r = await confirm({ title: `Remove ${o.displayName} as co-owner?`, destructive: true, confirmLabel: 'Remove' });
                          if (r.confirmed) act.mutate(() => api.del(`/patients/${p.id}/co-owners/${o.ownershipId}`));
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
              {!p.owner && <EmptyState title="No client linked" className="py-6" />}
            </ul>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Ownership history</CardTitle>
            </CardHeader>
            <Table>
              <THead>
                <TR>
                  <TH>Owner</TH>
                  <TH>From</TH>
                  <TH>To</TH>
                  <TH>Reason</TH>
                </TR>
              </THead>
              <TBody>
                {p.ownershipHistory.map((o) => (
                  <TR key={o.id}>
                    <TD>
                      <Link href={`/clients/${o.client.id}`} className="hover:underline">
                        {o.client.displayName}
                      </Link>
                    </TD>
                    <TD>{fmtDate(o.startedAt)}</TD>
                    <TD>{o.endedAt ? fmtDate(o.endedAt) : <Badge variant="success">Current</Badge>}</TD>
                    <TD className="text-muted-foreground">{o.endReason ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardContent>
              <AttachmentsPanel entityType="Patient" entityId={p.id} canWrite={editable} />
            </CardContent>
          </Card>
        </TabsContent>

        {can('audit.read') && (
          <TabsContent value="history">
            <Card>
              <CardContent>
                <HistoryPanel entityId={p.id} />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={dlg === 'edit'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Edit {p.name}</DialogTitle>
          </DialogHeader>
          <PatientForm
            patient={p}
            onSaved={() => {
              toast.success('Patient updated');
              setDlg(null);
              refresh();
            }}
            onCancel={() => setDlg(null)}
          />
        </DialogContent>
      </Dialog>
      <WeightDialog patientId={p.id} open={dlg === 'weight'} onOpenChange={(o) => !o && setDlg(null)} onSaved={refresh} />
      <AlertDialog patientId={p.id} open={dlg === 'alert'} onOpenChange={(o) => !o && setDlg(null)} onSaved={refresh} />
      <IdentifierDialog patientId={p.id} open={dlg === 'identifier'} onOpenChange={(o) => !o && setDlg(null)} onSaved={refresh} />
      <DeceasedDialog patientId={p.id} name={p.name} open={dlg === 'deceased'} onOpenChange={(o) => !o && setDlg(null)} onSaved={refresh} />
      <TransferDialog patientId={p.id} currentOwnerId={p.owner?.id} open={dlg === 'transfer'} onOpenChange={(o) => !o && setDlg(null)} onSaved={refresh} />
      <CoOwnerDialog
        patientId={p.id}
        excludeIds={[p.owner?.id, ...p.coOwners.map((c) => c.id)].filter(Boolean) as string[]}
        open={dlg === 'coowner'}
        onOpenChange={(o) => !o && setDlg(null)}
        onSaved={refresh}
      />
      {can('appointments.write') && <BookingDialog open={dlg === 'book'} onOpenChange={(o) => !o && setDlg(null)} defaults={{ patient: {
              id: p.id,
              name: p.name,
              patientNo: p.patientNo,
              species: p.species,
              owner: p.owner ? { id: p.owner.id, displayName: p.owner.displayName, mobilePhone: p.owner.mobilePhone } : null,
              alerts: p.alerts.filter((a) => a.isActive),
            } }} />}
      {dlg === 'consult' && (
        <StartConsultationDialog
          open
          onOpenChange={(o) => !o && setDlg(null)}
          initial={{
            id: p.id,
            name: p.name,
            patientNo: p.patientNo,
            species: p.species,
            owner: p.owner ? { id: p.owner.id, displayName: p.owner.displayName, mobilePhone: p.owner.mobilePhone } : null,
            alerts: p.alerts.filter((a) => a.isActive),
          }}
        />
      )}
      <TriageDialog open={dlg === 'triage'} onOpenChange={(o) => !o && setDlg(null)} patientId={p.id} patientName={p.name} />
      {can('hospital.write') && <AdmitDialog open={admitOpen} onOpenChange={setAdmitOpen} patient={{ id: p.id, name: p.name, patientNo: p.patientNo, species: p.species, owner: p.owner, alerts: p.alerts } as never} />}
      <MergePatientDialog patient={p} open={dlg === 'merge'} onOpenChange={(o) => !o && setDlg(null)} onMerged={refresh} />
    </>
  );
}

function WeightTab({ patient, onAdd }: { patient: PatientDetail; onAdd?: () => void }) {
  const data = [...patient.weights].reverse().map((w) => ({ date: fmtDate(w.measuredAt), kg: w.weightKg }));
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader>
          <CardTitle>Weight trend</CardTitle>
          {onAdd && (
            <Button size="sm" variant="outline" onClick={onAdd}>
              <Plus /> Record weight
            </Button>
          )}
        </CardHeader>
        <CardContent className="h-[280px]">
          {data.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} unit=" kg" domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} formatter={(v: number) => [`${v} kg`, 'Weight']} />
                <Line type="monotone" dataKey="kg" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="Not enough measurements" description="Record at least two weights to see a trend." />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Measurements</CardTitle>
        </CardHeader>
        {patient.weights.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH className="text-right">Weight</TH>
                <TH>BCS</TH>
                <TH>By</TH>
              </TR>
            </THead>
            <TBody>
              {patient.weights.map((w) => (
                <TR key={w.id}>
                  <TD className="text-xs">{fmtDateTime(w.measuredAt)}</TD>
                  <TD className="text-right tabular">{fmtWeight(w.weightKg)}</TD>
                  <TD>{w.bodyConditionScore ? `${w.bodyConditionScore}/${w.bcsScale}` : '—'}</TD>
                  <TD className="text-xs text-muted-foreground">{w.recordedByName}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState title="No weights recorded" className="py-6" />
        )}
      </Card>
    </div>
  );
}

function MergePatientDialog({ patient, open, onOpenChange, onMerged }: { patient: PatientDetail; open: boolean; onOpenChange: (o: boolean) => void; onMerged: () => void }) {
  const [dupe, setDupe] = useState<PickedPatient | null>(null);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post('/patients/merge', { survivorId: patient.id, mergedId: dupe!.id, reason }),
    onSuccess: () => {
      toast.success('Records merged');
      setDupe(null);
      setReason('');
      onOpenChange(false);
      onMerged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge duplicate patient</DialogTitle>
          <DialogDescription>
            Identifiers, weights, alerts, ownership history and documents of the duplicate move into <b>{patient.name}</b>. Only patients of the same species can be merged.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Duplicate record</Label>
            <PatientPicker value={dupe} onChange={setDupe} excludeId={patient.id} speciesId={patient.species.id} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pm-reason">Reason *</Label>
            <Textarea id="pm-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!dupe || !reason.trim()} loading={m.isPending} onClick={() => m.mutate()}>
            <GitMerge /> Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PatientPage() {
  return (
    <RequirePermission anyOf={['patients.read']}>
      <Suspense>
        <PatientRecord />
      </Suspense>
    </RequirePermission>
  );
}
