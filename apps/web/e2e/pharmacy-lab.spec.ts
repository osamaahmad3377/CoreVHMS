import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

async function openPatient(page: Page, name: string) {
  await page.goto(`/patients?q=${name}`);
  await page.getByRole('link', { name, exact: true }).first().click();
  await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible();
}

test.describe('Prescribing, dispensing and laboratory', () => {
  test('vet prescribes with the dose calculator and authorises; pharmacy dispenses', async ({ page, browser }) => {
    await login(page, 'vet@demo.pk');
    await openPatient(page, 'Sheru');
    await page.getByRole('tab', { name: 'Medications' }).click();
    await page.getByRole('button', { name: 'Prescribe' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.locator('#rx-weight').fill('20');
    await dlg.getByRole('combobox').first().click();
    await page.getByLabel('Search products').fill('Amoxicillin');
    await page.getByRole('option', { name: /Amoxicillin 250 mg/ }).click();
    // Arithmetic check only (not a clinical recommendation): 12.5 mg/kg × 20 kg = 250 mg = 1 tablet
    await dlg.getByLabel('Dose value').fill('12.5');
    await expect(dlg.getByText('1 tablet per dose')).toBeVisible();
    await expect(dlg.getByText('12.5 mg/kg × 20 kg = 250 mg')).toBeVisible();
    await expect(dlg.getByText(/No approved dose reference/)).toBeVisible();
    await expect(dlg.getByText('Supply 14 tablet')).toBeVisible();
    await dlg.getByRole('button', { name: 'Authorise prescription' }).click();
    await expect(page.getByText(/RX-\d+ authorised/)).toBeVisible();

    const ctx = await browser.newContext();
    const ph = await ctx.newPage();
    await login(ph, 'pharmacy@demo.pk');
    await ph.goto('/pharmacy');
    await ph.getByRole('row', { name: /Sheru/ }).first().click();
    await ph.getByRole('button', { name: 'Dispense' }).click();
    const d = ph.getByRole('dialog');
    // Batch left blank: stock is issued first-expiry-first-out and the issued batch is recorded.
    await d.getByRole('button', { name: 'Dispense' }).click();
    await expect(ph.getByText(/fully dispensed/)).toBeVisible();
    await expect(ph.getByText('batch AMX250-D01').first()).toBeVisible();
    await ctx.close();
  });

  test('orders a CBC, lab tech collects and enters results, vet validates and releases', async ({ page, browser }) => {
    await login(page, 'vet@demo.pk');
    await openPatient(page, 'Rocky');
    await page.getByRole('tab', { name: 'Diagnostics' }).click();
    await page.getByRole('button', { name: 'Order' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Filter tests').fill('Complete blood');
    await dlg.getByText('Complete blood count').click();
    await dlg.getByRole('button', { name: /Order 1 test/ }).click();
    await expect(page.getByText(/LAB-\d+ ordered/)).toBeVisible();
    const orderLink = page.getByRole('link', { name: /Complete blood count/ }).first();
    const href = await orderLink.getAttribute('href');

    const ctx = await browser.newContext();
    const lab = await ctx.newPage();
    await login(lab, 'lab@demo.pk');
    await lab.goto(href!);
    await lab.getByRole('button', { name: 'Collect' }).click();
    await lab.getByRole('dialog').getByRole('button', { name: /^Collect samples?$/ }).click(); // confirms which sample types are taken
    await expect(lab.getByText(/^S\d{8}$/).first()).toBeVisible();
    for (const [name, v] of [['Haematocrit', '42'], ['Haemoglobin', '150'], ['Red blood cells', '6.5'], ['White blood cells', '9.1'], ['Neutrophils', '6.0'], ['Lymphocytes', '2.1'], ['Platelets', '250']]) {
      await lab.getByLabel(name, { exact: true }).fill(v);
    }
    await lab.getByRole('button', { name: 'Save results' }).click();
    await expect(lab.getByText('Awaiting validation').first()).toBeVisible();
    await expect(lab.getByRole('button', { name: 'Validate & release' })).toHaveCount(0);
    await ctx.close();

    await page.goto(href!);
    await page.getByRole('button', { name: 'Validate & release' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Release results' }).click();
    await expect(page.getByText('Released', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Amend Haematocrit' })).toBeVisible();
  });
});
