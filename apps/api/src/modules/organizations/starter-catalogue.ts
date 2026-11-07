import type { AppointmentCategory, BoardingUnitType, LabCategory, LocationType, ResourceType, ResultType, SampleType, ServiceCategory, WardType } from '@prisma/client';
import { DENTAL_PROCEDURES } from '@vcms/shared';

/**
 * What every new clinic starts with, so day one works without a settings tour. Everything here is a name and a
 * place to put a price: every price is 0 until the clinic sets its own ("Check your price list" in the setup
 * checklist), nothing clinical is assumed (no doses, schedules or reference ranges), and the clinic can rename,
 * switch off or delete any of it. Areas a clinic does not use (hospital, boarding, dental…) stay hidden while that
 * service is switched off in Settings → Services you offer.
 */

export interface StarterService {
  code: string;
  name: string;
  category: ServiceCategory;
}

/** The price list. Codes are stable so the starter items can be linked to below. */
export const STARTER_PRICE_LIST: StarterService[] = [
  // Consultations
  { code: 'CONSULT', name: 'Consultation', category: 'CONSULTATION' },
  { code: 'FOLLOWUP', name: 'Follow-up', category: 'CONSULTATION' },
  { code: 'EMERGENCY', name: 'Emergency consultation', category: 'CONSULTATION' },
  { code: 'HEALTHCHECK', name: 'Health check', category: 'CONSULTATION' },
  { code: 'TRAVELCHECK', name: 'Travel / fit-to-fly check', category: 'CONSULTATION' },
  // Preventive care
  { code: 'VACCINATION', name: 'Vaccination', category: 'VACCINATION' },
  { code: 'DEWORMING', name: 'Deworming', category: 'PROCEDURE' },
  { code: 'TICKFLEA', name: 'Tick & flea treatment', category: 'PROCEDURE' },
  { code: 'MICROCHIP', name: 'Microchip implant', category: 'PROCEDURE' },
  // Treatments and procedures
  { code: 'INJECTION', name: 'Injection', category: 'PROCEDURE' },
  { code: 'FLUIDS', name: 'Fluid therapy (drip)', category: 'PROCEDURE' },
  { code: 'WOUND', name: 'Wound cleaning & dressing', category: 'PROCEDURE' },
  { code: 'BANDAGE', name: 'Bandage change', category: 'PROCEDURE' },
  { code: 'SUTURE-RM', name: 'Suture removal', category: 'PROCEDURE' },
  { code: 'EARCLEAN', name: 'Ear cleaning (clinical)', category: 'PROCEDURE' },
  { code: 'ANALGLAND', name: 'Anal gland expression', category: 'PROCEDURE' },
  { code: 'SEDATION', name: 'Sedation', category: 'PROCEDURE' },
  { code: 'EUTHANASIA', name: 'Euthanasia', category: 'PROCEDURE' },
  { code: 'CREMATION', name: 'Cremation arrangement', category: 'OTHER' },
  // Surgery
  { code: 'SPAY', name: 'Spay (ovariohysterectomy)', category: 'SURGERY' },
  { code: 'NEUTER', name: 'Castration (neuter)', category: 'SURGERY' },
  { code: 'GA', name: 'General anaesthetic', category: 'SURGERY' },
  { code: 'SURG-MINOR', name: 'Minor surgery', category: 'SURGERY' },
  { code: 'SURG-MAJOR', name: 'Major surgery', category: 'SURGERY' },
  { code: 'LUMP', name: 'Lump removal', category: 'SURGERY' },
  // Diagnostics (tests themselves are priced in the test catalogue)
  { code: 'SAMPLE', name: 'Sample collection', category: 'DIAGNOSTIC' },
  // Hospital
  { code: 'HOSPDAY', name: 'Hospital stay (per day)', category: 'HOSPITALISATION' },
  { code: 'ICUDAY', name: 'Intensive care (per day)', category: 'HOSPITALISATION' },
  { code: 'ISODAY', name: 'Isolation (per day)', category: 'HOSPITALISATION' },
  // Grooming
  { code: 'GROOM-FULL', name: 'Full groom', category: 'GROOMING' },
  { code: 'GROOM-BATH', name: 'Bath & blow-dry', category: 'GROOMING' },
  { code: 'GROOM-NAILS', name: 'Nail trim', category: 'GROOMING' },
  { code: 'GROOM-EARS', name: 'Ear cleaning (grooming)', category: 'GROOMING' },
  { code: 'GROOM-DESHED', name: 'De-shedding treatment', category: 'GROOMING' },
  { code: 'GROOM-HYGIENE', name: 'Hygiene trim', category: 'GROOMING' },
  // Boarding
  { code: 'BOARD-DOG', name: 'Boarding — dog (per night)', category: 'BOARDING' },
  { code: 'BOARD-CAT', name: 'Boarding — cat (per night)', category: 'BOARDING' },
  // Home visits
  { code: 'HV-CALLOUT', name: 'Home visit call-out fee', category: 'FIELD_VISIT' },
  { code: 'HV-KM', name: 'Home visit travel (per km)', category: 'FIELD_VISIT' },
  // Paperwork
  { code: 'CERT', name: 'Certificate', category: 'OTHER' },
  // Dental: one service per procedure on the dental chart (Settings → Dental prices links them).
  ...DENTAL_PROCEDURES.map((p) => ({ code: `DENT-${p.code}`, name: `Dental: ${p.label}`, category: 'DENTAL' as const })),
];

