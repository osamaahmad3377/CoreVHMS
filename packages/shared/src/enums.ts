/** Enumerations shared by API, database and UI. Keep in sync with prisma/schema.prisma enums. */
export const CLIENT_TYPES = ['INDIVIDUAL', 'FAMILY', 'FARM', 'BREEDER', 'COMPANY', 'SHELTER', 'OTHER'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const CLIENT_STATUSES = ['ACTIVE', 'ARCHIVED', 'MERGED'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CONTACT_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP', 'PHONE', 'POST'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const CONTACT_ROLES = ['CO_OWNER', 'AUTHORIZED', 'EMERGENCY', 'BILLING', 'OTHER'] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const SPECIES_CATEGORIES = ['COMPANION', 'LIVESTOCK', 'POULTRY', 'EQUINE', 'EXOTIC', 'WILDLIFE'] as const;
export type SpeciesCategory = (typeof SPECIES_CATEGORIES)[number];

export const PATIENT_SEXES = ['MALE', 'FEMALE', 'MALE_NEUTERED', 'FEMALE_SPAYED', 'UNKNOWN'] as const;
export type PatientSex = (typeof PATIENT_SEXES)[number];

export const PATIENT_STATUSES = ['ACTIVE', 'DECEASED', 'TRANSFERRED', 'ARCHIVED', 'MERGED'] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];

export const IDENTIFIER_TYPES = ['MICROCHIP', 'EAR_TAG', 'RFID', 'TATTOO', 'BRAND', 'REGISTRATION', 'OTHER'] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

export const ALERT_TYPES = ['ALLERGY', 'CONDITION', 'BEHAVIOUR', 'MEDICATION', 'OTHER'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const MEMBERSHIP_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const COUNTRIES = [
  { code: 'PK', name: 'Pakistan', currency: 'PKR', timezone: 'Asia/Karachi' },
  { code: 'AU', name: 'Australia', currency: 'AUD', timezone: 'Australia/Sydney' },
] as const;

export const ENUM_LABELS: Record<string, string> = {
  INDIVIDUAL: 'Individual',
  FAMILY: 'Family',
  FARM: 'Farm',
  BREEDER: 'Breeder',
  COMPANY: 'Company',
  SHELTER: 'Shelter / rescue',
  OTHER: 'Other',
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
  MERGED: 'Merged',
  EMAIL: 'Email',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  PHONE: 'Phone',
  POST: 'Post',
  CO_OWNER: 'Co-owner',
  AUTHORIZED: 'Authorized contact',
  EMERGENCY: 'Emergency contact',
  BILLING: 'Billing contact',
  COMPANION: 'Companion',
  LIVESTOCK: 'Livestock',
  POULTRY: 'Poultry',
  EQUINE: 'Equine',
  EXOTIC: 'Exotic',
  WILDLIFE: 'Wildlife',
  MALE: 'Male',
  FEMALE: 'Female',
  MALE_NEUTERED: 'Male (neutered)',
  FEMALE_SPAYED: 'Female (spayed)',
  UNKNOWN: 'Unknown',
  DECEASED: 'Deceased',
  TRANSFERRED: 'Transferred',
  MICROCHIP: 'Microchip',
  EAR_TAG: 'Ear tag',
  RFID: 'RFID',
  TATTOO: 'Tattoo',
  BRAND: 'Brand',
  REGISTRATION: 'Registration no.',
  ALLERGY: 'Allergy',
  CONDITION: 'Chronic condition',
  BEHAVIOUR: 'Behaviour',
  MEDICATION: 'Medication',
  INFO: 'Info',
  WARNING: 'Warning',
  CRITICAL: 'Critical',
  INVITED: 'Invited',
  SUSPENDED: 'Suspended',
};

/**
 * Wording that only fits one domain. Several enums share a value (IN_PROGRESS is a surgery, lab order, field visit
 * and grooming state), so the flat map holds a neutral label and a screen asks for its domain's wording here.
 */
export type LabelScope = 'surgery' | 'lab' | 'message' | 'outcome' | 'contactRole' | 'purchaseOrder' | 'wardType' | 'treatment' | 'sample' | 'movement';
export const SCOPED_ENUM_LABELS: Record<LabelScope, Record<string, string>> = {
  surgery: { IN_PROGRESS: 'In surgery' },
  lab: { COLLECTED: 'Sample collected' },
  message: { GENERAL: 'General message' },
  outcome: { DECEASED: 'Died' },
  contactRole: { AUTHORIZED: 'Authorised contact' },
  purchaseOrder: { SUBMITTED: 'Awaiting approval' },
  wardType: { KENNEL: 'Kennels' },
  treatment: { FLUID: 'Fluids' },
  sample: { FLUID: 'Body fluid' },
  movement: { BIRTH: 'Born', DEATH: 'Died', SALE: 'Sold' },
};

export function enumLabel(value: string | null | undefined, scope?: LabelScope): string {
  if (!value) return '';
  return (scope && SCOPED_ENUM_LABELS[scope][value]) ?? ENUM_LABELS[value] ?? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

export const APPOINTMENT_CATEGORIES = ['CONSULTATION', 'VACCINATION', 'FOLLOW_UP', 'SURGERY', 'DENTAL', 'DIAGNOSTICS', 'GROOMING', 'EMERGENCY', 'FIELD_VISIT', 'OTHER'] as const;
export const RESOURCE_TYPES = ['ROOM', 'THEATRE', 'EQUIPMENT', 'KENNEL', 'VEHICLE', 'OTHER'] as const;
export const LEAVE_TYPES = ['ANNUAL', 'SICK', 'TRAINING', 'PUBLIC_HOLIDAY', 'OTHER'] as const;
export const APPOINTMENT_STATUSES = ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const APPOINTMENT_SOURCES = ['RECEPTION', 'PHONE', 'ONLINE', 'WALK_IN', 'FOLLOW_UP'] as const;
/** Where a visit happens: at the clinic, or a vet goes to the client's home. */
export const VISIT_LOCATIONS = ['CLINIC', 'HOME'] as const;
export type VisitLocation = (typeof VISIT_LOCATIONS)[number];
/** Five-level triage scale (colour-coded). Staff choose the level; the system never assigns it automatically. */
export const TRIAGE_PRIORITIES = ['RESUSCITATION', 'EMERGENT', 'URGENT', 'LESS_URGENT', 'NON_URGENT'] as const;
export type TriagePriority = (typeof TRIAGE_PRIORITIES)[number];
export const TRIAGE_COLOURS: Record<TriagePriority, string> = {
  RESUSCITATION: '#b91c1c',
  EMERGENT: '#ea580c',
  URGENT: '#ca8a04',
  LESS_URGENT: '#16a34a',
  NON_URGENT: '#2563eb',
};
export const ENCOUNTER_TYPES = ['CONSULTATION', 'EMERGENCY', 'FOLLOW_UP', 'VACCINATION', 'FIELD_VISIT', 'TELEHEALTH', 'HOSPITAL_ROUND', 'OTHER'] as const;
export const NOTE_STATUSES = ['DRAFT', 'REVIEWED', 'SIGNED', 'SUPERSEDED'] as const;
export const DIAGNOSIS_TYPES = ['DIFFERENTIAL', 'PROVISIONAL', 'CONFIRMED'] as const;
export const DIAGNOSIS_STATUSES = ['ACTIVE', 'RESOLVED', 'RULED_OUT'] as const;
export const PROBLEM_STATUSES = ['ACTIVE', 'INACTIVE', 'RESOLVED'] as const;
export const TASK_TYPES = ['FOLLOW_UP_CALL', 'RECHECK', 'RESULT_REVIEW', 'CLIENT_CALLBACK', 'ADMIN', 'OTHER'] as const;
export const EXAM_SYSTEMS = [
  'General appearance', 'Eyes', 'Ears', 'Nose & throat', 'Oral cavity & teeth', 'Lymph nodes', 'Cardiovascular',
  'Respiratory', 'Abdomen', 'Gastrointestinal', 'Urogenital', 'Musculoskeletal', 'Neurological', 'Skin & coat',
  'Mammary', 'Rumen (ruminants)', 'Udder (dairy)', 'Hooves / feet',
] as const;
export const VITAL_PARAMETERS = ['temperatureC', 'heartRate', 'respiratoryRate', 'capillaryRefillSec', 'systolicBp', 'spo2'] as const;
export const VITAL_LABELS: Record<string, { label: string; unit: string }> = {
  temperatureC: { label: 'Temperature', unit: '°C' },
  heartRate: { label: 'Heart rate', unit: 'bpm' },
  respiratoryRate: { label: 'Respiratory rate', unit: 'breaths/min' },
  capillaryRefillSec: { label: 'CRT', unit: 's' },
  systolicBp: { label: 'Systolic BP', unit: 'mmHg' },
  spo2: { label: 'SpO₂', unit: '%' },
};

Object.assign(ENUM_LABELS, {
  CONSULTATION: 'Consultation', VACCINATION: 'Vaccination', FOLLOW_UP: 'Follow-up', SURGERY: 'Surgery', DENTAL: 'Dental',
  DIAGNOSTICS: 'Diagnostics', GROOMING: 'Grooming', EMERGENCY: 'Emergency', FIELD_VISIT: 'Field visit',
  ROOM: 'Consult room', THEATRE: 'Theatre', EQUIPMENT: 'Equipment', KENNEL: 'Kennel', VEHICLE: 'Vehicle',
  ANNUAL: 'Annual leave', SICK: 'Sick leave', TRAINING: 'Training', PUBLIC_HOLIDAY: 'Public holiday',
  BOOKED: 'Booked', CONFIRMED: 'Confirmed', CHECKED_IN: 'Checked in', IN_CONSULTATION: 'In consultation',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled', NO_SHOW: 'No-show',
  RECEPTION: 'Reception', ONLINE: 'Online', WALK_IN: 'Walk-in',
  RESUSCITATION: 'Critical — see now', EMERGENT: 'Very urgent', URGENT: 'Urgent', LESS_URGENT: 'Can wait', NON_URGENT: 'Routine',
  TELEHEALTH: 'Telehealth', HOSPITAL_ROUND: 'Hospital round',
  DRAFT: 'Draft', REVIEWED: 'Reviewed', SIGNED: 'Signed', SUPERSEDED: 'Replaced by a correction',
  DIFFERENTIAL: 'Differential', PROVISIONAL: 'Provisional', RESOLVED: 'Resolved', RULED_OUT: 'Ruled out', INACTIVE: 'Inactive',
  FOLLOW_UP_CALL: 'Follow-up call', RECHECK: 'Recheck', RESULT_REVIEW: 'Result review', CLIENT_CALLBACK: 'Client callback', ADMIN: 'Admin',
  OPEN: 'Open', DONE: 'Done', WAITING: 'Waiting',
});

export const PRODUCT_TYPES = ['MEDICINE', 'VACCINE', 'CONSUMABLE', 'FOOD', 'GROOMING', 'ACCESSORY', 'SUPPLEMENT', 'RETAIL', 'EQUIPMENT'] as const;
/** Types that can be prescribed and carry dose, strength, prescription-only and controlled settings. */
export const PRESCRIBABLE_PRODUCT_TYPES = ['MEDICINE', 'VACCINE'] as const;
/** Plain-language names used in forms, filters and the shop counter. */
export const PRODUCT_TYPE_LABELS: Record<(typeof PRODUCT_TYPES)[number], string> = {
  MEDICINE: 'Medicines',
  VACCINE: 'Vaccines',
  CONSUMABLE: 'Clinic consumables',
  FOOD: 'Food & treats',
  GROOMING: 'Grooming & hygiene',
  ACCESSORY: 'Accessories',
  SUPPLEMENT: 'Supplements',
  RETAIL: 'Other shop items',
  EQUIPMENT: 'Equipment',
};
/** Units for shop items (medicines use DISPENSING_UNITS). */
export const RETAIL_UNITS = ['piece', 'pack', 'bag', 'can', 'pouch', 'tin', 'bottle', 'tube', 'box', 'roll', 'pair', 'set', 'kg', 'g', 'L', 'mL', 'unit'] as const;
/**
 * Starter shelf categories given to every new organization (also added to existing ones by migration
 * retail_products). Shop groupings only — no clinical meaning; each clinic can rename, add or hide them.
 */
export const DEFAULT_PRODUCT_CATEGORIES: { name: string; productType: (typeof PRODUCT_TYPES)[number]; sortOrder: number }[] = [
  { name: 'Dry food', productType: 'FOOD', sortOrder: 10 },
  { name: 'Wet food', productType: 'FOOD', sortOrder: 20 },
  { name: 'Veterinary diets', productType: 'FOOD', sortOrder: 30 },
  { name: 'Treats & chews', productType: 'FOOD', sortOrder: 40 },
  { name: 'Livestock feed & minerals', productType: 'FOOD', sortOrder: 50 },
  { name: 'Shampoos & conditioners', productType: 'GROOMING', sortOrder: 10 },
  { name: 'Brushes, combs & clippers', productType: 'GROOMING', sortOrder: 20 },
  { name: 'Ear, eye & dental care', productType: 'GROOMING', sortOrder: 30 },
  { name: 'Litter & hygiene', productType: 'GROOMING', sortOrder: 40 },
  { name: 'Collars, leads & harnesses', productType: 'ACCESSORY', sortOrder: 10 },
  { name: 'Toys', productType: 'ACCESSORY', sortOrder: 20 },
  { name: 'Beds, crates & carriers', productType: 'ACCESSORY', sortOrder: 30 },
  { name: 'Bowls & feeders', productType: 'ACCESSORY', sortOrder: 40 },
  { name: 'Clothing & recovery wear', productType: 'ACCESSORY', sortOrder: 50 },
  { name: 'Vitamins & supplements', productType: 'SUPPLEMENT', sortOrder: 10 },
];
export const DOSAGE_FORMS = ['TABLET', 'CAPSULE', 'ORAL_LIQUID', 'ORAL_PASTE', 'INJECTION', 'INFUSION', 'TOPICAL', 'OPHTHALMIC', 'OTIC', 'SPOT_ON', 'POUR_ON', 'BOLUS', 'INTRAMAMMARY', 'POWDER', 'IMPLANT', 'INHALANT', 'OTHER'] as const;
export const ROUTES = ['PO', 'SC', 'IM', 'IV', 'TOPICAL', 'OPHTHALMIC', 'OTIC', 'INTRAMAMMARY', 'INTRANASAL', 'RECTAL', 'TRANSDERMAL', 'INHALED', 'OTHER'] as const;
export const DISPENSING_UNITS = ['tablet', 'capsule', 'mL', 'g', 'dose', 'vial', 'ampoule', 'tube', 'sachet', 'pipette', 'bolus', 'unit', 'syringe'] as const;
export const PRESCRIPTION_STATUSES = ['DRAFT', 'AUTHORIZED', 'PARTIALLY_DISPENSED', 'DISPENSED', 'CANCELLED'] as const;
export const LAB_CATEGORIES = ['HAEMATOLOGY', 'BIOCHEMISTRY', 'URINALYSIS', 'PARASITOLOGY', 'MICROBIOLOGY', 'CYTOLOGY', 'HISTOPATHOLOGY', 'SEROLOGY', 'ENDOCRINOLOGY', 'MOLECULAR', 'IMAGING', 'OTHER'] as const;
export const SAMPLE_TYPES = ['WHOLE_BLOOD_EDTA', 'SERUM', 'PLASMA', 'URINE', 'FAECES', 'SWAB', 'TISSUE', 'MILK', 'SKIN_SCRAPING', 'FLUID', 'OTHER', 'NONE'] as const;
export const IMAGING_MODALITIES = ['XRAY', 'ULTRASOUND', 'CT', 'MRI', 'ENDOSCOPY', 'ECG', 'OTHER'] as const;
export const ORDER_PRIORITIES = ['ROUTINE', 'URGENT', 'STAT'] as const;
export const ORDER_STATUSES = ['ORDERED', 'COLLECTED', 'IN_PROGRESS', 'AWAITING_VALIDATION', 'RELEASED', 'CANCELLED'] as const;

Object.assign(ENUM_LABELS, {
  MEDICINE: 'Medicine', VACCINE: 'Vaccine', CONSUMABLE: 'Clinic consumables', RETAIL: 'Other shop items', FOOD: 'Food & treats', EQUIPMENT: 'Equipment',
  TABLET: 'Tablet', CAPSULE: 'Capsule', ORAL_LIQUID: 'Oral liquid', ORAL_PASTE: 'Oral paste', INJECTION: 'Injection', INFUSION: 'Infusion',
  TOPICAL: 'Topical', OPHTHALMIC: 'Ophthalmic', OTIC: 'Otic', SPOT_ON: 'Spot-on', POUR_ON: 'Pour-on', BOLUS: 'Bolus', INTRAMAMMARY: 'Intramammary',
  POWDER: 'Powder', IMPLANT: 'Implant', INHALANT: 'Inhalant',
  AUTHORIZED: 'Authorised', PARTIALLY_DISPENSED: 'Partly dispensed', DISPENSED: 'Dispensed',
  HAEMATOLOGY: 'Haematology', BIOCHEMISTRY: 'Biochemistry', URINALYSIS: 'Urinalysis', PARASITOLOGY: 'Parasitology', MICROBIOLOGY: 'Microbiology',
  CYTOLOGY: 'Cytology', HISTOPATHOLOGY: 'Histopathology', SEROLOGY: 'Serology', ENDOCRINOLOGY: 'Endocrinology', MOLECULAR: 'Molecular / PCR', IMAGING: 'Imaging',
  WHOLE_BLOOD_EDTA: 'Whole blood (EDTA)', SERUM: 'Serum', PLASMA: 'Plasma', URINE: 'Urine', FAECES: 'Faeces', SWAB: 'Swab', TISSUE: 'Tissue',
  MILK: 'Milk', SKIN_SCRAPING: 'Skin scraping', FLUID: 'Body fluid', NONE: 'No sample',
  XRAY: 'Radiography (X-ray)', ULTRASOUND: 'Ultrasound', CT: 'CT', MRI: 'MRI', ENDOSCOPY: 'Endoscopy', ECG: 'ECG',
  ROUTINE: 'Routine', STAT: 'Immediately (STAT)', ORDERED: 'Ordered', COLLECTED: 'Sample collected', IN_PROGRESS: 'In progress',
  AWAITING_VALIDATION: 'Awaiting validation', RELEASED: 'Released', PENDING: 'Pending', RESULTED: 'Results entered',
  PRELIMINARY: 'Preliminary', FINAL: 'Final', LOW: 'Low', HIGH: 'High', CRITICAL_LOW: 'Critical low', CRITICAL_HIGH: 'Critical high', ABNORMAL: 'Abnormal', NORMAL: 'Normal',
  RECEIVED: 'Received', IN_ANALYSIS: 'In analysis', REJECTED: 'Rejected', DISPOSED: 'Disposed',
  GIVEN: 'Given', NOT_GIVEN: 'Not given', APPROVED: 'Approved', RETIRED: 'Retired',
});

export const LOCATION_TYPES = ['PHARMACY', 'STORE', 'WARD', 'THEATRE', 'VEHICLE', 'OTHER'] as const;
export const MOVEMENT_TYPES = ['RECEIPT', 'DISPENSE', 'ADMINISTER', 'SALE', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT', 'WRITE_OFF', 'RETURN_TO_SUPPLIER', 'RETURN_FROM_CLIENT'] as const;
export const ADJUSTMENT_REASONS = ['DAMAGED', 'EXPIRED', 'LOST', 'FOUND', 'RECALLED', 'DATA_CORRECTION', 'RETURN_TO_SUPPLIER', 'RETURN_FROM_CLIENT', 'OTHER'] as const;
export const SERVICE_CATEGORIES = ['CONSULTATION', 'PROCEDURE', 'SURGERY', 'DIAGNOSTIC', 'HOSPITALISATION', 'VACCINATION', 'DENTAL', 'GROOMING', 'BOARDING', 'FIELD_VISIT', 'OTHER'] as const;
export const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_WALLET', 'CHEQUE', 'ONLINE', 'INSURANCE', 'OTHER'] as const;
export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const;
export const EXPENSE_CATEGORIES = ['SUPPLIER_PAYMENT', 'RENT', 'UTILITIES', 'SALARIES', 'EQUIPMENT', 'MAINTENANCE', 'MARKETING', 'TRAVEL', 'FEES', 'OTHER'] as const;

Object.assign(ENUM_LABELS, {
  PHARMACY: 'Pharmacy', STORE: 'Store room', WARD: 'Ward', VEHICLE: 'Vehicle',
  RECEIPT: 'Received', DISPENSE: 'Dispensed', ADMINISTER: 'Administered', SALE: 'Sold', ADJUSTMENT: 'Adjustment',
  TRANSFER_OUT: 'Transfer out', TRANSFER_IN: 'Transfer in', COUNT: 'Stock count', WRITE_OFF: 'Write-off',
  RETURN_TO_SUPPLIER: 'Return to supplier', RETURN_FROM_CLIENT: 'Return from client',
  DAMAGED: 'Damaged', LOST: 'Lost', FOUND: 'Found', RECALLED: 'Recalled', DATA_CORRECTION: 'Data correction',
  AVAILABLE: 'Available', QUARANTINED: 'On hold',
  SUBMITTED: 'Awaiting approval', PARTIALLY_RECEIVED: 'Partly received',
  PROCEDURE: 'Procedure', HOSPITALISATION: 'Hospital stay', BOARDING: 'Boarding',
  CASH: 'Cash', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', MOBILE_WALLET: 'Mobile wallet', CHEQUE: 'Cheque',
  ISSUED: 'Issued', PARTIALLY_PAID: 'Partly paid', PAID: 'Paid', VOID: 'Void', WAIVED: 'Waived', INVOICED: 'Invoiced',
  SENT: 'Sent', ACCEPTED: 'Accepted', DECLINED: 'Declined', CONVERTED: 'Turned into invoice', CLOSED: 'Closed',
  SUPPLIER_PAYMENT: 'Supplier payment', RENT: 'Rent', UTILITIES: 'Utilities', SALARIES: 'Salaries', MAINTENANCE: 'Maintenance',
  MARKETING: 'Marketing', TRAVEL: 'Travel', FEES: 'Bank / platform fees',
  SERVICE: 'Service', PRODUCT: 'Product', LAB: 'Diagnostic', CUSTOM: 'Other item',
});

// ── Hospitalisation & surgery (Milestone 6) ──
export const WARD_TYPES = ['GENERAL', 'ICU', 'ISOLATION', 'CATTERY', 'KENNEL', 'LARGE_ANIMAL', 'EXOTICS', 'OTHER'] as const;
export const PATIENT_CONDITIONS = ['STABLE', 'FAIR', 'GUARDED', 'CRITICAL'] as const;
export const CPR_STATUSES = ['UNDECIDED', 'CPR', 'DNR'] as const;
export const ADMISSION_OUTCOMES = ['DISCHARGED_HOME', 'TRANSFERRED', 'DECEASED', 'EUTHANASED'] as const;
export const TREATMENT_KINDS = ['MEDICATION', 'FLUID', 'FEEDING', 'NURSING', 'OBSERVATION', 'OTHER'] as const;
export const TREATMENT_SCHEDULES = ['INTERVAL', 'ONCE', 'AS_NEEDED', 'CONTINUOUS'] as const;
export const SURGERY_STATUSES = ['SCHEDULED', 'PRE_OP', 'IN_PROGRESS', 'RECOVERY', 'COMPLETED', 'CANCELLED'] as const;
export const SURGERY_PRIORITIES = ['ELECTIVE', 'URGENT', 'EMERGENCY'] as const;
export const ASA_GRADES = ['I', 'II', 'III', 'IV', 'V'] as const;
export const SURGERY_ROLES = ['SURGEON', 'ASSISTANT', 'ANAESTHETIST', 'NURSE', 'OTHER'] as const;
export const CHECKLIST_PHASES = ['SIGN_IN', 'TIME_OUT', 'SIGN_OUT'] as const;

Object.assign(ENUM_LABELS, {
  ICU: 'Intensive care', ISOLATION: 'Isolation', CATTERY: 'Cattery', KENNEL: 'Kennels', LARGE_ANIMAL: 'Large animal', EXOTICS: 'Exotics',
  STABLE: 'Stable', FAIR: 'Fair', GUARDED: 'Guarded', CRITICAL: 'Critical',
  UNDECIDED: 'Not decided', CPR: 'Resuscitate (CPR)', DNR: 'Do not resuscitate (DNR)',
  DISCHARGED_HOME: 'Discharged home', TRANSFERRED: 'Transferred', DECEASED: 'Died', EUTHANASED: 'Euthanased',
  FLUID: 'Fluids', FEEDING: 'Feeding', NURSING: 'Nursing care', OBSERVATION: 'Observation',
  INTERVAL: 'Every few hours', ONCE: 'Once', AS_NEEDED: 'As needed', CONTINUOUS: 'Continuous',
  PRE_OP: 'Pre-op', IN_PROGRESS: 'In surgery', RECOVERY: 'Recovery',
  ELECTIVE: 'Elective', URGENT: 'Urgent',
  SURGEON: 'Surgeon', ASSISTANT: 'Assistant', ANAESTHETIST: 'Anaesthetist', NURSE: 'Nurse',
  SIGN_IN: 'Before induction', TIME_OUT: 'Before incision', SIGN_OUT: 'Before leaving theatre',
  ADMITTED: 'In hospital', DISCHARGED: 'Discharged', HOSPITAL_ALERT: 'Hospital alert',
  INTRA_OP: 'During surgery',
});

// ── Preventive care & communications (Milestone 7) ──
export const CARE_KINDS = ['VACCINATION', 'DEWORMING', 'PARASITE_PREVENTION', 'HEALTH_CHECK', 'DENTAL', 'OTHER'] as const;
export const CARE_ITEM_STATUSES = ['DUE', 'COMPLETED', 'CANCELLED', 'DEFERRED'] as const;
export const MESSAGE_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP'] as const;
export const MESSAGE_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED', 'SKIPPED'] as const;
/** Messages sent automatically to the client when something happens (Settings → Client notifications). */
export const CLIENT_NOTIFICATION_EVENTS = ['APPOINTMENT_BOOKED', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_CANCELLED', 'HOME_VISIT_ON_THE_WAY', 'LAB_RESULTS_READY', 'PATIENT_DISCHARGED', 'PAYMENT_RECEIVED', 'VACCINATION_GIVEN'] as const;
export type ClientNotificationEvent = (typeof CLIENT_NOTIFICATION_EVENTS)[number];
export const MESSAGE_PURPOSES = ['CARE_REMINDER', 'CARE_OVERDUE', 'APPOINTMENT_REMINDER', 'PORTAL_INVITE', 'PORTAL_RESET', 'GENERAL', ...CLIENT_NOTIFICATION_EVENTS] as const;
export const PREFERRED_TIMES = ['MORNING', 'AFTERNOON', 'EVENING', 'ANY'] as const;

Object.assign(ENUM_LABELS, {
  DEWORMING: 'Deworming', PARASITE_PREVENTION: 'Flea, tick & parasite prevention', HEALTH_CHECK: 'Health check', DENTAL: 'Dental',
  DEFERRED: 'Deferred', DUE: 'Due',
  EMAIL: 'Email', SMS: 'SMS', WHATSAPP: 'WhatsApp',
  QUEUED: 'Queued', SENDING: 'Sending', SENT: 'Sent', FAILED: 'Failed', SKIPPED: 'Not sent',
  CARE_REMINDER: 'Care reminder', CARE_OVERDUE: 'Overdue care reminder', APPOINTMENT_REMINDER: 'Appointment reminder', HOME_VISIT_ON_THE_WAY: 'Vet on the way', PORTAL_INVITE: 'Portal invitation', PORTAL_RESET: 'Portal password reset', GENERAL: 'General message', AUTOMATION: 'Automation', AUTOMATION_TEAM: 'Automation (to the team)',
  MORNING: 'Morning', AFTERNOON: 'Afternoon', EVENING: 'Evening', ANY: 'Any time',
  PENDING: 'Pending', BOOKED: 'Booked', DECLINED: 'Declined',
});

// ── Livestock, boarding & grooming, insurance & referrals (Milestone 8) ──
export const FARM_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const ANIMAL_GROUP_KINDS = ['HERD', 'FLOCK', 'PEN', 'BATCH'] as const;
export const PRODUCTION_PURPOSES = ['DAIRY', 'BEEF', 'BREEDING', 'LAYER', 'BROILER', 'MEAT', 'WOOL', 'MIXED', 'OTHER'] as const;
export const LIVESTOCK_EVENT_TYPES = ['MOVE', 'PURCHASE', 'SALE', 'TRANSFER', 'DEATH', 'CULL', 'BIRTH', 'PLACEMENT'] as const;
export const BREEDING_EVENT_TYPES = ['HEAT', 'SERVICE', 'INSEMINATION', 'PREGNANCY_CHECK', 'BIRTH', 'ABORTION', 'DRY_OFF'] as const;
export const PREGNANCY_RESULTS = ['PREGNANT', 'NOT_PREGNANT', 'INCONCLUSIVE'] as const;
export const PRODUCTION_KINDS = ['MILK', 'EGGS', 'FEED', 'BATCH_WEIGHT', 'MORTALITY', 'WATER'] as const;
export const GROUP_TREATMENT_KINDS = ['VACCINATION', 'PARASITE_CONTROL', 'TREATMENT', 'OTHER'] as const;
export const OUTBREAK_STATUSES = ['SUSPECTED', 'CONFIRMED', 'CONTROLLED', 'CLOSED'] as const;
export const FIELD_VISIT_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const BOARDING_UNIT_TYPES = ['KENNEL', 'CATTERY', 'SUITE', 'STABLE', 'OTHER'] as const;
export const BOARDING_STATUSES = ['RESERVED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'] as const;
export const BOARDING_LOG_KINDS = ['FEEDING', 'WALK', 'MEDICATION', 'NOTE', 'INCIDENT'] as const;
export const GROOMING_STATUSES = ['WAITING', 'IN_PROGRESS', 'READY', 'COLLECTED', 'CANCELLED'] as const;
export const POLICY_STATUSES = ['ACTIVE', 'EXPIRED', 'CANCELLED'] as const;
export const PRE_AUTH_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_APPROVED', 'DECLINED'] as const;
export const CLAIM_STATUSES = ['DRAFT', 'SUBMITTED', 'QUERIED', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'PAID', 'CLOSED'] as const;
export const CLAIM_PAYEES = ['CLINIC', 'CLIENT'] as const;
export const REFERRAL_DIRECTIONS = ['OUTGOING', 'INCOMING'] as const;
export const REFERRAL_STATUSES = ['DRAFT', 'SENT', 'RECEIVED', 'ACCEPTED', 'COMPLETED', 'DECLINED', 'CANCELLED'] as const;
export const REFERRAL_URGENCIES = ['ROUTINE', 'URGENT', 'EMERGENCY'] as const;
/** Default unit per production record kind (the clinic can enter another unit). */
export const PRODUCTION_UNITS: Record<(typeof PRODUCTION_KINDS)[number], string> = { MILK: 'L', EGGS: 'eggs', FEED: 'kg', BATCH_WEIGHT: 'kg', MORTALITY: 'head', WATER: 'L' };

Object.assign(ENUM_LABELS, {
  HERD: 'Herd', FLOCK: 'Flock', PEN: 'Pen', BATCH: 'Batch',
  DAIRY: 'Dairy', BEEF: 'Beef', BREEDING: 'Breeding', LAYER: 'Layers', BROILER: 'Broilers', MEAT: 'Meat', WOOL: 'Wool', MIXED: 'Mixed',
  MOVE: 'Moved', PURCHASE: 'Purchased', SALE: 'Sold', TRANSFER: 'Transferred out', DEATH: 'Died', CULL: 'Culled', BIRTH: 'Born', PLACEMENT: 'Placed',
  HEAT: 'Heat observed', INSEMINATION: 'Artificial insemination', PREGNANCY_CHECK: 'Pregnancy check', ABORTION: 'Abortion', DRY_OFF: 'Dried off',
  PREGNANT: 'Pregnant', NOT_PREGNANT: 'Not pregnant', INCONCLUSIVE: 'Inconclusive',
  MILK: 'Milk', EGGS: 'Eggs', FEED: 'Feed', BATCH_WEIGHT: 'Average weight', MORTALITY: 'Mortality', WATER: 'Water',
  PARASITE_CONTROL: 'Parasite control', TREATMENT: 'Treatment',
  SUSPECTED: 'Suspected', CONFIRMED: 'Confirmed', CONTROLLED: 'Controlled', CLOSED: 'Closed',
  SCHEDULED: 'Scheduled',
  CATTERY: 'Cattery', SUITE: 'Suite', STABLE: 'Stable',
  RESERVED: 'Reserved', CHECKED_OUT: 'Checked out',
  WALK: 'Walk', MEDICATION: 'Medication', NOTE: 'Note', INCIDENT: 'Incident',
  WAITING: 'Waiting', READY: 'Ready for collection',
  EXPIRED: 'Expired',
  APPROVED: 'Approved', PARTIALLY_APPROVED: 'Partly approved', QUERIED: 'Query from insurer', REJECTED: 'Rejected', PAID: 'Paid',
  CLINIC: 'Clinic', HOME: 'Home visit', CLIENT: 'Client',
  OUTGOING: 'Outgoing', INCOMING: 'Incoming', RECEIVED: 'Received', ACCEPTED: 'Accepted',
  ROUTINE: 'Routine', EMERGENCY: 'Emergency',
  INSURANCE: 'Insurance', REFERRAL: 'Referral letter', NOT_STARTED: 'Not started yet',
});

// Neutral wording for values that several enums share (see SCOPED_ENUM_LABELS for each domain's own wording).
Object.assign(ENUM_LABELS, {
  IN_PROGRESS: 'In progress', COLLECTED: 'Collected', GENERAL: 'General', DECEASED: 'Deceased', AUTHORIZED: 'Authorised',
  SUBMITTED: 'Submitted', KENNEL: 'Kennel', FLUID: 'Fluids', BIRTH: 'Birth', DEATH: 'Death',
});
