import { z } from 'zod';

/**
 * Certificates for patients (vaccination, health, fitness to travel, microchip, desexing, death…) and for staff
 * (employment, experience, training, CPD, appreciation). Each is issued from a template the clinic designs
 * (Settings → Certificate templates), carries a number and a verification code (QR code and barcode), and is never
 * changed once issued: it can only be revoked, or replaced by a new one.
 */

export const CERTIFICATE_SUBJECTS = ['PATIENT', 'STAFF'] as const;
export type CertificateSubject = (typeof CERTIFICATE_SUBJECTS)[number];

export const CERTIFICATE_KINDS = [
  'VACCINATION',
  'RABIES_VACCINATION',
  'HEALTH',
  'FITNESS_TO_TRAVEL',
  'FITNESS',
  'MICROCHIP',
  'STERILISATION',
  'DEATH',
  'BREEDING_SOUNDNESS',
  'LIVESTOCK_HEALTH',
  'PATIENT_CUSTOM',
  'EMPLOYMENT',
  'EXPERIENCE',
  'TRAINING',
  'CPD',
  'APPRECIATION',
  'STAFF_CUSTOM',
] as const;
export type CertificateKind = (typeof CERTIFICATE_KINDS)[number];

export const CERTIFICATE_STATUSES = ['ISSUED', 'REVOKED'] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

export interface CertificateInput {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'number' | 'select';
  required?: boolean;
  options?: string[];
  hint?: string;
  placeholder?: string;
  /** Text used when nothing is typed. */
  default?: string;
}

export interface CertificateKindInfo {
  label: string;
  subject: CertificateSubject;
  /** One line for the picker. */
  description: string;
  /** The heading on the certificate. */
  title: string;
  orientation: 'portrait' | 'landscape';
  /** What the issuer fills in (pre-filled from the records where possible). */
  inputs: CertificateInput[];
  /** A list of records printed as a table. */
  table?: 'VACCINATIONS';
  /** Suggested validity from the issue date, in days (null: no expiry). */
  validityDays: number | null;
  /** The wording of the certificate, with {{placeholders}}; the clinic can change it in the template. */
  statement: string;
}

const examDate: CertificateInput = { key: 'examDate', label: 'Examined on', type: 'date', required: true };
const remarks: CertificateInput = { key: 'remarks', label: 'Remarks', type: 'textarea', hint: 'Printed under the statement. Leave empty for none.' };

