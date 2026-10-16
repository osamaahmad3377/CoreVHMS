# MASTER DEVELOPMENT PROMPT — NEXTCORE VETERINARY CLINIC MANAGEMENT SYSTEM (VCMS)

## 1. Your Role

Act as a senior software architect, principal full-stack developer, veterinary practice management domain expert, database architect, UI/UX designer, QA engineer, cybersecurity specialist, and AI integration engineer.

You are responsible for designing, developing, testing, and documenting a complete, professional **Veterinary Clinic Management System (VCMS)**, also known as Veterinary Practice Management Software (VPMS).

The product must be comparable in breadth and usability to modern veterinary platforms such as Digitail, Veterian, Instinct EMR, Neurovet, and other established practice management systems. Use these products as market references for feature categories and workflow ideas. Do not copy their proprietary code, branding, or designs.

The application must be a real, working product—not a static mockup, a collection of disconnected pages, or a dashboard containing fake data.

## 2. Product Vision

Build a comprehensive veterinary practice management platform for:

- Veterinary clinics and general practices.
- Pet hospitals and emergency veterinary centres.
- Companion animals, including dogs, cats, rabbits, and other configurable species.
- Livestock and farm veterinary services, including cattle, buffalo, sheep, goats, and poultry.
- Veterinary laboratories and diagnostic facilities.
- Veterinary pharmacies and dispensaries.
- Multi-doctor and multi-branch veterinary organizations.

The system should automate administrative work, centralize clinical records, improve patient safety, simplify client communication, manage inventory and finance, and provide actionable operational analytics.

Support Pakistan and Australia as initial target markets, with architecture that allows expansion into other countries.

The system should be configurable for different clinic sizes, specialties, workflows, currencies, languages, tax rules, and regulatory requirements.

## 3. First Action: Inspect the Existing Repository

Before writing code:

1. Inspect the repository structure, existing files, package configuration, database schema, installed dependencies, routes, authentication, UI components, and deployment setup.
2. Determine whether this is an existing application or a new project.
3. Preserve working functionality and follow the existing conventions where appropriate.
4. Identify incomplete features, broken workflows, duplicated code, security problems, and architectural limitations.
5. Create `docs/PROJECT_AUDIT.md` documenting your findings.
6. Create `docs/IMPLEMENTATION_PLAN.md` containing the architecture, milestones, dependencies, risks, and implementation sequence.
7. Create `docs/FEATURE_MATRIX.md` listing all modules and their implementation status.
8. Create `docs/DATABASE_DESIGN.md` documenting the proposed entities, relationships, constraints, and indexes.
9. If the repository is empty, establish the project structure and initial architecture before implementation.
10. Do not delete existing user work, reset Git, overwrite configuration, or run destructive database commands without explicit authorization.

After the audit, begin implementation. Do not stop after producing documentation or a plan.

## 4. Recommended Technology Stack

First inspect the existing project. If no suitable stack exists, use the following baseline:

### Frontend
- Next.js with App Router.
- React and TypeScript with strict type checking.
- Tailwind CSS.
- A consistent accessible component library such as shadcn/ui.
- React Hook Form and Zod for form handling and validation.
- TanStack Query where client-side server-state management is useful.
- A calendar component suitable for scheduling and resource management.
- Reusable charts and data tables.

### Backend
- NestJS with TypeScript, or a clearly structured server-side architecture appropriate to the existing repository.
- REST APIs with versioning and OpenAPI documentation.
- Server-side validation, authorization, business logic, and transaction management.
- Background jobs for reminders, notifications, report generation, and scheduled maintenance.

### Database
- PostgreSQL for the primary production database.
- Prisma ORM or another well-supported ORM with explicit migrations.
- Relational data modeling with foreign keys, appropriate indexes, transactions, and constraints.
- Database-backed audit trails and reliable backup procedures.

### Infrastructure
- Docker and Docker Compose for reproducible development.
- Environment variables for secrets and configuration.
- Automated tests and CI workflows.
- Object storage abstraction for documents and images.
- Optional external services for email, SMS, WhatsApp, payments, AI, and laboratory integration.

