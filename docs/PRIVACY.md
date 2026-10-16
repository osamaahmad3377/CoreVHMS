# Privacy and record-keeping

How NextCore VCMS handles personal information, and the tools a clinic uses to meet client requests.
**This is not legal advice.** Obligations differ by country, state/province, clinic type and contract; each
clinic must confirm its own obligations (privacy law, veterinary board rules, tax record-keeping) before go-live.

## 1. What the system holds

| Category | Examples | Where |
|---|---|---|
| Client (owner) personal data | name, phone numbers, email, addresses, national ID / tax number (optional), notes, consents | Clients |
| Animal and clinical records | patient details, consultations and signed notes, diagnoses, prescriptions, lab results, hospital and surgery records, vaccinations, breeding and production records | Patients and clinical modules |
| Financial records | invoices, payments, refunds, insurance claims | Billing, Insurance |
| Communications | messages sent (content and delivery log), referral letters | Communications |
| Staff data | names, emails, roles, sign-in history | Settings → Staff, Audit log |
| Technical data | IP address and browser of each audited action, request ids | Audit log, server logs |

The clinic is the controller of this data; the operator of the server (the clinic or its IT provider) processes it on the clinic's behalf.

## 2. Built-in safeguards
- Access by role and permission; every record view of a patient and every export is written to the audit log.
- Clients' communication preferences and consents (reminders, marketing) are recorded with the date they changed; reminders are never sent to clients who opted out.
- Encryption in transit (HTTPS) and of MFA secrets at rest. Disk/volume encryption for the database and backups should be enabled on the hosting side.
- Backups contain personal data: keep them encrypted, access-restricted and within the agreed retention period (OPERATIONS.md §2).

## 3. Client requests

Requires the **privacy.manage** permission (granted to Owners and Practice managers).

### Access / copy of data
Client page → **Privacy** → **Download all data (JSON)**. The file contains everything the clinic holds about
the client: contact details, addresses, notes, animals with identifiers, weights and alerts, appointments,
encounters and signed clinical notes, diagnoses, vital signs, prescriptions and dispensing, released lab
results, care plans, hospital and surgery records, invoices, payments, estimates, messages, farms and field
visits, boarding and grooming, insurance policies, claims and referrals. Draft notes (unfinished working
documents) are not included. Each export is recorded in the audit log (`client.data_exported`).

### Correction
Client and patient details are edited directly; every change is audited with old and new values. Signed
clinical records are corrected by amendment, never overwritten, so the original remains visible.

### Erasure ("right to be forgotten")
Client page → **Privacy** → **Anonymise on request** (reason/reference required). This permanently removes:
name, phone numbers, email, national ID and tax number, notes, addresses and extra contacts, the
recipients and contents of emails/messages sent by the clinic, the subject and text of client-portal messages
(and the client's name on messages they wrote; the database allows only this fixed redaction of that locked record), boarding emergency contacts and belongings,
and identifying farm names, addresses, coordinates and registration numbers; turns off consents; archives
the client; and switches off any portal access.

It **keeps** the animals' clinical records, invoices and payments, now linked to "Anonymised client C-…",
because veterinary and tax rules usually require them to be retained for a number of years. Before
anonymising: the account balance must be zero, no animal may be in hospital or boarding, and a client
that was merged into another must be anonymised through the surviving record. Anonymisation
cannot be undone; download the data first if the client asked for a copy. The audit entry records that it
happened and the reason, without the removed personal details.

Audit log entries made before anonymisation may still contain names in their summaries; the audit log is
kept unaltered for accountability and is accessible only to users with the audit permission.

## 4. Retention
The application does not delete records automatically. Agree a retention schedule with the clinic, for example:

| Records | Typical retention to confirm |
|---|---|
| Clinical records | as required by the veterinary board (often several years after the last visit) |
| Financial records | as required by tax law (often 5–7 years) |
| Audit log | at least as long as the records it relates to |
| Server logs | 90 days |
| Backups | 30 daily + 12 monthly |

Clients who have not visited for longer than the retention period can be anonymised using the procedure above.

## 5. Jurisdiction notes (to be confirmed for each deployment)
- **Australia:** the Privacy Act 1988 and the Australian Privacy Principles apply to many businesses (including smaller ones in some circumstances); the Notifiable Data Breaches scheme requires notifying affected individuals and the OAIC of eligible breaches. State veterinary practitioner boards set clinical record-keeping requirements.
- **Pakistan:** confirm the status of national personal data protection legislation and any provincial requirements at the time of deployment, plus record-keeping rules of the relevant veterinary council and tax authorities.

## 6. Data breaches
Follow OPERATIONS.md §7 (contain, preserve evidence, assess using the audit log, recover, notify where required, review).