export const CERTIFICATE_KIND_INFO: Record<CertificateKind, CertificateKindInfo> = {
  VACCINATION: {
    label: 'Vaccination certificate',
    subject: 'PATIENT',
    description: 'The vaccinations on record, with dates, batch numbers and when each is next due.',
    title: 'Certificate of Vaccination',
    orientation: 'portrait',
    table: 'VACCINATIONS',
    validityDays: null,
    inputs: [remarks],
    statement: 'This is to certify that the animal described below has received the vaccinations listed, as recorded at {{clinic.name}}.',
  },
  RABIES_VACCINATION: {
    label: 'Rabies vaccination certificate',
    subject: 'PATIENT',
    description: 'One rabies vaccination: vaccine, batch, date given and valid until — for travel and licensing.',
    title: 'Rabies Vaccination Certificate',
    orientation: 'portrait',
    validityDays: 365,
    inputs: [
      { key: 'vaccine', label: 'Vaccine (product)', type: 'text', required: true },
      { key: 'manufacturer', label: 'Manufacturer', type: 'text' },
      { key: 'batch', label: 'Batch / lot number', type: 'text', required: true },
      { key: 'vaccinationDate', label: 'Date given', type: 'date', required: true },
      remarks,
    ],
    statement:
      'I certify that the animal described below was vaccinated against rabies on {{input.vaccinationDate}} with {{input.vaccine}} (batch {{input.batch}}). This vaccination is valid until {{certificate.validUntil}}.',
  },
  HEALTH: {
    label: 'Health / wellness certificate',
    subject: 'PATIENT',
    description: 'After an examination: the animal is healthy and free of signs of infectious disease.',
    title: 'Certificate of Good Health',
    orientation: 'portrait',
    validityDays: 30,
    inputs: [examDate, { key: 'findings', label: 'Examination findings', type: 'textarea', default: 'No abnormalities detected on clinical examination.' }, remarks],
    statement:
      'I certify that I examined the animal described below on {{input.examDate}} and found it to be in good health and free from clinical signs of infectious or contagious disease.',
  },
  FITNESS_TO_TRAVEL: {
    label: 'Fitness to travel',
    subject: 'PATIENT',
    description: 'Fit to travel by air, road or sea, to a destination — usually needed within 10 days of travel.',
    title: 'Fitness to Travel Certificate',
    orientation: 'portrait',
    validityDays: 10,
    inputs: [
      examDate,
      { key: 'destination', label: 'Destination', type: 'text', required: true, placeholder: 'e.g. Dubai, UAE' },
      { key: 'travelMode', label: 'Travelling', type: 'select', options: ['by air', 'by road', 'by sea', 'by rail'], default: 'by air' },
      { key: 'travelDate', label: 'Travel date', type: 'date' },
      remarks,
    ],
    statement:
      'I certify that I examined the animal described below on {{input.examDate}} and found it fit to travel {{input.travelMode}} to {{input.destination}}. It showed no clinical signs of infectious or contagious disease.',
  },
  FITNESS: {
    label: 'Fitness certificate',
    subject: 'PATIENT',
    description: 'Fit for boarding, grooming, a show, sport or work, breeding or adoption.',
    title: 'Certificate of Fitness',
    orientation: 'portrait',
    validityDays: 30,
    inputs: [
      examDate,
      { key: 'purpose', label: 'Fit for', type: 'select', required: true, options: ['boarding', 'grooming', 'a show or exhibition', 'sport or work', 'breeding', 'adoption', 'transport', 'competition'], default: 'boarding' },
      remarks,
    ],
    statement: 'I certify that I examined the animal described below on {{input.examDate}} and found it fit for {{input.purpose}}.',
  },
  MICROCHIP: {
    label: 'Microchip certificate',
    subject: 'PATIENT',
    description: 'The microchip number, where it was implanted and when — for registration and travel.',
    title: 'Microchip Identification Certificate',
    orientation: 'portrait',
    validityDays: null,
    inputs: [
      { key: 'microchip', label: 'Microchip number', type: 'text', required: true },
      { key: 'implantDate', label: 'Implanted (or first read) on', type: 'date', required: true },
      { key: 'location', label: 'Site', type: 'text', default: 'left side of the neck' },
      remarks,
    ],
    statement: 'I certify that the animal described below is identified by microchip number {{input.microchip}}, implanted or read on {{input.implantDate}} at the {{input.location}}.',
  },
  STERILISATION: {
    label: 'Desexing (spay / neuter) certificate',
    subject: 'PATIENT',
    description: 'The animal was spayed or castrated, and when — for registration, licensing and shelters.',
    title: 'Certificate of Desexing',
    orientation: 'portrait',
    validityDays: null,
    inputs: [
      { key: 'procedure', label: 'Procedure', type: 'select', required: true, options: ['spayed (ovariohysterectomy)', 'spayed (ovariectomy)', 'castrated (neutered)', 'vasectomised'] },
      { key: 'procedureDate', label: 'Date of surgery', type: 'date', required: true },
      remarks,
    ],
    statement: 'I certify that the animal described below was {{input.procedure}} on {{input.procedureDate}}.',
  },
  DEATH: {
    label: 'Death / euthanasia certificate',
    subject: 'PATIENT',
    description: 'Date, manner and cause of death and aftercare — for owners, insurers and registries.',
    title: 'Certificate of Death',
    orientation: 'portrait',
    validityDays: null,
    inputs: [
      { key: 'dateOfDeath', label: 'Date of death', type: 'date', required: true },
      { key: 'manner', label: 'Manner of death', type: 'select', required: true, options: ['natural death', 'humane euthanasia', 'found dead', 'accident'] },
      { key: 'cause', label: 'Cause of death', type: 'text', placeholder: 'If known' },
      { key: 'aftercare', label: 'Aftercare', type: 'text', placeholder: 'e.g. private cremation, burial' },
      remarks,
    ],
    statement: 'This is to certify that the animal described below died on {{input.dateOfDeath}}. Manner of death: {{input.manner}}. Cause: {{input.cause}}. Aftercare: {{input.aftercare}}.',
  },
  BREEDING_SOUNDNESS: {
    label: 'Breeding soundness certificate',
    subject: 'PATIENT',
    description: 'A breeding soundness examination and its result — for sale, breeding and herd records.',
    title: 'Breeding Soundness Examination',
    orientation: 'portrait',
    validityDays: 90,
    inputs: [
      examDate,
      { key: 'result', label: 'Result', type: 'select', required: true, options: ['satisfactory potential breeder', 'questionable — re-examine', 'unsatisfactory potential breeder', 'classification deferred'] },
      { key: 'findings', label: 'Findings', type: 'textarea' },
      remarks,
    ],
    statement: 'I certify that I examined the animal described below for breeding soundness on {{input.examDate}}. Result: {{input.result}}.',
  },
  LIVESTOCK_HEALTH: {
    label: 'Livestock health certificate',
    subject: 'PATIENT',
    description: 'For movement, sale, shows or slaughter: examined and free of signs of contagious disease.',
    title: 'Livestock Health Certificate',
    orientation: 'portrait',
    validityDays: 7,
    inputs: [
      examDate,
      { key: 'purpose', label: 'For', type: 'select', options: ['movement', 'sale', 'a show or fair', 'slaughter', 'export', 'breeding'], default: 'movement' },
      { key: 'farm', label: 'Farm / herd', type: 'text' },
      { key: 'findings', label: 'Findings', type: 'textarea' },
      remarks,
    ],
    statement:
      'I certify that I examined the animal described below on {{input.examDate}}, before {{input.purpose}}, and it showed no clinical signs of contagious or infectious disease.',
  },
  PATIENT_CUSTOM: {
    label: 'Other patient certificate',
    subject: 'PATIENT',
    description: 'Your own wording, for anything else.',
    title: 'Veterinary Certificate',
    orientation: 'portrait',
    validityDays: null,
    inputs: [
      { key: 'heading', label: 'Heading', type: 'text', required: true, default: 'Veterinary Certificate' },
      { key: 'statement', label: 'Statement', type: 'textarea', required: true },
    ],
    statement: '{{input.statement}}',
  },
  EMPLOYMENT: {
    label: 'Employment certificate',
    subject: 'STAFF',
    description: 'Confirms someone works at the clinic, in which role and since when (visa, bank, rental).',
    title: 'Employment Certificate',
    orientation: 'portrait',
    validityDays: 90,
    inputs: [
      { key: 'purpose', label: 'Issued for', type: 'text', placeholder: 'e.g. visa application', default: 'whatever purpose it may serve' },
      remarks,
    ],
    statement:
      'This is to certify that {{staff.name}} has been employed at {{clinic.name}} as {{staff.jobTitle}} since {{staff.joinedAt}} and remains in our employment. This certificate is issued on request, for {{input.purpose}}.',
  },
  EXPERIENCE: {
    label: 'Experience certificate',
    subject: 'STAFF',
    description: 'For someone leaving: their role, the dates they worked and a word on their work.',
    title: 'Experience Certificate',
    orientation: 'landscape',
    validityDays: null,
    inputs: [
      { key: 'fromDate', label: 'Worked from', type: 'date', required: true },
      { key: 'toDate', label: 'Worked until', type: 'date', required: true },
      { key: 'conduct', label: 'About their work', type: 'textarea', default: 'During this time we found them sincere, hard-working and professional. We wish them every success.' },
    ],
    statement: 'This is to certify that {{staff.name}} worked at {{clinic.name}} as {{staff.jobTitle}} from {{input.fromDate}} to {{input.toDate}}. {{input.conduct}}',
  },
  TRAINING: {
    label: 'Training certificate',
    subject: 'STAFF',
    description: 'Completion of a course or in-house training, with hours and trainer.',
    title: 'Certificate of Completion',
    orientation: 'landscape',
    validityDays: null,
    inputs: [
      { key: 'course', label: 'Course or training', type: 'text', required: true },
      { key: 'hours', label: 'Hours', type: 'number' },
      { key: 'completedOn', label: 'Completed on', type: 'date', required: true },
      { key: 'trainer', label: 'Trainer', type: 'text' },
    ],
    statement: 'This is to certify that {{staff.name}} has successfully completed {{input.course}} ({{input.hours}} hours) on {{input.completedOn}}.',
  },
  CPD: {
    label: 'CPD certificate',
    subject: 'STAFF',
    description: 'Continuing professional development hours, for registration with the veterinary council.',
    title: 'Continuing Professional Development',
    orientation: 'landscape',
    validityDays: null,
    inputs: [
      { key: 'topic', label: 'Topic', type: 'text', required: true },
      { key: 'hours', label: 'CPD hours', type: 'number', required: true },
      { key: 'period', label: 'Period', type: 'text', placeholder: 'e.g. January – June 2026', required: true },
      { key: 'provider', label: 'Provider', type: 'text' },
    ],
    statement: 'This is to certify that {{staff.name}} completed {{input.hours}} hours of continuing professional development in {{input.topic}} during {{input.period}}.',
  },
  APPRECIATION: {
    label: 'Certificate of appreciation',
    subject: 'STAFF',
    description: 'Recognition — employee of the month, years of service, outstanding care.',
    title: 'Certificate of Appreciation',
    orientation: 'landscape',
    validityDays: null,
    inputs: [{ key: 'reason', label: 'In recognition of', type: 'text', required: true, placeholder: 'e.g. outstanding patient care' }],
    statement: 'Presented to {{staff.name}} in recognition of {{input.reason}}, with sincere thanks from everyone at {{clinic.name}}.',
  },
  STAFF_CUSTOM: {
    label: 'Other staff certificate',
    subject: 'STAFF',
    description: 'Your own wording, for anything else.',
    title: 'Certificate',
    orientation: 'landscape',
    validityDays: null,
    inputs: [
      { key: 'heading', label: 'Heading', type: 'text', required: true, default: 'Certificate' },
      { key: 'statement', label: 'Statement', type: 'textarea', required: true },
    ],
    statement: '{{input.statement}}',
  },
};

