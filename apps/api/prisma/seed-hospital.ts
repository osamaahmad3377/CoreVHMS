import type { PrismaClient } from '@prisma/client';
import { stableUuid } from '../src/common/util/stable-uuid';
import { localParts, zonedToUtc } from '../src/common/time/tz';
import { DEFAULT_CHECKLIST } from '../src/modules/hospital/surgery.service';
import type { SeededOrg } from './seed-modules';

/**
 * Demo hospital and surgery data (Milestone 6). Prices are illustrative; treatment orders are clearly
 * labelled demo records and are not dosing guidance.
 */
export async function seedHospital(prisma: PrismaClient, s: SeededOrg) {
  const orgId = s.org.id;
  const pk = s.org.country === 'PK';
  const branch = s.branches[0];
  const tz = branch.timezone;
  const next = async (key: string) => {
    const r = await prisma.$queryRaw<{ value: number }[]>`INSERT INTO "Counter" ("organizationId","key","value") VALUES (${orgId}::uuid, ${key}, 1) ON CONFLICT ("organizationId","key") DO UPDATE SET "value" = "Counter"."value" + 1 RETURNING "value"`;
    return Number(r[0].value);
  };
  const tax = await prisma.taxRate.findFirst({ where: { organizationId: orgId, isDefault: true } });
  const svc = async (code: string, name: string, category: string, priceMinor: number) => prisma.service.create({ data: { organizationId: orgId, code, name, category: category as any, priceMinor } });
  const hospDay = await svc('HOSPDAY', 'Hospitalisation (per day)', 'HOSPITALISATION', pk ? 300000 : 9500);
  const icuDay = await svc('ICUDAY', 'Intensive care (per day)', 'HOSPITALISATION', pk ? 800000 : 28000);
  const spay = await svc('SPAY', 'Ovariohysterectomy (spay)', 'SURGERY', pk ? 1500000 : 45000);
  await svc('NEUTER', 'Castration', 'SURGERY', pk ? 1000000 : 32000);

  const wardDefs: [string, string, string | null, string[]][] = [
    ['General ward', 'GENERAL', hospDay.id, ['K1', 'K2', 'K3', 'K4', 'K5', 'K6']],
    ['Cattery', 'CATTERY', hospDay.id, ['C1', 'C2', 'C3', 'C4']],
    ['Intensive care', 'ICU', icuDay.id, ['ICU1', 'ICU2']],
    ['Isolation', 'ISOLATION', hospDay.id, ['ISO1']],
  ];
  const cages: Record<string, { id: string; wardId: string }> = {};
  for (const [i, [name, type, serviceId, cageNames]] of wardDefs.entries()) {
    const ward = await prisma.ward.create({ data: { organizationId: orgId, branchId: branch.id, name, type: type as any, dailyServiceId: serviceId, sortOrder: i } });
    for (const [j, c] of cageNames.entries()) cages[c] = { ...(await prisma.cage.create({ data: { organizationId: orgId, wardId: ward.id, name: c, sortOrder: j } })), wardId: ward.id };
  }
  await prisma.surgeryChecklistItem.createMany({ data: DEFAULT_CHECKLIST.map((d, i) => ({ ...d, organizationId: orgId, sortOrder: i })) });

  const dogs = s.patients.filter((p) => p.species === 'Dog');
  const cats = s.patients.filter((p) => p.species === 'Cat');
  const vet = await prisma.membership.findFirst({ where: { organizationId: orgId, isClinician: true, status: 'ACTIVE', NOT: { jobTitle: { contains: 'Owner' } } }, include: { user: true } });
  const nurse = await prisma.membership.findFirst({ where: { organizationId: orgId, status: 'ACTIVE', roles: { some: { role: { key: 'nurse' } } } }, include: { user: true } });
  if (!vet || !dogs.length) return;
  const by = vet.user;
  const nurseUser = nurse?.user ?? by;
  const HOUR = 3600_000;
  const now = Date.now();

  // ── One inpatient: admitted 26 h ago in the general ward ──
  const patient = dogs[dogs.length - 1];
  const admittedAt = new Date(now - 26 * HOUR);
  const adm = await prisma.admission.create({
    data: {
      organizationId: orgId,
      branchId: branch.id,
      number: await next('admission'),
      patientId: patient.id,
      clientId: patient.clientId,
      wardId: cages.K2.wardId,
      cageId: cages.K2.id,
      condition: 'GUARDED',
      cprStatus: 'CPR',
      reason: 'Haemorrhagic gastroenteritis — IV fluids and monitoring (demo)',
      diagnosis: 'Acute haemorrhagic diarrhoea syndrome (working diagnosis, demo)',
      feedingInstructions: 'Small frequent meals of the recovery diet once vomiting has stopped (demo).',
      responsibleClinicianId: vet.id,
      admittedAt,
      admittedById: by.id,
      admittedByName: by.name,
      expectedDischargeAt: new Date(now + 24 * HOUR),
    },
  });
  const order = async (data: Record<string, unknown>) =>
    prisma.treatmentOrder.create({ data: { organizationId: orgId, admissionId: adm.id, startAt: admittedAt, orderedById: by.id, orderedByName: by.name, ...data } as any });
  const fluids = await order({ kind: 'FLUID', schedule: 'CONTINUOUS', description: 'IV crystalloid infusion (demo)', fluidRateMlPerHour: 40, intervalHours: 4, instructions: 'Check catheter site and pump at each check (demo record).' });
  const feed = await order({ kind: 'FEEDING', schedule: 'INTERVAL', description: 'Recovery diet (demo)', intervalHours: 8 });
  const walk = await order({ kind: 'NURSING', schedule: 'INTERVAL', description: 'Walk outside and record urine/faeces', intervalHours: 6 });
  await order({ kind: 'OBSERVATION', schedule: 'AS_NEEDED', description: 'Check for vomiting after meals' });
  // Scheduled occurrences: past ones recorded (one not done), upcoming ones due; one recent occurrence left overdue.
  for (const o of [fluids, feed, walk]) {
    const every = (o.intervalHours ?? 6) * HOUR;
    for (let t = admittedAt.getTime(); t <= now + 36 * HOUR; t += every) {
      const past = t < now - HOUR;
      const overdueDemo = !past && t < now;
      const skipped = o.id === feed.id && t === admittedAt.getTime();
      await prisma.treatmentTask.create({
        data: {
          organizationId: orgId,
          admissionId: adm.id,
          orderId: o.id,
          dueAt: new Date(t),
          ...(past && !overdueDemo
            ? skipped
              ? { status: 'SKIPPED', doneAt: new Date(t + 10 * 60_000), doneById: nurseUser.id, doneByName: nurseUser.name, skipReason: 'Still vomiting — food withheld (demo)' }
              : { status: 'DONE', doneAt: new Date(t + 10 * 60_000), doneById: nurseUser.id, doneByName: nurseUser.name, value: o.id === feed.id ? 'Ate 50%' : o.id === walk.id ? 'Urinated, soft faeces' : 'Pump running, site clean' }
            : {}),
        },
      });
    }
  }
  for (const [h, temp, hr, rr] of [[25, 39.6, 132, 32], [13, 39.1, 118, 28], [2, 38.7, 104, 24]] as const) {
    await prisma.vitalSign.create({ data: { organizationId: orgId, patientId: patient.id, admissionId: adm.id, recordedAt: new Date(now - h * HOUR), temperatureC: temp, heartRate: hr, respiratoryRate: rr, recordedById: nurseUser.id, recordedByName: nurseUser.name, notes: 'Demo observation' } });
  }
  await prisma.hospitalNote.createMany({
    data: [
      { organizationId: orgId, admissionId: adm.id, type: 'PROGRESS', text: 'Admitted for IV fluids. Bright but dehydrated. Plan: fluids, monitor PCV/TS, recheck tomorrow (demo).', authorId: by.id, authorName: by.name, createdAt: admittedAt },
      { organizationId: orgId, admissionId: adm.id, type: 'HANDOVER', text: 'Night shift: no vomiting since 22:00, one episode of bloody diarrhoea at 02:00. Owner asked for an update call in the morning (demo).', authorId: nurseUser.id, authorName: nurseUser.name, createdAt: new Date(now - 6 * HOUR) },
    ],
  });
  // Daily charges for the two started days, with the same idempotent ids the API uses.
  for (const d of [1, 2]) {
    await prisma.charge.create({
      data: { organizationId: orgId, branchId: branch.id, clientId: patient.clientId, patientId: patient.id, sourceType: 'HospitalDay', sourceId: stableUuid(`admission-day:${adm.id}:${d}`), kind: 'SERVICE', serviceId: hospDay.id, description: `${hospDay.name} — day ${d} (General ward)`, quantity: 1, unitPriceMinor: hospDay.priceMinor, taxRateBasisPoints: tax?.rateBasisPoints ?? 0, createdByName: 'System', createdAt: new Date(admittedAt.getTime() + (d - 1) * 24 * HOUR) },
    });
  }

  // ── One surgery this afternoon (branch-local), consent recorded, checklist not yet started ──
  const surgPatient = cats[0] ?? dogs[0];
  const type = await prisma.appointmentType.findFirst({ where: { organizationId: orgId, category: 'SURGERY' } });
  const theatre = await prisma.resource.findFirst({ where: { organizationId: orgId, branchId: branch.id, type: 'THEATRE' } });
  if (!type || !theatre) return;
  const today = localParts(new Date(), tz).date;
  const startsAt = zonedToUtc(today, 13 * 60 + 30, tz);
  const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
  const appt = await prisma.appointment.create({
    data: { organizationId: orgId, branchId: branch.id, number: await next('appointment'), clientId: surgPatient.clientId, patientId: surgPatient.id, appointmentTypeId: type.id, clinicianId: vet.id, startsAt, endsAt, status: 'CONFIRMED', reason: 'Ovariohysterectomy (spay)', notes: 'Demo surgery booking', source: 'RECEPTION' },
  });
  await prisma.appointmentResource.create({ data: { appointmentId: appt.id, resourceId: theatre.id, startsAt, endsAt } });
  const checklist = await prisma.surgeryChecklistItem.findMany({ where: { organizationId: orgId }, orderBy: { sortOrder: 'asc' } });
  const surgery = await prisma.surgery.create({
    data: {
      organizationId: orgId,
      branchId: branch.id,
      number: await next('surgery'),
      patientId: surgPatient.id,
      clientId: surgPatient.clientId,
      appointmentId: appt.id,
      procedure: 'Ovariohysterectomy (spay)',
      serviceId: spay.id,
      theatreId: theatre.id,
      scheduledAt: startsAt,
      durationMinutes: 60,
      priority: 'ELECTIVE',
      asaGrade: 'I',
      preOpAssessment: 'Healthy young patient, clinical examination unremarkable (demo).',
      fastingConfirmed: true,
      consentObtained: true,
      consentGivenBy: 'Owner (demo)',
      consentAt: new Date(now - 2 * HOUR),
      consentRecordedBy: by.name,
      estimateMinor: spay.priceMinor,
      checklist: checklist.map((c) => ({ key: c.id, phase: c.phase, label: c.label, checked: false })),
      createdById: by.id,
      createdByName: by.name,
    },
  });
  await prisma.surgeryTeamMember.create({ data: { organizationId: orgId, surgeryId: surgery.id, membershipId: vet.id, role: 'SURGEON' } });
  if (nurse) await prisma.surgeryTeamMember.create({ data: { organizationId: orgId, surgeryId: surgery.id, membershipId: nurse.id, role: 'ANAESTHETIST' } });
}
