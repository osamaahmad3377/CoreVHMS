export interface AlertSummary {
  id: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  type: string;
  /** Allergy / medication alerts: what the patient reacts to, and how. */
  substance?: string | null;
  reaction?: string | null;
}

export interface ClientRow {
  id: string;
  number: number;
  clientNo: string;
  type: string;
  status: string;
  displayName: string;
  email: string | null;
  mobilePhone: string | null;
  balanceMinor: number;
  createdAt: string;
  patients: { id: string; name: string; species: string; status: string }[];
}

export interface Address {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string;
  isPrimary: boolean;
}

export interface ClientContact {
  id: string;
  role: string;
  name: string;
  relationship: string | null;
  email: string | null;
  phone: string | null;
  canAuthorizeTreatment: boolean;
  canCollectAnimal: boolean;
  notes: string | null;
}

export interface ClientDetail {
  id: string;
  number: number;
  clientNo: string;
  type: string;
  status: string;
  anonymisedAt?: string | null;
  title: string | null;
  firstName: string | null;
  lastName: string | null;
  organizationName: string | null;
  displayName: string;
  email: string | null;
  mobilePhone: string | null;
  homePhone: string | null;
  workPhone: string | null;
  nationalId: string | null;
  taxNumber: string | null;
  preferredChannel: string;
  preferredLanguage: string | null;
  marketingConsent: boolean;
  remindersConsent: boolean;
  consentUpdatedAt: string | null;
  notes: string | null;
  referralSource: string | null;
  primaryBranchId: string | null;
  balanceMinor: number;
  archivedAt: string | null;
  archivedReason: string | null;
  createdAt: string;
  mergedInto: { id: string; displayName: string } | null;
  addresses: Address[];
  contacts: ClientContact[];
  clientNotes: { id: string; body: string; category: string; isPinned: boolean; authorName: string; createdAt: string }[];
  patients: {
    id: string;
    name: string;
    number: number;
    species: string;
    breed: string | null;
    sex: string;
    dateOfBirth: string | null;
    status: string;
    isPrimaryOwner: boolean;
    alerts: AlertSummary[];
  }[];
}

export interface PatientRow {
  id: string;
  number: number;
  patientNo: string;
  name: string;
  status: string;
  sex: string;
  dateOfBirth: string | null;
  dobEstimated: boolean;
  species: { id: string; name: string; category: string };
  breed: string | null;
  colour: string | null;
  latestWeightKg: number | null;
  photoAttachmentId: string | null;
  owner: { id: string; displayName: string; mobilePhone: string | null } | null;
  alerts: AlertSummary[];
}

export interface PatientDetail {
  id: string;
  number: number;
  patientNo: string;
  name: string;
  status: string;
  sex: string;
  colour: string | null;
  markings: string | null;
  dateOfBirth: string | null;
  dobEstimated: boolean;
  deceasedAt: string | null;
  causeOfDeath: string | null;
  euthanasia: boolean | null;
  aftercare: string | null;
  bloodType: string | null;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  notes: string | null;
  photoAttachmentId: string | null;
  primaryBranchId: string | null;
  latestWeightKg: number | null;
  breedText: string | null;
  archivedReason: string | null;
  createdAt: string;
  species: { id: string; name: string; category: string };
  breed: { id: string; name: string } | null;
  identifiers: { id: string; type: string; value: string; issuedAt: string | null; notes: string | null }[];
  alerts: (AlertSummary & { details: string | null; substance: string | null; reaction: string | null; isActive: boolean; createdByName: string | null; createdAt: string; resolvedAt: string | null })[];
  weights: { id: string; weightKg: number; bodyConditionScore: number | null; bcsScale: number; measuredAt: string; notes: string | null; recordedByName: string | null }[];
  owner: { id: string; displayName: string; number: number; mobilePhone: string | null; email: string | null; status: string; balanceMinor: number } | null;
  coOwners: { ownershipId: string; id: string; displayName: string; mobilePhone: string | null }[];
  ownershipHistory: { id: string; clientId: string; isPrimary: boolean; startedAt: string; endedAt: string | null; endReason: string | null; client: { id: string; displayName: string } }[];
  mergedInto: { id: string; name: string } | null;
  farmId?: string | null;
  groupId?: string | null;
}

export interface Species {
  id: string;
  name: string;
  category: string;
  isActive: boolean;
  _count?: { breeds: number; patients: number };
}

export interface Breed {
  id: string;
  name: string;
  speciesId: string;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  timezone: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  isActive: boolean;
  _count?: { members: number };
}

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: string | null;
  description: string | null;
  uploadedByName: string | null;
  createdAt: string;
  url: string;
  sharedWithClient?: boolean;
  /** Set when listed from a related record (includeRelated), e.g. a consultation's photo on the patient. */
  source?: { entityType: string; entityId: string; label: string } | null;
}

export interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  actorName: string | null;
  ip: string | null;
  createdAt: string;
}

export interface AppointmentType {
  id: string;
  name: string;
  category: string;
  durationMinutes: number;
  color: string;
  priceMinor: number | null;
  serviceId?: string | null;
  /** The linked service: its price is what the appointment is charged at. */
  service?: { id: string; code: string; name: string; priceMinor: number; isActive: boolean } | null;
  requiresClinician: boolean;
  allowOnlineBooking: boolean;
  isActive: boolean;
}

export interface Resource {
  id: string;
  name: string;
  type: string;
  branchId: string;
  isActive: boolean;
  branch?: { id: string; name: string };
}

export interface Clinician {
  membershipId: string;
  userId: string;
  name: string;
  jobTitle: string | null;
}

export interface Appointment {
  id: string;
  number: number;
  appointmentNo: string;
  branchId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  source: string;
  priority: string | null;
  reason: string | null;
  notes: string | null;
  isOverbooked: boolean;
  recurrenceGroupId: string | null;
  checkedInAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  client: { id: string; displayName: string; mobilePhone: string | null };
  patient: { id: string; name: string; number: number; status: string; species: { name: string }; alerts: AlertSummary[] } | null;
  appointmentType: { id: string; name: string; color: string; category: string; durationMinutes: number };
  groomingJob?: { id: string; status: string } | null;
  fieldVisit?: { id: string; status: string } | null;
  clinician: { id: string; name: string } | null;
  resources: { id: string; name: string; type: string }[];
  encounter: { id: string; status: string } | null;
  /** Front desk, finished visits: the client's charges not yet invoiced. */
  unbilledCharges?: number;
  triage: { id: string; priority: string; presentingComplaint: string; assessedAt: string; assessedByName: string } | null;
  /** Waiting-room token for the day, and the last call to a room. */
  tokenNumber?: number | null;
  calledAt?: string | null;
  calledRoom?: string | null;
  callCount?: number;
  effectivePriority?: string | null;
  waitingMinutes?: number | null;
  /** Home visit: the vet goes to the client. The address is a copy made when booking. */
  location?: 'CLINIC' | 'HOME';
  visitAddress?: string | null;
  visitDirections?: string | null;
  visitMapUrl?: string | null;
  /** When the vet sets off; their calendar is blocked from here. */
  travelStartsAt?: string | null;
  travelMinutes?: number;
  onTheWayAt?: string | null;
  arrivedAt?: string | null;
  distanceKm?: number | null;
}

/** A home visit on the vet's day list, with the fees already added to the client's bill. */
export interface HomeVisit extends Appointment {
  client: { id: string; displayName: string; mobilePhone: string | null; email: string | null };
  fees: { id: string; kind: 'CALLOUT' | 'DISTANCE'; description: string; totalMinor: number; status: string }[];
}

export interface HomeVisitSettings {
  enabled: boolean;
  travelMinutes: number;
  callout: { id: string; name: string; priceMinor: number; isActive: boolean } | null;
  perKm: { id: string; name: string; priceMinor: number; isActive: boolean } | null;
}

export interface RosterEntry {
  membershipId: string;
  name: string;
  jobTitle: string | null;
  isClinician: boolean;
  workingHours: { id: string; dayOfWeek: number; startMinute: number; endMinute: number; branchId: string }[];
  leave: { id: string; type: string; startsAt: string; endsAt: string; reason: string | null }[];
}