export const kindsFor = (subject: CertificateSubject) => CERTIFICATE_KINDS.filter((k) => CERTIFICATE_KIND_INFO[k].subject === subject);

/** The permission needed to issue (and revoke) a certificate of this kind. */
export const issuePermissionFor = (kind: CertificateKind) => (CERTIFICATE_KIND_INFO[kind].subject === 'STAFF' ? 'certificates.staff' : 'certificates.issue');

// ── Placeholders ──

export interface CertificateField {
  key: string;
  label: string;
  sample: string;
}

const COMMON_FIELDS: CertificateField[] = [
  { key: 'clinic.name', label: 'Clinic name', sample: 'Happy Paws Veterinary Clinic' },
  { key: 'clinic.address', label: 'Clinic address', sample: '12 Main Boulevard, Gulberg, Lahore' },
  { key: 'clinic.phone', label: 'Clinic phone', sample: '0300 1234567' },
  { key: 'clinic.email', label: 'Clinic email', sample: 'hello@happypaws.pk' },
  { key: 'branch.name', label: 'Branch', sample: 'Gulberg' },
  { key: 'certificate.title', label: 'Certificate heading', sample: 'Certificate of Good Health' },
  { key: 'certificate.number', label: 'Certificate number', sample: 'CERT-000123' },
  { key: 'certificate.issuedAt', label: 'Date issued', sample: '5 Nov 2026' },
  { key: 'certificate.validUntil', label: 'Valid until (date)', sample: '5 Dec 2026' },
  { key: 'certificate.validity', label: 'Validity line ("Valid until …", empty if it never expires)', sample: 'Valid until 5 Dec 2026' },
  { key: 'certificate.code', label: 'Verification code', sample: 'K7Q2-M9XP-4TRA' },
  { key: 'certificate.verifyUrl', label: 'Verification address', sample: 'https://happypaws.nextcore.pk/verify/K7Q2M9XP4TRA' },
  { key: 'certificate.statement', label: 'Statement (the wording for this type)', sample: 'I certify that I examined the animal described below on 4 Nov 2026 and found it to be in good health.' },
  { key: 'certificate.remarks', label: 'Remarks', sample: 'Kept on a balanced diet; next check-up in six months.' },
  { key: 'issuer.name', label: 'Issued by — name', sample: 'Dr. Ayesha Raza' },
  { key: 'issuer.jobTitle', label: 'Issued by — job title', sample: 'Veterinary Surgeon' },
  { key: 'issuer.registration', label: 'Issued by — registration no.', sample: 'PVMC 12345' },
];

