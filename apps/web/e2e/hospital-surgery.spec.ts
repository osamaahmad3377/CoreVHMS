import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('Hospital and surgery', () => {
  test('vet admits a patient, adds a treatment, nurse-style recording, observations and discharge', async ({ page }) => {
    await login(page, 'vet@demo.pk');
    await page.goto('/patients?q=Rocky');
    await page.getByRole('link', { name: 'Rocky', exact: true }).first().click();
    // An interrupted earlier run can leave Rocky in hospital (the page then offers "In hospital" instead of Admit): discharge that stay first.
    const stay = page.getByRole('link', { name: /In hospital · HOSP-/ }).first();
    await expect(stay.or(page.getByRole('button', { name: 'Admit' })).first()).toBeVisible();
    if (await stay.isVisible()) {
      const id = ((await stay.getAttribute('href')) ?? '').split('/').pop();
      const csrf = (await page.context().cookies()).find((c) => c.name === 'vcms_csrf')?.value ?? '';
      const res = await page.request.post(`/api/v1/admissions/${id}/discharge`, { headers: { 'X-CSRF-Token': csrf, Origin: new URL(page.url()).origin }, data: { outcome: 'DISCHARGED_HOME', dischargeSummary: 'E2E clean-up of an interrupted run' } });
      expect(res.ok(), await res.text()).toBeTruthy();
      await page.reload();
    }
    await page.getByRole('button', { name: 'Admit' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.locator('#adm-ward').selectOption({ index: 1 });
    await dlg.locator('#adm-cage').selectOption({ index: 1 });
    await dlg.locator('#adm-reason').fill('Post-operative monitoring (E2E)');
    await dlg.getByRole('button', { name: 'Admit' }).click();
    await expect(page.getByText(/Rocky admitted \(HOSP-\d{6}\)/)).toBeVisible();
    await expect(page).toHaveURL(/\/hospital\/admissions\//);

    await page.getByRole('button', { name: 'Add treatment' }).click();
    const od = page.getByRole('dialog');
    await od.locator('#or-kind').selectOption('NURSING');
    await od.locator('#or-desc').fill('Walk outside (E2E)');
    await od.locator('#or-int').fill('6');
    await od.getByRole('button', { name: 'Add to sheet' }).click();
    await expect(page.getByText('Treatment added to the sheet')).toBeVisible();

    const due = page.getByRole('listitem').filter({ hasText: 'Walk outside (E2E)' });
    await due.getByRole('button', { name: 'Record' }).click();
    const td = page.getByRole('dialog');
    await td.locator('#tk-value').fill('Urinated');
    await td.getByRole('button', { name: 'Record' }).click();
    await expect(page.getByText('Treatment recorded')).toBeVisible();

    await page.getByRole('tab', { name: 'Observations' }).click();
    await page.getByLabel('Temp (°C)').fill('38.6');
    await page.getByLabel('Heart rate (/min)').fill('96');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Observations recorded')).toBeVisible();

    await page.getByRole('button', { name: 'Discharge' }).click();
    const dd = page.getByRole('dialog');
    await dd.locator('#dc-sum').fill('Recovered well, eating and walking normally (E2E).');
    await dd.locator('#dc-home').fill('Short lead walks for 7 days.');
    await dd.getByRole('button', { name: 'Discharge' }).click();
    await expect(page.getByText('Patient discharged')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print discharge summary' })).toBeVisible();
  });

  test('surgeon completes the safety checklist, monitors anaesthesia and signs the surgical report', async ({ page }) => {
    await login(page, 'vet@demo.pk');
    await page.goto('/surgery');
    await page.getByRole('link', { name: 'Billo' }).first().click();
    await expect(page.getByRole('button', { name: 'Start surgery' })).toBeDisabled(); // checklist not done
    await page.getByRole('button', { name: 'Patient arrived (pre-op)' }).click();
    await page.getByRole('tab', { name: /Safety checklist/ }).click();
    const boxes = page.getByRole('tabpanel').getByRole('checkbox');
    const n = await boxes.count();
    for (let i = 0; i < n; i++) {
      await boxes.nth(i).click();
      await expect(boxes.nth(i)).toBeChecked();
    }
    await page.getByRole('button', { name: 'Start surgery' }).click();
    await expect(page.getByText('In surgery').first()).toBeVisible();

    await page.getByRole('tab', { name: 'Anaesthesia' }).click();
    await page.getByLabel('HR').fill('110');
    await page.getByLabel('SpO₂ %').fill('98');
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.getByRole('cell', { name: '110' })).toBeVisible();

    await page.getByRole('button', { name: 'Move to recovery' }).click();
    await page.getByRole('tab', { name: 'Procedure' }).click();
    await page.locator('#sf-surgicalNotes').fill('Routine ventral midline ovariohysterectomy (E2E).');
    await page.locator('#sf-complications').fill('None');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Complete & sign' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Complete & sign' }).click();
    await expect(page.getByText('Signed', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print report' })).toBeVisible();
  });
});
