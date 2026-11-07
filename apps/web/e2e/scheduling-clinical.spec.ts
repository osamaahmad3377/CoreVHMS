import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/** Opens a step of the consultation from the step list. */
const step = (page: Page, name: string) => page.getByRole('navigation', { name: 'Consultation steps' }).getByRole('button', { name: new RegExp(`${name}$`) }).click();

/** A future Tuesday (Pakistan demo clinicians are rostered 09:00–17:00 Mon–Sat). */
function futureTuesday() {
  const d = new Date();
  d.setDate(d.getDate() + 7 + ((2 - d.getDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

test.describe('Clinical day: book → check in → consult → sign', () => {
  test('books via the calendar, checks in, starts the consultation and signs a SOAP note', async ({ page }) => {
    await login(page, 'vet@demo.pk');
    const date = futureTuesday();
    await page.goto(`/calendar?date=${date}`);
    await page.getByRole('button', { name: 'Book appointment' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox').first().click();
    await page.getByLabel('Search patients').fill('Toto');
    await page.getByRole('option', { name: /Toto/ }).click();
    await dialog.locator('#bk-clin').selectOption({ label: 'Dr. Ayesha Raza' });
    // pick the first free slot offered by the availability endpoint
    const slot = dialog.locator('button.tabular').first();
    await expect(slot).toBeVisible();
    const slotTime = (await slot.textContent())!.trim();
    await slot.click();
    await dialog.locator('#bk-reason').fill('E2E: ear scratching');
    await dialog.getByRole('button', { name: 'Book appointment' }).click();
    await expect(page.getByText(/Appointment booked: .*\(A-\d+\)/)).toBeVisible();

    // open it from the calendar grid
    await page.getByRole('button', { name: new RegExp(`${slotTime} Toto`) }).click();
    const appt = page.getByRole('dialog');
    await appt.getByRole('button', { name: 'Check in' }).click();
    await expect(appt.getByText('Checked in', { exact: true }).first()).toBeVisible();
    await appt.getByRole('button', { name: 'Start consultation' }).click();
    await expect(page).toHaveURL(/\/consultations\//);

    // Quick consult: the booking reason is kept in the owner's words; a template decides the questions.
    await expect(page.locator('#qc-reason')).toHaveValue('E2E: ear scratching');
    await page.getByRole('button', { name: 'Ear problem' }).click();
    await step(page, 'History');
    await page.getByRole('button', { name: 'Left', exact: true }).click();
    await page.locator('#qc-owner').fill('Scratching left ear for 5 days.');
    await expect(page.getByText(/Left side\./).first()).toBeVisible(); // written from the tapped answer
    await step(page, 'Examination');
    await page.getByRole('button', { name: 'Everything looks normal' }).click();
    await page.locator('#qc-exam').fill('Erythema and brown discharge in left canal.');
    await step(page, 'Diagnosis');
    await page.locator('#qc-diagnosis').fill('Otitis externa (left)');
    await page.locator('#qc-diagnosis').press('Enter');
    await expect(page.getByText('Otitis externa (left)', { exact: true }).first()).toBeVisible();
    await step(page, 'Treatment');
    await page.locator('#qc-plan').fill('Ear cleaning; recheck 10 days.');
    await step(page, 'Review & sign');
    await expect(page.getByText(/Otitis externa \(left\) \(likely\)/)).toBeVisible();
    await page.getByRole('button', { name: 'Sign and complete' }).click();
    await expect(page.getByRole('region', { name: 'Consultation finished' })).toBeVisible();
    await page.getByRole('button', { name: 'Show full details' }).click();
    await expect(page.getByText('Integrity verified')).toBeVisible();
    await expect(page.getByText('Signed · v1')).toBeVisible();

    // amend
    await page.getByRole('button', { name: 'Amend' }).click();
    await page.locator('#amend-reason').fill('Owner reported head tilt after signing');
    const showAll = page.getByRole('button', { name: 'Show all steps' });
    if (await showAll.isVisible()) await showAll.click();
    await page.locator('#n-assessment').fill('Otitis externa (left); rule out otitis media.');
    await page.getByRole('button', { name: 'Sign & lock note' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign note' }).click();
    await expect(page.getByText('Signed · v2')).toBeVisible();
    await expect(page.getByText('Previous versions (1)')).toBeVisible();
  });

  test('walk-in appears in the front-desk waiting list and can be triaged', async ({ page }) => {
    await login(page, 'nurse@demo.pk');
    await page.goto('/front-desk');
    await page.getByRole('button', { name: 'Walk-in' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox').first().click();
    await page.getByLabel('Search patients').fill('Max');
    await page.getByRole('option', { name: /Max/ }).first().click();
    await dialog.locator('#wi-r').fill('E2E: hit by car');
    await dialog.getByRole('button', { name: 'Check in' }).click();
    await expect(page.getByText(/Checked in: Max as a walk-in/)).toBeVisible();
    const card = page.locator('li', { hasText: 'E2E: hit by car' }).first();
    await card.getByRole('button', { name: 'Triage' }).click();
    const triage = page.getByRole('dialog');
    await triage.getByRole('radio', { name: /Very urgent/ }).click();
    await triage.locator('#tr-c').fill('Hit by car, tachypnoeic');
    await triage.getByRole('button', { name: 'Save triage' }).click();
    await expect(page.locator('li', { hasText: 'E2E: hit by car' }).first().getByText('Very urgent')).toBeVisible();
  });

  test('an open consultation opens as Quick consult: eight steps and a More menu', async ({ page }) => {
    await login(page, 'vet@demo.pk');
    const id = await page.evaluate(async () => (await (await fetch('/api/v1/encounters?status=OPEN&pageSize=1')).json()).data[0]?.id as string | undefined);
    test.skip(!id, 'No open consultation in this clinic');
    await page.goto(`/consultations/${id}`);
    const steps = page.getByRole('navigation', { name: 'Consultation steps' });
    await expect(steps.getByRole('listitem')).toHaveCount(8);
    for (const name of ['Reason', 'History', 'Measurements', 'Examination', 'Diagnosis', 'Treatment', 'Owner advice', 'Review & sign']) await expect(steps.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'More for this visit' })).toBeVisible();
  });

  test('several reasons at once: vaccination with no consultation fee, then two problems whose questions are both asked', async ({ page }) => {
    await login(page, 'vet@demo.pk');
    const call = (method: string, path: string, body?: unknown) =>
      page.evaluate(
        async ([method, path, body]) => {
          const csrf = document.cookie.split('; ').find((c) => c.startsWith('vcms_csrf='))?.split('=')[1] ?? '';
          const r = await fetch(`/api/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body ? JSON.stringify(body) : undefined });
          return r.json();
        },
        [method, path, body] as [string, string, unknown],
      );
    const patient = (await call('GET', '/patients?q=Toto&pageSize=1')).data[0];
    const enc = await call('POST', '/encounters', { patientId: patient.id, chiefComplaint: '' });
    try {
      await page.goto(`/consultations/${enc.id}`);
      await page.getByRole('button', { name: 'Vaccination', exact: true }).click();
      const dialog = page.getByRole('dialog');
      if (await dialog.isVisible().catch(() => false)) await page.keyboard.press('Escape');
      await expect(page.getByText('No consultation fee — only the vaccination is charged.')).toBeVisible();
      await expect.poll(async () => (await call('GET', `/encounters/${enc.id}`)).chargeConsultation).toBe(false);

      await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'Consultation', exact: true }).click();
      await page.getByRole('button', { name: 'Ear problem' }).click();
      await page.getByRole('button', { name: /Vomiting/ }).first().click();
      await expect(page.getByRole('list', { name: 'Selected reasons' }).getByRole('listitem')).toHaveText(['Vaccination', 'Ear problem', /Vomiting/]);
      await expect(page.getByText('The consultation fee applies.')).toBeVisible();
      await expect.poll(async () => (await call('GET', `/encounters/${enc.id}`)).chargeConsultation).toBe(true);

      await step(page, 'History');
      await expect(page.getByRole('region', { name: 'Ear problem' })).toBeVisible();
      await expect(page.getByRole('region', { name: /Vomiting/ })).toBeVisible();
    } finally {
      await call('POST', `/encounters/${enc.id}/cancel`, { reason: 'E2E cleanup' });
    }
  });

  test('step 1: choose the category, then the appointment type with its questions', async ({ page }) => {
    await login(page, 'vet@demo.pk');
    const call = (method: string, path: string, body?: unknown) =>
      page.evaluate(
        async ([method, path, body]) => {
          const csrf = document.cookie.split('; ').find((c) => c.startsWith('vcms_csrf='))?.split('=')[1] ?? '';
          const r = await fetch(`/api/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body ? JSON.stringify(body) : undefined });
          return r.json();
        },
        [method, path, body] as [string, string, unknown],
      );
    const types = (await call('GET', '/appointment-types')) as { name: string; categoryRef: { name: string; kind: string } | null; template: unknown }[];
    const followUp = types.find((t) => t.categoryRef?.kind === 'FOLLOW_UP');
    test.skip(!followUp, 'No follow-up appointment type in this clinic');
    const patient = (await call('GET', '/patients?q=Toto&pageSize=1')).data[0];
    const enc = await call('POST', '/encounters', { patientId: patient.id, chiefComplaint: '' });
    try {
      await page.goto(`/consultations/${enc.id}`);
      const categories = page.getByRole('group', { name: 'Category' });
      for (const name of ['Consultation', 'Vaccination', 'Grooming']) await expect(categories.getByRole('button', { name, exact: true })).toBeVisible();
      // Nothing is open until a category is chosen; tapping it again deselects it.
      await expect(page.getByText('Choose a category above, or search for an appointment type.')).toBeVisible();
      const consultation = categories.getByRole('button', { name: /^Consultation(\s*\d+)?$/ });
      await consultation.click();
      await expect(page.getByRole('heading', { name: 'Appointment type · Consultation' })).toBeVisible();
      await consultation.click();
      await expect(page.getByText('Choose a category above, or search for an appointment type.')).toBeVisible();
      await expect(consultation).toHaveAttribute('aria-pressed', 'false');
      await consultation.click();
      const typeTiles = page.getByRole('group', { name: 'Appointment types' });
      await expect(typeTiles.getByRole('button', { name: 'Ear problem' })).toBeVisible();
      await typeTiles.getByRole('button', { name: 'Ear problem' }).click();
      await expect(categories.getByRole('button', { name: /^Consultation\s*1$/ })).toBeVisible();
      // Another category: its own types; what was chosen stays chosen.
      await categories.getByRole('button', { name: followUp!.categoryRef!.name, exact: true }).click();
      await expect(page.getByRole('heading', { name: `Appointment type · ${followUp!.categoryRef!.name}` })).toBeVisible();
      await expect(typeTiles.getByRole('button', { name: 'Ear problem' })).toHaveCount(0);
      await typeTiles.getByRole('button', { name: followUp!.name, exact: true }).click();
      await expect(page.getByRole('list', { name: 'Selected reasons' }).getByRole('listitem')).toHaveText(['Ear problem', followUp!.name]);
      // The search finds an appointment type in any category.
      const search = page.getByRole('searchbox', { name: 'Search appointment types' });
      await search.fill('ear');
      await expect(typeTiles.getByRole('button', { name: 'Ear problem' })).toHaveAttribute('aria-pressed', 'true');
      await search.fill('zzz-nothing');
      await expect(page.getByText('No appointment type matches “zzz-nothing”.')).toBeVisible();
      await search.fill('');
      await step(page, 'History');
      await expect(page.getByRole('region', { name: 'Ear problem' })).toBeVisible();
      // Deselecting Consultation takes its appointment type off.
      await step(page, 'Reason');
      await consultation.click();
      await expect(page.getByRole('heading', { name: 'Appointment type · Consultation' })).toBeVisible();
      await consultation.click();
      await expect(page.getByRole('list', { name: 'Selected reasons' }).getByRole('listitem')).toHaveText([followUp!.name]);
    } finally {
      await call('POST', `/encounters/${enc.id}/cancel`, { reason: 'E2E cleanup' });
    }
  });

  test('grooming in step 1: the clinic’s grooming services and prices, added to the bill, no consultation fee', async ({ page }) => {
    await login(page, 'vet@demo.pk');
    const call = (method: string, path: string, body?: unknown) =>
      page.evaluate(
        async ([method, path, body]) => {
          const csrf = document.cookie.split('; ').find((c) => c.startsWith('vcms_csrf='))?.split('=')[1] ?? '';
          const r = await fetch(`/api/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body ? JSON.stringify(body) : undefined });
          return r.json();
        },
        [method, path, body] as [string, string, unknown],
      );
    const patient = (await call('GET', '/patients?q=Toto&pageSize=1')).data[0];
    const enc = await call('POST', '/encounters', { patientId: patient.id, chiefComplaint: '' });
    try {
      const { options } = await call('GET', `/encounters/${enc.id}/services?category=GROOMING`);
      const svc = (options as { name: string; priceMinor: number }[]).find((o) => o.priceMinor > 0);
      test.skip(!svc, 'No priced grooming service in this clinic');
      await page.goto(`/consultations/${enc.id}`);
      await page.getByRole('button', { name: 'Grooming', exact: true }).click();
      const panel = page.getByRole('region', { name: 'Grooming' });
      await panel.getByRole('button', { name: new RegExp(`^${svc!.name}`) }).click();
      await expect(panel.getByText(new RegExp(`Added to the bill: ${svc!.name}`))).toBeVisible();
      await expect(page.getByText('No consultation fee — only the grooming is charged.')).toBeVisible();
      await expect.poll(async () => (await call('GET', `/charges?encounterId=${enc.id}`)).data.map((c: { description: string }) => c.description)).toEqual([svc!.name]);
      // Tap again: off the bill.
      await panel.getByRole('button', { name: new RegExp(`^${svc!.name}`) }).click();
      await expect(panel.getByText(/Added to the bill/)).toHaveCount(0);
    } finally {
      await call('POST', `/encounters/${enc.id}/cancel`, { reason: 'E2E cleanup' });
    }
  });

  test('the examination starts all normal and the vet taps only what is abnormal', async ({ page }) => {
    await login(page, 'vet@demo.pk');
    const call = (method: string, path: string, body?: unknown) =>
      page.evaluate(
        async ([method, path, body]) => {
          const csrf = document.cookie.split('; ').find((c) => c.startsWith('vcms_csrf='))?.split('=')[1] ?? '';
          const r = await fetch(`/api/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body ? JSON.stringify(body) : undefined });
          return r.json();
        },
        [method, path, body] as [string, string, unknown],
      );
    const patient = (await call('GET', '/patients?q=Toto&pageSize=1')).data[0];
    const enc = await call('POST', '/encounters', { patientId: patient.id, chiefComplaint: 'E2E exam check' });
    await page.goto(`/consultations/${enc.id}`);
    await step(page, 'Examination');
    await page.getByRole('button', { name: 'Everything looks normal' }).click();
    await expect(page.getByText(/11 normal · 0 abnormal/)).toBeVisible();
    await page.getByRole('button', { name: 'Skin & coat: normal' }).click();
    await page.getByRole('button', { name: 'Itchy' }).click();
    await expect(page.getByLabel('Skin & coat findings')).toHaveValue('Itchy');
    await expect(page.getByText(/1 abnormal/)).toBeVisible();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });
    await call('POST', `/encounters/${enc.id}/cancel`, { reason: 'E2E cleanup' });
  });
});
