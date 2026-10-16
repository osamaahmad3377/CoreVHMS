import { expect, test } from '@playwright/test';
import { login, uniq } from './helpers';

test.describe('Front desk: clients and patients', () => {
  test('registers a new client and a patient, then finds the patient via global search', async ({ page }) => {
    await login(page, 'reception@demo.pk');
    const surname = uniq('Testowner');
    const petName = uniq('Pet');

    await page.goto('/clients/new');
    await page.getByLabel('First name').fill('Erum');
    await page.locator('#lastName').fill(surname);
    await page.getByLabel('Mobile').fill(`0300 ${Math.floor(1000000 + Math.random() * 8999999)}`);
    await page.locator('#a1').fill('House 5, Street 9');
    await page.getByLabel('City / town / village').fill('Lahore');
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(surname) })).toBeVisible();

    await page.getByRole('link', { name: 'Add animal' }).click();
    await expect(page.getByText(`Owner: ${surname}, Erum`)).toBeVisible();
    await page.locator('#name').fill(petName);
    await page.locator('#speciesId').selectOption({ label: 'Cat' });
    await page.getByLabel('Breed', { exact: true }).selectOption({ label: 'Persian' });
    await page.getByLabel('Sex').selectOption('FEMALE');
    await page.getByLabel('Current weight (kg)').fill('3.4');
    await page.getByRole('button', { name: 'Register patient' }).click();

    await expect(page.getByRole('link', { name: petName })).toBeVisible();
    await expect(page.getByText('3.4 kg').first()).toBeVisible();

    await page.keyboard.press('Meta+k');
    await page.getByPlaceholder(/Search patients, owners/).fill(petName);
    await expect(page.getByRole('option', { name: new RegExp(petName) })).toBeVisible();
  });

  test('warns about duplicate clients by phone number', async ({ page }) => {
    await login(page, 'reception@demo.pk');
    await page.goto('/clients/new');
    await page.getByLabel('Mobile').fill('+92 300 1234567'); // demo client Ahmed Khan is 0300 1234567
    await expect(page.getByText('Possible existing client')).toBeVisible();
    await expect(page.getByText('Same mobile number')).toBeVisible();
  });

  test('adds a critical allergy which appears in the patient banner', async ({ page }) => {
    await login(page, 'vet@demo.pk');
    await page.goto('/patients?q=Snowy');
    await page.getByRole('link', { name: 'Snowy' }).first().click();
    const title = uniq('Allergy to ');
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Add medical alert' }).click();
    await page.getByLabel('Severity').selectOption('CRITICAL');
    await page.locator('#al-title').fill(title);
    await page.getByRole('button', { name: 'Add alert' }).click();
    await expect(page.getByLabel('Medical alerts').getByText(title)).toBeVisible();
  });
});

test.describe('Access control in the UI', () => {
  test('receptionist does not see administration menus and is denied the audit page', async ({ page }) => {
    await login(page, 'reception@demo.pk');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Clients' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
    await page.goto('/audit');
    await expect(page.getByText('Access denied')).toBeVisible();
  });
});