export const PATIENT_FIELDS: CertificateField[] = [
  { key: 'patient.name', label: 'Patient name', sample: 'Bruno' },
  { key: 'patient.number', label: 'Patient number', sample: 'P-000412' },
  { key: 'patient.species', label: 'Species', sample: 'Dog' },
  { key: 'patient.breed', label: 'Breed', sample: 'Labrador Retriever' },
  { key: 'patient.sex', label: 'Sex', sample: 'Male (neutered)' },
  { key: 'patient.dateOfBirth', label: 'Date of birth', sample: '12 Mar 2022' },
  { key: 'patient.age', label: 'Age', sample: '4 years' },
  { key: 'patient.colour', label: 'Colour / markings', sample: 'Golden' },
  { key: 'patient.microchip', label: 'Microchip', sample: '900012345678901' },
  { key: 'patient.tag', label: 'Ear tag / other ID', sample: 'PK-LHR-2231' },
  { key: 'patient.weight', label: 'Weight', sample: '31.5 kg' },
  { key: 'owner.name', label: 'Owner name', sample: 'Ahmed Khan' },
  { key: 'owner.address', label: 'Owner address', sample: '45-B Model Town, Lahore' },
  { key: 'owner.phone', label: 'Owner phone', sample: '0321 7654321' },
];

export const STAFF_FIELDS: CertificateField[] = [
  { key: 'staff.name', label: 'Staff member', sample: 'Nadia Iqbal' },
  { key: 'staff.jobTitle', label: 'Job title', sample: 'Senior Veterinary Nurse' },
  { key: 'staff.registration', label: 'Registration no.', sample: 'PVMC-N 2231' },
  { key: 'staff.joinedAt', label: 'Joined', sample: '1 Feb 2021' },
  { key: 'staff.branches', label: 'Branches', sample: 'Gulberg, F-7' },
];

/** The placeholders a template of this kind can use, with sample values for the designer's preview. */
export function certificateFields(kind: CertificateKind): CertificateField[] {
  const info = CERTIFICATE_KIND_INFO[kind];
  const inputs = info.inputs.map((i) => ({ key: `input.${i.key}`, label: i.label, sample: SAMPLE_INPUTS[i.key] ?? i.default ?? i.label }));
  return [...COMMON_FIELDS, ...(info.subject === 'PATIENT' ? PATIENT_FIELDS : STAFF_FIELDS), ...inputs];
}

const SAMPLE_INPUTS: Record<string, string> = {
  examDate: '4 Nov 2026',
  vaccine: 'Rabisin',
  manufacturer: 'Boehringer Ingelheim',
  batch: 'RB-22871',
  vaccinationDate: '4 Nov 2026',
  destination: 'Dubai, UAE',
  travelMode: 'by air',
  travelDate: '10 Nov 2026',
  purpose: 'boarding',
  microchip: '900012345678901',
  implantDate: '20 Apr 2022',
  location: 'left side of the neck',
  procedure: 'castrated (neutered)',
  procedureDate: '15 Aug 2023',
  dateOfDeath: '2 Nov 2026',
  manner: 'humane euthanasia',
  cause: 'end-stage renal failure',
  aftercare: 'private cremation',
  result: 'satisfactory potential breeder',
  farm: 'Green Valley Dairy',
  heading: 'Veterinary Certificate',
  statement: 'Your own wording appears here.',
  fromDate: '1 Feb 2021',
  toDate: '31 Oct 2026',
  course: 'Fear Free handling — Level 1',
  hours: '12',
  completedOn: '28 Oct 2026',
  trainer: 'Dr. Ayesha Raza',
  topic: 'small animal anaesthesia',
  period: 'January – June 2026',
  provider: 'Pakistan Veterinary Medical Council',
  reason: 'outstanding patient care',
  conduct: 'During this time we found them sincere, hard-working and professional.',
  findings: 'No abnormalities detected on clinical examination.',
  remarks: 'Kept on a balanced diet; next check-up in six months.',
};

