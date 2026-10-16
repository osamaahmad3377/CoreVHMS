# User acceptance testing (UAT) checklist

Clinic staff use this checklist to confirm that NextCore VCMS supports their real daily work before go-live.
Each scenario is carried out by a person in the named role, on a **test copy** of the system, never on the live one.

## 1. Before testing

- [ ] A test installation is running (DEPLOYMENT.md), separate from the future live server, with its own database.
- [ ] It is set up with the clinic's own configuration: organisation, branches, staff accounts and roles, price list
      and tax rates, medicines and stock locations, wards and cages, appointment types, and the protocols and
      reference data the clinic's vets have approved. The dashboard's **Set up your clinic** checklist is complete.
      (The demo seed, `npm run db:seed`, can be used for a first walk-through, but sign-off must be on the clinic's own set-up.)
- [ ] Email delivery is configured (SMTP) and someone can receive test emails.
- [ ] Each tester has their **own** account with the role they will have in real life.
- [ ] Testers use only invented clients and animals. Never enter real client data into the test system.

**How to record results.** For each scenario, enter **Pass**, **Fail** or **N/A** (the clinic does not do this),
the tester's initials and the date. For each failure, note what was expected, what happened, the time, and the
`x-request-id` if an error message shows one. Report failures to the project team.

**Sign-off criteria.** Every scenario marked "Critical" (C) passes; no other failure blocks daily work, or it
has an agreed workaround and fix date.

## 2. Scenarios

### Access and security

| # | C | Role | Scenario | Expected result | Result | Initials / date |
|---|---|---|---|---|---|---|
| 1 | C | Owner | Invite a new staff member and give them the Reception role | Invitation email arrives; the new user sets a password and signs in | | |
| 1a | C | Owner | Add a staff member with **Create temporary password**; give them the password; they sign in | They must choose their own password before seeing anything; afterwards the temporary password no longer works | | |
| 1b | | Owner | For a member who forgot their password, click **Temporary password** in the staff list | A new temporary password is shown once; their old password and sign-ins stop working | | |
| 2 | C | Reception | Try to open Settings → Roles & permissions, and the Audit log | Menu items hidden; opening the address directly shows "Access denied" | | |
| 3 | | Any | Enter a wrong password 5 times | Account locked for 15 minutes; "Forgot password" email still works | | |
| 4 | | Any | Turn on 2-step sign-in (authenticator app); sign out and in again | A 6-digit code is asked for; recovery codes are shown once | | |
| 5 | C | Owner | Suspend a staff account while that person is signed in | Their next action signs them out; they cannot sign in again | | |
| 6 | | Owner | Open Audit log, filter by a user and by **Exports (all)**, export CSV | Shows sign-ins, record views, changes with old/new values, and every download of client data or reports; CSV opens in a spreadsheet | | |

### Everyday flow

| # | C | Role | Scenario | Expected result | Result | Initials / date |
|---|---|---|---|---|---|---|
| 6a | C | Each role | Sign in and look at the dashboard | “Needs your attention” lists only what that person has to do, most urgent first; every button opens the right page | | |
| 6b | | Vet | Complete a consultation | “Next steps” offers Bill this visit, Book a recheck and Back to the waiting list; Bill this visit opens an invoice with the client’s charges selected | | |
| 6c | | Any | Press ⌘K / Ctrl K and type “sale”, “book” or “invoice” | The matching action appears and opens the right screen | | |

### Clients, animals and front desk

| # | C | Role | Scenario | Expected result | Result | Initials / date |
|---|---|---|---|---|---|---|
| 7 | C | Reception | Register a new client with two animals, one with a penicillin allergy | Saved; the allergy shows in red on the animal's banner | | |
| 8 | | Reception | Register the same client again with the same phone number | Possible duplicate warning before saving | | |
| 9 | | Manager | Merge two duplicate clients | One client remains with all animals, visits and invoices | | |
| 10 | C | Reception | Book an appointment; try to book the same vet at an overlapping time | First booking saved; overlap refused unless overbooking is explicitly allowed | | |
| 11 | C | Reception | Check the client in on the Front desk; record an emergency walk-in with triage | Both appear in the waiting list; the emergency is shown first | | |
| 12 | | Any | Search (⌘K / Ctrl K) by client name, phone, animal name, microchip and a prescription number (RX-…) | The right record is found | | |
| 12a | | Reception | In the calendar, drag an appointment to another time and to another vet; open the Month view | Appointment moves; a clash asks “Move anyway?”; month shows the day's appointments | | |

### Consultation, pharmacy and laboratory

| # | C | Role | Scenario | Expected result | Result | Initials / date |
|---|---|---|---|---|---|---|
| 13 | C | Vet | Start the consultation, record vitals, write and **sign** the notes | Signed note can no longer be edited | | |
| 14 | C | Vet | Correct the signed note with an amendment | Amendment saved; the original remains visible | | |
| 15 | C | Vet | Prescribe the penicillin-type medicine to the allergic animal | Allergy warning; prescribing requires a documented override | | |
| 16 | C | Nurse → Vet → Pharmacy | Nurse drafts a prescription, vet authorises it, pharmacy dispenses it | Dispensing is blocked until authorised; stock decreases from the batch that expires first; label prints | | |
| 17 | C | Vet → Lab | Order a blood test, collect the sample, enter results, release them | Results outside the reference range are flagged; a critical value creates an urgent task for the vet | | |
| 18 | | Vet | Book a recheck from the consultation and complete the consultation | Recheck appears in the calendar; unsigned notes are reported | | |

### Billing and point of sale

| # | C | Role | Scenario | Expected result | Result | Initials / date |
|---|---|---|---|---|---|---|
| 19 | C | Reception | Create an invoice for the visit in scenarios 13–17 | Consultation, medicine and test are already listed as unbilled charges, each once | | |
| 20 | C | Reception | Take a part payment by card and the rest in cash | Invoice paid; receipt prints; client balance is zero | | |
| 21 | C | Accounts | Refund part of an issued invoice with a credit note | Credit note numbered; the original invoice is unchanged | | |
| 22 | C | Reception | At the POS, scan a product, take cash, give change | Sale recorded; stock decreases; receipt prints | | |
| 22a | C | Owner | Settings → Receipts & printing: choose 80 mm, the logo and its size, header and footer text; Print test receipt on the counter printer | Receipt fills the roll width without cut-off edges, logo is sharp, no blank paper after the receipt, settings kept after saving | | |
| 23 | | Reception | Try to sell a prescription-only medicine at the POS | Refused | | |
| 23a | C | Inventory / owner | Add a dog food (Inventory → Products → New product → Food & treats) with brand, pack size, category and price; receive stock; sell it at the POS from Food & treats → its shelf | Tile shows brand and pack size; stock falls after the sale; Reports → Sales by category shows the sale under its shelf | | |
| 24 | C | Accounts | Open the cash drawer with a float; close it at the end of the day | Expected vs. counted amount and any difference are shown | | |
| 25 | | Manager | Run the financial summary and aged receivables for today; open Reports → Clinical activity | Totals match the invoices and payments made during testing; clinical counts match the consultations and stays recorded | | |

### Stock and procurement

| # | C | Role | Scenario | Expected result | Result | Initials / date |
|---|---|---|---|---|---|---|
| 26 | C | Inventory | Create a purchase order; a different person approves it; receive it with batch and expiry | Stock increases per batch; expired goods are refused | | |
| 27 | | Inventory | Count stock and post a difference with a reason | Stock corrected; adjustment visible in the stock history | | |
| 28 | | Manager | Check low-stock and expiring items on the dashboard | Items below their reorder level / close to expiry are listed | | |
| 28a | | Nurse → Inventory | Nurse requests an item (Inventory → Item requests); the inventory officer orders it | One draft purchase order; the request shows “Ordered” with the order number | | |
| 28b | C | Inventory | Return part of a recalled batch to its supplier (Inventory → Supplier returns) | Stock falls by the returned quantity; supplier balance falls by its cost; return cannot be edited | | |

### Hospital and surgery

| # | C | Role | Scenario | Expected result | Result | Initials / date |
|---|---|---|---|---|---|---|
| 29 | C | Vet | Admit an animal to a cage with a treatment plan | Cage shows occupied; tasks appear on the treatment sheet | | |
| 30 | C | Nurse | Record due treatments and observations; leave one task overdue | Overdue task shows red; medicine doses reduce stock and are charged | | |
| 31 | C | Vet | Discharge with home-care instructions | Discharge summary prints; hospital days are on the bill | | |
| 32 | C | Surgeon / nurse | Schedule surgery, record consent, complete both checklists, record anaesthesia readings, write and complete the report | Surgery cannot start before the checklist; completed report is locked; fee and consumables charged | | |

### Preventive care and communications

| # | C | Role | Scenario | Expected result | Result | Initials / date |
|---|---|---|---|---|---|---|
| 33 | C | Vet | Apply the clinic's vaccination protocol to an animal; record the vaccine | Next dose date set; vaccination certificate prints | | |
| 34 | C | Manager | Make an item due and wait for the hourly reminder run | One reminder email per client; none for clients who opted out | | |
| 35 | | Manager | Edit a reminder template and send a manual message | Message appears in the delivery log as sent | | |

### Farms, boarding, grooming, insurance (where the clinic offers them)

| # | C | Role | Scenario | Expected result | Result | Initials / date |
|---|---|---|---|---|---|---|
| 36 | | Farm vet | Create a farm and herd; register animals by pasting ear tags | All animals created; duplicate tags refused | | |
| 37 | | Farm vet | Record service and pregnancy check; record a birth | Due date from the configured gestation length; calf linked to dam and sire | | |
| 38 | | Farm vet | Treat a group with a product that has a withdrawal period | Stock and bill updated; animals show "do not sell until …" | | |
| 39 | | Farm vet | Complete a field visit and invoice it | Visit locked; invoice includes the call-out fee | | |
| 40 | | Reception | Book a kennel; try to double-book it; check in with an overdue vaccination; check out early | Double booking refused; check-in needs an approval; only nights stayed are billed | | |
| 41 | | Reception (or groomer with a custom role) | Take a grooming walk-in through to "Collected" | Services billed when marked ready | | |
| 42 | | Reception | Add an insurance policy; create a claim from an issued invoice; record the insurer's payment | Invoice balance falls by the insurer's payment | | |
| 43 | | Vet | Create a referral and email the letter | Email in the delivery log; referral status tracked | | |

### Management and privacy

| # | C | Role | Scenario | Expected result | Result | Initials / date |
|---|---|---|---|---|---|---|
| 44 | | Manager | Set up a weekly roster and a leave day | Leave warns about affected appointments | | |
| 45 | C | Manager | Client → Privacy → Download all data | One JSON file with the client's details, animals, visits and invoices; export recorded in the audit log | | |
| 46 | C | Manager | Anonymise a test client with a zero balance | Name and contact details removed; medical records and invoices kept under "Anonymised client C-…"; refused while the balance is not zero | | |
| 47 | | Any | Use the system on the devices the clinic will use (reception PC, ward tablet, phone) | Screens readable and usable on each device | | |

### Operations (IT provider, with the clinic manager)

| # | C | Role | Scenario | Expected result | Result | Initials / date |
|---|---|---|---|---|---|---|
| 48 | C | IT | Run `scripts/test-backup-restore.sh` once on the server, then `scripts/backup.sh` and `scripts/verify-backup.sh` on the test installation (OPERATIONS.md §2) | Test passes; verification reports matching row counts | | |
| 49 | C | IT | Restore a backup on the test system (OPERATIONS.md §3) | Data returns to the state of the backup; uploaded files open | | |
| 50 | C | IT | Check `https://<test domain>/api/v1/health/ready` and the padlock in the browser | 200 response; valid HTTPS certificate | | |

## 3. Sign-off

| | Name | Role | Decision (accept / accept with conditions / reject) | Signature | Date |
|---|---|---|---|---|---|
| Clinic | | Owner / practice manager | | | |
| Clinic | | Lead veterinarian | | | |
| Project team | | | | | |

Conditions and agreed fix dates:

&nbsp;
