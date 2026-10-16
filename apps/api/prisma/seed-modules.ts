import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { localDayBounds, localParts, zonedToUtc } from '../src/common/time/tz';

export interface SeededOrg {
  org: { id: string; currency: string; country: string };
  branches: { id: string; timezone: string }[];
  staffIds: Record<string, string>;
  patients: { id: string; species: string; clientId: string }[];
}

async function next(prisma: PrismaClient, orgId: string, key: string) {
  const rows = await prisma.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("organizationId","key","value") VALUES (${orgId}::uuid, ${key}, 1)
    ON CONFLICT ("organizationId","key") DO UPDATE SET "value" = "Counter"."value" + 1 RETURNING "value"`;
  return Number(rows[0].value);
}

const TEMPLATES = [
  {
    name: 'Wellness examination (companion)',
    speciesCategory: 'COMPANION' as const,
    presentingComplaint: 'Annual health check',
    subjective: 'Owner reports: appetite —, drinking —, urination/defecation —, exercise tolerance —, behaviour changes —.',
    objective: '',
    assessment: 'Healthy adult / findings: ',
    plan: 'Preventive care discussed (vaccination status, parasite control, dental care, nutrition). Next wellness check in 12 months.',
    examSystems: ['General appearance', 'Eyes', 'Ears', 'Oral cavity & teeth', 'Lymph nodes', 'Cardiovascular', 'Respiratory', 'Abdomen', 'Musculoskeletal', 'Skin & coat'],
  },
  {
    name: 'Vomiting / diarrhoea',
    speciesCategory: 'COMPANION' as const,
    presentingComplaint: 'Vomiting and/or diarrhoea',
    subjective: 'Onset: —. Frequency: —. Blood present: —. Diet change / scavenging: —. Toxin access: —. Vaccination status: —.',
    objective: 'Hydration: —. Abdominal palpation: —.',
    assessment: 'Differentials: dietary indiscretion, gastroenteritis, foreign body, parasitism, pancreatitis, systemic disease.',
    plan: 'Diagnostics: —. Treatment: —. Client advised to return if vomiting persists, blood appears or patient becomes lethargic.',
    examSystems: ['General appearance', 'Oral cavity & teeth', 'Cardiovascular', 'Abdomen', 'Gastrointestinal', 'Skin & coat'],
  },
  {
    name: 'Lameness',
    speciesCategory: null,
    presentingComplaint: 'Lameness',
    subjective: 'Limb affected: —. Duration: —. Trauma: —. Worse after rest/exercise: —.',
    objective: 'Gait assessment: —. Palpation/manipulation: —. Pain response: —.',
    assessment: '',
    plan: 'Rest / imaging / analgesia as per clinician. Recheck in — days.',
    examSystems: ['General appearance', 'Musculoskeletal', 'Neurological', 'Hooves / feet'],
  },
  {
    name: 'Bovine mastitis investigation',
    speciesCategory: 'LIVESTOCK' as const,
    presentingComplaint: 'Abnormal milk / swollen quarter',
    subjective: 'Days in milk: —. Quarters affected: —. Milk appearance: —. Appetite / milk yield change: —. Previous cases: —.',
    objective: 'Udder: heat/swelling/pain by quarter —. CMT: —. Rumen motility: —.',
    assessment: 'Clinical mastitis grade —.',
    plan: 'Milk sample for culture. Treatment per farm protocol and clinician. Record withdrawal periods before milk/meat use.',
    examSystems: ['General appearance', 'Udder (dairy)', 'Rumen (ruminants)', 'Cardiovascular', 'Respiratory'],
  },
];

/** Demo data for scheduling and clinical records (Milestone 3). */
export async function seedModules(prisma: PrismaClient, s: SeededOrg) {
  const orgId = s.org.id;
  const pk = s.org.country === 'PK';
  const branch = s.branches[0];
  const tz = branch.timezone;

  // Appointment types
  const typeDefs = [
    { name: 'Consultation', category: 'CONSULTATION', durationMinutes: 20, color: '#0d7a70', price: pk ? 200000 : 9500 },
    { name: 'Vaccination', category: 'VACCINATION', durationMinutes: 15, color: '#2563eb', price: pk ? 150000 : 7000 },
    { name: 'Follow-up', category: 'FOLLOW_UP', durationMinutes: 15, color: '#7c3aed', price: pk ? 100000 : 5500 },
    { name: 'Surgical admission', category: 'SURGERY', durationMinutes: 30, color: '#b45309', price: null },
    { name: 'Emergency', category: 'EMERGENCY', durationMinutes: 30, color: '#dc2626', price: pk ? 400000 : 18000 },
    { name: 'Farm visit', category: 'FIELD_VISIT', durationMinutes: 60, color: '#65a30d', price: pk ? 500000 : 25000 },
    { name: 'Grooming', category: 'GROOMING', durationMinutes: 45, color: '#db2777', price: pk ? 250000 : 8000, requiresClinician: false },
  ] as const;
  const types: Record<string, { id: string; durationMinutes: number }> = {};
  for (const t of typeDefs) {
    const row = await prisma.appointmentType.create({
      data: {
        organizationId: orgId,
        name: t.name,
        category: t.category,
        durationMinutes: t.durationMinutes,
        color: t.color,
        priceMinor: t.price,
        requiresClinician: 'requiresClinician' in t ? t.requiresClinician : true,
        allowOnlineBooking: ['Consultation', 'Vaccination', 'Grooming'].includes(t.name),
      },
    });
    types[t.name] = row;
  }

  // Rooms
  for (const b of s.branches) {
    for (const [name, type] of [
      ['Consult room 1', 'ROOM'],
      ['Consult room 2', 'ROOM'],
      ['Theatre', 'THEATRE'],
      ['X-ray', 'EQUIPMENT'],
    ] as const) {
      await prisma.resource.create({ data: { organizationId: orgId, branchId: b.id, name, type } });
    }
  }

  // Templates
  for (const t of TEMPLATES) await prisma.clinicalTemplate.create({ data: { organizationId: orgId, ...t } });

  // Clinician rosters: PK Mon–Sat 09:00–17:00 with Friday prayer break; AU Mon–Fri 08:00–18:00, Sat 09:00–13:00.
  const clinicians = await prisma.membership.findMany({ where: { organizationId: orgId, isClinician: true, status: 'ACTIVE' }, include: { user: true } });
  for (const c of clinicians) {
    const slots: { dayOfWeek: number; startMinute: number; endMinute: number }[] = [];
    if (pk) {
      for (const d of [1, 2, 3, 4, 6]) slots.push({ dayOfWeek: d, startMinute: 540, endMinute: 1020 });
      slots.push({ dayOfWeek: 5, startMinute: 540, endMinute: 780 }, { dayOfWeek: 5, startMinute: 870, endMinute: 1020 });
      slots.push({ dayOfWeek: 0, startMinute: 600, endMinute: 840 }); // Sunday emergency cover
    } else {
      for (const d of [1, 2, 3, 4, 5]) slots.push({ dayOfWeek: d, startMinute: 480, endMinute: 1080 });
      slots.push({ dayOfWeek: 6, startMinute: 540, endMinute: 780 });
    }
    await prisma.workingHours.createMany({ data: slots.map((x) => ({ ...x, organizationId: orgId, membershipId: c.id, branchId: branch.id })) });
  }

  const companion = s.patients.filter((p) => ['Dog', 'Cat', 'Rabbit', 'Companion bird'].includes(p.species));
  const vets = clinicians.filter((c) => !c.jobTitle?.includes('Owner') && !c.jobTitle?.includes('Principal'));
  const vetPool = vets.length ? vets : clinicians;
  if (!vetPool.length || !companion.length) return;

  // Today's schedule (branch-local) in a mix of states
  const today = localParts(new Date(), tz).date;
  const nowMin = localParts(new Date(), tz).minuteOfDay;
  const plan = [
    { min: 9 * 60, type: 'Consultation', reason: 'Itchy skin, scratching ears' },
    { min: 9 * 60 + 30, type: 'Vaccination', reason: 'Annual booster' },
    { min: 10 * 60, type: 'Follow-up', reason: 'Recheck after gastroenteritis' },
    { min: 11 * 60, type: 'Consultation', reason: 'Reduced appetite' },
    { min: 12 * 60, type: 'Consultation', reason: 'Lump on flank' },
    { min: 14 * 60 + 30, type: 'Vaccination', reason: 'Puppy vaccination' },
    { min: 15 * 60 + 30, type: 'Consultation', reason: 'Limping right hind' },
    { min: 16 * 60, type: 'Follow-up', reason: 'Wound check' },
  ];
  const ownerOf = async (patientId: string) =>
    (await prisma.patientOwnership.findFirst({ where: { patientId, endedAt: null, isPrimary: true } }))!.clientId;

  for (let i = 0; i < plan.length; i++) {
    const p = companion[i % companion.length];
    const vet = vetPool[i % vetPool.length];
    const startsAt = zonedToUtc(today, plan[i].min, tz);
    const t = types[plan[i].type];
    const endsAt = new Date(startsAt.getTime() + t.durationMinutes * 60_000);
    const past = plan[i].min + t.durationMinutes < nowMin;
    const current = plan[i].min <= nowMin && !past;
    const status = past ? (i === 2 ? 'NO_SHOW' : 'COMPLETED') : current ? 'CHECKED_IN' : i % 3 === 0 ? 'CONFIRMED' : 'BOOKED';
    const clientId = await ownerOf(p.id);
    const appt = await prisma.appointment.create({
      data: {
        organizationId: orgId,
        branchId: branch.id,
        number: await next(prisma, orgId, 'appointment'),
        clientId,
        patientId: p.id,
        appointmentTypeId: t.id,
        clinicianId: vet.id,
        startsAt,
        endsAt,
        status,
        reason: plan[i].reason,
        notes: 'Demo appointment',
        checkedInAt: status === 'CHECKED_IN' || status === 'COMPLETED' ? new Date(startsAt.getTime() - 5 * 60_000) : null,
        completedAt: status === 'COMPLETED' ? endsAt : null,
      },
    });
    if (status === 'COMPLETED') await seedEncounter(prisma, s, { patientId: p.id, clientId, vet, at: startsAt, appointmentId: appt.id, complaint: plan[i].reason, completed: true });
  }

  // Historical consultations (signed) for timelines
  for (let i = 0; i < Math.min(6, companion.length); i++) {
    const p = companion[i];
    const vet = vetPool[i % vetPool.length];
    const at = new Date(Date.now() - (30 + i * 23) * 86400_000);
    await seedEncounter(prisma, s, { patientId: p.id, clientId: await ownerOf(p.id), vet, at, complaint: ['Annual health check', 'Vomiting', 'Ear infection', 'Skin rash', 'Lameness', 'Coughing'][i], completed: true });
  }

  await seedPharmacyLab(prisma, s, vetPool, companion, ownerOf);

  // Follow-up tasks
  const { start } = localDayBounds(new Date(), tz);
  for (let i = 0; i < 3; i++) {
    const p = companion[i];
    await prisma.task.create({
      data: {
        organizationId: orgId,
        branchId: branch.id,
        type: i === 0 ? 'RESULT_REVIEW' : 'FOLLOW_UP_CALL',
        title: ['Review blood results and call owner', 'Check on post-operative recovery', 'Confirm medication tolerance'][i],
        dueAt: new Date(start.getTime() + (i - 1) * 86400_000 + 10 * 3600_000),
        patientId: p.id,
        assigneeId: vetPool[i % vetPool.length].id,
        createdByName: 'Demo seed',
      },
    });
  }
}

const SOAPS: Record<string, { s: string; o: string; a: string; p: string; dx: string }> = {
  default: { s: 'Owner reports the animal is otherwise bright and eating.', o: 'BAR, well hydrated. No significant abnormalities on examination.', a: 'Healthy on examination.', p: 'Continue current preventive care.', dx: 'Clinically normal' },
  Vomiting: { s: 'Vomited three times over 24 h after eating rubbish. Still drinking.', o: 'Mildly dehydrated (~5%). Abdomen soft, mild discomfort cranially.', a: 'Acute gastritis, likely dietary indiscretion.', p: 'Bland diet 3 days, fluids as per clinician. Return if persists.', dx: 'Acute gastritis' },
  'Ear infection': { s: 'Head shaking and scratching left ear for one week.', o: 'Left ear canal erythematous with brown discharge. Right ear normal.', a: 'Otitis externa, left.', p: 'Ear cleaning demonstrated; topical treatment per clinician. Recheck 10 days.', dx: 'Otitis externa' },
  'Skin rash': { s: 'Itchy for 2 weeks, worse at night.', o: 'Papules and alopecia over dorsum, flea dirt present.', a: 'Flea allergy dermatitis suspected.', p: 'Parasite control for all in-contact animals. Recheck 3 weeks.', dx: 'Flea allergy dermatitis' },
  Lameness: { s: 'Lame on right hind after playing in park.', o: 'Grade 2/5 lameness RH, pain on stifle extension, no drawer detected.', a: 'Soft tissue injury RH stifle; cruciate disease not excluded.', p: 'Strict rest 2 weeks, analgesia per clinician, radiographs if not improving.', dx: 'Right hind lameness — soft tissue injury' },
  Coughing: { s: 'Dry honking cough for 4 days after boarding.', o: 'Cough elicited on tracheal palpation, chest auscultation clear, afebrile.', a: 'Infectious tracheobronchitis.', p: 'Rest, avoid collar pressure, monitor appetite and breathing.', dx: 'Infectious tracheobronchitis' },
};

async function seedEncounter(
  prisma: PrismaClient,
  s: SeededOrg,
  e: { patientId: string; clientId: string; vet: { id: string; userId: string; user: { name: string } }; at: Date; appointmentId?: string; complaint: string; completed: boolean },
) {
  const orgId = s.org.id;
  const soap = SOAPS[e.complaint] ?? SOAPS.default;
  const enc = await prisma.encounter.create({
    data: {
      organizationId: orgId,
      branchId: s.branches[0].id,
      number: await next(prisma, orgId, 'encounter'),
      patientId: e.patientId,
      clientId: e.clientId,
      appointmentId: e.appointmentId ?? null,
      clinicianId: e.vet.id,
      chiefComplaint: e.complaint,
      status: e.completed ? 'COMPLETED' : 'OPEN',
      startedAt: e.at,
      completedAt: e.completed ? new Date(e.at.getTime() + 20 * 60_000) : null,
    },
  });
  const signedAt = new Date(e.at.getTime() + 25 * 60_000);
  const content = {
    presentingComplaint: e.complaint,
    history: null,
    subjective: soap.s,
    objective: soap.o,
    assessment: soap.a,
    plan: soap.p,
    followUpInstructions: null,
    examFindings: null,
  };
  // Same canonical form as NotesService.noteContentHash so integrity checks pass.
  const contentHash = createHash('sha256')
    .update(JSON.stringify({ ...content, signedById: e.vet.userId, signedAt: signedAt.toISOString() }))
    .digest('hex');
  await prisma.clinicalNote.create({
    data: {
      organizationId: orgId,
      encounterId: enc.id,
      patientId: e.patientId,
      ...content,
      examFindings: undefined,
      status: 'SIGNED',
      authorId: e.vet.userId,
      authorName: e.vet.user.name,
      signedById: e.vet.userId,
      signedByName: e.vet.user.name,
      signedAt,
      contentHash,
      createdAt: e.at,
    },
  });
  await prisma.diagnosis.create({
    data: { organizationId: orgId, encounterId: enc.id, patientId: e.patientId, term: soap.dx, type: 'PROVISIONAL', diagnosedById: e.vet.userId, diagnosedByName: e.vet.user.name, createdAt: e.at },
  });
  await prisma.vitalSign.create({
    data: {
      organizationId: orgId,
      patientId: e.patientId,
      encounterId: enc.id,
      recordedAt: new Date(e.at.getTime() + 5 * 60_000),
      temperatureC: 38.6,
      heartRate: 96,
      respiratoryRate: 24,
      painScore: e.complaint === 'Lameness' ? 4 : 1,
      recordedByName: e.vet.user.name,
    },
  });
}

/**
 * Formulary and laboratory demo catalogue. Product strengths describe the presentation only.
 * NO dose references, withdrawal periods or reference intervals are seeded — these are clinical
 * content that each clinic must enter from its own validated sources.
 */
async function seedPharmacyLab(
  prisma: PrismaClient,
  s: SeededOrg,
  vets: { id: string; userId: string; user: { name: string } }[],
  companion: { id: string }[],
  ownerOf: (patientId: string) => Promise<string>,
) {
  const orgId = s.org.id;
  const pk = s.org.country === 'PK';
  const P = (name: string, d: Partial<Record<string, unknown>>) => ({ organizationId: orgId, name, ...d });
  // Shop shelf categories come from the organization's starter set (OrgBootstrapService).
  const shelf = Object.fromEntries((await prisma.productCategory.findMany({ where: { organizationId: orgId } })).map((c) => [c.name, c.id]));
  const S = (name: string, type: string, category: string, d: Partial<Record<string, unknown>>) =>
    P(name, { type, categoryId: shelf[category] ?? null, minDispenseIncrement: 1, requiresPrescription: false, ...d });
  const products = [
    P('Amoxicillin 250 mg tablets', { genericName: 'Amoxicillin', form: 'TABLET', strengthValue: 250, strengthUnit: 'mg', dispensingUnit: 'tablet', minDispenseIncrement: 0.5, activeIngredients: ['amoxicillin'], sellPriceMinor: pk ? 4000 : 120, sku: 'AMX250' }),
    P('Meloxicam 1.5 mg/mL oral suspension', { genericName: 'Meloxicam', form: 'ORAL_LIQUID', strengthValue: 1.5, strengthUnit: 'mg', dispensingUnit: 'mL', minDispenseIncrement: 0.1, activeIngredients: ['meloxicam'], sellPriceMinor: pk ? 3000 : 90, sku: 'MLX15', targetSpecies: ['COMPANION'] }),
    P('Metronidazole 200 mg tablets', { genericName: 'Metronidazole', form: 'TABLET', strengthValue: 200, strengthUnit: 'mg', dispensingUnit: 'tablet', minDispenseIncrement: 0.5, activeIngredients: ['metronidazole'], sellPriceMinor: pk ? 2500 : 80, sku: 'MTZ200' }),
    P('Ivermectin 10 mg/mL injection', { genericName: 'Ivermectin', form: 'INJECTION', strengthValue: 10, strengthUnit: 'mg', dispensingUnit: 'mL', minDispenseIncrement: 0.1, activeIngredients: ['ivermectin'], sellPriceMinor: pk ? 1500 : 60, sku: 'IVM10', targetSpecies: ['LIVESTOCK'] }),
    P('Oxytetracycline 200 mg/mL injection', { genericName: 'Oxytetracycline', form: 'INJECTION', strengthValue: 200, strengthUnit: 'mg', dispensingUnit: 'mL', minDispenseIncrement: 0.5, activeIngredients: ['oxytetracycline'], sellPriceMinor: pk ? 1200 : 50, sku: 'OTC200', targetSpecies: ['LIVESTOCK'] }),
    P('Ketamine 100 mg/mL injection', { genericName: 'Ketamine', form: 'INJECTION', strengthValue: 100, strengthUnit: 'mg', dispensingUnit: 'mL', minDispenseIncrement: 0.05, activeIngredients: ['ketamine'], isControlled: true, controlledSchedule: pk ? 'Controlled' : 'S8', sku: 'KET100' }),
    P('Rabies vaccine (inactivated)', { type: 'VACCINE', form: 'INJECTION', dispensingUnit: 'dose', minDispenseIncrement: 1, sellPriceMinor: pk ? 150000 : 4500, sku: 'VAC-RAB' }),
    P('Canine DHPPi vaccine', { type: 'VACCINE', form: 'INJECTION', dispensingUnit: 'dose', minDispenseIncrement: 1, sellPriceMinor: pk ? 180000 : 6500, sku: 'VAC-DHP', targetSpecies: ['COMPANION'] }),
    P('Sterile syringe 3 mL', { type: 'CONSUMABLE', dispensingUnit: 'unit', minDispenseIncrement: 1, requiresPrescription: false, sellPriceMinor: pk ? 3000 : 50, sku: 'SYR3' }),
    S('Elizabethan collar (medium)', 'ACCESSORY', 'Clothing & recovery wear', { dispensingUnit: 'unit', packSize: 'Medium', sellPriceMinor: pk ? 90000 : 1800, sku: 'ECOL-M' }),
    // Demo shop items (brands are labelled “Demo”).
    S('Adult dog food, chicken & rice', 'FOOD', 'Dry food', { brand: 'Demo Paws', packSize: '3 kg bag', dispensingUnit: 'bag', sellPriceMinor: pk ? 450000 : 3500, sku: 'FD-DOG3', barcode: '2000000000017', targetSpecies: ['COMPANION'] }),
    S('Cat food, salmon in gravy', 'FOOD', 'Wet food', { brand: 'Demo Whiskers', packSize: '85 g pouch', dispensingUnit: 'pouch', sellPriceMinor: pk ? 25000 : 180, sku: 'FD-CAT85', barcode: '2000000000024', targetSpecies: ['COMPANION'] }),
    S('Dental chew sticks', 'FOOD', 'Treats & chews', { brand: 'Demo Paws', packSize: '7 sticks', dispensingUnit: 'pack', sellPriceMinor: pk ? 120000 : 1200, sku: 'TR-DENT7' }),
    S('Oatmeal dog shampoo', 'GROOMING', 'Shampoos & conditioners', { brand: 'Demo Groom', packSize: '250 mL bottle', dispensingUnit: 'bottle', sellPriceMinor: pk ? 90000 : 1600, sku: 'GR-SHMP250' }),
    S('Slicker brush', 'GROOMING', 'Brushes, combs & clippers', { brand: 'Demo Groom', packSize: 'Medium', dispensingUnit: 'piece', sellPriceMinor: pk ? 70000 : 1400, sku: 'GR-BRUSH' }),
    S('Nylon dog collar', 'ACCESSORY', 'Collars, leads & harnesses', { brand: 'Demo Paws', packSize: 'Medium, 35–50 cm', dispensingUnit: 'piece', sellPriceMinor: pk ? 60000 : 1200, sku: 'AC-COLLAR-M' }),
    S('Rubber chew toy', 'ACCESSORY', 'Toys', { brand: 'Demo Paws', packSize: 'Large', dispensingUnit: 'piece', sellPriceMinor: pk ? 50000 : 900, sku: 'AC-TOY-L' }),
    S('Joint support chews', 'SUPPLEMENT', 'Vitamins & supplements', { brand: 'Demo Vet Nutrition', packSize: '60 chews', dispensingUnit: 'pack', sellPriceMinor: pk ? 350000 : 3200, sku: 'SP-JOINT60' }),
  ];
  const created: Record<string, string> = {};
  for (const p of products) created[(p as any).sku] = (await prisma.product.create({ data: p as any })).id;

  const T = (code: string, name: string, category: string, sampleType: string, analytes: [string, string, string | null, string?, string[]?][], extra: Record<string, unknown> = {}) => ({ code, name, category, sampleType, analytes, extra });
  const tests = [
    T('CBC', 'Complete blood count', 'HAEMATOLOGY', 'WHOLE_BLOOD_EDTA', [['HCT', 'Haematocrit', '%'], ['HGB', 'Haemoglobin', 'g/L'], ['RBC', 'Red blood cells', '×10¹²/L'], ['WBC', 'White blood cells', '×10⁹/L'], ['NEU', 'Neutrophils', '×10⁹/L'], ['LYM', 'Lymphocytes', '×10⁹/L'], ['PLT', 'Platelets', '×10⁹/L']], { priceMinor: pk ? 250000 : 9000, turnaroundHours: 2 }),
    T('BIOCH', 'Biochemistry panel', 'BIOCHEMISTRY', 'SERUM', [['ALT', 'ALT', 'U/L'], ['ALP', 'ALP', 'U/L'], ['UREA', 'Urea', 'mmol/L'], ['CREA', 'Creatinine', 'µmol/L'], ['GLU', 'Glucose', 'mmol/L'], ['TP', 'Total protein', 'g/L'], ['ALB', 'Albumin', 'g/L']], { priceMinor: pk ? 400000 : 14000, turnaroundHours: 3 }),
    T('UA', 'Urinalysis', 'URINALYSIS', 'URINE', [['USG', 'Specific gravity', null, 'NUMERIC'], ['PH', 'pH', null, 'NUMERIC'], ['PRO', 'Protein (dipstick)', null, 'OPTION', ['Negative', 'Trace', '1+', '2+', '3+']], ['BLD', 'Blood (dipstick)', null, 'OPTION', ['Negative', 'Trace', '1+', '2+', '3+']], ['SED', 'Sediment', null, 'TEXT']], { priceMinor: pk ? 120000 : 6000 }),
    T('FFLOT', 'Faecal flotation', 'PARASITOLOGY', 'FAECES', [['RES', 'Result', null, 'OPTION', ['No parasites seen', 'Parasite ova seen']], ['ID', 'Organisms identified', null, 'TEXT']], { priceMinor: pk ? 80000 : 4500 }),
    T('MILKCULT', 'Milk culture & sensitivity', 'MICROBIOLOGY', 'MILK', [['ORG', 'Organism(s)', null, 'TEXT'], ['SENS', 'Sensitivity', null, 'TEXT']], { performedBy: 'EXTERNAL', externalLabName: pk ? 'Provincial Veterinary Diagnostic Lab' : 'State Veterinary Laboratory', turnaroundHours: 72 }),
    T('XR-THX', 'Thoracic radiographs', 'IMAGING', 'NONE', [], { modality: 'XRAY', priceMinor: pk ? 350000 : 22000 }),
    T('US-ABD', 'Abdominal ultrasound', 'IMAGING', 'NONE', [], { modality: 'ULTRASOUND', priceMinor: pk ? 500000 : 35000 }),
  ];
  const testIds: Record<string, { id: string; analytes: { id: string; code: string }[] }> = {};
  for (const t of tests) {
    const row = await prisma.labTest.create({ data: { organizationId: orgId, code: t.code, name: t.name, category: t.category as any, sampleType: t.sampleType as any, ...(t.extra as any) } });
    const analytes = [];
    for (const [i, [code, name, unit, type, options]] of t.analytes.entries()) {
      analytes.push(await prisma.labAnalyte.create({ data: { organizationId: orgId, testId: row.id, code, name, unit, resultType: (type ?? 'NUMERIC') as any, options: options ?? [], decimals: code === 'USG' ? 3 : 1, sortOrder: i } }));
    }
    testIds[t.code] = { id: row.id, analytes };
  }

  if (!vets.length || companion.length < 3) return;
  const vet = vets[0];
  const next = async (key: string) => {
    const r = await prisma.$queryRaw<{ value: number }[]>`INSERT INTO "Counter" ("organizationId","key","value") VALUES (${orgId}::uuid, ${key}, 1) ON CONFLICT ("organizationId","key") DO UPDATE SET "value" = "Counter"."value" + 1 RETURNING "value"`;
    return Number(r[0].value);
  };
  // Demo prescriptions (illustrative records only — not dosing guidance)
  for (const [i, status] of (['DRAFT', 'AUTHORIZED'] as const).entries()) {
    const patientId = companion[i].id;
    const rx = await prisma.prescription.create({
      data: {
        organizationId: orgId,
        branchId: s.branches[0].id,
        number: await next('prescription'),
        patientId,
        clientId: await ownerOf(patientId),
        prescriberId: vet.id,
        status: 'DRAFT',
        notes: 'DEMO DATA — illustrative record only, not dosing guidance.',
        createdById: vet.userId,
        createdByName: vet.user.name,
      },
    });
    await prisma.prescriptionItem.create({
      data: {
        organizationId: orgId,
        prescriptionId: rx.id,
        productId: created[i === 0 ? 'MTZ200' : 'AMX250'],
        route: 'PO',
        doseValue: 1,
        doseUnit: 'tablet',
        amountPerDose: 1,
        frequencyPerDay: 2,
        frequencyText: 'Twice daily (BID)',
        durationDays: 5,
        quantity: 10,
        instructions: 'Give one tablet by mouth twice daily with food for 5 days. (Demo)',
        warnings: [{ code: 'NO_REFERENCE', message: 'No approved dose reference configured (demo).', blocking: false }],
      },
    });
    if (status === 'AUTHORIZED') {
      // Same canonical form as PrescriptionsService.hash so the integrity check passes.
      const items = await prisma.prescriptionItem.findMany({ where: { prescriptionId: rx.id } });
      const at = new Date();
      const contentHash = createHash('sha256')
        .update(
          JSON.stringify({
            items: [...items].sort((a, b) => a.id.localeCompare(b.id)).map((x) => [x.productId, String(x.doseValue), x.doseUnit, String(x.amountPerDose), x.route, x.frequencyText, String(x.quantity), x.instructions, x.repeats]),
            at: at.toISOString(),
            by: vet.userId,
          }),
        )
        .digest('hex');
      await prisma.prescription.update({ where: { id: rx.id }, data: { status: 'AUTHORIZED', authorizedById: vet.userId, authorizedByName: vet.user.name, authorizedAt: at, contentHash } });
    }
  }
  // Demo lab orders: one awaiting collection, one awaiting validation
  for (const [i, status] of (['ORDERED', 'AWAITING_VALIDATION'] as const).entries()) {
    const patientId = companion[i + 2]?.id ?? companion[0].id;
    const o = await prisma.diagnosticOrder.create({
      data: {
        organizationId: orgId,
        branchId: s.branches[0].id,
        number: await next('lab_order'),
        patientId,
        clientId: await ownerOf(patientId),
        status,
        priority: i === 0 ? 'URGENT' : 'ROUTINE',
        clinicalNotes: i === 0 ? 'Lethargic, reduced appetite (demo)' : 'Pre-anaesthetic screen (demo)',
        orderedById: vet.userId,
        orderedByName: vet.user.name,
        orderingMembershipId: vet.id,
      },
    });
    const test = testIds[i === 0 ? 'CBC' : 'UA'];
    const item = await prisma.diagnosticOrderItem.create({ data: { organizationId: orgId, orderId: o.id, testId: test.id, status: status === 'AWAITING_VALIDATION' ? 'RESULTED' : 'PENDING' } });
    if (status === 'AWAITING_VALIDATION') {
      const sample = await prisma.sample.create({ data: { organizationId: orgId, orderId: o.id, barcode: `S${String(await next('sample')).padStart(8, '0')}`, sampleType: 'URINE', status: 'IN_ANALYSIS', collectedById: vet.userId, collectedByName: vet.user.name } });
      await prisma.sampleEvent.create({ data: { organizationId: orgId, sampleId: sample.id, action: 'COLLECTED', byId: vet.userId, byName: vet.user.name } });
      const vals: Record<string, [number | null, string | null]> = { USG: [1.032, null], PH: [6.5, null], PRO: [null, 'Trace'], BLD: [null, 'Negative'], SED: [null, 'Unremarkable (demo)'] };
      for (const a of test.analytes) {
        const [n, t] = vals[a.code];
        await prisma.labResult.create({ data: { organizationId: orgId, orderItemId: item.id, analyteId: a.id, valueNumeric: n, valueText: t, enteredById: vet.userId, enteredByName: vet.user.name } });
      }
    }
  }
}