/** Sample values for every placeholder of a kind — the designer's preview. */
export function sampleCertificateData(kind: CertificateKind): Record<string, string> {
  const fields = Object.fromEntries(certificateFields(kind).map((f) => [f.key, f.sample]));
  fields['certificate.title'] = CERTIFICATE_KIND_INFO[kind].title;
  fields['certificate.statement'] = fillPlaceholders(CERTIFICATE_KIND_INFO[kind].statement, fields);
  return fields;
}

/** Replaces {{key}} with its value (unknown or empty values print nothing). */
export function fillPlaceholders(text: string, data: Record<string, string | null | undefined>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => data[key] ?? '');
}

/**
 * Fills a text element for printing: a line whose placeholders are all empty is left out ("Microchip: " when the
 * animal has none), so templates can list every detail and print only what is known.
 */
export function fillCertificateText(text: string, data: Record<string, string | null | undefined>): string {
  return text
    .split('\n')
    .filter((line) => {
      const keys = [...line.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
      return !keys.length || keys.some((k) => (data[k] ?? '').trim() !== '');
    })
    .map((line) => fillPlaceholders(line, data))
    .join('\n');
}

/** One row of the vaccinations table. */
export interface CertificateVaccinationRow {
  vaccine: string;
  product: string;
  batch: string;
  givenOn: string;
  nextDue: string;
  givenBy: string;
}
export const VACCINATION_COLUMNS: { key: keyof CertificateVaccinationRow; label: string }[] = [
  { key: 'vaccine', label: 'Vaccine' },
  { key: 'product', label: 'Product' },
  { key: 'batch', label: 'Batch' },
  { key: 'givenOn', label: 'Date given' },
  { key: 'nextDue', label: 'Next due' },
  { key: 'givenBy', label: 'Given by' },
];
export const SAMPLE_VACCINATIONS: CertificateVaccinationRow[] = [
  { vaccine: 'DHPPi + L4', product: 'Nobivac DHPPi', batch: 'A123B45', givenOn: '12 Mar 2026', nextDue: '12 Mar 2027', givenBy: 'Dr. Ayesha Raza' },
  { vaccine: 'Rabies', product: 'Rabisin', batch: 'RB-22871', givenOn: '12 Mar 2026', nextDue: '12 Mar 2027', givenBy: 'Dr. Ayesha Raza' },
  { vaccine: 'Kennel cough', product: 'Nobivac KC', batch: 'KC-9981', givenOn: '2 Apr 2026', nextDue: '2 Apr 2027', givenBy: 'Dr. Hamza Butt' },
];

// ── Layout (what the designer edits) ──

export const PAGE_SIZES = { A4: { w: 210, h: 297, label: 'A4' }, LETTER: { w: 215.9, h: 279.4, label: 'US Letter' } } as const;
export type PageSize = keyof typeof PAGE_SIZES;
export const BORDER_STYLES = ['none', 'simple', 'double', 'thick', 'ornate'] as const;
export const FONT_FAMILIES = ['sans', 'serif', 'script', 'mono'] as const;
export const CERTIFICATE_ELEMENT_TYPES = ['text', 'image', 'qr', 'barcode', 'line', 'box', 'table', 'signature', 'watermark'] as const;

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour like #1a2b3c');
const mm = z.number().min(-50).max(400);
/** Images are kept inside the template (logo-sized pictures, a signature or a seal). */
const imageData = z
  .string()
  .regex(/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/, 'An image')
  .max(700_000, 'Images must be smaller than 500 KB');

const base = {
  id: z.string().min(1).max(40),
  x: mm,
  y: mm,
  w: z.number().min(1).max(400),
  h: z.number().min(0.2).max(400),
  rotate: z.number().min(-180).max(180).optional(),
};

export const certificateElementSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('text'),
    text: z.string().max(4000),
    fontSize: z.number().min(4).max(120),
    fontFamily: z.enum(FONT_FAMILIES),
    fontWeight: z.union([z.literal(400), z.literal(600), z.literal(700)]),
    italic: z.boolean().optional(),
    uppercase: z.boolean().optional(),
    letterSpacing: z.number().min(-2).max(20).optional(),
    lineHeight: z.number().min(0.8).max(3).optional(),
    align: z.enum(['left', 'center', 'right', 'justify']),
    color,
  }),
  z.object({ ...base, type: z.literal('image'), src: z.union([z.literal('logo'), imageData]), fit: z.enum(['contain', 'cover']), opacity: z.number().min(0.05).max(1).optional() }),
  z.object({ ...base, type: z.literal('qr'), color, caption: z.boolean().optional() }),
  z.object({ ...base, type: z.literal('barcode'), color, showText: z.boolean().optional() }),
  z.object({ ...base, type: z.literal('line'), color, thickness: z.number().min(0.1).max(10), style: z.enum(['solid', 'dashed', 'dotted']) }),
  z.object({
    ...base,
    type: z.literal('box'),
    borderColor: color,
    borderWidth: z.number().min(0).max(10),
    borderStyle: z.enum(['solid', 'dashed', 'dotted', 'double']),
    fill: z.union([color, z.literal('transparent')]),
    radius: z.number().min(0).max(50),
  }),
  z.object({ ...base, type: z.literal('table'), source: z.literal('VACCINATIONS'), fontSize: z.number().min(5).max(16), headerColor: color, color }),
  z.object({ ...base, type: z.literal('signature'), label: z.string().max(80), color, showName: z.boolean(), fontSize: z.number().min(5).max(20) }),
  /** Faint text or a picture behind everything else (e.g. "ORIGINAL", the clinic's logo), with its own opacity. */
  z.object({
    ...base,
    type: z.literal('watermark'),
    mode: z.enum(['text', 'image']),
    text: z.string().max(200),
    src: z.union([z.literal('logo'), imageData]),
    fontSize: z.number().min(8).max(300),
    fontFamily: z.enum(FONT_FAMILIES),
    fontWeight: z.union([z.literal(400), z.literal(600), z.literal(700)]),
    uppercase: z.boolean().optional(),
    letterSpacing: z.number().min(-2).max(40).optional(),
    color,
    /** 2% (barely there) to 100%. */
    opacity: z.number().min(0.02).max(1),
  }),
]);
export type CertificateElement = z.infer<typeof certificateElementSchema>;
export type CertificateElementType = CertificateElement['type'];