/** Which price-list service each dental chart procedure charges (Settings → Dental prices). */
export const STARTER_DENTAL_PRICES = DENTAL_PROCEDURES.map((p) => ({ code: p.code, serviceCode: `DENT-${p.code}` }));

/** Settings → Home visits: the call-out fee and the price per km. */
export const STARTER_HOME_VISIT = { calloutCode: 'HV-CALLOUT', perKmCode: 'HV-KM' };

/** What can be booked on the calendar. Durations are booking defaults the clinic changes in Settings → Appointment types. */
export const STARTER_APPOINTMENT_TYPES: { name: string; kind: AppointmentCategory; /** A starter category by name (else the kind's usual one). */ category?: string; durationMinutes: number; color: string; serviceCode: string | null; allowOnlineBooking?: boolean }[] = [
  { name: 'Consultation', kind: 'CONSULTATION', durationMinutes: 20, color: '#0d7a70', serviceCode: 'CONSULT', allowOnlineBooking: true },
  { name: 'Follow-up', kind: 'FOLLOW_UP', durationMinutes: 15, color: '#7c3aed', serviceCode: 'FOLLOWUP', allowOnlineBooking: true },
  { name: 'Vaccination', kind: 'VACCINATION', durationMinutes: 15, color: '#2563eb', serviceCode: 'VACCINATION', allowOnlineBooking: true },
  { name: 'Deworming', kind: 'VACCINATION', category: 'Deworming', durationMinutes: 15, color: '#65a30d', serviceCode: 'DEWORMING' },
  { name: 'Health check', kind: 'CONSULTATION', durationMinutes: 20, color: '#0891b2', serviceCode: 'HEALTHCHECK', allowOnlineBooking: true },
  { name: 'Emergency', kind: 'EMERGENCY', durationMinutes: 30, color: '#dc2626', serviceCode: 'EMERGENCY' },
  { name: 'Surgery', kind: 'SURGERY', durationMinutes: 90, color: '#b45309', serviceCode: null },
  { name: 'Dental', kind: 'DENTAL', durationMinutes: 60, color: '#0f766e', serviceCode: 'DENT-SP' },
  { name: 'Diagnostics (tests & imaging)', kind: 'DIAGNOSTICS', durationMinutes: 30, color: '#4f46e5', serviceCode: 'SAMPLE' },
  { name: 'Full groom', kind: 'GROOMING', durationMinutes: 90, color: '#db2777', serviceCode: 'GROOM-FULL', allowOnlineBooking: true },
  { name: 'Bath & blow-dry', kind: 'GROOMING', durationMinutes: 60, color: '#ec4899', serviceCode: 'GROOM-BATH', allowOnlineBooking: true },
  { name: 'Nail trim', kind: 'GROOMING', durationMinutes: 15, color: '#f472b6', serviceCode: 'GROOM-NAILS', allowOnlineBooking: true },
];

/** Settings → Rooms, theatres & equipment (per branch). */
export const STARTER_RESOURCES: { name: string; type: ResourceType }[] = [
  { name: 'Consult room 1', type: 'ROOM' },
  { name: 'Consult room 2', type: 'ROOM' },
  { name: 'Treatment room', type: 'ROOM' },
  { name: 'Grooming room', type: 'ROOM' },
  { name: 'Theatre', type: 'THEATRE' },
  { name: 'X-ray machine', type: 'EQUIPMENT' },
  { name: 'Ultrasound scanner', type: 'EQUIPMENT' },
];