export type AttendanceStatus = 'IN' | 'ON_BREAK' | 'DONE' | 'NOT_IN_YET' | 'ABSENT' | 'ON_LEAVE' | 'DAY_OFF' | 'UPCOMING' | 'NOT_TRACKED' | 'PRESENT';

export interface AttendanceRecord {
  id: string;
  membershipId: string;
  branchId: string;
  clockInAt: string;
  clockOutAt: string | null;
  breakStartedAt: string | null;
  breakMinutes: number;
  note: string | null;
  source: 'SELF' | 'MANAGER' | 'REGISTER';
  editReason: string | null;
  workedMinutes: number;
}

export interface AttendanceDay {
  date: string;
  status: AttendanceStatus;
  slots: { startMinute: number; endMinute: number }[];
  rosteredMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  onLeave: boolean;
  leaveType: string | null;
  records: AttendanceRecord[];
}

export interface AttendanceMember {
  membershipId: string;
  name: string;
  jobTitle: string | null;
  isClinician: boolean;
  days: AttendanceDay[];
  totals: { rosteredDays: number; presentDays: number; lateDays: number; earlyDays: number; absentDays: number; leaveDays: number; workedMinutes: number; rosteredMinutes: number };
}

export interface AttendanceRange {
  from: string;
  to: string;
  today: string;
  /** First day attendance was recorded at the clinic; earlier days are not counted. */
  trackedFrom: string;
  graceMinutes: number;
  branch: { id: string; name: string; timezone: string };
  members: AttendanceMember[];
}

export interface AttendanceMe {
  open: (AttendanceRecord & { branchName: string }) | null;
  today: AttendanceDay | null;
  branch: { id: string; name: string };
}

export interface ExamFinding {
  system: string;
  status: 'NORMAL' | 'ABNORMAL' | 'NOT_EXAMINED';
  notes?: string | null;
}

