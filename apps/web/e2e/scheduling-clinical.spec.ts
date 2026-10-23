import { expect, test } from '@playwright/test';
import { login } from './helpers';

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

    // The note is written in steps; show them all so every field can be filled in one go.
    await page.getByRole('button', { name: 'Show all steps' }).click();
    await expect(page.locator('#n-presentingComplaint')).toHaveValue('E2E: ear scratching'); // from the booking reason
    await expect(page.getByLabel('History — what the owner tells you')).toBeVisible();
    await page.locator('#n-subjective').fill('Scratching left ear for 5 days.');
    await page.locator('#n-objective').fill('Erythema and brown discharge in left canal.');
    await page.locator('#n-assessment').fill('Otitis externa (left).');
    await page.locator('#n-plan').fill('Ear cleaning; recheck 10 days.');
    // A guided visit saves by itself; finishing it signs the vet's note.
    await expect(page.getByText(/Saved automatically/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Finish consultation' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: /Sign notes? & finish/ }).click();
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
});
