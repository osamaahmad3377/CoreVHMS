import type { PrismaClient } from '@prisma/client';
import type { SeededOrg } from './seed-modules';

const DAY = 86400_000;
const dateOnly = (ms: number) => new Date(new Date(ms).toISOString().slice(0, 10));
const DEMO_SOURCE = 'DEMO DATA — replace with your clinic’s reviewed figure and its source';

/**
 * Demo livestock, boarding/grooming and insurance/referral data (Milestone 8). Figures such as gestation
 * lengths are labelled demo values for showing the workflow; clinics enter their own reviewed data.
 */
export async function seedServices(prisma: PrismaClient, s: SeededOrg) {
  const orgId = s.org.id;
  const pk = s.org.country === 'PK';
  const branch = s.branches[0];
  const now = Date.now();
  const next = async (key: string) => {
    const r = await prisma.$queryRaw<{ value: number }[]>`INSERT INTO "Counter" ("organizationId","key","value") VALUES (${orgId}::uuid, ${key}, 1) ON CONFLICT ("organizationId","key") DO UPDATE SET "value" = "Counter"."value" + 1 RETURNING "value"`;
    return Number(r[0].value);
  };
  const vet = await prisma.membership.findFirst({ where: { organizationId: orgId, isClinician: true, status: 'ACTIVE', roles: { some: { role: { key: { in: ['field_vet', 'veterinarian'] } } } } }, include: { user: true }, orderBy: { createdAt: 'asc' } });
  const fieldVet = (await prisma.membership.findFirst({ where: { organizationId: orgId, status: 'ACTIVE', roles: { some: { role: { key: 'field_vet' } } } }, include: { user: true } })) ?? vet;
  const reception = await prisma.membership.findFirst({ where: { organizationId: orgId, status: 'ACTIVE', roles: { some: { role: { key: 'receptionist' } } } }, include: { user: true } });
  if (!vet) return;
  const by = { id: vet.userId, name: vet.user.name };
  const tax = await prisma.taxRate.findFirst({ where: { organizationId: orgId, isDefault: true } });
  const taxBp = tax?.rateBasisPoints ?? 0;
  const species = await prisma.species.findMany({ where: { organizationId: orgId } });
  const sp = (n: string) => species.find((x) => x.name === n)!;
  const patients = await prisma.patient.findMany({ where: { organizationId: orgId, id: { in: s.patients.map((p) => p.id) } }, include: { identifiers: true } });

  // ── Livestock ──
  for (const name of ['Cattle', 'Buffalo', 'Goat', 'Sheep']) {
    const x = species.find((y) => y.name === name);
    if (x) await prisma.species.update({ where: { id: x.id }, data: { gestationDays: { Cattle: 283, Buffalo: 310, Goat: 150, Sheep: 147 }[name], gestationSource: DEMO_SOURCE } });
  }
  const farmClients = await prisma.client.findMany({ where: { organizationId: orgId, type: 'FARM' }, orderBy: { number: 'asc' } });
  const farmFor = async (clientId: string, name: string, district: string, lat: number, lng: number) =>
    prisma.farm.create({ data: { organizationId: orgId, number: await next('farm'), clientId, name, district, latitude: lat, longitude: lng, address: `${district} (demo address)`, createdByName: 'Demo seed' } });
  const calloutSvc = await prisma.service.findFirst({ where: { organizationId: orgId, code: 'FARM' } });
  const examSvc = await prisma.service.create({ data: { organizationId: orgId, code: 'HERDEXAM', name: 'Herd health examination (per head)', category: 'FIELD_VISIT', priceMinor: pk ? 30000 : 1500 } });
  const farms: { id: string; clientId: string }[] = [];

  for (const [i, c] of farmClients.entries()) {
    const farm = await farmFor(c.id, c.displayName, pk ? (i === 0 ? 'Sheikhupura' : 'Kasur') : 'Dubbo', pk ? 31.71 + i * 0.1 : -32.25, pk ? 73.98 - i * 0.1 : 148.6);
    farms.push(farm);
    const own = patients.filter((p) => s.patients.find((x) => x.id === p.id)?.clientId === c.id);
    const bySpecies = new Map<string, typeof own>();
    for (const p of own) {
      const name = species.find((x) => x.id === p.speciesId)!.name;
      if (!['Cattle', 'Buffalo', 'Goat', 'Sheep'].includes(name)) continue;
      bySpecies.set(name, [...(bySpecies.get(name) ?? []), p]);
    }
    for (const [name, animals] of bySpecies) {
      const g = await prisma.animalGroup.create({ data: { organizationId: orgId, farmId: farm.id, name: name === 'Goat' ? 'Breeding goats' : name === 'Buffalo' ? 'Milking buffaloes' : 'Milking cows', kind: 'HERD', speciesId: sp(name).id, purpose: name === 'Goat' ? 'BREEDING' : 'DAIRY', location: 'Main shed' } });
      for (const a of animals) {
        await prisma.patient.update({ where: { id: a.id }, data: { farmId: farm.id, groupId: g.id } });
        await prisma.livestockMovement.create({ data: { organizationId: orgId, type: 'PLACEMENT', patientId: a.id, toFarmId: farm.id, toGroupId: g.id, occurredAt: new Date(now - 400 * DAY), recordedByName: 'Demo seed' } });
      }
      // A few more tagged animals so herd lists, fertility and milk sheets have something to show.
      const extra = name === 'Goat' ? ['Moti', 'Sheela', 'Bano'] : name === 'Buffalo' ? ['Neeli', 'Sanwli'] : pk ? ['Sohni'] : ['Rosie', 'Bluebell'];
      for (const [j, n] of extra.entries()) {
        const number = await next('patient');
        const p = await prisma.patient.create({ data: { organizationId: orgId, number, name: n, speciesId: sp(name).id, breedText: name === 'Goat' ? 'Beetal' : name === 'Buffalo' ? 'Nili-Ravi' : pk ? 'Sahiwal' : 'Angus', sex: 'FEMALE', dateOfBirth: dateOnly(now - (900 + j * 120) * DAY), farmId: farm.id, groupId: g.id, primaryBranchId: branch.id } });
        await prisma.patientOwnership.create({ data: { organizationId: orgId, patientId: p.id, clientId: c.id, isPrimary: true } });
        await prisma.patientIdentifier.create({ data: { organizationId: orgId, patientId: p.id, type: 'EAR_TAG', value: `${s.org.country}-DEMO-${String(number).padStart(4, '0')}` } });
        await prisma.livestockMovement.create({ data: { organizationId: orgId, type: 'PURCHASE', patientId: p.id, toFarmId: farm.id, toGroupId: g.id, occurredAt: new Date(now - (300 - j * 20) * DAY), counterparty: 'Livestock market (demo)', recordedByName: 'Demo seed' } });
        animals.push(p as any);
      }
      const females = animals.filter((a) => a.sex.startsWith('FEMALE'));
      const male = animals.find((a) => a.sex.startsWith('MALE'));
      const gestation = { Cattle: 283, Buffalo: 310, Goat: 150, Sheep: 147 }[name]!;
      for (const [j, f] of females.entries()) {
        if (j % 3 === 0) {
          // Pregnant, due within the next few weeks.
          const served = now - (gestation - 20 + j * 4) * DAY;
          await prisma.breedingEvent.create({ data: { organizationId: orgId, patientId: f.id, type: name === 'Goat' ? 'SERVICE' : 'INSEMINATION', occurredAt: new Date(served), sireId: name === 'Goat' ? male?.id ?? null : null, sireText: name === 'Goat' ? null : 'AI sire (demo straw)', semenBatch: name === 'Goat' ? null : 'DEMO-S-01', expectedDueDate: dateOnly(served + gestation * DAY), dueDateSource: `${name} gestation ${gestation} days — ${DEMO_SOURCE}`, recordedById: by.id, recordedByName: by.name } });
          await prisma.breedingEvent.create({ data: { organizationId: orgId, patientId: f.id, type: 'PREGNANCY_CHECK', occurredAt: new Date(served + 45 * DAY), result: 'PREGNANT', method: 'Ultrasound (demo)', expectedDueDate: dateOnly(served + gestation * DAY), recordedById: by.id, recordedByName: by.name } });
        } else if (j % 3 === 1) {
          await prisma.breedingEvent.create({ data: { organizationId: orgId, patientId: f.id, type: 'HEAT', occurredAt: new Date(now - (5 + j) * DAY), recordedById: by.id, recordedByName: by.name } });
        }
      }
      // Two weeks of milk recording for dairy herds.
      if (name !== 'Goat') {
        const rows = [];
        for (let d = 14; d >= 1; d--) {
          for (const [j, f] of females.entries()) rows.push({ organizationId: orgId, farmId: farm.id, patientId: f.id, groupId: g.id, kind: 'MILK' as const, recordedOn: dateOnly(now - d * DAY), quantity: (name === 'Buffalo' ? 8 : 10) + ((j * 7 + d) % 5) * 0.5, unit: 'L', recordedByName: 'Demo seed' });
        }
        await prisma.productionRecord.createMany({ data: rows });
      }
    }
    if (i === 0 && pk) {
      // A broiler batch with daily records.
      const chicken = sp('Chicken');
      const placed = now - 24 * DAY;
      const batch = await prisma.animalGroup.create({ data: { organizationId: orgId, farmId: farm.id, name: 'Broiler shed 1', kind: 'BATCH', speciesId: chicken.id, purpose: 'BROILER', tracksIndividuals: false, initialCount: 3000, headCount: 3000, placedOn: dateOnly(placed), breedText: 'Ross 308 (demo)', location: 'Shed 1' } });
      await prisma.livestockMovement.create({ data: { organizationId: orgId, type: 'PLACEMENT', toFarmId: farm.id, toGroupId: batch.id, headCount: 3000, occurredAt: new Date(placed), recordedByName: 'Demo seed' } });
      let dead = 0;
      const rows = [];
      for (let d = 23; d >= 1; d--) {
        const m = d > 20 ? 12 : d % 4 === 0 ? 5 : 2;
        dead += m;
        rows.push({ organizationId: orgId, farmId: farm.id, groupId: batch.id, kind: 'MORTALITY' as const, recordedOn: dateOnly(now - d * DAY), quantity: m, unit: 'head', recordedByName: 'Demo seed' });
        rows.push({ organizationId: orgId, farmId: farm.id, groupId: batch.id, kind: 'FEED' as const, recordedOn: dateOnly(now - d * DAY), quantity: 60 + (23 - d) * 12, unit: 'kg', recordedByName: 'Demo seed' });
        if (d % 7 === 0) rows.push({ organizationId: orgId, farmId: farm.id, groupId: batch.id, kind: 'BATCH_WEIGHT' as const, recordedOn: dateOnly(now - d * DAY), quantity: Math.round((0.05 + (24 - d) * 0.055) * 100) / 100, unit: 'kg', recordedByName: 'Demo seed' });
      }
      await prisma.productionRecord.createMany({ data: rows });
      await prisma.animalGroup.update({ where: { id: batch.id }, data: { headCount: 3000 - dead } });
      await prisma.groupTreatment.create({ data: { organizationId: orgId, farmId: farm.id, groupId: batch.id, kind: 'VACCINATION', productName: 'Newcastle disease vaccine (demo, supplied by farmer)', route: 'Drinking water', headCount: 3000 - dead, administeredAt: new Date(now - 10 * DAY), notes: 'Demo record', administeredById: by.id, administeredByName: by.name } });
    }
    if (i === 1 && pk) {
      await prisma.diseaseOutbreak.create({ data: { organizationId: orgId, number: await next('outbreak'), farmId: farm.id, disease: 'Peste des petits ruminants (suspected, demo)', notifiable: true, status: 'SUSPECTED', firstSeenOn: dateOnly(now - 2 * DAY), populationAtRisk: 5, affectedCount: 1, deathCount: 0, diagnosisMethod: 'Clinical signs; samples sent to lab (demo)', controlMeasures: 'Affected goat isolated; movement off the farm stopped (demo).', createdByName: by.name } });
    }

    // Field visits: one completed last week (billed), one scheduled tomorrow.
    if (calloutSvc && fieldVet) {
      const past = await prisma.fieldVisit.create({
        data: { organizationId: orgId, branchId: branch.id, number: await next('fieldVisit'), farmId: farm.id, clientId: c.id, clinicianId: fieldVet.id, scheduledAt: new Date(now - 7 * DAY), purpose: 'Routine herd health check (demo)', calloutServiceId: calloutSvc.id, distanceKm: 24, status: 'IN_PROGRESS', startedAt: new Date(now - 7 * DAY), createdByName: 'Demo seed' },
      });
      const item = await prisma.fieldVisitItem.create({ data: { organizationId: orgId, visitId: past.id, kind: 'SERVICE', serviceId: examSvc.id, description: examSvc.name, quantity: 4, unitPriceMinor: examSvc.priceMinor, recordedByName: fieldVet.user.name, createdAt: new Date(now - 7 * DAY) } });
      await prisma.charge.create({ data: { organizationId: orgId, branchId: branch.id, clientId: c.id, sourceType: 'FieldVisitItem', sourceId: item.id, kind: 'SERVICE', serviceId: examSvc.id, description: `${examSvc.name} (FV-${String(past.number).padStart(5, '0')})`, quantity: 4, unitPriceMinor: examSvc.priceMinor, taxRateBasisPoints: taxBp, createdByName: fieldVet.user.name, createdAt: new Date(now - 7 * DAY) } });
      await prisma.charge.create({ data: { organizationId: orgId, branchId: branch.id, clientId: c.id, sourceType: 'FieldVisit', sourceId: past.id, kind: 'SERVICE', serviceId: calloutSvc.id, description: `${calloutSvc.name} (FV-${String(past.number).padStart(5, '0')})`, quantity: 1, unitPriceMinor: calloutSvc.priceMinor, taxRateBasisPoints: taxBp, createdByName: fieldVet.user.name, createdAt: new Date(now - 7 * DAY) } });
      await prisma.fieldVisit.update({ where: { id: past.id }, data: { status: 'COMPLETED', completedAt: new Date(now - 7 * DAY + 2 * 3600_000), completedByName: fieldVet.user.name, findings: 'Herd in good body condition. One cow with mild lameness, hoof trimmed (demo).', recommendations: 'Keep the lame cow on soft bedding; recheck in 2 weeks (demo).' } });
      await prisma.fieldVisit.create({ data: { organizationId: orgId, branchId: branch.id, number: await next('fieldVisit'), farmId: farm.id, clientId: c.id, clinicianId: fieldVet.id, scheduledAt: new Date(now + DAY + 2 * 3600_000), purpose: i === 0 ? 'Pregnancy checks and vaccination (demo)' : 'Follow-up on sick goat (demo)', calloutServiceId: calloutSvc.id, createdByName: 'Demo seed' } });
    }
  }

  // ── Boarding & grooming ──
  const nightly = await prisma.service.create({ data: { organizationId: orgId, code: 'BOARD', name: 'Boarding (per night)', category: 'BOARDING', priceMinor: pk ? 150000 : 5500 } });
  const catNight = await prisma.service.create({ data: { organizationId: orgId, code: 'CATBOARD', name: 'Cattery (per night)', category: 'BOARDING', priceMinor: pk ? 100000 : 4000 } });
  const units = [];
  for (const [j, n] of ['Kennel 1', 'Kennel 2', 'Kennel 3', 'Kennel 4'].entries()) units.push(await prisma.boardingUnit.create({ data: { organizationId: orgId, branchId: branch.id, name: n, type: 'KENNEL', nightlyServiceId: nightly.id, sortOrder: j } }));
  for (const [j, n] of ['Cat suite A', 'Cat suite B'].entries()) units.push(await prisma.boardingUnit.create({ data: { organizationId: orgId, branchId: branch.id, name: n, type: 'CATTERY', nightlyServiceId: catNight.id, sortOrder: 10 + j } }));
  const dogs = patients.filter((p) => species.find((x) => x.id === p.speciesId)?.name === 'Dog');
  const cats = patients.filter((p) => species.find((x) => x.id === p.speciesId)?.name === 'Cat');
  const ownerOf = (id: string) => s.patients.find((p) => p.id === id)!.clientId;
  if (dogs[1]) {
    const stay = await prisma.boardingStay.create({
      data: {
        organizationId: orgId, branchId: branch.id, number: await next('boarding'), patientId: dogs[1].id, clientId: ownerOf(dogs[1].id), unitId: units[0].id, status: 'CHECKED_IN',
        startDate: dateOnly(now - 2 * DAY), endDate: dateOnly(now + 3 * DAY), nightlyRateMinor: nightly.priceMinor, nightlyServiceId: nightly.id,
        feedingInstructions: 'Own dry food, 2 cups morning and evening (demo).', belongings: 'Bed and lead', emergencyContact: 'Owner’s brother (demo)', checkedInAt: new Date(now - 2 * DAY), checkedInByName: reception?.user.name ?? by.name, createdByName: reception?.user.name ?? by.name,
      },
    });
    await prisma.boardingLog.createMany({
      data: [
        { organizationId: orgId, stayId: stay.id, kind: 'FEEDING', text: 'Ate all breakfast (demo)', recordedAt: new Date(now - DAY - 6 * 3600_000), recordedByName: reception?.user.name ?? by.name },
        { organizationId: orgId, stayId: stay.id, kind: 'WALK', text: '20 minute walk, normal stool (demo)', recordedAt: new Date(now - DAY - 4 * 3600_000), recordedByName: reception?.user.name ?? by.name },
        { organizationId: orgId, stayId: stay.id, kind: 'FEEDING', text: 'Ate half of dinner (demo)', recordedAt: new Date(now - 14 * 3600_000), recordedByName: reception?.user.name ?? by.name },
      ],
    });
  }
  if (cats[1]) {
    await prisma.boardingStay.create({ data: { organizationId: orgId, branchId: branch.id, number: await next('boarding'), patientId: cats[1].id, clientId: ownerOf(cats[1].id), unitId: units[4].id, startDate: dateOnly(now + 4 * DAY), endDate: dateOnly(now + 11 * DAY), nightlyRateMinor: catNight.priceMinor, nightlyServiceId: catNight.id, feedingInstructions: 'Wet food twice daily (demo).', createdByName: 'Demo seed' } });
  }
  const groomSvc = await prisma.service.findFirst({ where: { organizationId: orgId, code: 'GROOM' } });
  const nailSvc = await prisma.service.findFirst({ where: { organizationId: orgId, code: 'NAIL' } });
  if (dogs[2] && groomSvc) {
    const job = await prisma.groomingJob.create({ data: { organizationId: orgId, branchId: branch.id, number: await next('grooming'), patientId: dogs[2].id, clientId: ownerOf(dogs[2].id), status: 'IN_PROGRESS', instructions: 'Short summer cut, keep the tail fluffy (demo)', startedAt: new Date(now - 30 * 60_000), createdByName: reception?.user.name ?? 'Demo seed', createdAt: new Date(now - 60 * 60_000) } });
    await prisma.groomingJobService.create({ data: { organizationId: orgId, jobId: job.id, serviceId: groomSvc.id, description: groomSvc.name, priceMinor: groomSvc.priceMinor } });
    if (nailSvc) await prisma.groomingJobService.create({ data: { organizationId: orgId, jobId: job.id, serviceId: nailSvc.id, description: nailSvc.name, priceMinor: nailSvc.priceMinor } });
  }

  // ── Insurance & referrals ──
  const insurer = await prisma.insuranceProvider.create({ data: { organizationId: orgId, name: pk ? 'Demo Takaful Pet Cover' : 'Demo PetSure Australia', phone: pk ? '042 1111 2222' : '1300 000 000', claimsEmail: pk ? 'claims@demo-takaful.example' : 'claims@demo-petsure.example', notes: 'Demo insurer' } });
  const insured = dogs[0];
  if (insured) {
    const clientId = ownerOf(insured.id);
    const policy = await prisma.insurancePolicy.create({ data: { organizationId: orgId, providerId: insurer.id, patientId: insured.id, clientId, policyNumber: `DEMO-${s.org.country}-1001`, planName: 'Accident & illness (demo)', startDate: dateOnly(now - 200 * DAY), endDate: dateOnly(now + 165 * DAY), excessMinor: pk ? 500000 : 10000, coverLimitMinor: pk ? 50000000 : 1500000, createdByName: 'Demo seed' } });
    const inv = await prisma.invoice.findFirst({ where: { organizationId: orgId, clientId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] } }, orderBy: { issuedAt: 'desc' } });
    if (inv) {
      await prisma.insuranceClaim.create({
        data: {
          organizationId: orgId, number: await next('claim'), policyId: policy.id, patientId: insured.id, clientId, condition: 'Gastroenteritis (demo claim)', treatmentFrom: dateOnly(inv.issuedAt?.getTime() ?? now), treatmentTo: dateOnly(inv.issuedAt?.getTime() ?? now),
          claimedMinor: inv.totalMinor, status: 'SUBMITTED', submittedAt: new Date(now - 3 * DAY), submittedByName: reception?.user.name ?? by.name, clinicalSummary: 'Vomiting and diarrhoea for 2 days; treated with fluids and supportive care (demo).', createdByName: 'Demo seed',
          invoices: { create: [{ organizationId: orgId, invoiceId: inv.id, amountMinor: inv.totalMinor }] },
        },
      });
    }
    await prisma.preAuthorization.create({ data: { organizationId: orgId, number: await next('preauth'), policyId: policy.id, procedure: 'Dental scale and polish under anaesthesia (demo)', estimateMinor: pk ? 2500000 : 65000, status: 'DRAFT', createdByName: 'Demo seed' } });
  }
  const specialist = await prisma.referralContact.create({ data: { organizationId: orgId, name: pk ? 'Dr. Sana Malik' : 'Dr. Emily Chen', practice: pk ? 'Lahore Veterinary Referral Centre (demo)' : 'Sydney Animal Specialists (demo)', specialty: 'Orthopaedics', email: pk ? 'referrals@lvrc-demo.example' : 'referrals@sas-demo.example', phone: pk ? '042 3333 4444' : '02 9000 0000' } });
  const refPatient = dogs[dogs.length - 1];
  if (refPatient) {
    await prisma.referral.create({ data: { organizationId: orgId, number: await next('referral'), direction: 'OUTGOING', patientId: refPatient.id, clientId: ownerOf(refPatient.id), contactId: specialist.id, urgency: 'ROUTINE', reason: 'Intermittent hind-limb lameness for orthopaedic assessment (demo)', clinicalSummary: 'Lameness grade 2/5 right hind for 4 weeks; partial response to rest and anti-inflammatories. Radiographs inconclusive (demo).', questions: 'Is cruciate disease likely? Surgical options?', status: 'SENT', sentAt: new Date(now - 4 * DAY), sentByName: by.name, createdByName: by.name } });
  }
}