### Desktop and Offline Support
Design the system so it can eventually run as an installed desktop application and support offline clinic workflows.

Do not falsely claim that a cloud-only application works offline. Implement a deliberate offline architecture when required, with local persistence, synchronization, conflict resolution, and secure recovery.

For initial development, keep the application modular so the desktop distribution and offline capabilities can be added without rewriting the clinical domain.

## 5. Product Design and User Experience

Build a premium, modern, clean, responsive interface suitable for real veterinary professionals.

The application should feel like a mature healthcare product, not a generic admin template.

### Design requirements
- Desktop-first clinical workflows with full tablet and mobile responsiveness.
- Clear typography, consistent spacing, and accessible colour contrast.
- A collapsible sidebar and a contextual top navigation bar.
- Fast global search for patients, owners, appointments, invoices, and records.
- Persistent patient identity and relevant medical alerts throughout clinical workflows.
- Quick actions for new appointment, patient registration, consultation, prescription, invoice, and emergency admission.
- Clear status indicators for waiting, in consultation, hospitalized, in surgery, recovery, discharged, and other configurable states.
- Keyboard-friendly navigation, accessible forms, loading states, empty states, and error messages.
- Confirmation dialogs for destructive or high-impact actions.
- Search, sorting, pagination, and useful filters in data-heavy screens.
- Light and dark themes if practical.
- Configurable clinic branding, logo, invoice templates, and print layouts.

Use a coherent veterinary product design system. Do not overload the interface with too many cards, colours, charts, or unnecessary animations.

### Main navigation

Create an organized navigation structure covering:

1. Dashboard
2. Front Desk
3. Calendar and Appointments
4. Clients and Owners
5. Animal Patients
6. Clinical Records
7. Consultations
8. Prescriptions and Pharmacy
9. Laboratory and Diagnostics
10. Hospitalization
11. Surgery and Anaesthesia
12. Preventive Care and Vaccinations
13. Inventory and Procurement
14. Billing and Payments
15. Point of Sale
16. Livestock and Farm Management
17. Boarding and Grooming
18. Insurance and Referrals
19. Staff and Scheduling
20. Reports and Analytics
21. Communications
22. Documents and Templates
23. Integrations
24. Administration and Settings
25. Audit Logs and Security

Show menu items according to user permissions and enabled modules.

## 6. Authentication, Roles and Permissions

Implement a secure authentication and authorization system.

Required roles should include:

- Platform administrator.
- Organization owner.
- Practice manager.
- Veterinarian.
- Veterinary nurse or technician.
- Receptionist.
- Laboratory technician.
- Pharmacy or dispensary staff.
- Surgeon and anaesthesia staff.
- Ward and inpatient staff.
- Inventory and procurement officer.
- Accountant or cashier.
- Farm or field veterinarian.
- Pet owner or farm client.
- External laboratory or referral partner.

Allow organizations to create custom roles and assign granular permissions.

Support:
- Login, logout, password reset, account invitation, and account recovery.
- Two ways to add a staff member, chosen by the administrator:
  - **Email invitation:** the person receives a link and sets their own password.
  - **Temporary password:** the system generates a strong password that is shown once to the administrator, who shares it in person. No email is needed. At first sign-in the person must choose their own password before they can use anything else. An unused temporary password expires after 7 days.
  - Administrators can issue a new temporary password to a staff member who has forgotten theirs, but only when that account is used by their organization alone. An email address that already has an account can only be invited, so an existing password is never replaced.
- Multi-factor authentication where supported.
- Session expiration and secure session management.
- Optional single sign-on for suitable deployments.
- Organization and branch membership.
- Separation of clinical, financial, inventory, and administrative permissions.
- Restricted access to sensitive medical and financial information.
- Audit logs for sensitive access, changes, exports, and administrative actions.

Never rely only on hiding frontend buttons for authorization. Enforce permissions on the server for every protected operation.

## 7. Core Module: Dashboard and Operations

Create a live dashboard that displays information derived from actual database records.

