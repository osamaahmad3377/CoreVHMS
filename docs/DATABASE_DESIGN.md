# Database Design — NextCore VCMS

Source of truth: `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/`. This document explains the design; update it when a migration changes the model.

## 1. Conventions

| Rule | Detail |
|---|---|
| Identifiers | UUID v4 primary keys (`@db.Uuid`). Human-facing numbers (C-000123, P-000045, INV-…) come from the `Counter` table. |
| Tenancy | Every tenant-owned table has `organizationId` (FK → `Organization`, `ON DELETE RESTRICT`). The Prisma tenant extension injects it into every query; cross-tenant FK references from user input are validated in services. |
| Branch | Operational rows carry `branchId`/`primaryBranchId` where location matters (appointments, stock, invoices). |
| Time | `timestamptz(3)` in UTC. Date-only clinical facts (date of birth) use `date`. Branch timezone drives display/scheduling. |
| Money | Integer minor units + organization currency. No floating point. |
| Deletion | Clinical, financial and identity records are never hard-deleted by application code: status fields (`ARCHIVED`, `MERGED`, `VOIDED`), soft-delete (`deletedAt`) for attachments, amendments for signed records. |
| Audit | `AuditEvent` is append-only (DB trigger rejects UPDATE/DELETE). Writes happen in the same transaction as the change. |
| JSON | Only for audit diffs and genuinely schemaless payloads (integration logs). Never as a substitute for relational entities. |

## 2. Entity overview (implemented)

### Identity & tenancy
```
Organization 1─* Branch
Organization 1─* Role 1─* RolePermission(permission key)
Organization 1─* Membership *─1 User
Membership *─* Role      (MembershipRole)
Membership *─* Branch    (MembershipBranch)
User 1─* Session, AuthToken(PASSWORD_RESET | INVITATION), MfaChallenge
AuditEvent (organizationId nullable for pre-tenant events such as failed logins)
Counter (organizationId, key) → value
```
- `User` is global (one login across organizations); `Membership` carries per-organization status, job title, clinician flag and professional registration number.
- `Session.tokenHash` = SHA-256 of an opaque random token; the token itself is only in the HttpOnly cookie.
- MFA secrets are AES-256-GCM encrypted (`mfaSecretEnc`); recovery codes are stored as SHA-256 hashes.

### Clients
```
Client 1─* Address        (one isPrimary per client, enforced in service)
Client 1─* ClientContact  (CO_OWNER | AUTHORIZED | EMERGENCY | BILLING | OTHER)
Client 1─* ClientNote
Client 1─* PatientOwnership *─1 Patient
```
- `displayName` is denormalised for sorting/search; `phoneDigits` holds the last 10 digits of the mobile number so `0300 1234567` and `+92 300 1234567` match.
- `balanceMinor` is a cached balance maintained by the finance module (Milestone 5) inside invoice/payment transactions.
- Merges set `status = MERGED`, `mergedIntoId`; related rows are re-pointed by registered merge steps.

### Patients
```
Species 1─* Breed
Patient *─1 Species, *─1 Breed?
Patient 1─* PatientOwnership  (history; exactly one current primary owner — partial unique index)
Patient 1─* PatientIdentifier (MICROCHIP | EAR_TAG | RFID | TATTOO | BRAND | REGISTRATION | OTHER)
Patient 1─* WeightRecord      (latestWeightKg cached on Patient)
Patient 1─* PatientAlert      (ALLERGY | CONDITION | BEHAVIOUR | MEDICATION | OTHER; INFO/WARNING/CRITICAL)
```
- `PatientIdentifier` is unique per `(organizationId, type, value)`; values are normalised (spaces removed, upper-case).
- Death/transfer/archive are status changes with dates and reasons; nothing is deleted.

### Files
`Attachment(entityType, entityId)` stores metadata only (name, MIME, size, SHA-256, storage key, uploader). Bytes live in the storage adapter. Access is authorised through the owning entity's permissions.

## 3. Constraints and indexes (beyond Prisma defaults)

| Object | Purpose |
|---|---|
| `Client_displayName_trgm_idx`, `Patient_name_trgm_idx` (GIN, `pg_trgm`) | Fast fuzzy search and duplicate detection (`similarity()`). |
| `PatientOwnership_one_current_primary` (partial unique on `patientId` where `isPrimary AND endedAt IS NULL`) | Guarantees a single current legal owner. |
| `audit_event_no_update` trigger | Makes `AuditEvent` append-only. |
| `(organizationId, number)` unique on Client/Patient | Per-tenant numbering. |
| `(organizationId, status, displayName)`, `(organizationId, phoneDigits)`, `(organizationId, email)` | List/sort/search paths. |