export interface ClinicalNote {
  id: string;
  version: number;
  status: 'DRAFT' | 'REVIEWED' | 'SIGNED' | 'SUPERSEDED';
  presentingComplaint: string | null;
  history: string | null;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  followUpInstructions: string | null;
  examFindings: ExamFinding[] | null;
  templateId: string | null;
  aiAssisted: boolean;
  authorId: string;
  authorName: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  signedByName: string | null;
  signedAt: string | null;
  contentHash: string | null;
  amendsId: string | null;
  amendmentReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Vitals {
  id: string;
  recordedAt: string;
  temperatureC: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  weightKg: number | null;
  mucousMembranes: string | null;
  capillaryRefillSec: number | null;
  painScore: number | null;
  systolicBp: number | null;
  diastolicBp: number | null;
  meanBp: number | null;
  spo2: number | null;
  notes: string | null;
  recordedByName: string | null;
  flags?: Record<string, { flag: 'LOW' | 'HIGH'; low: number; high: number; source: string }>;
}

export interface Diagnosis {
  id: string;
  term: string;
  code: string | null;
  codeSystem: string | null;
  type: string;
  status: string;
  notes: string | null;
  diagnosedByName: string | null;
  createdAt: string;
}

export interface Problem {
  id: string;
  term: string;
  status: string;
  onsetDate: string | null;
  resolvedDate: string | null;
  isChronic: boolean;
  notes: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  type: string;
  status: string;
  title: string;
  details: string | null;
  dueAt: string;
  patient: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  completedAt: string | null;
  completedByName: string | null;
  createdByName: string | null;
}

export interface Encounter {
  id: string;
  number: number;
  encounterNo: string;
  type: string;
  status: string;
  chiefComplaint: string | null;
  startedAt: string;
  completedAt: string | null;
  patientId: string;
  appointmentId: string | null;
  clinician: { id: string; name: string } | null;
  appointment: { id: string; number: number; status: string; reason: string | null; location?: 'CLINIC' | 'HOME'; visitAddress?: string | null; appointmentType: { name: string } } | null;
  patient: import('@/components/patients/patient-banner').BannerPatient & { species: { id: string; name: string; category: string } };
  client: { id: string; displayName: string; mobilePhone: string | null };
  notes: ClinicalNote[];
  vitals: Vitals[];
  diagnoses: Diagnosis[];
  tasks: Task[];
}

export interface EncounterRow {
  id: string;
  encounterNo: string;
  type: string;
  status: string;
  chiefComplaint: string | null;
  startedAt: string;
  completedAt: string | null;
  patient: { id: string; name: string; number: number; species: { name: string }; alerts: AlertSummary[] };
  client: { id: string; displayName: string };
  clinician: { id: string; name: string } | null;
  noteStatus: 'NONE' | 'SIGNED' | 'UNSIGNED';
  diagnoses: { id: string; term: string; type: string }[];
}

export interface ClinicalTemplateRow {
  id: string;
  name: string;
  speciesCategory: string | null;
  presentingComplaint: string | null;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  examSystems: string[];
  isActive: boolean;
}

// ── Pharmacy ──
export interface Product {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  genericName: string | null;
  type: string;
  categoryId: string | null;
  productCategory?: { id: string; name: string } | null;
  brand: string | null;
  packSize: string | null;
  photoAttachmentId: string | null;
  form: string | null;
  strengthValue: number | null;
  strengthUnit: string | null;
  dispensingUnit: string;
  minDispenseIncrement: number;
  activeIngredients: string[];
  /** Drug class / family (e.g. "Penicillins"); matched by the allergy check. */
  drugClass?: string | null;
  manufacturer: string | null;
  requiresPrescription: boolean;
  isControlled: boolean;
  controlledSchedule: string | null;
  targetSpecies: string[];
  sellPriceMinor: number | null;
  notes: string | null;
  isActive: boolean;
  trackStock?: boolean;
  taxRateId?: string | null;
  _count?: { doseReferences: number };
}

export interface DoseReference {
  id: string;
  productId: string;
  speciesId: string;
  species: { id: string; name: string };
  indication: string | null;
  route: string;
  doseMin: number;
  doseMax: number;
  doseUnit: string;
  frequency: string | null;
  maxPerDose: number | null;
  notes: string | null;
  source: string;
  status: 'DRAFT' | 'APPROVED' | 'RETIRED';
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
}

export interface ProductDetail extends Product {
  withdrawals: { id: string; speciesId: string; species: { id: string; name: string }; meatDays: number | null; milkHours: number | null; eggDays: number | null; source: string }[];
  doseReferences: DoseReference[];
}

export interface SafetyWarning {
  code: string;
  message: string;
  blocking: boolean;
}

export interface DoseEvaluation {
  product: { id: string | null; name: string; dispensingUnit: string; isControlled: boolean };
  outside?: boolean;
  calculation: { rawAmount: number; amount: number; dispensingUnit: string; deliveredDose: number | null; deliveredUnit: string | null; deliveredPerKg: number | null; roundingPercent: number; steps: string[] };
  frequency: { code: string; label: string; perDay: number | null };
  quantity: number;
  warnings: SafetyWarning[];
  doseReferenceId: string | null;
  requiresOverride: boolean;
  /** Set when the amount per dose is above the clinic's "please confirm" number of tablets/units. */
  largeDose?: { amount: number; unit: string; confirmAbove: number } | null;
}

export interface PrescriptionItem {
  id: string;
  /** Null for a medicine the client buys outside the clinic. */
  productId: string | null;
  product: Product | null;
  /** Name and strength written for a medicine bought outside. */
  outsideName: string | null;
  /** True when the client buys this medicine outside: nothing to hand out or bill here. */
  outside: boolean;
  /** The medicine's name, from the pharmacy or as written. */
  name: string;
  /** The unit amounts are counted in (tablet, mL…). */
  unit: string;
  route: string;
  doseValue: number;
  doseUnit: string;
  weightKgUsed: number | null;
  amountPerDose: number;
  frequencyText: string;
  durationDays: number | null;
  quantity: number;
  quantityDispensed: number;
  remaining: number;
  repeats: number;
  instructions: string;
  warnings: SafetyWarning[] | null;
  overrideReason: string | null;
  doseReference: { id: string; source: string; doseMin: number; doseMax: number; doseUnit: string } | null;
  dispensations: { id: string; quantity: number; batchNumber: string | null; expiryDate: string | null; dispensedByName: string; dispensedAt: string }[];
}

export interface Prescription {
  id: string;
  number: number;
  prescriptionNo: string;
  status: string;
  weightKg: number | null;
  notes: string | null;
  validUntil: string | null;
  repeatOfId: string | null;
  authorizedByName: string | null;
  authorizedAt: string | null;
  contentHash: string | null;
  cancelReason: string | null;
  createdByName: string | null;
  createdAt: string;
  encounterId: string | null;
  encounterNo?: string | null;
  patient: { id: string; name: string; number: number; sex: string; dateOfBirth: string | null; latestWeightKg: number | null; species: { id: string; name: string; category: string }; alerts: AlertSummary[] };
  client: { id: string; displayName: string; title?: string | null; firstName?: string | null; lastName?: string | null; organizationName?: string | null; mobilePhone: string | null };
  prescriber: { id: string; name: string; registration: string | null } | null;
  items: PrescriptionItem[];
}

export interface Administration {
  id: string;
  status: string;
  dose: number;
  doseUnit: string;
  route: string;
  site: string | null;
  batchNumber: string | null;
  reasonNotGiven: string | null;
  notes: string | null;
  administeredAt: string;
  administeredByName: string;
  product: { id: string; name: string; dispensingUnit: string };
}

export interface ActiveWithdrawal {
  id: string;
  product: { id: string; name: string };
  treatedAt: string;
  meatClearAt: string | null;
  milkClearAt: string | null;
  eggClearAt: string | null;
  meatActive: boolean;
  milkActive: boolean;
  eggActive: boolean;
  source: string;
}

// ── Laboratory ──
export interface LabAnalyte {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  resultType: 'NUMERIC' | 'TEXT' | 'OPTION';
  options: string[];
  decimals: number;
  sortOrder: number;
  intervals?: { id: string; speciesId: string; species: { id: string; name: string }; sex: string | null; ageMinMonths: number | null; ageMaxMonths: number | null; low: number | null; high: number | null; criticalLow: number | null; criticalHigh: number | null; source: string; reviewedByName: string | null }[];
}

export interface LabTest {
  id: string;
  code: string;
  name: string;
  category: string;
  sampleType: string;
  performedBy: string;
  externalLabName: string | null;
  modality: string | null;
  priceMinor: number | null;
  turnaroundHours: number | null;
  instructions: string | null;
  isActive: boolean;
  analytes: LabAnalyte[];
}

export interface LabResult {
  id: string;
  analyteId: string;
  valueNumeric: number | null;
  valueText: string | null;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  refSource: string | null;
  flag: string | null;
  status: 'PRELIMINARY' | 'FINAL' | 'SUPERSEDED';
  comment: string | null;
  enteredByName: string;
  enteredAt: string;
  supersedesId: string | null;
  amendmentReason: string | null;
}

export interface DiagnosticOrder {
  id: string;
  number: number;
  orderNo: string;
  status: string;
  priority: string;
  clinicalNotes: string | null;
  externalReference: string | null;
  hasCritical: boolean;
  orderedByName: string;
  releasedByName: string | null;
  releasedAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  encounterId: string | null;
  patient: { id: string; name: string; number: number; patientNo: string; sex: string; dateOfBirth: string | null; dobEstimated: boolean; status: string; latestWeightKg: number | null; photoAttachmentId: string | null; species: { id: string; name: string; category: string }; breed: { name: string } | null; alerts: AlertSummary[] };
  client: { id: string; displayName: string; mobilePhone: string | null };
  items: {
    id: string;
    status: string;
    test: LabTest;
    results: LabResult[];
    imagingReport: { id: string; modality: string; bodyRegion: string | null; views: string | null; findings: string; conclusion: string; recommendations: string | null; studyInstanceUid: string | null; reportedByName: string; reportedAt: string } | null;
  }[];
  samples: { id: string; barcode: string; sampleType: string; status: string; collectedAt: string; collectedByName: string; rejectionReason: string | null; notes: string | null; events: { id: string; action: string; notes: string | null; byName: string; at: string }[] }[];
  referenceIntervals?: Record<string, { low: number | null; high: number | null; criticalLow: number | null; criticalHigh: number | null; source: string }>;
}

// ── Inventory & procurement ──
export interface StockLocation {
  id: string;
  branchId: string;
  name: string;
  type: string;
  isDefault: boolean;
  isActive: boolean;
  branch?: { name: string };
}

export interface StockRow {
  id: string;
  name: string;
  sku: string | null;
  type: string;
  dispensingUnit: string;
  isControlled: boolean;
  reorderLevel: number | null;
  reorderQuantity: number | null;
  onHand: number;
  available: number;
  unusable: number;
  valueMinor: number;
  nextExpiry: string | null;
  low: boolean;
  expiringSoon: boolean;
  locations: { id: string; name: string; quantity: number }[];
  /** Orders not yet fully received that include this product. */
  openOrders?: { id: string; poNo: string; status: string }[];
}

export interface StockBatch {
  id: string;
  batchNumber: string;
  expiryDate: string | null;
  status: 'AVAILABLE' | 'QUARANTINED' | 'RECALLED';
  statusReason: string | null;
  unitCostMinor: number;
  receivedAt: string;
  supplier: { name: string } | null;
  onHand: number;
  levels: { id: string; locationId: string; quantity: number; location: { id: string; name: string } }[];
}

export interface ProductStock {
  product: {
    id: string;
    name: string;
    sku: string | null;
    type: string;
    dispensingUnit: string;
    trackStock: boolean;
    isControlled: boolean;
    sellPriceMinor: number | null;
    taxRateId: string | null;
    reorderLevel: number | null;
    reorderQuantity: number | null;
  };
  batches: StockBatch[];
}

export interface StockMovement {
  id: string;
  type: string;
  quantity: number;
  balanceAfter: number;
  unitCostMinor: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  /** What caused it, e.g. "Counter sale INV-000012", with a link when there is a page for it. */
  reference?: { label: string; href: string | null } | null;
  createdAt: string;
  createdByName: string | null;
  product: { name: string; dispensingUnit: string; controlledSchedule?: string | null };
  batch: { batchNumber: string };
  location: { name: string };
}

export interface StockCount {
  id: string;
  number: number;
  countNo?: string;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  notes: string | null;
  startedByName: string;
  completedByName: string | null;
  createdAt: string;
  completedAt: string | null;
  location: { id?: string; name: string };
  _count?: { lines: number };
  lines?: {
    id: string;
    productId: string;
    batchId: string;
    expectedQty: number;
    countedQty: number | null;
    product: { id: string; name: string; dispensingUnit: string };
    batch: { batchNumber: string; expiryDate: string | null; unitCostMinor: number };
  }[];
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  paymentTermsDays: number;
  notes: string | null;
  isActive: boolean;
}

export interface PurchaseOrder {
  id: string;
  number: number;
  poNo: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
  supplierId: string;
  locationId: string;
  location?: { id: string; name: string; branch?: { name: string; addressLine1?: string | null; addressLine2?: string | null; city?: string | null; phone?: string | null } | null } | null;
  supplier: { id: string; name: string } & Partial<Supplier>;
  totalMinor: number;
  expectedAt: string | null;
  notes: string | null;
  createdByName: string;
  createdById: string;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
  /** This clinic requires a different person to approve (Settings → Tax & payments). */
  needsSecondApprover?: boolean;
  lines: { id: string; productId: string; quantity: number; quantityReceived: number; outstanding?: number; unitCostMinor: number; product: { id?: string; name: string; dispensingUnit?: string; sku?: string | null; type?: string } }[];
  receipts?: { id: string; receiptNo: string; receivedAt: string; totalMinor: number; receivedByName: string; lines: { id: string; quantity: number; unitCostMinor: number; product: { name: string }; batch: { batchNumber: string; expiryDate: string | null } }[] }[];
}

// ── Billing ──
export interface TaxRate {
  id: string;
  name: string;
  rateBasisPoints: number;
  isDefault: boolean;
  isActive: boolean;
}

export interface Service {
  id: string;
  code: string;
  name: string;
  category: string;
  priceMinor: number;
  taxRateId: string | null;
  isActive: boolean;
  /** Active appointment types charged with this service. */
  appointmentTypes?: { id: string; name: string }[];
}

export interface BillingSettings {
  currency: string;
  pricesIncludeTax: boolean;
  paymentTermsDays: number;
  requireCashSession: boolean;
  allowNegativeStock: boolean;
  /** Purchase orders must be approved by someone other than the person who raised them. */
  poRequiresSecondApprover: boolean;
  /** Prescription-only items may be sold at the counter without a prescription (controlled medicines never). */
  sellWithoutPrescription: boolean;
}

export interface Charge {
  id: string;
  kind: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  taxRateBasisPoints: number;
  /** Taken off when invoiced (e.g. covered by a wellness plan), with the reason. */
  discountMinor: number;
  discountNote: string | null;
  status: 'PENDING' | 'INVOICED' | 'WAIVED';
  waivedReason: string | null;
  sourceType: string;
  sourceId: string;
  clientId: string;
  patientId: string | null;
  createdAt: string;
  createdByName: string | null;
  client: { id: string; displayName: string };
  patient: { id: string; name: string } | null;
}

export interface InvoiceLine {
  id: string;
  kind: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  taxRateBasisPoints: number;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  chargeId: string | null;
  productId: string | null;
  /** Product SKU or service code (invoice detail only). */
  code?: string | null;
}

export interface Invoice {
  id: string;
  number: number | null;
  invoiceNo: string;
  status: 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
  isPos: boolean;
  branchId?: string;
  branch?: { id: string; name: string; addressLine1?: string | null; addressLine2?: string | null; city?: string | null; postcode?: string | null; phone?: string | null; email?: string | null } | null;
  currency: string;
  pricesIncludeTax: boolean;
  clientId: string | null;
  patientId: string | null;
  client: { id: string; displayName: string; number: number; email: string | null; mobilePhone: string | null; addresses: { line1: string; line2: string | null; city: string | null }[] } | null;
  patient?: { id: string; name: string; number: number } | null;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  creditedMinor: number;
  balanceMinor: number;
  notes: string | null;
  issuedAt: string | null;
  issuedByName: string | null;
  dueAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedByName: string | null;
  createdAt: string;
  createdByName: string | null;
  overdue: boolean;
  lines: InvoiceLine[];
  allocations: { id: string; amountMinor: number; createdAt: string; payment: { id: string; receiptNo: string; method: string; receivedAt: string; receivedByName: string | null } }[];
  creditNotes: { id: string; creditNoteNo: string; amountMinor: number; reason: string; createdAt: string; createdByName: string | null }[];
}

export interface Payment {
  id: string;
  number: number;
  receiptNo: string;
  clientId: string | null;
  client: { id: string; displayName: string } | null;
  amountMinor: number;
  refundedMinor: number;
  allocatedMinor: number;
  unallocatedMinor: number;
  method: string;
  reference: string | null;
  notes: string | null;
  receivedAt: string;
  receivedByName: string | null;
  allocations: { id: string; amountMinor: number; invoice: { id: string; invoiceNo: string; totalMinor: number; status: string } }[];
  refunds: { id: string; refundNo: string; amountMinor: number; method: string; reason: string; refundedAt: string; refundedByName: string | null }[];
}

export interface CashRegister {
  id: string;
  name: string;
  branchId: string;
  branch: { name: string };
  sessions: CashSession[];
}

export interface CashSession {
  id: string;
  registerId: string;
  openedById?: string;
  status: 'OPEN' | 'CLOSED';
  openingFloatMinor: number;
  expectedCashMinor: number | null;
  countedCashMinor: number | null;
  varianceMinor: number | null;
  openedAt: string;
  openedByName: string;
  closedAt: string | null;
  closedByName: string | null;
  notes: string | null;
  register?: { name: string };
}

export interface CashExpected {
  session: CashSession;
  cashInMinor: number;
  refundsMinor: number;
  paidOutMinor: number;
  expectedCashMinor: number;
}

export interface Estimate {
  id: string;
  estimateNo: string;
  status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'CONVERTED';
  client: { id: string; displayName: string };
  patientId: string | null;
  validUntil: string | null;
  notes: string | null;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  convertedInvoiceId: string | null;
  createdAt: string;
  createdByName: string | null;
  lines: { id: string; description: string; quantity: number; unitPriceMinor: number; grossMinor: number }[];
}

export interface Expense {
  id: string;
  date: string;
  category: string;
  description: string;
  amountMinor: number;
  taxMinor: number;
  method: string;
  reference: string | null;
  supplier: { name: string } | null;
  createdByName: string | null;
}

export interface Statement {
  client: { id: string; displayName: string; balanceMinor: number };
  lines: { date: string; type: string; reference: string; description: string; debitMinor: number; creditMinor: number; balanceMinor: number }[];
  closingBalanceMinor: number;
}

// ── Shop counter ──
export interface PosItem {
  type: 'PRODUCT' | 'SERVICE';
  id: string;
  name: string;
  code: string | null;
  barcode: string | null;
  category: string;
  categoryId: string | null;
  categoryName: string | null;
  brand: string | null;
  packSize: string | null;
  photoAttachmentId: string | null;
  unit: string;
  priceMinor: number | null;
  taxRateBasisPoints: number;
  trackStock: boolean;
  available: number | null;
  rxOnly: boolean;
  /** Controlled medicines always need a prescription. */
  controlled: boolean;
}

export interface ProductCategory {
  id: string;
  name: string;
  productType: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount?: number;
}

export interface PosCatalog {
  items: PosItem[];
  exact: PosItem | null;
  allowNegativeStock: boolean;
  /** The clinic lets prescription-only items be sold without a prescription (with a note). */
  sellWithoutPrescription?: boolean;
}

// ── Hospital & surgery ──
export interface WardRow {
  id: string;
  branchId: string;
  name: string;
  type: string;
  dailyServiceId: string | null;
  dailyService: { id: string; name: string; priceMinor: number } | null;
  sortOrder: number;
  isActive: boolean;
  branch?: { name: string };
  cages: { id: string; name: string; notes: string | null; isActive: boolean; occupant: { id: string; patient: { id: string; name: string } } | null }[];
}

export interface AdmissionPatient {
  id: string;
  name: string;
  number: number;
  sex: string;
  dateOfBirth: string | null;
  latestWeightKg: number | null;
  status: string;
  species: { name: string; category: string };
  breed: { name: string } | null;
  alerts: { id: string; type: string; severity: string; title: string }[];
}

export interface Admission {
  id: string;
  number: number;
  admissionNo: string;
  status: 'ADMITTED' | 'DISCHARGED' | 'CANCELLED';
  condition: 'STABLE' | 'FAIR' | 'GUARDED' | 'CRITICAL';
  cprStatus: 'UNDECIDED' | 'CPR' | 'DNR';
  reason: string;
  diagnosis: string | null;
  isolation: boolean;
  feedingInstructions: string | null;
  expectedDischargeAt: string | null;
  admittedAt: string;
  admittedByName: string;
  dischargedAt: string | null;
  dischargedByName: string | null;
  outcome: string | null;
  dischargeSummary: string | null;
  homeCareInstructions: string | null;
  followUpAt: string | null;
  cancelReason: string | null;
  encounterId: string | null;
  wardId: string | null;
  cageId: string | null;
  daysInHospital: number;
  patient: AdmissionPatient;
  client: { id: string; displayName: string; mobilePhone: string | null };
  ward: { id: string; name: string; type: string; dailyService: { name: string; priceMinor: number } | null } | null;
  cage: { id: string; name: string } | null;
  responsibleClinician: { id: string; name: string } | null;
  notes?: { id: string; type: 'PROGRESS' | 'HANDOVER' | 'ALERT'; text: string; authorName: string; createdAt: string }[];
  surgeries?: { id: string; surgeryNo: string; procedure: string; status: string; scheduledAt: string }[];
  overdueTasks?: number;
  dueSoonTasks?: number;
  lastVitalsAt?: string | null;
  surgery?: { id: string; procedure: string; status: string; scheduledAt: string } | null;
}

export interface Flowboard {
  generatedAt: string;
  summary: { inpatients: number; critical: number; overdueTasks: number };
  wards: { id: string; name: string; type: string; cages: { id: string; name: string; admissionId: string | null }[] }[];
  admissions: Admission[];
}

export interface TreatmentTask {
  id: string;
  orderId: string;
  dueAt: string;
  status: 'DUE' | 'DONE' | 'SKIPPED' | 'CANCELLED';
  doneAt: string | null;
  doneByName: string | null;
  value: string | null;
  notes: string | null;
  skipReason: string | null;
}

export interface TreatmentOrder {
  id: string;
  kind: string;
  schedule: 'INTERVAL' | 'ONCE' | 'AS_NEEDED' | 'CONTINUOUS';
  description: string;
  productId: string | null;
  product: { id: string; name: string; dispensingUnit: string } | null;
  /** A medicine the clinic does not stock (e.g. brought in by the owner): no stock used, nothing charged. */
  outside?: boolean;
  dose: number | null;
  doseUnit: string | null;
  route: string | null;
  fluidRateMlPerHour: number | null;
  intervalHours: number | null;
  instructions: string | null;
  startAt: string;
  endAt: string | null;
  status: 'ACTIVE' | 'STOPPED' | 'COMPLETED';
  orderedByName: string;
  stopReason: string | null;
  tasks: TreatmentTask[];
}

export interface ChecklistEntry {
  key: string;
  phase: 'SIGN_IN' | 'TIME_OUT' | 'SIGN_OUT';
  label: string;
  checked: boolean;
  by?: string | null;
  at?: string | null;
}

export interface Surgery {
  id: string;
  number: number;
  surgeryNo: string;
  status: 'SCHEDULED' | 'PRE_OP' | 'IN_PROGRESS' | 'RECOVERY' | 'COMPLETED' | 'CANCELLED';
  priority: string;
  procedure: string;
  scheduledAt: string;
  durationMinutes: number;
  appointmentId: string | null;
  encounterId: string | null;
  serviceId: string | null;
  service: { id: string; name: string; priceMinor: number } | null;
  theatre: { id: string; name: string } | null;
  admission: { id: string; admissionNo: string; status: string } | null;
  patient: AdmissionPatient & { speciesId: string };
  client: { id: string; displayName: string; mobilePhone: string | null };
  team: { id: string; role: string; membershipId: string; name: string }[];
  asaGrade: string | null;
  asaEmergency: boolean;
  preOpAssessment: string | null;
  fastingConfirmed: boolean;
  consentObtained: boolean;
  consentGivenBy: string | null;
  consentAt: string | null;
  consentRecordedBy: string | null;
  estimateMinor: number | null;
  checklist: ChecklistEntry[];
  anaesthesiaPlan: string | null;
  airway: string | null;
  anaesthesiaStartAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  recoveryStartedAt: string | null;
  completedAt: string | null;
  completedByName: string | null;
  surgicalNotes: string | null;
  findings: string | null;
  complications: string | null;
  postOpInstructions: string | null;
  followUpAt: string | null;
  cancelReason: string | null;
  createdByName: string;
  readings?: AnaesthesiaReading[];
  items?: { id: string; quantity: number; notes: string | null; recordedByName: string; createdAt: string; product: { name: string; dispensingUnit: string } }[];
  addenda?: { id: string; text: string; authorName: string; createdAt: string }[];
  administrations?: { id: string; product: string; dose: number; doseUnit: string; route: string; status: string; administeredAt: string; administeredByName: string }[];
}

export interface AnaesthesiaReading {
  id: string;
  phase: 'INTRA_OP' | 'RECOVERY';
  recordedAt: string;
  heartRate: number | null;
  respiratoryRate: number | null;
  spo2: number | null;
  etco2: number | null;
  systolicBp: number | null;
  diastolicBp: number | null;
  meanBp: number | null;
  temperatureC: number | null;
  agentPercent: number | null;
  oxygenLpm: number | null;
  painScore: number | null;
  notes: string | null;
  recordedByName: string;
}

// ── Preventive care & communications ──
export interface CareProtocol {
  id: string;
  name: string;
  kind: string;
  speciesId: string | null;
  productId: string | null;
  species: { id: string; name: string } | null;
  product: { id: string; name: string } | null;
  firstDueAgeWeeks: number | null;
  intervalDays: number | null;
  source: string;
  notes: string | null;
  status: 'DRAFT' | 'APPROVED' | 'RETIRED';
  reviewedByName: string | null;
  reviewedAt: string | null;
  _count?: { items: number };
}

export interface CareItem {
  id: string;
  patientId: string;
  protocolId: string | null;
  protocol?: { id: string; name: string; intervalDays: number | null; productId: string | null } | null;
  kind: string;
  title: string;
  dueDate: string;
  effectiveDueDate: string;
  overdue: boolean;
  status: 'DUE' | 'COMPLETED' | 'CANCELLED' | 'DEFERRED';
  deferredUntil: string | null;
  deferReason: string | null;
  cancelReason: string | null;
  completedAt: string | null;
  completedByName: string | null;
  administrationId: string | null;
  givenElsewhere: boolean;
  productName: string | null;
  batchNumber: string | null;
  notes: string | null;
  remindedAt: string | null;
  overdueRemindedAt: string | null;
  /** Own repeat (null = follow the protocol; 0 = never). */
  repeatEvery: number | null;
  repeatUnit: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | null;
  repeatTimes: number | null;
  repeatUntil: string | null;
  patient?: { id: string; name: string; number: number; species: { name: string } };
  owner?: { id: string; displayName: string; mobilePhone: string | null; email: string | null; remindersConsent: boolean } | null;
}

export interface VaccinationCertificate {
  patient: { id: string; name: string; number: number; sex: string; dateOfBirth: string | null; species: string; breed: string | null; colour: string | null; identifiers: { type: string; value: string }[] };
  owner: { displayName: string; addresses: { line1: string; city: string | null }[] } | null;
  given: { id: string; title: string; date: string; product: string | null; manufacturer: string | null; batchNumber: string | null; expiryDate: string | null; givenBy: string | null; givenElsewhere: boolean }[];
  nextDue: { title: string; dueDate: string }[];
  generatedAt: string;
}

export interface OutboundMessage {
  id: string;
  clientId: string | null;
  client: { id: string; displayName: string } | null;
  channel: 'EMAIL' | 'SMS' | 'WHATSAPP';
  recipient: string;
  subject: string | null;
  body: string;
  purpose: string;
  status: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  /** WhatsApp receipts. */
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
  createdByName: string | null;
}

/** Settings → Integrations → WhatsApp. */
export interface WhatsAppOverview {
  connected: boolean;
  enabled: boolean;
  phoneNumberId: string | null;
  businessAccountId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  sendPolicy: 'PREFERRED' | 'ALL_MOBILE';
  fallbackToEmail: boolean;
  hasAppSecret: boolean;
  webhookPath: string | null;
  verifyToken: string | null;
  connectedByName: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  lastWebhookAt: string | null;
  links: { purpose: string; templateName: string; language: string; params: string[]; updatedByName: string | null; updatedAt: string }[];
  last30Days: { sent: number; failed: number; queued: number; skipped: number; delivered: number; read: number };
}

export interface WhatsAppTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  header: string | null;
  body: string;
  paramCount: number;
  supported: boolean;
  note: string | null;
}