/** Settings → Hospital wards & cages (per branch). Each ward charges its daily service per started day. */
export const STARTER_WARDS: { name: string; type: WardType; dailyServiceCode: string; cages: string[] }[] = [
  { name: 'General ward', type: 'GENERAL', dailyServiceCode: 'HOSPDAY', cages: ['Cage 1', 'Cage 2', 'Cage 3', 'Cage 4', 'Cage 5', 'Cage 6'] },
  { name: 'Cattery ward', type: 'CATTERY', dailyServiceCode: 'HOSPDAY', cages: ['Cat cage 1', 'Cat cage 2', 'Cat cage 3', 'Cat cage 4'] },
  { name: 'Intensive care', type: 'ICU', dailyServiceCode: 'ICUDAY', cages: ['ICU 1', 'ICU 2'] },
  { name: 'Isolation', type: 'ISOLATION', dailyServiceCode: 'ISODAY', cages: ['Isolation 1', 'Isolation 2'] },
];

/** Settings → Boarding kennels (per branch). Each unit charges its nightly service. */
export const STARTER_BOARDING_UNITS: { name: string; type: BoardingUnitType; nightlyServiceCode: string }[] = [
  { name: 'Kennel 1', type: 'KENNEL', nightlyServiceCode: 'BOARD-DOG' },
  { name: 'Kennel 2', type: 'KENNEL', nightlyServiceCode: 'BOARD-DOG' },
  { name: 'Kennel 3', type: 'KENNEL', nightlyServiceCode: 'BOARD-DOG' },
  { name: 'Kennel 4', type: 'KENNEL', nightlyServiceCode: 'BOARD-DOG' },
  { name: 'Cattery 1', type: 'CATTERY', nightlyServiceCode: 'BOARD-CAT' },
  { name: 'Cattery 2', type: 'CATTERY', nightlyServiceCode: 'BOARD-CAT' },
];

/**
 * Stock → Store rooms (per branch). Stock is received into the default one and medicines are taken from it.
 * Stock checks only start once the branch has entered some stock (InventoryService.trackingLocation), so an empty
 * store never blocks a sale or a dispense on day one.
 */
export const STARTER_STORE_ROOMS: { name: string; type: LocationType; isDefault: boolean }[] = [
  { name: 'Main store', type: 'STORE', isDefault: true },
  { name: 'Pharmacy', type: 'PHARMACY', isDefault: false },
];

/** Stock → Suppliers: for things bought over the counter when there is no regular supplier. */
/** The till drawer each branch starts with. */
export const STARTER_CASH_DRAWER = 'Reception';

export const STARTER_SUPPLIER = {
  name: 'Local Purchase',
  paymentTermsDays: 0,
  notes: 'For stock bought locally (cash or card) when there is no regular supplier. Add your own suppliers alongside it.',
};

type Analyte = { code: string; name: string; unit?: string; resultType?: ResultType; options?: string[]; decimals?: number };
const N = (code: string, name: string, unit: string, decimals = 1): Analyte => ({ code, name, unit, decimals });
const O = (code: string, name: string, options: string[]): Analyte => ({ code, name, resultType: 'OPTION', options });
const T = (code: string, name: string): Analyte => ({ code, name, resultType: 'TEXT' });
const POS_NEG = ['Negative', 'Positive', 'Inconclusive'];

/**
 * Lab → Test catalogue: common tests with what is measured and its unit, price 0. No reference intervals: those must
 * come from the clinic's own analyser or laboratory, with their source (Lab → Test catalogue → reference ranges).
 */