Include:
- Today's appointments.
- Checked-in and waiting patients.
- Consultations in progress.
- Emergency cases and triage priorities.
- Animals in surgery, recovery, and hospitalization.
- Pending diagnostic results.
- Follow-up tasks and overdue reminders.
- Prescriptions awaiting approval or dispensing.
- Low-stock and near-expiry products.
- Daily revenue, outstanding balances, and payment summaries.
- Staff workload and appointment utilization.
- Branch-level operational statistics.

Provide date ranges, branch filters, user-specific dashboards, drill-down links, and appropriate empty states.

Never use hardcoded figures in production dashboard components.

## 8. Core Module: Client and Owner Management

Implement complete client records.

Each client may be an individual, family, farm, breeder, company, or other configurable organization.

Include:
- Unique client number.
- Name and contact details.
- Email, phone, addresses, and emergency contact.
- Preferred communication channels.
- Multiple animals associated with one client.
- Co-owners and authorized contacts.
- Client balance, invoices, receipts, and payment history.
- Client consent and communication preferences.
- Notes, attachments, complaints, and communication history.
- Farm and business details.
- Client portal account linkage.
- Search, filtering, merging duplicate clients, and controlled archival.

Maintain a clear relationship between legal ownership, primary contact, authorized representative, farm, and animal.

## 9. Core Module: Animal Patient Management

Every animal must have a unique patient record.

Include:
- Patient ID, name, photograph, species, breed, sex, colour, markings, and date of birth or estimated age.
- Microchip, ear tag, RFID, tattoo, or other identification.
- Weight history, body-condition score, and relevant measurements.
- Owner, co-owner, farm, herd, or flock association.
- Allergies, chronic conditions, and important medical warnings.
- Vaccinations, deworming, and preventive-care history.
- Medical consultations, diagnoses, laboratory results, imaging, prescriptions, procedures, and surgeries.
- Reproductive history, pedigree, and offspring relationships where applicable.
- Insurance details and external identifiers where applicable.
- Patient status, deceased date, transfer history, and archival controls.
- Attachments, consent forms, certificates, and clinical documents.

Implement a unified patient timeline and patient-specific search.

Prevent accidental duplicate registration where possible and provide safe record-merging workflows.

## 10. Core Module: Appointments, Calendar and Triage

Build a functional scheduling engine.

Include:
- Day, week, month, and resource calendar views.
- Online booking and receptionist booking.
- Appointment type, duration, price, location, and assigned veterinarian.
- Doctor availability, working hours, leave, breaks, and capacity.
- Treatment rooms, equipment, and other bookable resources.
- Prevention of scheduling conflicts.
- Walk-ins and waiting lists.
- Check-in, triage, consultation, completion, cancellation, and no-show states.
- Emergency triage and configurable priority queues.
- Recurring appointments and follow-up bookings.
- Rescheduling and cancellation policies.
- Appointment confirmation and reminder jobs.
- Wait-time tracking and queue displays.
- Multi-branch schedules and timezone-aware appointments.

Triage should help staff prioritize cases, but emergency alerts and priority decisions must remain under appropriate veterinary control.

## 11. Core Module: Clinical Records and Consultations

Implement complete electronic veterinary medical records.

Include:
- Consultation history and encounter management.
- Presenting complaint and clinical history.
- Subjective, Objective, Assessment, and Plan (SOAP) notes.
- Vital signs and configurable species-specific measurements.
- Physical examination templates.
- Differential and confirmed diagnoses.
- Clinical problem lists.
- Treatment plans and follow-up instructions.
- Medical alerts, allergies, and relevant contraindications.
- Clinical photographs, scanned documents, and attachments.
- Referral letters and clinical summaries.
- Reusable templates for common consultations.
- Draft, reviewed, signed, and amended record states.
- Timestamps, author attribution, and audit history.

Signed clinical records must not be silently overwritten. Use amendment or addendum workflows that preserve the original record and record who changed what and why.

## 12. AI-Assisted SOAP Notes and Voice Dictation

Build an optional AI assistance module.

