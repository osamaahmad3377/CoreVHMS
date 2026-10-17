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
    await page.getByRole('button', { name: 'Add address' }).click();
    await page.locator('#a1').fill('House 5, Street 9');
    await page.getByLabel('City / town / village').fill('Lahore');
    await page.getByRole('button', { name: 'Add client' }).click();
    await expect(page.getByText('Saved. What next?')).toBeVisible();
    await expect(page.getByRole('heading', { name: new RegExp(surname) })).toBeVisible();

    await page.getByRole('link', { name: 'Add patient' }).first().click();
    await expect(page.getByText(`Owner (client): Erum ${surname}`)).toBeVisible();
    await page.locator('#name').fill(petName);
    await page.locator('#speciesId').selectOption({ label: 'Cat' });
    await page.getByLabel('Breed', { exact: true }).selectOption({ label: 'Persian' });
    await page.getByLabel('Sex').selectOption('FEMALE');
    await page.getByLabel('Current weight (kg)').fill('3.4');
    await page.getByRole('button', { name: 'Add patient' }).click();

    await expect(page.getByRole('link', { name: petName })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add another patient' })).toBeVisible();
    await expect(page.getByText('3.4 kg').first()).toBeVisible();

    await page.keyboard.press('Meta+k');
    await page.getByPlaceholder(/Search by name, patient or phone/).fill(petName);
    await expect(page.getByRole('option', { name: new RegExp(petName) })).toBeVisible();
  });

  test('warns about duplicate clients by phone number', async ({ page }) => {
    await login(page, 'reception@demo.pk');
    await page.goto('/clients/new');
    await page.getByLabel('Mobile').fill('+92 300 1234567'); // demo client Ahmed Khan is 0300 1234567
    await expect(page.getByText('Possible existing client')).toBeVisible();
    await expect(page.getByText('Same mobile number').first()).toBeVisible();
  });

  test('walk-in: a new client and patient are added from the empty search and checked in', async ({ page }) => {
    await login(page, 'reception@demo.pk');
    const client = uniq('Walkin Owner ');
    const pet = uniq('Moti');
    await page.goto('/front-desk');
    await page.getByRole('button', { name: 'Walk-in' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox').first().click();
    await page.getByLabel('Search patients').fill(client);
    await expect(page.getByText(`No patient found for “${client}”`)).toBeVisible();
    await page.getByRole('button', { name: 'New client and patient' }).click();
    await expect(dialog.locator('#qa-client')).toHaveValue(client);
    await dialog.locator('#qa-mobile').fill(`0300 ${Math.floor(1000000 + Math.random() * 8999999)}`);
    await dialog.locator('#qa-patient').fill(pet);
    await dialog.locator('#qa-species').selectOption({ label: 'Dog' });
    await dialog.getByRole('button', { name: 'Save and select' }).click();
    await expect(dialog.getByRole('combobox').first()).toContainText(pet);
    await dialog.getByRole('button', { name: 'Check in' }).click();
    await expect(page.getByText(new RegExp(`Checked in: ${pet} as a walk-in`))).toBeVisible();
  });

  test('finds a client by a phone number typed with spaces', async ({ page }) => {
    await login(page, 'reception@demo.pk');
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(/Search by name, patient or phone/).fill('0300 1234');
    await expect(page.getByRole('option', { name: /Ahmed Khan/ }).first()).toBeVisible();
  });

  test('adds a critical allergy which appears in the patient banner', async ({ page }) => {
    await login(page, 'vet@demo.pk');
    await page.goto('/patients?q=Snowy');
    await page.getByRole('link', { name: 'Snowy' }).first().click();
    const title = uniq('Allergy to ');
    await page.getByRole('button', { name: 'Add medical alert' }).click();
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
    await expect(nav.getByRole('link', { name: 'Activity log' })).toHaveCount(0);
    await page.goto('/audit');
    await expect(page.getByText('Access denied')).toBeVisible();
  });
});