export const certificateLayoutSchema = z.object({
  version: z.literal(1),
  page: z.object({
    size: z.enum(['A4', 'LETTER']),
    orientation: z.enum(['portrait', 'landscape']),
    background: color,
    backgroundImage: imageData.nullish(),
    border: z.object({ style: z.enum(BORDER_STYLES), color, inset: z.number().min(0).max(40) }),
  }),
  elements: z.array(certificateElementSchema).max(80),
});
export type CertificateLayout = z.infer<typeof certificateLayoutSchema>;

/** The page in millimetres. */
export function pageMm(page: CertificateLayout['page']) {
  const s = PAGE_SIZES[page.size];
  return page.orientation === 'portrait' ? { w: s.w, h: s.h } : { w: s.h, h: s.w };
}

// ── Built-in designs ──

export const CERTIFICATE_STYLES = ['classic', 'modern', 'elegant'] as const;
export type CertificateStyle = (typeof CERTIFICATE_STYLES)[number];
export const CERTIFICATE_STYLE_LABELS: Record<CertificateStyle, string> = { classic: 'Classic', modern: 'Modern', elegant: 'Elegant' };

let seq = 0;
const nid = (p: string) => `${p}${++seq}`;
const text = (x: number, y: number, w: number, h: number, t: string, o: Partial<Extract<CertificateElement, { type: 'text' }>> = {}): CertificateElement => ({
  id: nid('t'),
  type: 'text',
  x,
  y,
  w,
  h,
  text: t,
  fontSize: 11,
  fontFamily: 'sans',
  fontWeight: 400,
  align: 'left',
  color: '#1f2937',
  lineHeight: 1.45,
  ...o,
});

const PATIENT_DETAILS = 'Name: {{patient.name}}  ({{patient.number}})\nSpecies / breed: {{patient.species}} — {{patient.breed}}\nSex: {{patient.sex}}    Born: {{patient.dateOfBirth}}\nColour: {{patient.colour}}\nMicrochip: {{patient.microchip}}';
const OWNER_DETAILS = 'Owner: {{owner.name}}\nAddress: {{owner.address}}\nPhone: {{owner.phone}}';

/**
 * A ready-made design for a kind: a frame, the clinic's logo and name, the heading, the wording, the details, a
 * signature line and the verification QR code. Clinics start from one of these and change anything in the designer.
 */
