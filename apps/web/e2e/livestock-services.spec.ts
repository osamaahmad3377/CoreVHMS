import { expect, test, type Page } from '@playwright/test';
import { login, uniq } from './helpers';

async function pickPatient(page: Page, dialog: ReturnType<Page['getByRole']>, name: string) {
  await dialog.getByRole('combobox').first().click();
  await page.getByLabel('Search patients').fill(name);
  await page.getByRole('option', { name: new RegExp(name) }).first().click();
}

test.describe('Livestock, boarding & grooming, insurance', () => {
  test('field vet registers tagged animals into a herd and records a breeding event', async ({ page }) => {
    await login(page, 'farmvet@demo.pk');
    await page.goto('/livestock');
    await page.getByRole('link', { name: 'Aslam Dairy Farm' }).click();
    await expect(page).toHaveURL(/\/livestock\/farms\//);
    await page.getByRole('link', { name: /Milking buffaloes/ }).click();
    await page.getByRole('button', { name: 'Add animals' }).click();
    const dlg = page.getByRole('dialog');
    const tag = uniq('E2E-');
    await dlg.getByLabel('Paste tag numbers').fill(`${tag}-1 ${tag}-2`);
    await dlg.getByRole('button', { name: 'Add tags' }).click();
    await dlg.getByLabel('Sex 2').selectOption('FEMALE');
    await dlg.getByRole('button', { name: /Register 2 animals/ }).click();
    await expect(page.getByText('2 animal(s) registered')).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: `${tag}-2` }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Breeding' }).click();
    const bd = page.getByRole('dialog');
    await bd.locator('#br-type').selectOption('INSEMINATION');
    await bd.locator('#br-sire-text').fill('AI sire E2E');
    await bd.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Recorded — expected due \d{4}-\d{2}-\d{2}/)).toBeVisible();
  });

  test('farm visit: schedule, add work on site, complete, and invoice the farmer', async ({ page }) => {
    await login(page, 'owner@demo.pk');
    await page.goto('/livestock');
    await page.getByRole('link', { name: 'Mehmood Goat Farm' }).click();
    await expect(page).toHaveURL(/\/livestock\/farms\//);
    await page.getByRole('tab', { name: 'Visits', exact: true }).click();
    await page.getByRole('button', { name: 'Schedule visit' }).click();
    const sd = page.getByRole('dialog');
    await sd.locator('#fv-purpose').fill('Deworming the herd (E2E)');
    await sd.getByRole('button', { name: 'Schedule' }).click();
    await expect(page).toHaveURL(/\/livestock\/visits\//);
    await page.getByRole('button', { name: 'Add item' }).click();
    const ad = page.getByRole('dialog');
    await ad.locator('#vi-svc').selectOption({ label: 'Herd health examination (per head)' });
    await ad.locator('#vi-qty').fill('5');
    await ad.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Added and billed to the farm owner')).toBeVisible();
    await page.getByRole('button', { name: 'Complete' }).click();
    const cd = page.getByRole('dialog');
    await cd.locator('#fc-find').fill('All goats examined; worm burden moderate (E2E).');
    await cd.getByRole('button', { name: 'Complete visit' }).click();
    await expect(page.getByText('Visit completed').first()).toBeVisible();
    await expect(page.getByText('COMPLETED').first()).toBeVisible();
    await page.getByRole('button', { name: /Create invoice/ }).click();
    await expect(page).toHaveURL(/\/billing\/invoices\//);
  });

  test('reception books a kennel, checks the dog in and out, and grooms a walk-in', async ({ page }) => {
    await login(page, 'reception@demo.pk');
    await page.goto('/boarding');
    await page.getByRole('button', { name: 'New booking' }).click();
    const dlg = page.getByRole('dialog');
    await pickPatient(page, dlg, 'Toto');
    const kennel = await dlg.locator('#rs-unit option', { hasText: 'Kennel 3' }).getAttribute('value');
    await dlg.locator('#rs-unit').selectOption(kennel!);
    await dlg.getByRole('button', { name: 'Book' }).click();
    await expect(page.getByText(/Booked Toto \(BRD-\d+\)/)).toBeVisible();
    await page.getByRole('button', { name: 'Check in' }).click();
    const ci = page.getByRole('dialog');
    if (await ci.locator('#ci-override').isVisible()) await ci.locator('#ci-override').fill('Owner bringing certificate (E2E)');
    await ci.getByRole('button', { name: 'Check in' }).click();
    await expect(page.getByText('Toto checked in')).toBeVisible();
    await page.getByLabel('Log entry').fill('Ate all breakfast (E2E)');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('Ate all breakfast (E2E)')).toBeVisible();
    await page.getByRole('button', { name: 'Check out' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Check out' }).click();
    await expect(page.getByText('Checked out — nights added to the owner’s charges')).toBeVisible();
    await expect(page.getByText(/1 night billed/)).toBeVisible();

    await page.goto('/boarding?tab=grooming');
    await page.getByRole('button', { name: 'Walk-in' }).click();
    const gd = page.getByRole('dialog');
    await pickPatient(page, gd, 'Max');
    await gd.getByRole('checkbox').first().click();
    await gd.getByRole('button', { name: 'Check in' }).click();
    await expect(page).toHaveURL(/\/boarding\/grooming\//);
    await page.getByRole('button', { name: 'Ready for collection' }).click();
    await expect(page.getByText(/Ready — services added/)).toBeVisible();
    await page.getByRole('button', { name: 'Collected' }).click();
    await expect(page.getByText('COLLECTED').first()).toBeVisible();
  });

  test('insurance: the insurer approves the demo claim and its payment is posted', async ({ page }) => {
    await login(page, 'owner@demo.pk');
    await page.goto('/insurance');
    await page.getByRole('link', { name: 'Gastroenteritis (demo claim)' }).click();
    await page.getByRole('button', { name: 'Record decision' }).click();
    const dd = page.getByRole('dialog');
    await dd.locator('#dc-ref').fill('INS-E2E-1');
    await dd.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Decision recorded')).toBeVisible();
    await page.getByRole('button', { name: 'Record payment' }).click();
    const pd = page.getByRole('dialog');
    await pd.locator('#cp-ref').fill('EFT-E2E');
    await pd.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByText('Payment recorded against the invoices')).toBeVisible();
    await expect(page.getByText('PAID').first()).toBeVisible();
  });
});