export interface MessageTemplate {
  id: string;
  purpose: string;
  channel: 'EMAIL' | 'SMS' | 'WHATSAPP';
  subject: string | null;
  body: string;
  isActive: boolean;
  updatedByName: string | null;
  updatedAt: string;
}

export interface ClientMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  kind: string;
  subject: string | null;
  body: string;
  authorName: string;
  readAt: string | null;
  createdAt: string;
}

export interface AppointmentRequestRow {
  id: string;
  clientId: string;
  client: { id: string; displayName: string; mobilePhone: string | null; email: string | null };
  patient: { id: string; name: string; species: { name: string } } | null;
  reason: string;
  preferredDate: string;
  preferredTime: string;
  notes: string | null;
  status: string;
  createdAt: string;
}

export interface PortalStatus {
  invited: boolean;
  isActive?: boolean;
  email?: string;
  accountStatus?: 'INVITED' | 'ACTIVE' | 'DISABLED';
  lastLoginAt?: string | null;
  invitedAt?: string;
  invitedByName?: string | null;
}

// ── Milestone 8: livestock ──
export interface FarmRow {
  id: string;
  farmNo: string;
  name: string;
  clientId: string;
  client: { id: string; displayName: string; mobilePhone: string | null; email?: string | null };
  registrationNumber: string | null;
  address: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  areaHectares: number | null;
  notes: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  groupCount?: number;
  animalCount?: number;
  openOutbreaks?: number;
  animalsUnderWithdrawal?: number;
}
export interface AnimalGroupRow {
  id: string;
  farmId: string;
  name: string;
  kind: string;
  purpose: string;
  speciesId: string;
  species: { id: string; name: string; category: string; gestationDays?: number | null };
  tracksIndividuals: boolean;
  headCount: number;
  initialCount: number | null;
  placedOn: string | null;
  breedText: string | null;
  location: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'CLOSED';
  closedReason: string | null;
  population: number;
  ageDays: number | null;
}
export interface FarmDetail extends FarmRow {
  groups: AnimalGroupRow[];
  unassignedAnimals: number;
}
export interface GroupAnimal {
  id: string;
  name: string;
  patientNo: string;
  sex: string;
  dateOfBirth: string | null;
  latestWeightKg: number | null;
  breedText: string | null;
  breed: { name: string } | null;
  tag: string | null;
}
export interface GroupDetail extends AnimalGroupRow {
  farm: { id: string; name: string; farmNo: string; clientId: string };
  animals: GroupAnimal[];
}
export interface MovementRow {
  id: string;
  type: string;
  headCount: number;
  occurredAt: string;
  counterparty: string | null;
  priceMinor: number | null;
  reason: string | null;
  recordedByName: string;
  patient: { id: string; name: string; number: number } | null;
  fromGroup: { id: string; name: string } | null;
  toGroup: { id: string; name: string } | null;
  fromFarm: { id: string; name: string } | null;
  toFarm: { id: string; name: string } | null;
}
export interface BreedingEventRow {
  id: string;
  patientId: string;
  type: string;
  occurredAt: string;
  sireId: string | null;
  sireText: string | null;
  sire: { id: string; name: string; number: number } | null;
  patient?: { id: string; name: string };
  semenBatch: string | null;
  technician: string | null;
  method: string | null;
  result: string | null;
  expectedDueDate: string | null;
  dueDateSource: string | null;
  offspringCount: number | null;
  liveCount: number | null;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  recordedByName: string;
}
export interface ReproStatus {
  state: 'OPEN' | 'SERVED' | 'PREGNANT' | 'DUE_SOON' | 'OVERDUE' | 'DRY';
  expectedDueDate: string | null;
  lastHeat: string | null;
  lastService: string | null;
  lastBirth: string | null;
  daysSinceBirth: number | null;
}
export interface AnimalBreeding {
  events: BreedingEventRow[];
  status: ReproStatus | null;
  pedigree: {
    sire: { id: string; name: string; patientNo: string } | null;
    dam: { id: string; name: string; patientNo: string } | null;
    offspring: { id: string; name: string; patientNo: string; dateOfBirth: string | null; sex: string; status: string }[];
  };
}
export interface FertilityRow extends ReproStatus {
  id: string;
  name: string;
  patientNo: string;
  tag: string | null;
  group: { id: string; name: string } | null;
  species: string;
  dateOfBirth: string | null;
}
export interface ProductionRow {
  id: string;
  farmId: string;
  kind: string;
  recordedOn: string;
  quantity: number;
  unit: string;
  session: string | null;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  recordedByName: string;
  patient: { id: string; name: string } | null;
  group: { id: string; name: string } | null;
}
export interface GroupTreatmentRow {
  id: string;
  kind: string;
  productName: string;
  batchNumber: string | null;
  route: string | null;
  dosePerHead: string | null;
  headCount: number;
  quantityIssued: number | null;
  administeredAt: string;
  meatClearAt: string | null;
  milkClearAt: string | null;
  eggClearAt: string | null;
  withdrawalSource: string | null;
  notes: string | null;
  administeredByName: string;
  group: { id: string; name: string } | null;
}
export interface OutbreakRow {
  id: string;
  outbreakNo: string;
  farmId: string;
  farm: { id: string; name: string; district: string | null };
  group: { id: string; name: string } | null;
  disease: string;
  notifiable: boolean;
  status: 'SUSPECTED' | 'CONFIRMED' | 'CONTROLLED' | 'CLOSED';
  firstSeenOn: string;
  confirmedOn: string | null;
  closedOn: string | null;
  diagnosisMethod: string | null;
  populationAtRisk: number | null;
  affectedCount: number;
  deathCount: number;
  controlMeasures: string | null;
  reportedToAuthorityOn: string | null;
  authorityReference: string | null;
  notes: string | null;
}
export interface WithdrawalBoardRow {
  id: string;
  subjectType: 'ANIMAL' | 'BATCH';
  subject: { id: string; name: string; tag: string };
  farm: { id: string; name: string } | null;
  product: string;
  treatedAt: string;
  meatClearAt: string | null;
  milkClearAt: string | null;
  eggClearAt: string | null;
  meatActive: boolean;
  milkActive: boolean;
  eggActive: boolean;
  source: string;
}
export interface FieldVisitRow {
  id: string;
  visitNo: string;
  farmId: string;
  farm: { id: string; name: string; farmNo: string; address: string | null; district: string | null; latitude: number | null; longitude: number | null };
  client: { id: string; displayName: string; mobilePhone: string | null };
  clinician: { id: string; name: string } | null;
  appointment: { id: string; number: number; status: string; startsAt: string } | null;
  scheduledAt: string;
  purpose: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  calloutServiceId: string | null;
  distanceKm: number | null;
  findings: string | null;
  recommendations: string | null;
  completedAt: string | null;
  completedByName: string | null;
  cancelReason: string | null;
}
export interface FieldVisitDetail extends FieldVisitRow {
  items: { id: string; kind: string; description: string; quantity: number; unitPriceMinor: number; recordedByName: string; createdAt: string; patient: { id: string; name: string } | null }[];
  treatments: GroupTreatmentRow[];
  charges: { id: string; description: string; quantity: number; unitPriceMinor: number; status: string; totalMinor: number; sourceType: string }[];
}
export interface FarmReport {
  farm: FarmRow;
  period: { from: string; to: string };
  census: { individuals: number; bySpecies: { species: string; total: number; female: number; male: number }[]; batchHead: number };
  movements: { births: number; purchased: number; sold: number; deaths: number; culls: number; salesValueMinor: number };
  mortalityRatePct: number | null;
  breeding: { services: number; pregnancyChecks: number; pregnant: number; pregnancyRatePct: number | null; births: number; bornAlive: number; stillborn: number; abortions: number };
  production: { milkLitres: number; avgMilkPerAnimalDay: number | null; eggs: number; feedKg: number; batchMortality: number };
  batches: { id: string; name: string; species: string; purpose: string; status: string; placedOn: string | null; initialCount: number | null; headCount: number; ageDays: number | null; mortalityInPeriod: number; cumulativeMortalityPct: number | null; eggs: number; feedKg: number; latestAvgWeightKg: number | null }[];
  health: { treatments: number; openOutbreaks: number; newOutbreaks: { id: string; disease: string; status: string; affectedCount: number; deathCount: number }[]; activeWithdrawals: number };
}
export interface BirthDueRow extends ReproStatus {
  id: string;
  name: string;
  patientNo: string;
  tag: string | null;
  farm: { id: string; name: string } | null;
}