export function defaultCertificateLayout(kind: CertificateKind, style: CertificateStyle = 'classic', size: PageSize = 'A4'): CertificateLayout {
  seq = 0;
  const info = CERTIFICATE_KIND_INFO[kind];
  const page: CertificateLayout['page'] = {
    size,
    orientation: info.orientation,
    background: style === 'elegant' ? '#fffdf7' : '#ffffff',
    backgroundImage: null,
    border: { style: style === 'classic' ? 'double' : style === 'elegant' ? 'ornate' : 'none', color: style === 'modern' ? '#0d7a70' : '#8a6d3b', inset: 8 },
  };
  const { w: W, h: H } = pageMm(page);
  const accent = style === 'modern' ? '#0d7a70' : style === 'elegant' ? '#8a6d3b' : '#1e3a5f';
  const serif = style === 'modern' ? 'sans' : 'serif';
  const els: CertificateElement[] = [];
  const left = style === 'modern' ? 30 : 22;
  const inner = W - left - 22;
  const centre = style !== 'modern';
  const align = centre ? ('center' as const) : ('left' as const);

  if (style === 'modern') {
    els.push({ id: nid('b'), type: 'box', x: 0, y: 0, w: 14, h: H, borderColor: accent, borderWidth: 0, borderStyle: 'solid', fill: accent, radius: 0 });
  }
  const title = kind === 'PATIENT_CUSTOM' || kind === 'STAFF_CUSTOM' ? '{{input.heading}}' : '{{certificate.title}}';
  const landscape = info.orientation === 'landscape';

  // Header: logo, clinic name and contact.
  els.push({ id: nid('i'), type: 'image', src: 'logo', fit: 'contain', x: centre ? W / 2 - 13 : left, y: 18, w: 26, h: 18 });
  els.push(text(left, 38, inner, 8, '{{clinic.name}}', { fontSize: 15, fontWeight: 700, align, color: accent, fontFamily: serif }));
  els.push(text(left, 46, inner, 6, '{{clinic.address}} · {{clinic.phone}} · {{clinic.email}}', { fontSize: 8.5, align, color: '#6b7280' }));
  els.push({ id: nid('l'), type: 'line', x: centre ? W / 2 - 40 : left, y: 55, w: 80, h: 0.6, color: accent, thickness: 0.4, style: 'solid' });
  // Heading.
  els.push(text(left, 60, inner, 14, title, { fontSize: landscape ? 30 : 24, fontWeight: 700, align, color: '#111827', fontFamily: style === 'elegant' ? 'script' : serif, letterSpacing: style === 'classic' ? 1 : 0 }));

  if (info.subject === 'STAFF') {
    // A presentation certificate: "This is presented to" + name, then the wording.
    els.push(text(left, landscape ? 80 : 82, inner, 7, 'This certificate is presented to', { fontSize: 11, align, color: '#6b7280', italic: true }));
    els.push(text(left, landscape ? 88 : 90, inner, 14, '{{staff.name}}', { fontSize: 26, fontWeight: 700, align, color: accent, fontFamily: style === 'modern' ? 'sans' : 'script' }));
    els.push(text(left + (landscape ? 25 : 0), landscape ? 106 : 110, inner - (landscape ? 50 : 0), 40, '{{certificate.statement}}', { fontSize: 12, align: centre ? 'center' : 'justify', lineHeight: 1.6 }));
    els.push(text(left + (landscape ? 25 : 0), landscape ? 140 : 150, inner - (landscape ? 50 : 0), 14, '{{certificate.remarks}}', { fontSize: 10, align, color: '#4b5563', italic: true }));
  } else {
    els.push(text(left, 80, inner, 26, '{{certificate.statement}}', { fontSize: 11.5, align: 'justify', lineHeight: 1.6 }));
    els.push({ id: nid('b'), type: 'box', x: left, y: 108, w: inner, h: 38, borderColor: '#d1d5db', borderWidth: 0.3, borderStyle: 'solid', fill: style === 'elegant' ? '#fbf6ea' : '#f8fafc', radius: 2 });
    els.push(text(left + 4, 111, inner / 2 - 6, 34, PATIENT_DETAILS, { fontSize: 9.5, lineHeight: 1.65 }));
    els.push(text(left + inner / 2 + 2, 111, inner / 2 - 6, 34, OWNER_DETAILS + '\nWeight: {{patient.weight}}', { fontSize: 9.5, lineHeight: 1.65 }));
    let y = 152;
    if (info.table === 'VACCINATIONS') {
      els.push(text(left, y, inner, 6, 'Vaccinations', { fontSize: 11, fontWeight: 700, color: accent }));
      els.push({ id: nid('tb'), type: 'table', source: 'VACCINATIONS', x: left, y: y + 7, w: inner, h: 60, fontSize: 8.5, headerColor: accent, color: '#1f2937' });
      y += 72;
    }
    const hasFindings = info.inputs.some((i) => i.key === 'findings');
    if (hasFindings) {
      els.push(text(left, y, inner, 16, 'Findings: {{input.findings}}', { fontSize: 10, lineHeight: 1.5 }));
      y += 18;
    }
    els.push(text(left, y, inner, 14, '{{certificate.remarks}}', { fontSize: 10, color: '#4b5563', italic: true }));
  }

  // Footer: dates, signature and verification.
  const fy = H - 52;
  els.push(text(left, fy + 4, 70, 18, 'Certificate no. {{certificate.number}}\nIssued {{certificate.issuedAt}}\n{{certificate.validity}}', { fontSize: 8.5, color: '#4b5563', lineHeight: 1.5 }));
  els.push({ id: nid('s'), type: 'signature', x: W - 22 - 70, y: fy, w: 70, h: 22, label: info.subject === 'STAFF' ? 'For {{clinic.name}}' : 'Veterinarian', color: '#1f2937', showName: true, fontSize: 9 });
  els.push({ id: nid('q'), type: 'qr', x: W / 2 - 12, y: fy - 4, w: 24, h: 24, color: '#111827', caption: false });
  els.push(text(W / 2 - 30, fy + 21, 60, 10, 'Scan to verify · {{certificate.code}}', { fontSize: 7, align: 'center', color: '#6b7280' }));
  els.push({ id: nid('bc'), type: 'barcode', x: W / 2 - 25, y: H - 22, w: 50, h: 9, color: '#111827', showText: false });
  return { version: 1, page, elements: els };
}

