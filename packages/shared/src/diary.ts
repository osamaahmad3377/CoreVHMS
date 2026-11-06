import { z } from 'zod';

/**
 * The pet diary: a printed health book for a patient, built from the records — owner, description, identification,
 * rabies vaccination, rabies antibody (serology) tests, other vaccinations, deworming, tick and flea treatment,
 * treatments and procedures. Everything in it comes from records the clinic already keeps, plus the antibody test
 * records below. Nothing in the diary is typed into the diary itself.
 */

export const SEROLOGY_STATUSES = ['PLANNED', 'COMPLETED', 'VOIDED'] as const;
export type SerologyStatus = (typeof SEROLOGY_STATUSES)[number];
export const SEROLOGY_OUTCOMES = ['SATISFACTORY', 'UNSATISFACTORY'] as const;
export type SerologyOutcome = (typeof SEROLOGY_OUTCOMES)[number];
export const SEROLOGY_OUTCOME_LABELS: Record<SerologyOutcome, string> = { SATISFACTORY: 'Satisfactory', UNSATISFACTORY: 'Unsatisfactory' };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date');
const optDate = isoDate.nullish().or(z.literal('').transform(() => null));

/** A rabies antibody (titre) test that is planned, or taken with its result. */
export const serologyTestSchema = z
  .object({
    /** PLANNED: a test to do (shown under "Future tests"); COMPLETED: sampled, with the result. */
    status: z.enum(['PLANNED', 'COMPLETED']),
    plannedFor: optDate,
    sampleDate: optDate,
    laboratory: z.string().trim().max(160).nullish(),
    reference: z.string().trim().max(120).nullish(),
    /** The antibody level, e.g. 1.5 (IU/mL). */
    resultValue: z.coerce.number().min(0).max(100000).nullish().or(z.literal('').transform(() => null)),
    resultUnit: z.string().trim().max(20).default('IU/mL'),
    outcome: z.enum(SEROLOGY_OUTCOMES).nullish().or(z.literal('').transform(() => null)),
    /** Entered by the vet from the destination's rules (the system holds no country rules). */
    validFrom: optDate,
    validUntil: optDate,
    notes: z.string().trim().max(500).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'PLANNED' && !v.plannedFor) ctx.addIssue({ code: 'custom', path: ['plannedFor'], message: 'Choose the date the test is planned for' });
    if (v.status === 'COMPLETED') {
      if (!v.sampleDate) ctx.addIssue({ code: 'custom', path: ['sampleDate'], message: 'When was the sample taken?' });
      if (!v.outcome) ctx.addIssue({ code: 'custom', path: ['outcome'], message: 'Choose the result' });
      if (v.validFrom && v.validUntil && v.validUntil < v.validFrom) ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'Valid until is before valid from' });
    }
  });
export type SerologyTestInput = z.infer<typeof serologyTestSchema>;
export const voidSerologySchema = z.object({ reason: z.string().trim().min(3, 'Say why').max(300) });

export interface SerologyTestView {
  id: string;
  status: SerologyStatus;
  plannedFor: string | null;
  sampleDate: string | null;
  laboratory: string | null;
  reference: string | null;
  resultValue: number | null;
  resultUnit: string;
  outcome: SerologyOutcome | null;
  validFrom: string | null;
  validUntil: string | null;
  notes: string | null;
  recordedByName: string;
  voidedReason: string | null;
}

/** One line in a table of the diary: dates are calendar days (yyyy-mm-dd). */
export interface DiaryEntry {
  id: string;
  date: string;
  /** What was given or done. */
  title: string;
  /** Product, batch and the like. */
  detail: string | null;
  batch: string | null;
  validUntil: string | null;
  by: string | null;
  givenElsewhere?: boolean;
}