// ── Milestone 8: boarding & grooming ──
export interface BoardingUnit {
  id: string;
  branchId: string;
  name: string;
  type: string;
  nightlyServiceId: string | null;
  nightlyService: { id: string; name: string; priceMinor: number } | null;
  notes: string | null;
  sortOrder: number;
  isActive: boolean;
}
export interface BoardingStay {
  id: string;
  stayNo: string;
  branchId: string;
  status: 'RESERVED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW';
  startDate: string;
  endDate: string;
  nights: number;
  nightlyRateMinor: number;
  feedingInstructions: string | null;
  medicationInstructions: string | null;
  belongings: string | null;
  behaviourNotes: string | null;
  emergencyContact: string | null;
  vaccinationOverride: string | null;
  checkedInAt: string | null;
  checkedInByName: string | null;
  checkedOutAt: string | null;
  nightsCharged: number | null;
  cancelReason: string | null;
  createdByName: string | null;
  departingToday?: boolean;
  patient: { id: string; name: string; number: number; sex: string; dateOfBirth: string | null; species: { name: string }; breed: { name: string } | null; alerts: { id: string; type: string; severity: string; title: string }[] };
  client: { id: string; displayName: string; mobilePhone: string | null };
  unit: { id: string; name: string; type: string } | null;
}
export interface BoardingStayDetail extends BoardingStay {
  logs: { id: string; kind: string; text: string; recordedAt: string; recordedByName: string }[];
  overdueVaccinations: { id: string; title: string; dueDate: string; status: string }[];
  charge: { id: string; status: string; quantity: number; unitPriceMinor: number } | null;
}
export interface BoardingBoard {
  today: string;
  arriving: BoardingStay[];
  inHouse: BoardingStay[];
  upcoming: BoardingStay[];
  occupancy: { units: number; occupied: number };
}
export interface UnitAvailability extends BoardingUnit {
  stays: { id: string; stayNo: string; patient: { id: string; name: string }; startDate: string; endDate: string; status: string }[];
}
export interface GroomingJob {
  id: string;
  groomingNo: string;
  status: 'WAITING' | 'IN_PROGRESS' | 'READY' | 'COLLECTED' | 'CANCELLED';
  instructions: string | null;
  coatCondition: string | null;
  behaviour: string | null;
  groomerNotes: string | null;
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
  collectedAt: string | null;
  cancelReason: string | null;
  totalMinor: number;
  patient: { id: string; name: string; number: number; sex: string; species: { name: string }; breed: { name: string } | null; breedText: string | null; alerts: { id: string; type: string; severity: string; title: string }[] };
  client: { id: string; displayName: string; mobilePhone: string | null };
  groomer: { id: string; name: string } | null;
  appointment: { id: string; number: number; startsAt: string; status: string } | null;
  services: { id: string; serviceId: string; description: string; priceMinor: number }[];
  charges?: { id: string; sourceId: string; status: string }[];
}
export interface GroomingBoard {
  jobs: GroomingJob[];
  booked: { id: string; startsAt: string; reason: string | null; type: string; patient: { id: string; name: string; species: { name: string } } | null; client: { id: string; displayName: string; mobilePhone: string | null }; staff: { id: string; name: string } | null }[];
}