// ── Verification codes and barcodes ──

/** "K7Q2-M9XP-4TRA" from the stored code (12 characters, no look-alikes). */
export const formatVerificationCode = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-');
/** Whatever someone typed or scanned, back to the stored form. */
export const normaliseVerificationCode = (input: string) => input.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const VERIFICATION_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Code 128 bar widths for each symbol (bar, space, bar, space, bar, space), plus the stop symbol. */
const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132',
  '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212',
  '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311',
  '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212',
  '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113',
  '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
export const CODE128_PATTERNS = CODE128;

/**
 * Code 128 (set B) for printable ASCII: the bars as module widths, alternating bar and space, starting with a bar.
 * Quiet zones are left to the renderer.
 */
export function code128(value: string): number[] {
  const codes = [...value].map((ch) => {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error('Code 128 B takes printable characters only');
    return c - 32;
  });
  const checksum = (104 + codes.reduce((n, c, i) => n + c * (i + 1), 0)) % 103;
  return [104, ...codes, checksum, 106].flatMap((s) => [...CODE128[s]].map(Number));
}

// ── Requests ──

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date');

export const certificateTemplateSchema = z.object({
  kind: z.enum(CERTIFICATE_KINDS),
  name: z.string().trim().min(2, 'Name the template').max(120),
  layout: certificateLayoutSchema,
});
export type CertificateTemplateInput = z.infer<typeof certificateTemplateSchema>;

export const certificateTemplateUpdateSchema = certificateTemplateSchema.omit({ kind: true }).partial().extend({ isActive: z.boolean().optional() });
export type CertificateTemplateUpdate = z.infer<typeof certificateTemplateUpdateSchema>;

export const issueCertificateSchema = z
  .object({
    kind: z.enum(CERTIFICATE_KINDS),
    /** Empty: the clinic's default template for the kind (or the built-in design). */
    templateId: z.string().uuid().nullish(),
    patientId: z.string().uuid().nullish(),
    membershipId: z.string().uuid().nullish(),
    encounterId: z.string().uuid().nullish(),
    inputs: z.record(z.string().max(4000)).default({}),
    /** Vaccinations to list (vaccination certificates); empty: all on record. */
    vaccinationIds: z.array(z.string().uuid()).max(200).optional(),
    validUntil: isoDate.nullish(),
    /** Issuing a corrected copy: the old certificate is revoked in the same step. */
    replacesId: z.string().uuid().nullish(),
  })
  .superRefine((v, ctx) => {
    const subject = CERTIFICATE_KIND_INFO[v.kind].subject;
    if (subject === 'PATIENT' && !v.patientId) ctx.addIssue({ code: 'custom', path: ['patientId'], message: 'Choose the patient' });
    if (subject === 'STAFF' && !v.membershipId) ctx.addIssue({ code: 'custom', path: ['membershipId'], message: 'Choose the staff member' });
    for (const i of CERTIFICATE_KIND_INFO[v.kind].inputs) {
      const value = (v.inputs[i.key] ?? '').trim();
      if (i.required && !value) ctx.addIssue({ code: 'custom', path: ['inputs', i.key], message: `${i.label} is required` });
      if (value && i.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) ctx.addIssue({ code: 'custom', path: ['inputs', i.key], message: `${i.label} must be a date` });
      if (value && i.type === 'number' && !Number.isFinite(Number(value))) ctx.addIssue({ code: 'custom', path: ['inputs', i.key], message: `${i.label} must be a number` });
    }
  });
export type IssueCertificateInput = z.infer<typeof issueCertificateSchema>;

export const revokeCertificateSchema = z.object({ reason: z.string().trim().min(3, 'Say why').max(500) });

export const certificateListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  subject: z.enum(CERTIFICATE_SUBJECTS).optional(),
  kind: z.enum(CERTIFICATE_KINDS).optional(),
  status: z.enum(['ISSUED', 'REVOKED', 'EXPIRED']).optional(),
  patientId: z.string().uuid().optional(),
  membershipId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
});
export type CertificateListQuery = z.infer<typeof certificateListQuery>;

/** What the public verification page shows: enough to confirm the certificate, nothing more. */
export interface CertificateVerification {
  found: boolean;
  status?: 'VALID' | 'EXPIRED' | 'REVOKED';
  number?: string;
  title?: string;
  kindLabel?: string;
  issuedAt?: string;
  validUntil?: string | null;
  clinic?: string;
  /** "Bruno — Dog, Labrador Retriever" or the staff member's name. */
  subject?: string;
  /** The owner's name with the family name shortened ("Ahmed K."). */
  owner?: string | null;
  issuedBy?: string;
  revokedAt?: string | null;
  revokedReason?: string | null;
  replacedBy?: string | null;
  contentHash?: string;
}