export const STARTER_LAB_TESTS: { code: string; name: string; category: LabCategory; sampleType: SampleType; modality?: string; analytes: Analyte[] }[] = [
  { code: 'CBC', name: 'Complete blood count', category: 'HAEMATOLOGY', sampleType: 'WHOLE_BLOOD_EDTA', analytes: [N('HCT', 'Haematocrit', '%'), N('HGB', 'Haemoglobin', 'g/L', 0), N('RBC', 'Red blood cells', '×10¹²/L', 2), N('WBC', 'White blood cells', '×10⁹/L'), N('NEU', 'Neutrophils', '×10⁹/L', 2), N('LYM', 'Lymphocytes', '×10⁹/L', 2), N('MON', 'Monocytes', '×10⁹/L', 2), N('EOS', 'Eosinophils', '×10⁹/L', 2), N('PLT', 'Platelets', '×10⁹/L', 0)] },
  { code: 'BIOCH', name: 'Biochemistry panel', category: 'BIOCHEMISTRY', sampleType: 'SERUM', analytes: [N('ALT', 'ALT', 'U/L', 0), N('ALP', 'ALP', 'U/L', 0), N('UREA', 'Urea', 'mmol/L'), N('CREA', 'Creatinine', 'µmol/L', 0), N('GLU', 'Glucose', 'mmol/L'), N('TP', 'Total protein', 'g/L', 0), N('ALB', 'Albumin', 'g/L', 0), N('TBIL', 'Total bilirubin', 'µmol/L')] },
  { code: 'GLU', name: 'Blood glucose', category: 'BIOCHEMISTRY', sampleType: 'WHOLE_BLOOD_EDTA', analytes: [N('GLU', 'Glucose', 'mmol/L')] },
  { code: 'UA', name: 'Urinalysis', category: 'URINALYSIS', sampleType: 'URINE', analytes: [N('USG', 'Specific gravity', '', 3), N('PH', 'pH', ''), O('PRO', 'Protein (dipstick)', ['Negative', 'Trace', '1+', '2+', '3+']), O('BLD', 'Blood (dipstick)', ['Negative', 'Trace', '1+', '2+', '3+']), O('GLUU', 'Glucose (dipstick)', ['Negative', 'Trace', '1+', '2+', '3+']), T('SED', 'Sediment')] },
  { code: 'FAECAL', name: 'Faecal examination', category: 'PARASITOLOGY', sampleType: 'FAECES', analytes: [O('RES', 'Result', ['No parasites seen', 'Parasite eggs seen', 'Protozoa seen']), T('ID', 'Organisms identified')] },
  { code: 'SMEAR', name: 'Blood smear (blood parasites)', category: 'PARASITOLOGY', sampleType: 'WHOLE_BLOOD_EDTA', analytes: [O('RES', 'Result', ['No parasites seen', 'Parasites seen']), T('ID', 'Organisms identified')] },
  { code: 'SKINSCRAPE', name: 'Skin scraping', category: 'PARASITOLOGY', sampleType: 'SKIN_SCRAPING', analytes: [O('RES', 'Result', ['No mites seen', 'Mites seen']), T('ID', 'Findings')] },
  { code: 'EARCYTO', name: 'Ear cytology', category: 'CYTOLOGY', sampleType: 'SWAB', analytes: [O('YEAST', 'Yeast', ['None', 'Few', 'Moderate', 'Many']), O('COCCI', 'Cocci', ['None', 'Few', 'Moderate', 'Many']), O('RODS', 'Rods', ['None', 'Few', 'Moderate', 'Many']), T('NOTE', 'Comment')] },
  { code: 'FNA', name: 'Fine-needle aspirate (cytology)', category: 'CYTOLOGY', sampleType: 'TISSUE', analytes: [T('REP', 'Report')] },
  { code: 'PARVO', name: 'Parvovirus antigen (rapid test)', category: 'SEROLOGY', sampleType: 'FAECES', analytes: [O('RES', 'Result', POS_NEG)] },
  { code: 'CDV', name: 'Distemper antigen (rapid test)', category: 'SEROLOGY', sampleType: 'SWAB', analytes: [O('RES', 'Result', POS_NEG)] },
  { code: 'FIVFELV', name: 'FIV / FeLV (rapid test)', category: 'SEROLOGY', sampleType: 'WHOLE_BLOOD_EDTA', analytes: [O('FIV', 'FIV antibody', POS_NEG), O('FELV', 'FeLV antigen', POS_NEG)] },
  { code: 'HEARTWORM', name: 'Heartworm antigen (rapid test)', category: 'SEROLOGY', sampleType: 'WHOLE_BLOOD_EDTA', analytes: [O('RES', 'Result', POS_NEG)] },
  { code: 'CULTURE', name: 'Culture & sensitivity', category: 'MICROBIOLOGY', sampleType: 'SWAB', analytes: [T('ORG', 'Organism(s)'), T('SENS', 'Sensitivity')] },
  { code: 'HISTO', name: 'Histopathology (biopsy)', category: 'HISTOPATHOLOGY', sampleType: 'TISSUE', analytes: [T('REP', 'Report')] },
  { code: 'XRAY', name: 'X-ray', category: 'IMAGING', sampleType: 'NONE', modality: 'XRAY', analytes: [] },
  { code: 'US-ABD', name: 'Abdominal ultrasound', category: 'IMAGING', sampleType: 'NONE', modality: 'ULTRASOUND', analytes: [] },
];
