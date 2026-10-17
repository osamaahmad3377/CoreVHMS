import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('Vaccines & reminders', () => {
  test('vet records a vaccination given elsewhere and the next one is scheduled', async ({ page }) => {
    await login(page, 'vet@demo.pk');
    await page.goto('/patients?q=Max');
    await page.getByRole('link', { name: 'Max', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Care plan' }).click();
    const row = page.getByRole('listitem').filter({ hasText: 'Rabies vaccination' }).first();
    await row.getByRole('button', { name: 'Record' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('radio', { name: 'Given elsewhere' }).click();
    await dlg.locator('#cc-pname').fill('Rabies vaccine (other clinic)');
    await dlg.getByRole('button', { name: 'Record' }).click();
    await expect(page.getByText(/Rabies vaccination .* recorded/)).toBeVisible();
    await expect(page.getByText('given elsewhere (Rabies vaccine (other clinic))').first()).toBeVisible(); // earlier runs on the same demo pet leave more
    await expect(page.getByRole('listitem').filter({ hasText: 'Rabies vaccination' }).filter({ has: page.getByRole('button', { name: 'Record' }) })).toHaveCount(1); // next one scheduled
  });

  test('the client portal is switched off: no portal pages or portal controls for staff', async ({ page }) => {
    test.skip(process.env.CLIENT_PORTAL_ENABLED === 'true', 'Client portal is switched on for this run');
    await login(page, 'reception@demo.pk');
    await page.goto('/portal/login');
    await expect(page).not.toHaveURL(/\/portal/);
    await page.goto('/clients?q=Hussain');
    await page.getByRole('link', { name: /Zainab Hussain/ }).first().click();
    await expect(page.getByRole('heading', { name: /Hussain/ })).toBeVisible();
    await expect(page.getByText('Client portal')).toHaveCount(0);
    await page.goto('/communications');
    await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Client messages|Appointment requests/ })).toHaveCount(0);
  });
});