// ── Milestone 8: insurance & referrals ──
export interface InsuranceProvider {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  claimsEmail: string | null;
  website: string | null;
  notes: string | null;
  isActive: boolean;
}
export interface InsurancePolicy {
  id: string;
  providerId: string;
  provider: { id: string; name: string; phone: string | null; email: string | null; claimsEmail: string | null };
  patient: { id: string; name: string; number: number; species: { name: string } };
  client: { id: string; displayName: string };
  policyNumber: string;
  planName: string | null;
  startDate: string;
  endDate: string | null;
  excessMinor: number | null;
  coverLimitMinor: number | null;
  coPayPercent: number | null;
  exclusions: string | null;
  notes: string | null;
  status: string;
  state: string;
}
export interface PreAuthRow {
  id: string;
  preAuthNo: string;
  policyId: string;
  policy: InsurancePolicy;
  procedure: string;
  estimateMinor: number;
  status: string;
  submittedAt: string | null;
  decidedAt: string | null;
  approvedMinor: number | null;
  insurerReference: string | null;
  decisionNotes: string | null;
  notes: string | null;
  createdAt: string;
}
export interface InsuranceClaim {
  id: string;
  claimNo: string;
  policyId: string;
  policy: InsurancePolicy & { provider: InsuranceProvider };
  patient: { id: string; name: string; number: number; sex: string; dateOfBirth: string | null; species: { name: string }; breed: { name: string } | null; breedText: string | null; identifiers: { value: string }[] };
  client: { id: string; displayName: string; mobilePhone: string | null; email: string | null };
  condition: string;
  treatmentFrom: string;
  treatmentTo: string;
  payee: 'CLINIC' | 'CLIENT';
  claimedMinor: number;
  approvedMinor: number | null;
  paidMinor: number;
  outstandingMinor: number;
  status: string;
  clinicalSummary: string | null;
  submittedAt: string | null;
  submittedByName: string | null;
  decidedAt: string | null;
  insurerReference: string | null;
  decisionNotes: string | null;
  paidAt: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  invoices: { id: string; invoiceId: string; amountMinor: number; invoice: { id: string; number: number | null; status: string; issuedAt: string | null; totalMinor: number; balanceMinor: number } }[];
}
export interface ClinicalSummary {
  patient: { name: string; sex: string; dateOfBirth: string | null; species: { name: string }; breed: { name: string } | null; breedText: string | null; latestWeightKg: number | null } | null;
  problems: { term: string; isChronic: boolean; onsetDate: string | null }[];
  diagnoses: { term: string; type: string; createdAt: string }[];
  notes: { signedAt: string | null; presentingComplaint: string | null; assessment: string | null; plan: string | null; signedByName: string | null }[];
  weight: { weightKg: number; measuredAt: string } | null;
}
export interface ReferralContact {
  id: string;
  name: string;
  practice: string | null;
  specialty: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
}
export interface Referral {
  id: string;
  referralNo: string;
  direction: 'OUTGOING' | 'INCOMING';
  status: string;
  urgency: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
  reason: string;
  clinicalSummary: string | null;
  questions: string | null;
  externalVet: string | null;
  sentAt: string | null;
  sentByName: string | null;
  acceptedAt: string | null;
  appointmentAt: string | null;
  completedAt: string | null;
  outcome: string | null;
  declineReason: string | null;
  createdByName: string | null;
  createdAt: string;
  patient: { id: string; name: string; number: number; sex: string; dateOfBirth: string | null; latestWeightKg: number | null; species: { name: string }; breed: { name: string } | null; breedText: string | null; identifiers: { value: string }[] };
  client: { id: string; displayName: string; mobilePhone: string | null; email: string | null };
  contact: ReferralContact | null;
}

