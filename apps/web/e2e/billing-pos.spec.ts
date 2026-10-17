import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('Billing, payments and point of sale', () => {
  test('reception invoices a client’s items not yet invoiced and takes a card payment', async ({ page }) => {
    await login(page, 'reception@demo.pk');
    await page.goto('/billing/charges');
    const first = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Make invoice' }) }).first();
    await first.getByRole('button', { name: 'Show items' }).click();
    await expect(page.getByText(/^Added on /).first()).toBeVisible();
    await first.getByRole('link', { name: 'Make invoice' }).click();
    await expect(page.getByRole('heading', { name: 'New invoice' })).toBeVisible();
    await expect(page.getByLabel(/^Include /).first()).toBeChecked();
    await page.getByRole('button', { name: 'Finish invoice' }).click();
    await expect(page.getByText(/INV-\d{6} finished/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /INV-\d{6}/ })).toContainText('Unpaid');

    await page.getByRole('button', { name: 'Take payment' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('radio', { name: 'Card' }).click();
    await dlg.getByLabel('Receipt / slip no. (optional)').fill('AUTH-E2E');
    await expect(dlg.getByText('Extra kept as credit')).toBeVisible();
    await dlg.getByRole('button', { name: 'Save payment' }).click();
    await expect(page.getByText(/Payment RCPT-\d{6} recorded/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /INV-\d{6}/ })).toContainText('Paid');
    // Every payment row keeps its own receipt button.
    await expect(page.getByRole('button', { name: /^Print receipt RCPT-\d{6}/ }).first()).toBeVisible();
  });

  test('reception splits an invoice payment between card and cash', async ({ page }) => {
    await login(page, 'reception@demo.pk');
    await page.goto('/billing/charges');
    const first = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Make invoice' }) }).first();
    await first.getByRole('link', { name: 'Make invoice' }).click();
    await page.getByRole('button', { name: 'Finish invoice' }).click();
    await expect(page.getByText(/INV-\d{6} finished/)).toBeVisible();

    await page.getByRole('button', { name: 'Take payment' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('radio', { name: 'Card' }).click();
    await dlg.getByLabel('Amount paid now').fill('100');
    await dlg.getByRole('button', { name: 'Add split' }).click();
    await dlg.getByRole('radio', { name: 'Cash' }).click();
    await expect(dlg.getByRole('list', { name: 'Payments added' })).toContainText('Card');
    await dlg.getByRole('button', { name: /^Save payment/ }).click();
    await expect(page.getByText(/2 payments recorded \(RCPT-\d{6}, RCPT-\d{6}\)/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /INV-\d{6}/ })).toContainText('Paid');
    await expect(page.getByRole('button', { name: /^Print receipt RCPT-\d{6}/ }).first()).toBeVisible();
  });

  test('dispensary scans a retail item, takes cash with change, and stock is deducted', async ({ page }) => {
    await login(page, 'pharmacy@demo.pk');
    await page.goto('/inventory?q=Elizabethan');
    const row = page.getByRole('row', { name: /Elizabethan collar/ });
    const before = Number((await row.getByRole('cell').nth(1).innerText()).split(' ')[0]);

    await page.goto('/pos');
    await page.getByLabel('Scan or search items').fill('ECOL-M');
    await page.keyboard.press('Enter'); // barcode scanners send the code followed by Enter
    const basket = page.getByRole('list', { name: 'Basket' });
    await expect(basket.getByText('Elizabethan collar (medium)')).toBeVisible();
    await expect(page.getByRole('button', { name: /Edit price or discount/ })).toHaveCount(0); // catalogue prices only without billing permission
    await expect(page.getByRole('button', { name: 'Add Canine DHPPi vaccine' })).toHaveCount(0); // prescription vaccines are not sold at the counter

    await page.keyboard.press('F9');
    const pay = page.getByRole('dialog');
    await pay.getByLabel('Amount', { exact: true }).fill('1000');
    await pay.getByRole('button', { name: 'Finish sale · give Rs 100.00 change' }).click();
    await expect(page.getByText(/Sale INV-\d{6} complete/)).toBeVisible();
    await expect(page.getByText('Change to give')).toBeVisible();
    await expect(page.getByLabel(/^Receipt INV-\d{6}/).first()).toContainText('Cash given');

    await page.goto('/inventory?q=Elizabethan');
    await expect(page.getByRole('row', { name: /Elizabethan collar/ }).getByRole('cell').nth(1)).toContainText(String(before - 1));
  });

  test('cashier pauses and resumes a basket, splits payment between card and cash, and finds it in today’s sales', async ({ page }) => {
    await login(page, 'reception@demo.pk');
    await page.goto('/pos');
    await page.getByRole('tab', { name: 'Services' }).click();
    await page.getByRole('button', { name: 'Add Nail clip' }).click();
    await page.getByRole('button', { name: 'Pause sale', exact: true }).click();
    await expect(page.getByText('Scan or tap items to start a sale')).toBeVisible();
    await page.getByRole('button', { name: /Paused sales \(\d+\)/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Resume' }).first().click();
    await expect(page.getByRole('list', { name: 'Basket' }).getByText('Nail clip')).toBeVisible();

    await page.getByRole('button', { name: /^Take payment Rs 500.00/ }).click();
    const pay = page.getByRole('dialog');
    await pay.getByRole('radio', { name: 'Card' }).click();
    await pay.getByLabel('Amount', { exact: true }).fill('200');
    await pay.getByLabel('Receipt / slip no. (optional)').fill('AUTH-SPLIT');
    await pay.getByRole('button', { name: 'Add split' }).click();
    await pay.getByRole('radio', { name: 'Cash' }).click();
    await expect(pay.getByLabel('Amount', { exact: true })).toHaveValue('300.00');
    await pay.getByRole('button', { name: 'Finish sale' }).click();
    const receipt = page.getByLabel(/^Receipt INV-\d{6}/).first();
    await expect(receipt).toContainText('Card (AUTH-SPLIT)');
    await expect(receipt).toContainText('Rs 300.00');
    const invoiceNo = (await receipt.getAttribute('aria-label'))!.replace('Receipt ', '');

    await page.getByRole('button', { name: 'New sale' }).click();
    await page.getByRole('button', { name: 'Today’s sales' }).click();
    await expect(page.getByRole('dialog').getByText(invoiceNo)).toBeVisible();
  });
});
