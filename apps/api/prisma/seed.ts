/**
 * DEMONSTRATION DATA ONLY.
 * Creates two clearly labelled demo organizations with staff for every system role,
 * clients and patients. Never run against a production database.
 *
 *   npm run db:seed            # create demo data if missing
 *   npm run db:seed -- --reset # delete existing demo organizations first (dev only)
 */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { OrgBootstrapService } from '../src/modules/organizations/org-bootstrap.service';
import { seedFinance } from './seed-finance';
import { seedHospital } from './seed-hospital';
import { seedComms } from './seed-comms';
import { seedServices } from './seed-services';
import { seedModules } from './seed-modules';
import { seedForecast } from './seed-forecast';

const prisma = new PrismaClient();
export const DEMO_PASSWORD = 'DemoVet2026!';
const DEMO_TAG = '(Demo)';

const PK_STAFF = [
  ['owner', 'Dr. Imran Qadir', 'owner@demo.pk', 'Owner & Medical Director', true],
  ['practice_manager', 'Sana Malik', 'manager@demo.pk', 'Practice Manager', false],
  ['veterinarian', 'Dr. Ayesha Raza', 'vet@demo.pk', 'Veterinary Surgeon', true],
  ['veterinarian', 'Dr. Hamza Butt', 'vet2@demo.pk', 'Veterinary Surgeon', true],
  ['nurse', 'Nadia Iqbal', 'nurse@demo.pk', 'Senior Veterinary Nurse', false],
  ['receptionist', 'Usman Tariq', 'reception@demo.pk', 'Receptionist', false],
  ['lab_technician', 'Kashif Mehmood', 'lab@demo.pk', 'Laboratory Technician', false],
  ['pharmacy', 'Rabia Anwar', 'pharmacy@demo.pk', 'Dispensary In-charge', false],
  ['surgeon', 'Dr. Farhan Saeed', 'surgeon@demo.pk', 'Surgeon / Anaesthetist', true],
  ['ward_staff', 'Bilal Ahmed', 'ward@demo.pk', 'Ward Attendant', false],
  ['inventory_officer', 'Zeeshan Ali', 'inventory@demo.pk', 'Store Officer', false],
  ['accountant', 'Mariam Javed', 'accounts@demo.pk', 'Accountant', false],
  ['field_vet', 'Dr. Asad Khan', 'farmvet@demo.pk', 'Field Veterinarian (Livestock)', true],
] as const;

const AU_STAFF = [
  ['owner', 'Dr. Emma Collins', 'owner@demo.au', 'Practice Principal', true],
  ['veterinarian', 'Dr. Liam Nguyen', 'vet@demo.au', 'Veterinarian', true],
  ['nurse', 'Chloe Martin', 'nurse@demo.au', 'Veterinary Nurse', false],
  ['receptionist', 'Jack Wilson', 'reception@demo.au', 'Client Care', false],
] as const;

const PK_CLIENTS: { first: string; last: string; phone: string; email?: string; city: string; type?: string; org?: string; pets: [string, string, string, string?][] }[] = [
  { first: 'Ahmed', last: 'Khan', phone: '0300 1234567', email: 'ahmed.khan@example.pk', city: 'Lahore', pets: [['Sheru', 'Dog', 'German Shepherd', 'MALE'], ['Billo', 'Cat', 'Persian', 'FEMALE_SPAYED']] },
  { first: 'Fatima', last: 'Siddiqui', phone: '0321 4567890', email: 'fatima.s@example.pk', city: 'Lahore', pets: [['Coco', 'Cat', 'Siamese', 'FEMALE']] },
  { first: 'Usman', last: 'Chaudhry', phone: '0333 7654321', city: 'Lahore', pets: [['Tiger', 'Dog', 'Labrador Retriever', 'MALE_NEUTERED'], ['Mithu', 'Companion bird', 'African Grey Parrot', 'UNKNOWN']] },
  { first: 'Zainab', last: 'Hussain', phone: '0345 2223344', email: 'zainab.h@example.pk', city: 'Islamabad', pets: [['Snowy', 'Rabbit', 'Angora', 'FEMALE']] },
  { first: 'Hassan', last: 'Raza', phone: '0301 9988776', city: 'Islamabad', pets: [['Rocky', 'Dog', 'Rottweiler', 'MALE'], ['Luna', 'Cat', 'Domestic Shorthair', 'FEMALE_SPAYED']] },
  { first: 'Maryam', last: 'Ali', phone: '0312 5566778', email: 'maryam.ali@example.pk', city: 'Lahore', pets: [['Simba', 'Cat', 'Maine Coon', 'MALE_NEUTERED']] },
  { first: 'Bilal', last: 'Ahmad', phone: '0302 1112223', city: 'Rawalpindi', pets: [['Moti', 'Dog', 'Bully Kutta', 'MALE']] },
  { first: 'Sara', last: 'Sheikh', phone: '0335 4445556', email: 'sara.sheikh@example.pk', city: 'Lahore', pets: [['Kitty', 'Cat', 'Persian', 'FEMALE'], ['Oreo', 'Cat', 'British Shorthair', 'MALE']] },
  { first: 'Muhammad', last: 'Aslam', phone: '0300 6667778', city: 'Sheikhupura', type: 'FARM', org: 'Aslam Dairy Farm', pets: [['Rani', 'Buffalo', 'Nili-Ravi', 'FEMALE'], ['Gori', 'Cattle', 'Sahiwal', 'FEMALE'], ['Kali', 'Buffalo', 'Nili-Ravi', 'FEMALE']] },
  { first: 'Tariq', last: 'Mehmood', phone: '0346 8889990', city: 'Kasur', type: 'FARM', org: 'Mehmood Goat Farm', pets: [['Raja', 'Goat', 'Beetal', 'MALE'], ['Chandni', 'Goat', 'Beetal', 'FEMALE']] },
  { first: 'Hina', last: 'Farooq', phone: '0322 1231231', email: 'hina.f@example.pk', city: 'Islamabad', pets: [['Max', 'Dog', 'Golden Retriever', 'MALE_NEUTERED']] },
  { first: 'Kamran', last: 'Akmal', phone: '0331 3213213', city: 'Lahore', pets: [['Toto', 'Dog', 'Shih Tzu', 'MALE']] },
];