export interface Diary {
  generatedOn: string;
  clinic: { name: string; legalName: string | null; phone: string | null; email: string | null; website: string | null; address: string | null; branch: string | null };
  patient: {
    id: string;
    name: string;
    patientNo: string;
    species: string;
    breed: string | null;
    sex: string;
    dateOfBirth: string | null;
    dobEstimated: boolean;
    age: string | null;
    colour: string | null;
    markings: string | null;
    weight: string | null;
    weightDate: string | null;
    bloodType: string | null;
    desexed: boolean;
    photoAttachmentId: string | null;
    registeredOn: string;
  };
  owner: { name: string; phone: string | null; email: string | null; address: string | null } | null;
  identifiers: { type: string; typeLabel: string; value: string; issuedAt: string | null; notes: string | null }[];
  rabies: DiaryEntry[];
  serology: SerologyTestView[];
  futureTests: SerologyTestView[];
  vaccinations: DiaryEntry[];
  deworming: DiaryEntry[];
  tickFlea: DiaryEntry[];
  treatments: DiaryEntry[];
  procedures: DiaryEntry[];
}

/** How many rows fit on one page of each table of the booklet. */
export const DIARY_ROWS_PER_PAGE = { rabies: 9, serology: 8, future: 9, vaccinations: 9, deworming: 9, tickFlea: 9, treatments: 9, procedures: 9 } as const;
export const chunk = <T>(rows: T[], size: number): T[][] => (rows.length ? Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size)) : [[]]);

// ───────────────────────────── Look and sections (Settings → Pet diary) ─────────────────────────────

/** The sections between the covers that can be left out. (The owner and animal pages are always kept.) */
export const DIARY_SECTIONS = ['identification', 'rabies', 'serology', 'future', 'vaccinations', 'deworming', 'tickFlea', 'treatments', 'procedures'] as const;
export type DiarySection = (typeof DIARY_SECTIONS)[number];
export const DIARY_SECTION_LABELS: Record<DiarySection, string> = {
  identification: 'Identification (microchip and tags)',
  rabies: 'Rabies vaccination',
  serology: 'Rabies serological test',
  future: 'Future tests',
  vaccinations: 'Other vaccinations',
  deworming: 'Deworming',
  tickFlea: 'Tick & flea treatment',
  treatments: 'Treatments',
  procedures: 'Procedures',
};