### Scheduling (Milestone 3)
```
AppointmentType (duration, colour, indicative price, requiresClinician)
Resource (room/theatre/equipment per branch)
WorkingHours (membership × branch × weekday, minutes in branch-local time)   StaffLeave
Appointment *─1 Client, Patient?, AppointmentType, Membership(clinician)?, Branch
Appointment 1─* AppointmentResource (times copied for overlap constraint)
Appointment 1─* TriageAssessment     WaitlistEntry
```
- `Appointment_clinician_no_overlap` — `EXCLUDE USING gist (clinicianId WITH =, tstzrange(startsAt, endsAt) WITH &&)` for active, non-overbooked rows. `AppointmentResource_no_overlap` does the same per resource. Overlaps are therefore impossible even under concurrent requests (tested).
- Status lifecycle: BOOKED → CONFIRMED → CHECKED_IN → IN_CONSULTATION → COMPLETED; CANCELLED (reason) / NO_SHOW release the slot.

### Clinical records (Milestone 3)
```
Encounter *─1 Patient, Client (owner at time of visit), Appointment? (1:1), Membership(clinician)
Encounter 1─* ClinicalNote (versions via amendsId), VitalSign, Diagnosis, Task
Patient 1─* ProblemListItem, VitalSign, Diagnosis
Species 1─* VitalReference (low/high/unit/source/reviewer)
ClinicalTemplate
```
- `clinical_note_immutable` trigger: SIGNED/SUPERSEDED notes cannot be deleted and their content, signer, timestamps and hash cannot change; only SIGNED → SUPERSEDED and re-pointing `patientId` after a merge are allowed.
- `contentHash` = SHA-256 of canonical content + signer + signedAt; `/notes/:id/verify` recomputes it.

### Formulary, prescriptions & administration (Milestone 4)
```
Product (strength per dispensing unit, minDispenseIncrement, controlled, targetSpecies)
Product 1─* ProductWithdrawal (per species: meat days / milk hours / egg days + source)
Product 1─* DoseReference (per species & route, min/max/unit, source, DRAFT → APPROVED by vet)
Prescription (DRAFT → AUTHORIZED → PARTIALLY_DISPENSED → DISPENSED | CANCELLED; contentHash)
Prescription 1─* PrescriptionItem (dose, weight used, amountPerDose, quantity, repeats, warnings JSON, overrideReason)
PrescriptionItem 1─* Dispensation (quantity, batch, expiry)
MedicationAdministration (in-clinic, GIVEN/NOT_GIVEN, batch)    PatientWithdrawal (clear dates per product)
```
- `prescription_item_frozen` trigger: no insert/delete/clinical-field change once the prescription is not DRAFT (only `quantityDispensed` may change). CHECK constraints keep quantities positive and dispensing ≤ quantity × (1 + repeats).

### Laboratory & imaging (Milestone 4)
```
LabTest 1─* LabAnalyte 1─* ReferenceInterval (species, sex, age band, low/high, critical limits, source)
DiagnosticOrder 1─* DiagnosticOrderItem 1─* LabResult (snapshotted interval + flag; supersedesId chain)
DiagnosticOrderItem 1─1 ImagingReport
DiagnosticOrder 1─* Sample 1─* SampleEvent (chain of custody)
```
- `lab_result_immutable` trigger: FINAL/SUPERSEDED results cannot be changed or deleted; corrections are new FINAL rows that supersede the original.

### Inventory & procurement (Milestone 5)
```
StockLocation (per branch, one default) 1─* StockLevel *─1 StockBatch (product, batch no., expiry, weighted-average cost, status)
StockMovement (append-only ledger: type, signed quantity, balanceAfter, unit cost, reference)
StockCount 1─* StockCountLine (expected snapshot, counted)
Supplier 1─* PurchaseOrder 1─* PurchaseOrderLine ; GoodsReceipt 1─* GoodsReceiptLine (→ batch, → PO line)
PurchaseRequest (product, quantity, OPEN → ORDERED (→ PurchaseOrder) / REJECTED / CANCELLED; quantity > 0)
Supplier 1─* SupplierReturn 1─* SupplierReturnLine (→ batch, at batch cost; both append-only; RETURN_TO_SUPPLIER stock movements reference the return)
```
- `StockLevel` is unique per (batch, location); issues lock rows with `SELECT … FOR UPDATE` so concurrent issues cannot oversell.
- `stock_movement_append_only` trigger: ledger rows cannot be updated or deleted.
- Organization flags: `allowNegativeStock`; Product: `trackStock`, `reorderLevel`, `reorderQuantity`, `taxRateId`.

