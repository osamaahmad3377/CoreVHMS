'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CERTIFICATE_KIND_INFO, kindsFor, type CertificateKind, type CertificateLayout, type CertificateSubject, type CertificateVaccinationRow } from '@vcms/shared';
import { Award, ChevronLeft, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '../forms/form-error';
import { PatientPicker, type PickedPatient } from '../patients/patient-picker';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { useDebounce } from '@/hooks/use-debounce';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { FitCertificate } from './certificate-page';
import type { CertificateDetail, CertificatePrefill, CertificateTemplateRow } from './types';

interface StaffOption {
  id: string;
  status: string;
  jobTitle: string | null;
  user: { name: string; isSystemAccount?: boolean };
}

/** What a reissue starts from (a corrected copy of an existing certificate). */
export interface ReissueFrom {
  id: string;
  certificateNo: string;
  kind: CertificateKind;
  inputs: Record<string, string>;
  validUntil: string | null;
  templateId: string | null;
}

/**
 * Issue a certificate: the kind, who it is for, the template, the answers (pre-filled from the records) and how long
 * it is valid, with a live preview of exactly what will print.
 */
export function IssueCertificateDialog({
  open,
  onOpenChange,
  subject,
  patient,
  membership,
  encounterId,
  kind: presetKind,
  reissue,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subject: CertificateSubject;
  patient?: { id: string; name: string } | null;
  membership?: { id: string; name: string } | null;
  encounterId?: string | null;
  kind?: CertificateKind | null;
  reissue?: ReissueFrom | null;
}) {
  const router = useRouter();
  const { can, session } = useSession();
  const [kind, setKind] = useState<CertificateKind | null>(reissue?.kind ?? presetKind ?? null);
  const [picked, setPicked] = useState<PickedPatient | null>(null);
  const [staffId, setStaffId] = useState(membership?.id ?? '');
  const [templateId, setTemplateId] = useState<string>(reissue?.templateId ?? '');
  const [inputs, setInputs] = useState<Record<string, string>>(reissue?.inputs ?? {});
  const [validUntil, setValidUntil] = useState<string>(reissue?.validUntil ?? '');
  const [vaccinationIds, setVaccinationIds] = useState<string[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const patientId = patient?.id ?? picked?.id ?? null;
  const subjectId = subject === 'PATIENT' ? patientId : staffId || null;
  const info = kind ? CERTIFICATE_KIND_INFO[kind] : null;

  const staff = useQuery({
    queryKey: ['staff', ''],
    queryFn: () => api.get<StaffOption[]>('/staff'),
    enabled: open && subject === 'STAFF' && !membership && can('users.read'),
  });
  const templates = useQuery({
    queryKey: ['certificate-templates', kind],
    queryFn: () => api.get<CertificateTemplateRow[]>(`/certificate-templates?kind=${kind}`),
    enabled: open && !!kind,
  });
  const active = (templates.data ?? []).filter((t) => t.isActive);

  // Pre-fill from the records once the kind and the subject are known (not for a reissue, which starts from the old one).
  const prefill = useQuery({
    queryKey: ['certificate-prefill', kind, subjectId],
    queryFn: () => api.get<CertificatePrefill>(`/certificates/prefill?kind=${kind}&subjectId=${subjectId}`),
    enabled: open && !!kind && !!subjectId,
  });
  useEffect(() => {
    if (!prefill.data || reissue) return;
    setInputs(prefill.data.inputs);
    setValidUntil(prefill.data.validUntil ?? '');
    setVaccinationIds(null);
  }, [prefill.data, reissue]);
  useEffect(() => {
    if (!templateId && active.length) setTemplateId(active.find((t) => t.isDefault)?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.data]);

  const body = useMemo(
    () => ({
      kind,
      templateId: templateId || null,
      patientId: subject === 'PATIENT' ? patientId : null,
      membershipId: subject === 'STAFF' ? staffId || null : null,
      encounterId: encounterId ?? null,
      inputs,
      vaccinationIds: vaccinationIds ?? undefined,
      validUntil: validUntil || null,
      replacesId: reissue?.id ?? null,
    }),
    [kind, templateId, subject, patientId, staffId, encounterId, inputs, vaccinationIds, validUntil, reissue],
  );
  const debounced = useDebounce(body, 400);
  const preview = useQuery({
    queryKey: ['certificate-preview', debounced],
    queryFn: () => api.post<{ fields: Record<string, string>; table: CertificateVaccinationRow[]; layout: CertificateLayout; templateName: string }>('/certificates/preview', debounced),
    enabled: open && !!debounced.kind && !!subjectId,
    placeholderData: (prev) => prev,
  });

  const issue = useMutation({
    mutationFn: () => api.post<CertificateDetail>('/certificates', body),
    onSuccess: (c) => {
      toast.success(`${c.certificateNo} issued`);
      onOpenChange(false);
      router.push(`/certificates/${c.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setFieldErrors(e.fieldErrors);
      setError(e);
    },
  });

  const set = (key: string, value: string) => {
    setInputs((s) => ({ ...s, [key]: value }));
    if (fieldErrors[`inputs.${key}`]) setFieldErrors((f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== `inputs.${key}`)));
  };
  const missing = info?.inputs.filter((i) => i.required && !(inputs[i.key] ?? '').trim()) ?? [];
  const vaccinations = prefill.data?.vaccinations ?? [];
  const chosenVacc = vaccinationIds ?? vaccinations.map((v) => v.id);
  const canIssue = !!kind && !!subjectId && !missing.length && !(info?.table === 'VACCINATIONS' && !chosenVacc.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-w-6xl">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
              <Award className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle>{reissue ? `Correct ${reissue.certificateNo}` : info ? `Issue: ${info.label}` : subject === 'PATIENT' ? 'Issue a patient certificate' : 'Issue a staff certificate'}</DialogTitle>
              <DialogDescription>
                {reissue
                  ? 'A new certificate is issued with your changes, and the old one is revoked as “replaced”.'
                  : 'Filled in from the records — check it, then issue. Issued certificates can’t be changed, only revoked or replaced.'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!kind ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {kindsFor(subject).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} className="grid gap-1 rounded-xl border border-foreground/10 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5">
                <span className="text-sm font-semibold">{CERTIFICATE_KIND_INFO[k].label}</span>
                <span className="text-xs text-muted-foreground">{CERTIFICATE_KIND_INFO[k].description}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
            <div className="grid content-start gap-3">
              {!!error && <FormError error={error} />}
              {!presetKind && !reissue && (
                <button type="button" className="flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => setKind(null)}>
                  <ChevronLeft className="h-3.5 w-3.5" /> Another kind of certificate
                </button>
              )}
              {subject === 'PATIENT' ? (
                patient ? (
                  <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm">For <b>{patient.name}</b></p>
                ) : (
                  <label className="grid gap-1 text-sm font-medium">
                    Patient
                    <PatientPicker value={picked} onChange={setPicked} placeholder="Search by pet, owner or phone…" />
                  </label>
                )
              ) : membership ? (
                <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm">For <b>{membership.name}</b></p>
              ) : (
                <label className="grid gap-1 text-sm font-medium">
                  Staff member
                  <NativeSelect value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                    <option value="">Choose…</option>
                    {(staff.data ?? []).filter((m) => !m.user.isSystemAccount && m.status !== 'INVITED').map((m) => <option key={m.id} value={m.id}>{m.user.name}{m.jobTitle ? ` — ${m.jobTitle}` : ''}</option>)}
                  </NativeSelect>
                </label>
              )}

              {subjectId && (
                <>
                  <label className="grid gap-1 text-sm font-medium">
                    Template
                    <NativeSelect value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                      {!active.some((t) => t.isDefault) && <option value="">Built-in design</option>}
                      {active.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</option>)}
                    </NativeSelect>
                  </label>

                  {prefill.isLoading && !reissue ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Filling in from the records…</p>
                  ) : (
                    info!.inputs.map((i) => {
                      const err = fieldErrors[`inputs.${i.key}`];
                      const id = `ci-${i.key}`;
                      return (
                        <label key={i.key} htmlFor={id} className="grid gap-1 text-sm font-medium">
                          <span>{i.label}{i.required && <span className="text-destructive"> *</span>}</span>
                          {i.type === 'textarea' ? (
                            <Textarea id={id} rows={3} value={inputs[i.key] ?? ''} placeholder={i.placeholder} onChange={(e) => set(i.key, e.target.value)} />
                          ) : i.type === 'select' ? (
                            <NativeSelect id={id} value={inputs[i.key] ?? ''} onChange={(e) => set(i.key, e.target.value)}>
                              <option value="">Choose…</option>
                              {i.options!.map((o) => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}
                            </NativeSelect>
                          ) : (
                            <Input id={id} type={i.type === 'date' ? 'date' : i.type === 'number' ? 'number' : 'text'} value={inputs[i.key] ?? ''} placeholder={i.placeholder} onChange={(e) => set(i.key, e.target.value)} />
                          )}
                          {(err || i.hint) && <span className={cn('text-2xs font-normal', err ? 'text-destructive' : 'text-muted-foreground')}>{err ?? i.hint}</span>}
                        </label>
                      );
                    })
                  )}

                  {info!.table === 'VACCINATIONS' && (
                    <fieldset className="grid gap-1.5">
                      <legend className="mb-1 text-sm font-medium">Vaccinations to list</legend>
                      {vaccinations.length ? (
                        <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-2">
                          {vaccinations.map((v) => (
                            <label key={v.id} className="flex items-start gap-2 rounded p-1 text-sm hover:bg-muted/50">
                              <Checkbox
                                className="mt-0.5"
                                checked={chosenVacc.includes(v.id)}
                                onCheckedChange={(c) => setVaccinationIds(c ? [...chosenVacc, v.id] : chosenVacc.filter((x) => x !== v.id))}
                              />
                              <span className="min-w-0">
                                <span className="font-medium">{v.vaccine}</span>
                                <span className="block text-2xs text-muted-foreground">{[v.product, v.batch && `batch ${v.batch}`, v.givenOn && `given ${v.givenOn}`, v.nextDue && `next due ${v.nextDue}`].filter(Boolean).join(' · ')}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs">No vaccinations are recorded for this patient yet. Record them under Vaccines & reminders first.</p>
                      )}
                    </fieldset>
                  )}

                  <div className="grid gap-1 text-sm font-medium">
                    <label htmlFor="ci-valid">Valid until</label>
                    <div className="flex items-center gap-2">
                      <Input id="ci-valid" type="date" className="flex-1" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                      {validUntil && <Button type="button" size="sm" variant="ghost" onClick={() => setValidUntil('')}>No expiry</Button>}
                    </div>
                    <span className="text-2xs font-normal text-muted-foreground">{validUntil ? 'After this date the verification page shows it as expired.' : 'Never expires.'}</span>
                  </div>
                </>
              )}
            </div>

            <div className="grid min-w-0 content-start gap-2">
              <p className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                Preview{preview.data ? ` · ${preview.data.templateName}` : ''}
                {preview.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              </p>
              {subjectId && preview.data ? (
                <FitCertificate
                  layout={preview.data.layout}
                  data={{ fields: preview.data.fields, table: preview.data.table, qrValue: preview.data.fields['certificate.verifyUrl'], barcodeValue: 'PREVIEW00000', logoUrl: session.organization?.logoUrl ?? null }}
                  maxWidth={620}
                />
              ) : (
                <div className="flex aspect-[1/1.414] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                  {subjectId ? <Loader2 className="h-5 w-5 animate-spin" /> : `Choose the ${subject === 'PATIENT' ? 'patient' : 'staff member'} to see the certificate`}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {kind && (
            <Button disabled={!canIssue} loading={issue.isPending} title={missing.length ? `Still needed: ${missing.map((m) => m.label).join(', ')}` : undefined} onClick={() => { setError(null); issue.mutate(); }}>
              <Award /> {reissue ? 'Issue corrected certificate' : 'Issue certificate'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