export interface ReceiptSettings {
  paperWidthMm: 58 | 80;
  sideMarginMm: number;
  fontSize: 'SMALL' | 'NORMAL' | 'LARGE';
  showLogo: boolean;
  logoSource: 'BRANDING' | 'CUSTOM';
  customLogoAttachmentId: string | null;
  logoWidthPercent: number;
  logoAlign: 'LEFT' | 'CENTER' | 'RIGHT';
  logoMonochrome: boolean;
  title: string;
  headerText: string | null;
  footerText: string | null;
  policyText: string | null;
  showLegalName: boolean;
  showBranchAddress: boolean;
  showPhone: boolean;
  showEmail: boolean;
  showTaxNumber: boolean;
  showServedBy: boolean;
  showCustomer: boolean;
  showPatient: boolean;
  showItemCodes: boolean;
  showTaxLine: boolean;
  autoPrint: boolean;
  copies: number;
  updatedAt?: string | null;
  updatedByName?: string | null;
}

export interface ReceiptBranch { id: string; name: string; phone: string | null; email: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; postcode: string | null }

/** Everything needed to lay out a receipt (GET /receipt-settings). */
export interface ReceiptContext {
  settings: ReceiptSettings;
  clinic: { name: string; legalName: string | null; taxNumber: string | null; phone: string | null; email: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; postcode: string | null };
  branches: ReceiptBranch[];
  brandingLogo: boolean;
  logoVersion: string | null;
}

