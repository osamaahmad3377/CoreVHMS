import { expect, test } from '@playwright/test';
import { login, uniq } from './helpers';

test.describe('Staff with a temporary password', () => {
  test('owner creates an account with a temporary password; the new person must choose their own at first sign-in', async ({ page }) => {
    const email = `${uniq('temp').toLowerCase()}@demo-e2e.pk`;
    await login(page, 'owner@demo.pk');
    await page.goto('/settings/staff');
    await page.getByRole('button', { name: 'Add staff' }).click();
    const dlg = page.getByRole('dialog');
    // Temporary password is the default (many clinics have no staff email).
    await expect(dlg.getByRole('radio', { name: /Create temporary password/ })).toHaveAttribute('aria-checked', 'true');
    await dlg.locator('#m-name').fill('Temp Receptionist');
    await dlg.locator('#m-email').fill(email);
    await dlg.getByRole('checkbox', { name: 'Receptionist' }).click();
    await dlg.getByRole('button', { name: 'Create account' }).click();

    const shown = page.getByRole('dialog', { name: /Temporary password for Temp Receptionist/ });
    await expect(shown).toBeVisible();
    const temp = (await shown.getByTestId('temporary-password').textContent())!.trim();
    expect(temp).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
    await expect(shown.getByText(email)).toBeVisible();
    await shown.getByRole('button', { name: 'Done' }).click();
    const row = page.getByRole('row', { name: new RegExp(email) });
    await expect(row.getByText('Temporary password', { exact: true }).first()).toBeVisible(); // status badge
    await row.getByRole('button', { name: 'Actions for Temp Receptionist' }).click();
    await expect(page.getByRole('menuitem', { name: 'Temporary password' })).toBeVisible(); // action to issue a new one
    await page.keyboard.press('Escape');

    // The new person signs in with it and is asked for their own password before anything else.
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(temp);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Choose your own password')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Quick actions' })).toHaveCount(0);
    await page.locator('#fp-current').fill(temp);
    await page.locator('#fp-new').fill('Reception2026x');
    await page.locator('#fp-repeat').fill('Reception2026y');
    await expect(page.getByText('The passwords do not match')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save password and continue' })).toBeDisabled();
    await page.locator('#fp-repeat').fill('Reception2026x');
    await page.getByRole('button', { name: 'Save password and continue' }).click();
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Temp/ })).toBeVisible();

    // From now on the temporary password is useless and their own works.
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(temp);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Email or password is incorrect')).toBeVisible();
    await page.getByLabel('Password').fill('Reception2026x');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('the Staff page can add a person too; choosing the vet role marks them as a vet', async ({ page }) => {
    await login(page, 'owner@demo.pk');
    await page.goto('/staff');
    await page.getByRole('button', { name: 'Add staff' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add staff member' });
    // Six common roles first, the rest behind "More roles…".
    await expect(dlg.getByRole('checkbox', { name: 'Surgeon / anaesthetist' })).toHaveCount(0);
    await dlg.getByRole('button', { name: 'More roles…' }).click();
    await expect(dlg.getByRole('checkbox', { name: 'Surgeon / anaesthetist' })).toBeVisible();
    const isVet = dlg.getByRole('checkbox', { name: /This person is a vet/ });
    await expect(isVet).not.toBeChecked();
    await dlg.getByRole('checkbox', { name: 'Veterinarian', exact: true }).click();
    await expect(isVet).toBeChecked();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
  });
});