### Billing & finance (Milestone 5)
```
TaxRate, Service (code, price, tax) ← AppointmentType.serviceId
Charge (unique per organization + sourceType + sourceId; PENDING → INVOICED | WAIVED) ─1 InvoiceLine
Invoice (number assigned at issue) 1─* InvoiceLine ; 1─* CreditNote ; *─* Payment via PaymentAllocation
Payment (unique idempotencyKey per org) 1─* Refund
Estimate 1─* EstimateLine ; CashRegister 1─* CashSession ; Expense
```
- Money is integer minor units; tax per line in basis points, rounded per line; `Organization.pricesIncludeTax` switches inclusive/exclusive.
- Triggers: issued invoice lines are frozen (only `stockIssued` may change); invoice totals and number are frozen once issued; issued invoices, payments, refunds and credit notes cannot be deleted.
- Partial unique index: one OPEN cash session per register. CHECK constraints keep payment/refund/credit amounts positive.
- Client balance (`Client.balanceMinor`) = outstanding on issued invoices − unallocated payment credit; recomputed inside every billing transaction.

### Hospitalisation & surgery (Milestone 6)
```
Ward (branch, type, daily service) 1─* Cage
Admission (patient, client, ward, cage, condition, CPR status, responsible vet, discharge outcome/summary)
  1─* TreatmentOrder (kind, schedule, product/dose/route or fluid rate, interval) 1─* TreatmentTask (due, done/not done)
  1─* HospitalNote (progress / handover / alert)        VitalSign.admissionId links observations to a stay
Surgery (appointment, theatre Resource, service fee, ASA, consent, checklist JSON, anaesthesia plan, report)
  1─* SurgeryTeamMember · AnaesthesiaReading · SurgeryItem · SurgeryAddendum      SurgeryChecklistItem (org template)
```
- Partial unique indexes: one ADMITTED admission per patient and per cage.
- Triggers: discharged/cancelled admissions are frozen (patient/client re-pointing for merges allowed); completed/cancelled surgeries are frozen and undeletable; recorded treatment tasks cannot change; anaesthesia readings, hospital notes, surgery items and addenda are append-only.
- Daily hospital charges use deterministic source ids (`stableUuid("admission-day:<id>:<n>")`) so each day is billed once.

### Preventive care, communications & portal (Milestone 7)
```
CareProtocol (kind, species, product, first-dose age, interval, source, DRAFT/APPROVED/RETIRED) 1─* CareItem (due/deferred/completed/cancelled, administration link, reminder stamps)
MessageTemplate (purpose × channel) · OutboundMessage (queue + delivery log: status, attempts, nextAttemptAt, dedupeKey)
ClientMessage (secure portal messaging, INBOUND/OUTBOUND, readAt; trigger `client_message_lock`: no deletes, no edits except the read receipt and the fixed anonymisation redaction)
PortalUser (global login) 1─* PortalAccess (organisation + client) · PortalSession · PortalToken (invite/reset)
AppointmentRequest (portal request → booked/declined)            Attachment.sharedWithClient · Appointment.reminderSentAt
```
- Partial unique index: one open (due/deferred) care item per patient and protocol. Unique dedupe key per organisation on outbound messages.
- Triggers: completed care items are locked (merge re-pointing and reminder stamps excepted) and cannot be deleted; client messages cannot be edited (read receipt only) or deleted.

### Livestock, boarding & grooming, insurance & referrals (Milestone 8)
```
Client 1─* Farm 1─* AnimalGroup (HERD/FLOCK/PEN/BATCH; batch groups keep headCount) ─* Patient (farmId, groupId, sireId, damId)
LivestockMovement (append-only: move, purchase, sale, transfer, death, cull, birth, placement; animal or head count)
BreedingEvent (female, sire, result, expectedDueDate + dueDateSource, offspring counts; voided not deleted)
ProductionRecord (milk/eggs/feed/water/batch weight/mortality; voided not deleted) · GroupTreatment (product, stock, withdrawal clear dates)
DiseaseOutbreak · FieldVisit (appointment link) 1─* FieldVisitItem (billed)        Species.gestationDays + gestationSource
BoardingUnit (nightly service) 1─* BoardingStay (rate snapshot) 1─* BoardingLog (append-only)
GroomingJob (appointment link) 1─* GroomingJobService
InsuranceProvider 1─* InsurancePolicy 1─* PreAuthorization, InsuranceClaim *─* Invoice (InsuranceClaimInvoice)
ReferralContact 1─* Referral (OUTGOING/INCOMING)                                    PaymentMethod += INSURANCE
```
- Check constraints on head counts, quantities, amounts, policy and stay dates; partial unique index: one CHECKED_IN stay per animal. Unit double-booking is prevented with a per-unit advisory lock and overlap check.
- Triggers: movement history append-only (merge re-pointing allowed); breeding and production records may only be voided once (no edits/deletes); group treatments immutable; completed/cancelled field visits locked; field-visit items and boarding logs append-only.

## 4. Planned entities (later milestones)

| Milestone | Entities |
|---|---|