const AU_CLIENTS: typeof PK_CLIENTS = [
  { first: 'Olivia', last: 'Smith', phone: '0412 345 678', email: 'olivia.smith@example.com.au', city: 'Sydney', pets: [['Bella', 'Dog', 'Australian Cattle Dog', 'FEMALE_SPAYED']] },
  { first: 'James', last: 'Brown', phone: '0423 456 789', email: 'james.brown@example.com.au', city: 'Sydney', pets: [['Milo', 'Cat', 'Ragdoll', 'MALE_NEUTERED'], ['Charlie', 'Dog', 'Border Collie', 'MALE']] },
  { first: 'Sophie', last: 'Taylor', phone: '0434 567 890', city: 'Parramatta', pets: [['Ruby', 'Dog', 'Australian Kelpie', 'FEMALE']] },
  { first: 'Tom', last: 'Anderson', phone: '0445 678 901', city: 'Dubbo', type: 'FARM', org: 'Anderson Pastoral Co.', pets: [['Daisy', 'Cattle', 'Angus', 'FEMALE'], ['Ned', 'Horse', 'Australian Stock Horse', 'MALE_NEUTERED']] },
];

function digitsKey(p: string) {
  return p.replace(/\D/g, '').slice(-10);
}

async function nextNumber(orgId: string, key: string) {
  const rows = await prisma.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("organizationId","key","value") VALUES (${orgId}::uuid, ${key}, 1)
    ON CONFLICT ("organizationId","key") DO UPDATE SET "value" = "Counter"."value" + 1 RETURNING "value"`;
  return Number(rows[0].value);
}

async function seedOrg(opts: {
  name: string;
  country: 'PK' | 'AU';
  branchName: string;
  extraBranch?: { name: string; code: string };
  staff: readonly (readonly [string, string, string, string, boolean])[];
  clients: typeof PK_CLIENTS;
}) {
  const passwordHash = await hash(DEMO_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const [ownerKey, ownerName, ownerEmail, ownerTitle] = opts.staff[0];
  if (ownerKey !== 'owner') throw new Error('first staff member must be the owner');

  const owner = await prisma.user.create({ data: { email: ownerEmail, name: ownerName, passwordHash, passwordChangedAt: new Date() } });
  const { org, branch, membership, roleIds } = await prisma.$transaction(
    (tx) => new OrgBootstrapService().create(tx, { name: opts.name, country: opts.country, branchName: opts.branchName, ownerUserId: owner.id }),
    { timeout: 60_000 },
  );
  await prisma.membership.update({ where: { id: membership.id }, data: { jobTitle: ownerTitle, isClinician: true } });
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      legalName: opts.name.replace(` ${DEMO_TAG}`, ''),
      email: opts.country === 'PK' ? 'info@demo.pk' : 'hello@demo.au',
      phone: opts.country === 'PK' ? '042 35761234' : '02 9876 5432',
      city: opts.country === 'PK' ? 'Lahore' : 'Sydney',
      addressLine1: opts.country === 'PK' ? '45-B Gulberg III' : '12 Harbour Street',
    },
  });

  const branches = [branch];
  if (opts.extraBranch) {
    const b = await prisma.branch.create({
      data: { organizationId: org.id, name: opts.extraBranch.name, code: opts.extraBranch.code, timezone: branch.timezone },
    });
    branches.push(b);
    await prisma.membershipBranch.create({ data: { membershipId: membership.id, branchId: b.id } });
  }

  const staffIds: Record<string, string> = { [ownerEmail]: owner.id };
  for (const [roleKey, name, email, jobTitle, isClinician] of opts.staff.slice(1)) {
    const u = await prisma.user.create({ data: { email, name, passwordHash, passwordChangedAt: new Date() } });
    staffIds[email] = u.id;
    await prisma.membership.create({
      data: {
        organizationId: org.id,
        userId: u.id,
        status: 'ACTIVE',
        jobTitle,
        isClinician,
        joinedAt: new Date(),
        roles: { create: [{ roleId: roleIds[roleKey] }] },
        branches: { create: branches.map((b) => ({ branchId: b.id })) },
      },
    });
  }

  const species = await prisma.species.findMany({ where: { organizationId: org.id }, include: { breeds: true } });
  const patients: { id: string; species: string; clientId: string }[] = [];
  let i = 0;
  for (const c of opts.clients) {
    const number = await nextNumber(org.id, 'client');
    const isFarm = c.type === 'FARM';
    const client = await prisma.client.create({
      data: {
        organizationId: org.id,
        number,
        type: (c.type as any) ?? 'INDIVIDUAL',
        firstName: c.first,
        lastName: c.last,
        organizationName: c.org,
        displayName: isFarm && c.org ? c.org : [c.first, c.last].filter(Boolean).join(' '),
        email: c.email,
        mobilePhone: c.phone,
        phoneDigits: digitsKey(c.phone),
        preferredChannel: opts.country === 'PK' ? 'WHATSAPP' : 'SMS',
        remindersConsent: true,
        consentUpdatedAt: new Date(),
        primaryBranchId: branches[i % branches.length].id,
        notes: 'Demo data — not a real person.',
        createdById: owner.id,
        addresses: {
          create: [{ organizationId: org.id, line1: `${10 + i} Demo Street`, city: c.city, country: opts.country, isPrimary: true }],
        },
      },
    });
    for (const [name, speciesName, breedName, sex] of c.pets) {
      const s = species.find((x) => x.name === speciesName)!;
      const b = s.breeds.find((x) => x.name === breedName);
      const pn = await nextNumber(org.id, 'patient');
      const ageYears = 1 + ((i * 7 + pn) % 11);
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - ageYears, (pn * 3) % 12, 1 + (pn % 27));
      const weight = speciesName === 'Dog' ? 8 + ((pn * 37) % 30) : speciesName === 'Cat' ? 3 + ((pn * 13) % 4) : speciesName === 'Buffalo' ? 480 + pn : speciesName === 'Cattle' ? 420 + pn : speciesName === 'Goat' ? 35 + (pn % 15) : speciesName === 'Horse' ? 480 : 2;
      const p = await prisma.patient.create({
        data: {
          organizationId: org.id,
          number: pn,
          name,
          speciesId: s.id,
          breedId: b?.id,
          sex: (sex as any) ?? 'UNKNOWN',
          dateOfBirth: dob,
          dobEstimated: s.category === 'LIVESTOCK',
          colour: ['Black', 'Brown', 'White', 'Tan', 'Grey', 'Black & white'][pn % 6],
          latestWeightKg: weight,
          primaryBranchId: client.primaryBranchId,
          createdById: owner.id,
          ownerships: { create: [{ organizationId: org.id, clientId: client.id, isPrimary: true }] },
          weights: {
            create: [
              { organizationId: org.id, weightKg: weight * 0.92, measuredAt: new Date(Date.now() - 200 * 86400_000), recordedByName: 'Demo seed' },
              { organizationId: org.id, weightKg: weight, measuredAt: new Date(Date.now() - 20 * 86400_000), recordedByName: 'Demo seed' },
            ],
          },
        },
      });
      if (s.category === 'COMPANION' && pn % 3 === 0) {
        await prisma.patientIdentifier.create({
          data: { organizationId: org.id, patientId: p.id, type: 'MICROCHIP', value: `9820001${String(pn).padStart(8, '0')}` },
        });
      }
      if (s.category === 'LIVESTOCK') {
        await prisma.patientIdentifier.create({
          data: { organizationId: org.id, patientId: p.id, type: 'EAR_TAG', value: `${opts.country}-${String(pn).padStart(5, '0')}` },
        });
      }
      if (pn % 4 === 1) {
        await prisma.patientAlert.create({
          data: {
            organizationId: org.id,
            patientId: p.id,
            type: pn % 8 === 1 ? 'ALLERGY' : 'BEHAVIOUR',
            severity: pn % 8 === 1 ? 'CRITICAL' : 'WARNING',
            title: pn % 8 === 1 ? 'Demo allergy: penicillin (illustrative)' : 'Nervous during handling — use muzzle',
            substance: pn % 8 === 1 ? 'Penicillin' : null,
            createdByName: 'Demo seed',
          },
        });
      }
      patients.push({ id: p.id, species: speciesName, clientId: client.id });
    }
    i++;
  }
  return { org, branches, staffIds, patients };
}

async function main() {
  const reset = process.argv.includes('--reset');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');

  const existing = await prisma.organization.findMany({ where: { name: { endsWith: DEMO_TAG } } });
  if (existing.length && !reset) {
    console.log('Demo organizations already exist. Use --reset to recreate them.');
    return;
  }
  if (existing.length && reset) {
    console.log('Removing existing demo data…');
    const ids = existing.map((o) => o.id);
    // Demo-only cleanup: dependent rows first. AuditEvent rows are left in place (append-only).
    const tables: { tablename: string }[] = await prisma.$queryRawUnsafe(
      `SELECT c.table_name AS tablename FROM information_schema.columns c
       WHERE c.table_schema='public' AND c.column_name='organizationId' AND c.table_name NOT IN ('Organization','AuditEvent','Session','AuthToken')`,
    );
    await prisma.$executeRawUnsafe(`SET session_replication_role = replica`);
    for (const t of tables) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${t.tablename}" WHERE "organizationId" = ANY($1::uuid[])`, ids);
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "RolePermission" WHERE "roleId" NOT IN (SELECT id FROM "Role")`);
    await prisma.$executeRawUnsafe(`DELETE FROM "MembershipRole" WHERE "membershipId" NOT IN (SELECT id FROM "Membership")`);
    await prisma.$executeRawUnsafe(`DELETE FROM "MembershipBranch" WHERE "membershipId" NOT IN (SELECT id FROM "Membership")`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AppointmentResource" WHERE "appointmentId" NOT IN (SELECT id FROM "Appointment")`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Session" WHERE "organizationId" = ANY($1::uuid[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM "Organization" WHERE id = ANY($1::uuid[])`, ids);
    await prisma.$executeRawUnsafe(`SET session_replication_role = DEFAULT`);
    await prisma.user.deleteMany({ where: { OR: [{ email: { endsWith: '@demo.pk' } }, { email: { endsWith: '@demo.au' } }] } });
    // Portal logins are global; remove any left without access to a clinic (demo clients' logins).
    await prisma.$executeRawUnsafe(`DELETE FROM "PortalUser" WHERE id NOT IN (SELECT "portalUserId" FROM "PortalAccess")`);
  }

  const pk = await seedOrg({
    name: `NextCore Veterinary Hospital ${DEMO_TAG}`,
    country: 'PK',
    branchName: 'Lahore — Gulberg',
    extraBranch: { name: 'Islamabad — F-7', code: 'ISB' },
    staff: PK_STAFF,
    clients: PK_CLIENTS,
  });
  const au = await seedOrg({
    name: `Harbourside Vet Clinic ${DEMO_TAG}`,
    country: 'AU',
    branchName: 'Sydney — Pyrmont',
    staff: AU_STAFF,
    clients: AU_CLIENTS,
  });
  await seedModules(prisma, pk);
  await seedModules(prisma, au);
  await seedFinance(prisma, pk);
  await seedFinance(prisma, au);
  await seedForecast(prisma, pk);
  await seedHospital(prisma, pk);
  await seedHospital(prisma, au);
  // Demo portal logins, client messages and appointment requests only when the client portal is switched on.
  const portal = process.env.CLIENT_PORTAL_ENABLED === 'true';
  await seedComms(prisma, pk, portal ? { email: 'client@demo.pk', password: DEMO_PASSWORD } : null);
  await seedComms(prisma, au, portal ? { email: 'client@demo.au', password: DEMO_PASSWORD } : null);
  await seedServices(prisma, pk);
  await seedServices(prisma, au);

  console.log('\nDemo data created (password for every demo account: %s)', DEMO_PASSWORD);
  console.log('  Pakistan:  owner@demo.pk, vet@demo.pk, nurse@demo.pk, reception@demo.pk, lab@demo.pk, pharmacy@demo.pk, accounts@demo.pk, farmvet@demo.pk …');
  console.log('  Australia: owner@demo.au, vet@demo.au, nurse@demo.au, reception@demo.au');
  if (portal) console.log('  Client portal (/portal/login): client@demo.pk, client@demo.au');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