Required capabilities:
- Voice recording or dictated-text input, subject to consent and supported browser or desktop capabilities.
- Speech-to-text integration.
- Draft SOAP note generation from the supplied clinical information.
- Extraction of symptoms, examination findings, diagnoses, and planned treatment into editable fields.
- Summarization of previous medical history.
- Identification of missing clinical information.
- Conversion of approved templates into structured clinical documentation.
- Clinician review, editing, and explicit approval before saving a final signed note.
- Auditability of generated and modified documentation.
- Configurable retention and deletion of audio and AI-processing data.

AI-generated content must be clearly labelled as a draft. Never fabricate examination findings, laboratory results, diagnoses, or medication orders. If information is missing, mark it as unknown rather than inventing it.

Do not automatically sign clinical notes or issue prescriptions without the required human approval.

## 13. Prescriptions, Medication and Treatment

Implement:
- Medicine catalogue and product search.
- Prescription creation and authorization.
- Species, weight, dosage, route, frequency, duration, and quantity.
- Configurable dosage calculation tools with appropriate units and validation.
- Weight-based calculations with explicit rounding rules.
- Prescription labels and printable instructions.
- Medication dispensing and administration records.
- Repeat prescriptions and prescription history.
- Drug allergies, interactions, and safety warnings when reliable data sources are available.
- Treatment plans, injections, fluids, wound care, and nursing tasks.
- Medication reconciliation and adverse-event reporting.
- Pharmacy stock deduction and invoice integration.

Do not hardcode unverified drug dosages. Dosage calculations must use validated, maintained veterinary references and be reviewed by a qualified veterinarian. Show units, calculation inputs, warnings, and the source of clinical reference information.

## 14. Laboratory, Imaging and Diagnostics

Build an extensible diagnostics module.

Include:
- Configurable test catalogue and prices.
- Diagnostic orders associated with a patient and consultation.
- Sample collection, specimen identification, and barcode labels.
- Sample status and chain of custody where required.
- In-house and external laboratory workflows.
- Result entry, validation, approval, and report generation.
- Configurable reference intervals based on relevant species and test context.
- Abnormal and critical-result alerts.
- Blood, urine, faecal, microbiology, pathology, and other configurable tests.
- Imaging orders and report attachments.
- X-ray, ultrasound, CT, MRI, and other modality support.
- DICOM integration where appropriate.
- Laboratory analyzer connectors through supported protocols or vendor APIs.
- Result amendments and complete audit history.

Do not claim hardware integration unless the specific device, interface, protocol, and test environment have been implemented.

## 15. Hospitalization, Emergency and Surgery

### Hospitalization
- Admissions and discharge.
- Ward, cage, kennel, and isolation assignment.
- Hospitalization flowboard.
- Patient status and responsible clinical team.
- Vital-sign charts and observation schedules.
- Nursing tasks and shift handover.
- Feeding, hydration, medication, and fluid tracking.
- Treatment administration records.
- Critical alerts and escalation.
- Daily charges and discharge summaries.

### Surgery and anaesthesia
- Surgery scheduling and theatre availability.
- Pre-operative assessment and consent.
- Procedure checklists and team assignment.
- Anaesthesia planning and monitoring charts.
- Surgical notes, equipment, and consumable usage.
- Recovery observations.
- Post-operative medication and discharge instructions.
- Complication records and follow-up.

Maintain real-time workflow status without presenting unverified data as real-time. Support clear responsibility and traceability for clinical actions.

## 16. Preventive Care and Vaccinations

Include:
- Species-specific, configurable preventive-care schedules.
- Vaccination protocols and vaccination certificates.
- Vaccine batch and expiry tracking.
- Deworming and parasite prevention.
- Wellness plans and scheduled health checks.
- Reminder generation and follow-up tracking.
- Due, overdue, completed, cancelled, and deferred statuses.
- Recurring care schedules.
- Client notifications and communication preferences.
- Preventive-care compliance reports.

Schedules and clinical recommendations must be configurable and reviewed against applicable veterinary guidance.

## 17. Pharmacy, Inventory and Procurement

Create a complete inventory management subsystem.