export interface NotePhraseRow {
  id: string;
  field: string;
  groupName: string | null;
  label: string;
  text: string | null;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
}

// ── Wellness plans ──

export interface WellnessPlanItem {
  id: string;
  kind: 'SERVICE' | 'PRODUCT' | 'LAB';
  serviceId: string | null;
  productId: string | null;
  labTestId: string | null;
  quantity: number;
  label: string;
  unitValueMinor: number;
  unavailable: boolean;
}

export interface WellnessPlan {
  id: string;
  name: string;
  description: string | null;
  speciesId: string | null;
  species: { id: string; name: string } | null;
  durationMonths: number;
  priceMinor: number;
  monthlyPriceMinor: number | null;
  joiningFeeMinor: number;
  taxRateId: string | null;
  serviceDiscountBp: number;
  productDiscountBp: number;
  terms: string | null;
  status: 'ACTIVE' | 'RETIRED';
  activeMembers: number;
  includedValueMinor: number;
  items: WellnessPlanItem[];
}

export type WellnessState = 'ACTIVE' | 'UPCOMING' | 'EXPIRED' | 'CANCELLED';

export interface WellnessEntitlement {
  id: string;
  kind: 'SERVICE' | 'PRODUCT' | 'LAB';
  label: string;
  quantity: number;
  unitValueMinor: number;
  used: number;
  remaining: number;
}

export interface WellnessInstalment {
  id: string;
  seq: number;
  dueDate: string;
  amountMinor: number;
  status: 'SCHEDULED' | 'BILLED' | 'CANCELLED';
  billedAt: string | null;
  chargeStatus: 'PENDING' | 'INVOICED' | 'WAIVED' | null;
  invoice: { id: string; invoiceNo: string; status: string; balanceMinor: number } | null;
}

export interface WellnessUsage {
  id: string;
  kind: 'INCLUDED' | 'DISCOUNT' | 'MANUAL';
  description: string;
  quantity: number;
  savedMinor: number;
  note: string | null;
  chargeId: string | null;
  recordedByName: string | null;
  usedAt: string;
  reversedAt: string | null;
  reversedReason: string | null;
  reversedByName: string | null;
}

export interface WellnessEnrolment {
  id: string;
  number: number;
  enrolmentNo: string;
  planId: string;
  planName: string;
  plan: { id: string; name: string; status: string; durationMonths: number; monthlyPriceMinor: number | null; priceMinor: number };
  patient: { id: string; name: string; number: number; patientNo: string; status: string; species: { name: string } };
  client: { id: string; displayName: string; number: number; mobilePhone: string | null; email: string | null };
  branchId: string;
  startDate: string;
  endDate: string;
  state: WellnessState;
  status: 'ACTIVE' | 'CANCELLED';
  daysLeft: number | null;
  billing: 'UPFRONT' | 'MONTHLY';
  totalMinor: number;
  joiningFeeMinor: number;
  serviceDiscountBp: number;
  productDiscountBp: number;
  terms: string | null;
  notes: string | null;
  autoRenew: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledByName: string | null;
  createdByName: string | null;
  createdAt: string;
  renewedTo: { id: string; number: number; enrolmentNo: string; startDate: string; status: string } | null;
  renewedFrom: { id: string; number: number; enrolmentNo: string; endDate: string } | null;
  entitlements: WellnessEntitlement[];
  instalments: WellnessInstalment[];
  nextPayment: { dueDate: string; amountMinor: number } | null;
  paidInFullMinor: number;
  usages: WellnessUsage[];
  savedMinor: number;
  includedValueMinor: number;
}

export type WellnessMember = Omit<WellnessEnrolment, 'usages' | 'instalments' | 'terms'> & { includedTotal: number; includedUsed: number };

export interface WellnessSettlement {
  billedMinor: number;
  unbilledChargesMinor: number;
  scheduledMinor: number;
  usedValueMinor: number;
  shortfallMinor: number;
  unusedMinor: number;
}

export interface PatientWellness {
  today: string;
  current: WellnessEnrolment | null;
  upcoming: WellnessEnrolment | null;
  history: WellnessEnrolment[];
  availablePlans: WellnessPlan[];
}

export interface WellnessOverview {
  activeMembers: number;
  endingSoon: number;
  paymentsToBill: number;
  monthlyRecurringMinor: number;
  savedThisMonthMinor: number;
  billedThisMonthMinor: number;
  plans: { id: string; name: string; activeMembers: number }[];
}

// ── Dental charts ──

export interface DentalTooth {
  id: string;
  tooth: string;
  state: 'PRESENT' | 'MISSING' | 'UNERUPTED' | 'EXTRACTED';
  findings: string[];
  trStage: number | null;
  pdStage: number | null;
  mobility: number | null;
  furcation: number | null;
  calculus: number | null;
  gingivitis: number | null;
  probingMm: number | null;
  recessionMm: number | null;
  notes: string | null;
}

export interface DentalProcedureRow {
  id: string;
  tooth: string | null;
  code: string;
  label: string;
  serviceId: string | null;
  service: { id: string; name: string; code: string; priceMinor: number } | null;
  notes: string | null;
  recordedByName: string;
  createdAt: string;
  charge?: { id: string; status: 'PENDING' | 'INVOICED' | 'WAIVED'; unitPriceMinor: number; discountMinor: number; discountNote: string | null } | null;
}

export interface DentalChart {
  id: string;
  number: number;
  chartNo: string;
  branchId: string;
  patientId: string;
  clientId: string;
  encounterId: string | null;
  dentition: 'CANINE' | 'FELINE' | 'EQUINE';
  showDeciduous: boolean;
  examinedAt: string;
  anaesthetised: boolean;
  status: 'DRAFT' | 'SIGNED';
  occlusion: string | null;
  periodontalStage: number | null;
  calculusIndex: number | null;
  gingivalIndex: number | null;
  oralFindings: string | null;
  homeCare: string | null;
  notes: string | null;
  recheckDate: string | null;
  previousChartId: string | null;
  clinicianName: string;
  signedByName: string | null;
  signedAt: string | null;
  contentHash: string | null;
  createdAt: string;
  patient: { id: string; name: string; number: number; patientNo: string; sex: string; dateOfBirth: string | null; species: { id: string; name: string; category: string }; breed: { name: string } | null; breedText: string | null };
  client: { id: string; displayName: string; number: number };
  teeth: DentalTooth[];
  procedures: DentalProcedureRow[];
  addenda: { id: string; text: string; authorName: string; createdAt: string }[];
  extractedNow: string[];
  worstToothStage: number | null;
  previous?: { id: string; chartNo: string; examinedAt: string; periodontalStage: number | null } | null;
  integrity?: 'VERIFIED' | 'MISMATCH' | null;
}

export interface DentalChartListItem {
  id: string;
  chartNo: string;
  status: 'DRAFT' | 'SIGNED';
  dentition: DentalChart['dentition'];
  examinedAt: string;
  periodontalStage: number | null;
  clinicianName: string;
  signedByName: string | null;
  patient: { id: string; name: string; patientNo: string; species: { name: string } };
  client: { id: string; displayName: string };
  _count: { procedures: number; teeth: number };
}

export interface DentalPrice {
  code: string;
  label: string;
  abbr: string;
  scope: 'tooth' | 'mouth' | 'both';
  dentitions: string[] | null;
  service: { id: string; name: string; code: string; priceMinor: number; isActive: boolean } | null;
}
