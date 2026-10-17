import { expect, test } from '@playwright/test';
import { login, uniq } from './helpers';

test.describe('Item requests and supplier returns', () => {
  test('a nurse asks for syringes; the inventory officer orders them from the supplier', async ({ page }) => {
    const reason = uniq('E2E ward low ');
    await login(page, 'nurse@demo.pk');
    await page.goto('/inventory/requests');
    await page.getByRole('button', { name: 'Request item' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('combobox').first().click();
    await page.getByLabel('Search products').fill('Sterile syringe');
    await page.getByRole('option', { name: /Sterile syringe 3 mL/ }).click();
    await dlg.getByLabel(/Quantity/).fill('50');
    await dlg.getByLabel('Reason').fill(reason);
    await dlg.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText(/PR-\d+ sent to procurement/)).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(reason) });
    await expect(row.getByText('Open')).toBeVisible();
    // Asking is not ordering: the nurse has no order controls.
    await expect(page.getByRole('button', { name: /Order selected/ })).toHaveCount(0);

    await page.context().clearCookies();
    await login(page, 'inventory@demo.pk');
    await page.goto('/inventory/requests');
    const officerRow = page.getByRole('row', { name: new RegExp(reason) });
    await officerRow.getByRole('checkbox').click();
    await page.getByRole('button', { name: 'Order selected (1)' }).click();
    const order = page.getByRole('dialog');
    await order.locator('#ro-sup').selectOption({ label: 'Demo Pharma Distributors (Lahore)' });
    await expect(order.getByText('50 unit')).toBeVisible();
    await order.getByRole('button', { name: 'Create draft order' }).click();
    await expect(page).toHaveURL(/\/inventory\/purchase-orders\//);
    await expect(page.getByText('Sterile syringe 3 mL').first()).toBeVisible();
    await expect(page.getByText('Draft').first()).toBeVisible();

    await page.goto('/inventory/requests?show=all');
    await expect(page.getByRole('row', { name: new RegExp(reason) }).getByText('On draft order')).toBeVisible();
  });

  test('the inventory officer returns a syringe batch to its supplier', async ({ page }) => {
    const reason = uniq('E2E damaged box ');
    await login(page, 'inventory@demo.pk');
    await page.goto('/inventory/returns');
    await page.getByRole('button', { name: 'Return to supplier' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.locator('#sr-sup').selectOption({ label: 'Demo Pharma Distributors (Lahore)' });
    // Locations show their branch when the clinic has several; the current branch's are listed first.
    const mainPharmacy = await dlg.locator('#sr-loc option', { hasText: /^Main pharmacy/ }).first().getAttribute('value');
    await dlg.locator('#sr-loc').selectOption(mainPharmacy!);
    const qty = dlg.getByLabel('Quantity to return of batch SYR3-D01');
    await expect(qty).toBeVisible();
    await qty.fill('100000');
    await expect(dlg.getByText('A quantity is more than is on hand.')).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Record return' })).toBeDisabled();
    await qty.fill('1');
    await dlg.locator('#sr-reason').fill(reason);
    await dlg.getByRole('button', { name: 'Record return' }).click();
    await expect(page.getByText(/SRN-\d+ recorded/)).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(reason) });
    await expect(row.getByText(/1 × Sterile syringe 3 mL/)).toBeVisible();
  });
});