Include:
- Medicines, vaccines, consumables, equipment, and retail products.
- Product categories, SKUs, barcodes, units, and pricing.
- Batch and lot tracking.
- Expiry dates, supplier details, and purchase costs.
- Stock by branch, warehouse, shelf, or other storage location.
- Purchase requests, approval, purchase orders, and goods received.
- Supplier invoices and purchase returns.
- Stock transfers, adjustments, counts, and reconciliation.
- Minimum and maximum stock levels.
- Low-stock and expiry alerts.
- First-expiry-first-out issuing where appropriate.
- Damaged, recalled, quarantined, and expired stock workflows.
- Costing and inventory valuation.
- Sales, dispensing, and automatic stock deductions.
- Inventory audit logs.
- Controlled-medicine recordkeeping where required.
- Vaccine temperature monitoring where applicable.

Prevent negative inventory where configured, validate batch selection, and preserve a traceable stock movement ledger.

## 18. Billing, POS and Finance

Implement a transactional billing system.

Include:
- Service catalogue and configurable prices.
- Consultation, procedure, medicine, test, surgery, and hospitalization charges.
- Estimates and quotations.
- Draft, issued, paid, partially paid, overdue, voided, and refunded invoice states.
- Invoice line items, taxes, discounts, deposits, and adjustments.
- Cash, card, bank transfer, and supported online payment methods.
- Split payments and payment allocation.
- Refunds and credit notes.
- Client statements and outstanding balances.
- Cash register opening, closing, and reconciliation.
- Point of sale for retail and pharmacy sales.
- Supplier balances and expense records.
- Revenue, sales, tax, and profitability reports.
- Export to accounting software or structured files.

Integrate billable services with consultations, diagnostics, procedures, and medication dispensing so charges are not accidentally omitted or duplicated.

Never store raw payment-card details. Use compliant payment providers for card transactions.

## 19. Client Portal and Communications

> **Decision (2026-10-15):** the client portal is built and tested but **switched off** for the first release (`CLIENT_PORTAL_ENABLED=false`). With it off, portal pages, portal API routes and portal controls for staff are not available. It is planned for a future release. Email reminders and communications are active.

Create a secure client-facing portal.

Include:
- Account registration and authentication.
- Authorized animal profiles.
- Appointment requests and appointment history.
- Vaccination reminders and preventive-care schedules.
- Approved medical reports and laboratory results.
- Prescriptions, invoices, receipts, and payment history.
- Follow-up instructions and discharge documents.
- Secure messaging where supported.
- Consent and communication preferences.
- Appointment cancellation and rescheduling within configured rules.
- Feedback and support requests.

Integrate email, SMS, and WhatsApp through appropriate providers.

Use background jobs, retry policies, delivery statuses, rate limits, and communication logs. Avoid duplicate notifications and respect opt-outs and applicable privacy requirements.

## 20. Livestock and Farm Management

Include:
- Farm, owner, herd, flock, and animal group records.
- Cattle, buffalo, sheep, goats, poultry, and configurable species.
- Ear tags, RFID, and animal identification.
- Herd movement and ownership history.
- Breeding and mating records.
- Artificial insemination.
- Heat detection and pregnancy examinations.
- Expected and actual birth records.
- Offspring and pedigree tracking.
- Milk production and growth records.
- Vaccination and parasite-control campaigns.
- Disease surveillance and outbreak tracking.
- Feed and nutritional records.
- Medication withdrawal periods and treatment records.
- Mortality, culling, sales, and transfers.
- Field visit scheduling and on-site billing.
- Batch-level poultry production and mortality.
- Farm health and productivity reporting.

Support offline field workflows through a deliberate synchronization architecture if offline operation is enabled.

## 21. Additional Modules

Design modular implementations for:
- Boarding and kennel management.
- Grooming appointments and billing.
- Pet retail and shop POS.
- Insurance policies, pre-authorizations, and claim documentation.
- Referral management and external specialists.
- Blood bank and transfusion traceability.
- Dental charts and dental procedures.
- End-of-life care and aftercare arrangements.
- Breeding, pedigrees, and genetics.
- Equipment assets, calibration, and maintenance.
- Supplier management and procurement.
- Document templates, certificates, consent forms, and digital signatures.
- Customer support, feedback, and complaint management.
- Multi-branch and corporate group management.

