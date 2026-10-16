import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('Ease of use', () => {
  test('receptionist sees role-based quick actions and finds a guide in the help centre', async ({ page }) => {
    await login(page, 'reception@demo.pk');
    const quick = page.getByRole('navigation', { name: 'Quick actions' });
    await expect(quick.getByRole('link', { name: /Counter sale/ })).toBeVisible();
    await expect(quick.getByRole('link', { name: /Consultations/ })).toHaveCount(0); // clinical work is not part of this role

    await page.getByRole('link', { name: 'Help centre' }).first().click();
    await page.getByLabel('Search help').fill('refund');
    await expect(page.getByText('Take a payment, refund or give credit')).toBeVisible();
    await expect(page.getByText('To refund, open Billing → Payments')).toBeVisible();

    await page.goto('/pos');
    await page.getByRole('link', { name: 'How to' }).click();
    await expect(page.getByText('Open Point of sale. Scan the barcode')).toBeVisible();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  });
});
