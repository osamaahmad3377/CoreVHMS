import { expect, test } from '@playwright/test';
import { login, uniq } from './helpers';

test.describe('Shop products: food, grooming and accessories', () => {
  test('owner adds a dog food with brand, pack size and category, receives it, and finds it on its shelf at the counter', async ({ page }) => {
    const name = uniq('E2E puppy kibble ');
    await login(page, 'owner@demo.pk');
    await page.goto('/inventory/catalog');
    await page.getByRole('button', { name: 'Add product' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('radio', { name: /Food & treats/ }).click();
    await expect(dlg.getByText('Strength & dispensing')).toHaveCount(0); // medicine fields are not asked for food
    await expect(dlg.getByText('Prescription-only')).toHaveCount(0);
    await dlg.locator('#p-n').fill(name);
    await dlg.locator('#p-brand').fill('E2E Brand');
    await dlg.locator('#p-cat').selectOption({ label: 'Dry food' });
    await dlg.locator('#p-pack').fill('2 kg bag');
    await dlg.locator('#p-du').selectOption('bag');
    await dlg.locator('#p-pr').fill('3500');
    await dlg.locator('#p-reorder').fill('2');
    await dlg.getByRole('button', { name: 'Save product' }).click();
    await expect(page).toHaveURL(/\/inventory\/products\//);
    await expect(page.getByText(/Food & treats › Dry food · E2E Brand · 2 kg bag/)).toBeVisible();
    // Next step is offered straight away; the reorder level from the form was saved.
    await expect(page.getByText('Add opening stock')).toBeVisible();
    await expect(page.locator('#ps-level')).toHaveValue('2');

    // It is listed under Products → Food & treats.
    await page.goto('/inventory/catalog?tab=FOOD');
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('Dry food');

    // Receive a delivery so it can be sold: food needs no batch number, and the supplier can be "bought locally".
    await page.goto('/inventory?receive=1');
    const rcv = page.getByRole('dialog');
    // "What are you adding to stock?" — the food line then asks for no batch number.
    await expect(rcv.getByRole('heading', { name: 'What are you adding to stock?' })).toBeVisible();
    await rcv.getByRole('radio', { name: /Food/ }).click();
    await expect(rcv.getByLabel('Line 1 batch number')).toHaveCount(0);
    await rcv.locator('#rcv-sup').selectOption({ label: 'Bought locally / not recorded' });
    await rcv.locator('button[role=combobox]').first().click();
    await page.getByLabel('Search products').fill(name);
    await page.getByRole('option', { name: new RegExp(name) }).click();
    await rcv.getByLabel('Line 1 quantity').fill('6');
    // The disabled button explains what is missing.
    await expect(rcv.getByRole('status')).toContainText(`Enter the cost price for ${name}`);
    await rcv.getByLabel('Line 1 unit cost').fill('2500');
    await rcv.getByRole('button', { name: 'Add to stock' }).click();
    await expect(page.getByText(new RegExp(`6 bags of ${name} added to stock \\(GRN-\\d+\\)`))).toBeVisible();

    // Shop counter: section → shelf → tile with brand, pack size and stock.
    await page.goto('/pos');
    await page.getByRole('tab', { name: 'Food & treats' }).click();
    await page.getByRole('tablist', { name: 'Shelves' }).getByRole('tab', { name: 'Dry food' }).click();
    const tile = page.getByRole('button', { name: `Add ${name}` });
    await expect(tile).toContainText('E2E Brand · 2 kg bag');
    await expect(tile).toContainText('6 bags');
    await page.getByRole('tablist', { name: 'Shelves' }).getByRole('tab', { name: 'Wet food' }).click();
    await expect(page.getByRole('button', { name: `Add ${name}` })).toHaveCount(0);
    await page.getByRole('tablist', { name: 'Shelves' }).getByRole('tab', { name: 'Dry food' }).click();
    await page.getByRole('button', { name: `Add ${name}` }).click();
    await expect(page.getByRole('list', { name: 'Basket' }).getByText(name)).toBeVisible();
  });

  test('categories can be added and hidden, and appear as shelves at the counter', async ({ page }) => {
    const shelf = uniq('E2E shelf ');
    await login(page, 'owner@demo.pk');
    await page.goto('/inventory/catalog');
    await page.getByRole('button', { name: 'Categories' }).click();
    const dlg = page.getByRole('dialog', { name: 'Shop categories' });
    await dlg.locator('#pc-name').fill(shelf);
    await dlg.locator('#pc-type').selectOption({ label: 'Grooming & hygiene' });
    await dlg.getByRole('button', { name: 'Add' }).click();
    await expect(dlg.getByText(shelf)).toBeVisible();

    await page.goto('/pos');
    await page.getByRole('tab', { name: 'Grooming & hygiene' }).click();
    await expect(page.getByRole('tablist', { name: 'Shelves' }).getByRole('tab', { name: shelf })).toBeVisible();

    await page.goto('/inventory/catalog');
    await page.getByRole('button', { name: 'Categories' }).click();
    const again = page.getByRole('dialog', { name: 'Shop categories' });
    await again.getByRole('listitem').filter({ hasText: shelf }).getByRole('button', { name: 'Hide' }).click();
    await expect(again.getByText(`${shelf} (hidden)`)).toBeVisible();
    await page.goto('/pos');
    await page.getByRole('tab', { name: 'Grooming & hygiene' }).click();
    await expect(page.getByRole('tab', { name: shelf })).toHaveCount(0);
  });
});