Implement these as real modules with database models, permissions, workflows, validation, and tests—not as navigation links to empty pages.

## 22. Reporting and Analytics

Provide operational and financial reporting for:
- Appointments, utilization, cancellations, and no-shows.
- New clients and registered patients.
- Revenue, taxes, payments, and outstanding balances.
- Service and product sales.
- Profitability and expenses.
- Pharmacy stock valuation, expiry losses, and turnover.
- Supplier purchases and stock movements.
- Laboratory turnaround times.
- Hospital occupancy and length of stay.
- Clinical follow-ups and preventive-care completion.
- Staff workloads and performance.
- Livestock health and productivity.
- Branch-level comparisons.

Reports should include appropriate filters, drill-down navigation, date ranges, branch selection, and CSV, Excel, or PDF exports.

Clearly distinguish revenue from profit, and calculate financial measures using documented accounting rules.

## 23. Settings and Configuration

Provide configurable settings for:
- Organization, clinic, and branches.
- Branding, logo, and contact details.
- Users, roles, permissions, and approval rules.
- Appointment types, calendars, and working hours.
- Species, breeds, clinical templates, and diagnostic catalogues.
- Medicines, products, suppliers, and pricing.
- Currency, taxes, invoice numbering, and payment methods.
- Units of measurement, time zones, and date formats.
- Languages and translations.
- Notification templates and provider credentials.
- Data import/export and retention.
- Integrations and API keys.
- Backup, restore, and system maintenance.
- Optional feature modules and subscriptions.

Keep credentials and sensitive configuration in secure storage. Do not expose secrets to frontend code or commit them to version control.

## 24. Database Architecture

Design a normalized relational database with appropriate foreign keys, constraints, indexes, and transaction boundaries.

Consider entities including:

- organizations, clinics, branches, users, roles, permissions, memberships and sessions;
- clients, contacts, addresses, farms and client consent;
- animals, species, breeds, identifiers, ownership history and patient relationships;
- appointments, calendars, resources, queues and triage assessments;
- encounters, clinical notes, observations, diagnoses, allergies and problems;
- prescriptions, prescription items, medication administrations and treatment plans;
- procedures, surgeries, anaesthesia records, hospital admissions and nursing observations;
- diagnostic orders, samples, tests, results, imaging studies and reports;
- products, medicines, batches, stock locations, stock movements, suppliers and purchase orders;
- services, price lists, estimates, invoices, invoice items, payments, refunds and expenses;
- vaccinations, preventive-care schedules, reminders and communications;
- herds, flocks, breeding events, offspring, farm visits and production records;
- documents, attachments, consent forms and templates;
- audit events, integration configurations, background jobs and notification delivery records.

Use UUIDs or another consistent identifier strategy. Add organization and branch ownership where appropriate, and enforce tenant isolation at the backend and database-access layers.

Do not put every feature into one large table or use unstructured JSON as a substitute for relational entities.

Store files outside the main relational database when appropriate, using secure metadata records and controlled access.

## 25. API and Integration Standards

Build versioned, documented APIs with:
- Input validation and normalized error responses.
- Authentication and authorization.
- Pagination, filtering, and sorting.
- Rate limiting for sensitive endpoints.
- Transaction-safe writes.
- Idempotency for appropriate financial and integration operations.
- Consistent timestamps and timezone handling.
- Integration logs and retry policies.
- Webhooks where useful.
- OpenAPI documentation.

Integrations must fail safely. A failed notification must not undo a successfully committed invoice, and a repeated webhook must not create duplicate payments or duplicate records.

## 26. Security, Privacy and Regulatory Readiness

Implement:
- Server-side permission checks.
- Secure password hashing and session handling.
- Protection against injection, cross-site scripting, cross-site request forgery where applicable, and insecure direct object references.
- Strict validation and safe file uploads.
- Secrets management.
- Encryption in transit and appropriate encryption at rest.
- Audit logging and monitored administrative access.
- Backup retention and restore testing.
- Data export, retention, correction, and deletion workflows consistent with applicable obligations.
- Secure multi-tenant data isolation.
- Incident response and operational documentation.