export const DIARY_THEMES = ['CLASSIC', 'MODERN', 'ELEGANT'] as const;
export type DiaryTheme = (typeof DIARY_THEMES)[number];
export const DIARY_THEME_INFO: Record<DiaryTheme, { label: string; hint: string }> = {
  CLASSIC: { label: 'Classic', hint: 'A full colour cover and a coloured band on every page.' },
  MODERN: { label: 'Modern', hint: 'A white cover with a colour block, and clean pages with a colour edge.' },
  ELEGANT: { label: 'Elegant', hint: 'A white cover with a fine double border, serif titles and thin rules.' },
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour like #0d7a70');

/** How the clinic's diary looks. Everything has a sensible default, so a clinic that changes nothing still gets a good book. */
export const diarySettingsSchema = z.object({
  title: z.string().trim().min(1, 'Give the diary a title').max(40).default('Pet Health Diary'),
  tagline: z.string().trim().max(100).nullish().transform((v) => v || null),
  theme: z.enum(DIARY_THEMES).default('CLASSIC'),
  /** Null: the clinic's brand colour. */
  accentColor: hex.nullish().or(z.literal('').transform(() => null)),
  hiddenSections: z.array(z.enum(DIARY_SECTIONS)).max(DIARY_SECTIONS.length).default([]),
  /** A QR code on the back cover (and the page after the owner’s details) that opens the diary online. */
  showQr: z.boolean().default(true),
  showPhoto: z.boolean().default(true),
  /** Ruled pages for handwritten notes before the back cover. */
  notesPages: z.number().int().min(0).max(4).default(1),
  backTitle: z.string().trim().min(1).max(80).default('Please bring this diary to every visit'),
  backMessage: z.string().trim().max(400).default('It records your pet’s vaccinations, tests, treatments and procedures. Keep it safe and show it when travelling, boarding or visiting another vet.'),
  /** Printed in the footer of every page (opening hours, a motto, a licence line…). */
  footerNote: z.string().trim().max(120).nullish().transform((v) => v || null),
  /** Shown on the back cover (e.g. the out-of-hours emergency number). */
  emergencyNote: z.string().trim().max(160).nullish().transform((v) => v || null),
});
export type DiarySettings = z.infer<typeof diarySettingsSchema>;
export const DEFAULT_DIARY_SETTINGS: DiarySettings = diarySettingsSchema.parse({});

/** What the diary's online page and the printed copy are built from. */
export interface DiaryBooklet {
  diary: Diary;
  settings: DiarySettings;
  /** The address the QR code opens (null when the clinic switched the QR code off). */
  qrValue: string | null;
}

/** The owner's private link to the online diary. */
export interface DiaryLinkInfo {
  url: string;
  createdAt: string;
  lastViewedAt: string | null;
  viewCount: number;
}

/** A made-up diary, for previewing the design in Settings. */
export function sampleDiary(clinic: { name: string; phone?: string | null; email?: string | null; address?: string | null }): Diary {
  const e = (id: string, date: string, title: string, o: Partial<DiaryEntry> = {}): DiaryEntry => ({ id, date, title, detail: null, batch: null, validUntil: null, by: 'Dr. A. Khan', ...o });
  return {
    generatedOn: '2026-11-06',
    clinic: { name: clinic.name, legalName: null, phone: clinic.phone ?? '042 3576 1234', email: clinic.email ?? 'hello@clinic.example', website: null, address: clinic.address ?? '12 Garden Road, Lahore', branch: null },
    patient: { id: 'sample', name: 'Tiger', patientNo: 'P-000123', species: 'Dog', breed: 'Labrador Retriever', sex: 'Male (neutered)', dateOfBirth: '2022-03-14', dobEstimated: false, age: '4 years 7 months', colour: 'Golden', markings: 'White patch on chest', weight: '28.4 kg', weightDate: '2026-10-20', bloodType: null, desexed: true, photoAttachmentId: null, registeredOn: '2022-05-02' },
    owner: { name: 'Bilal Ahmad', phone: '0300 1234567', email: 'bilal@example.com', address: '5 Canal View, Lahore' },
    identifiers: [{ type: 'MICROCHIP', typeLabel: 'Microchip', value: '900 164 000 123 456', issuedAt: '2022-05-02', notes: null }],
    rabies: [e('r1', '2025-10-20', 'Rabies vaccination', { detail: 'Nobivac Rabies', batch: 'A2231B', validUntil: '2026-10-20' }), e('r2', '2026-10-20', 'Rabies vaccination', { detail: 'Nobivac Rabies', batch: 'B7781C', validUntil: '2027-10-20' })],
    serology: [{ id: 's1', status: 'COMPLETED', plannedFor: null, sampleDate: '2026-11-01', laboratory: 'Central Vet Lab', reference: 'CVL-8841', resultValue: 1.8, resultUnit: 'IU/mL', outcome: 'SATISFACTORY', validFrom: '2026-11-01', validUntil: '2029-11-01', notes: null, recordedByName: 'Dr. A. Khan', voidedReason: null }],
    futureTests: [],
    vaccinations: [e('v1', '2026-10-20', 'DHPPi', { detail: 'Nobivac DHPPi', batch: 'D1120K', validUntil: '2027-10-20' })],
    deworming: [e('d1', '2026-09-02', 'Deworming', { detail: 'Drontal Plus', validUntil: '2026-12-02' })],
    tickFlea: [e('t1', '2026-10-05', 'Tick & flea', { detail: 'NexGard', validUntil: '2026-11-05' })],
    treatments: [],
    procedures: [e('p1', '2024-02-10', 'Neutering', { by: 'Dr. S. Malik' })],
  };
}

/** The animal's earlier care, read from the clinic's records, for the "Past history" of a consultation. */
export interface PatientHistorySummary {
  sections: { title: string; items: string[] }[];
  /** The same, written out as plain text: "Vaccinations: Rabies — 12 Nov 2025; …." */
  text: string;
}