Design for applicable privacy and veterinary recordkeeping requirements in Pakistan and Australia. Validate actual obligations for the selected deployment, jurisdiction, and clinic type instead of assuming one set of rules applies everywhere.

## 27. Offline-First and Desktop Readiness

Plan for clinics with unreliable internet access.

When implementing offline support:
- Identify which modules can safely work offline.
- Cache only the records required for authorized users.
- Encrypt sensitive local data.
- Queue offline operations with unique operation identifiers.
- Synchronize changes when connectivity returns.
- Detect and resolve conflicting updates.
- Protect against duplicate invoices, payments, prescriptions, and clinical events.
- Maintain synchronization logs and failure recovery.
- Support local backup and verified restore.
- Provide clear online, offline, pending-sync, and sync-error indicators.

Do not silently overwrite conflicting clinical records. Financial and clinical conflicts require explicit reconciliation rules.

## 28. Development and Testing Requirements

Follow a test-driven or test-first approach for critical business logic.

Implement:
- Unit tests for calculations, permissions, validations, and domain services.
- Integration tests for database operations and APIs.
- End-to-end tests for the principal clinical and financial workflows.
- Authorization tests for every sensitive resource category.
- Multi-tenant isolation tests.
- Inventory concurrency and stock deduction tests.
- Invoice totals, tax, partial payment, refund, and reconciliation tests.
- Appointment conflict tests.
- Reminder scheduling and duplicate-delivery tests.
- Backup and restoration tests.
- Offline synchronization and conflict tests when applicable.

Run linting, type checks, migrations, and relevant test suites after each implementation milestone.

Fix discovered failures instead of hiding them or weakening the tests.

## 29. Definition of Done

A feature is not complete merely because a screen exists.

Each feature must have:
1. A usable interface.
2. A working backend operation.
3. Persistent database storage.
4. Correct validation and error handling.
5. Enforced permissions.
6. Appropriate audit history.
7. Loading, empty, and failure states.
8. Relevant automated tests.
9. Documentation where needed.
10. Verified end-to-end functionality.

Avoid fake buttons, placeholder actions, dead-end pages, hardcoded production metrics, fake integrations, and unimplemented save operations.

Use clearly labelled demo data only in seed or demonstration environments.

## 30. Execution Strategy

Work in small, verifiable milestones.

### Milestone 1: Repository audit and foundation
- Audit the repository.
- Establish architecture, design system, configuration, database migrations, authentication, and permissions.
- Build the main application shell.

### Milestone 2: Client and patient management
- Implement clients, owners, animal registration, patient profiles, medical history, search, and attachments.

### Milestone 3: Appointments and clinical workflows
- Implement calendar, booking, check-in, triage, consultations, SOAP notes, diagnoses, and follow-ups.

### Milestone 4: Prescriptions and diagnostics
- Implement medicines, prescriptions, treatment plans, laboratory orders, results, and imaging records.

### Milestone 5: Pharmacy, inventory and finance
- Implement products, batches, stock movements, procurement, invoices, payments, POS, and financial reports.

### Milestone 6: Hospital and surgery
- Implement admissions, flowboards, ward management, surgery, anaesthesia, nursing, and discharge.

### Milestone 7: Client communication and portals
- Implement reminders, notification integrations, client portal, and document sharing.
- Status: complete; the client portal is switched off for the first release (see section 19).

### Milestone 8: Livestock and additional modules
- Implement farm management, field visits, breeding, production, boarding, grooming, insurance, and referrals.

### Milestone 9: AI and advanced integrations (this feature will not be implemented yet tbd)
- Add AI-assisted documentation, validated decision-support integrations, diagnostic equipment connectors, and advanced analytics.
- Status: deferred by decision; not started.

### Milestone 10: Production readiness
- Complete security testing, regression testing, backup and recovery validation, documentation, deployment automation, and user acceptance testing.
- Status: complete except user acceptance testing, which clinic staff carry out with `docs/UAT_CHECKLIST.md`.

Prioritize a coherent, working end-to-end workflow over creating many incomplete modules.

## 31. Instructions for Working in Claude Code

- Use repository inspection and available tools before making architectural decisions.
- Break complex tasks into manageable implementation steps.
- Maintain `docs/IMPLEMENTATION_PLAN.md` and update completed work as milestones progress.
- Use migrations rather than manual production database changes.
- Reuse established components and avoid unnecessary dependencies.
- Keep business logic separate from UI components.
- Avoid oversized files and duplicated business rules.
- Do not silently change the technology stack.
- Do not remove working functionality without a justified migration plan.
- Never claim a test passed unless it was actually executed.
- Do not claim an integration is functional until it has been tested.
- Ask for clarification only when a decision materially affects safety, architecture, data integrity, or an irreversible operation.
- Use safe defaults for other implementation details.
- If blocked by missing credentials or external services, implement a documented adapter and a clearly labelled mock for development, then continue with other work.
- Do not expose secrets in logs, source code, documentation, or frontend bundles.

At the end of each milestone, report:
1. Features implemented.
2. Important files and database changes.
3. Tests executed and their actual results.
4. Known defects or limitations.
5. Setup or migration instructions.
6. The next concrete implementation tasks.

## 32. Decisions and Current Status

_Last updated: 2026-10-16. The detailed status is kept in `docs/FEATURE_MATRIX.md` and the progress log in `docs/IMPLEMENTATION_PLAN.md`; this section records decisions that change or narrow the brief above._

### Decisions
- **AI (section 12, Milestone 9):** deferred; not started.
- **Client portal (section 19):** built, tested and switched off (`CLIENT_PORTAL_ENABLED=false`) until a later release.
- **Staff onboarding (section 6):** email invitation or administrator-generated temporary password, with a forced password change at first sign-in.
- **Stack in use:**
  - Next.js 15 (App Router) with React 19, Tailwind CSS and TanStack Query.
  - NestJS 10 with Prisma 5 and PostgreSQL 16.
  - Shared Zod schemas and permissions in `packages/shared`.
  - Docker images and Docker Compose for deployment.
- **Clinical reference data:** no doses, schedules, reference ranges, gestation lengths or withdrawal periods are shipped. Each clinic enters them with a recorded source and approval.

### Status
- **Milestones 1–8:** complete.
- **Milestone 10:** complete except user acceptance testing by clinic staff.
- **Production deployment, backups and operations:** documented in `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`, `docs/SECURITY.md` and `docs/PRIVACY.md`. Backup and restore are tested end to end by `scripts/test-backup-restore.sh`, which the CI workflow runs.
- **Added after Milestone 10:**
  - Calendar month view and drag-to-reschedule.
  - Clinical activity report.
  - Purchase requests and supplier returns.
  - Prescription search.
  - Redaction of portal messages when a client is anonymised.
  - Temporary passwords for staff.
  - Receipt printing on 80/58 mm thermal paper with the clinic logo, configured in Settings → Receipts & printing.
  - Shop products: food, grooming, accessories and supplements, with clinic-managed categories, brand, pack size and photos at the shop counter, and a sales-by-category report.
- **Not yet built because they need outside parts:**
  - Laboratory analyser, DICOM/PACS and anaesthesia monitor connectors.
  - Drug-interaction checking (no validated data source).
  - SMS and WhatsApp providers.
  - Online payment gateways.
  - Barcode hardware.
- **Not yet built:**
  - Offline/desktop operation (section 27).
  - Document template designer and e-signatures.
  - Custom report builder.
  - Shift swaps and timesheets.
  - Single sign-on.

## Final Instruction

Start by auditing the existing repository. Create the documentation listed in Section 3, then begin implementing the application.

Do not respond with only a plan. Build the real product incrementally, verify the work, and continue through the milestones as far as the available session, tools, and environment allow.

The goal is a secure, maintainable, complete, and production-oriented Veterinary Clinic Management System that veterinary professionals can actually use for daily clinical, administrative, commercial, and operational work.
