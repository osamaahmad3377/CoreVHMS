import { expect, test, type Page } from '@playwright/test';
import { login, uniq } from './helpers';

/** A new client with a dog, made through the API (from the page, with its session) so every run starts clean. */
async function newDog(page: Page) {
  const name = uniq('Rex');
  const lastName = uniq('E2E');
  const phone = `0300 ${String(Date.now()).slice(-7)}`;
  const id = await page.evaluate(
    async ([name, lastName, phone]) => {
      const csrf = document.cookie.split('; ').find((c) => c.startsWith('vcms_csrf='))?.split('=')[1] ?? '';
      const call = async (path: string, body?: unknown) => {
        const r = await fetch(`/api/v1${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body ? JSON.stringify(body) : undefined });
        if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
        return r.json();
      };
      const species: { id: string; name: string }[] = await call('/species');
      const client = await call('/clients', { type: 'INDIVIDUAL', firstName: 'Wellness', lastName, mobilePhone: phone });
      const patient = await call('/patients', { ownerId: client.id, name, speciesId: species.find((s) => s.name === 'Dog')!.id, sex: 'MALE' });
      return patient.id as string;
    },
    [name, lastName, phone],
  );
  return { id, name };
}

test.describe('Wellness plans and dental charts', () => {
  test('owner creates a plan and enrols a dog; the vet charts its teeth and signs', async ({ page }) => {
    await login(page, 'owner@demo.pk');
    const plan = uniq('E2E Care ');
    await page.goto('/wellness?tab=plans');
    await page.getByRole('button', { name: 'New plan' }).first().click();
    const pd = page.getByRole('dialog');
    await pd.getByLabel('Plan name').fill(plan);
    await pd.getByLabel('For').selectOption({ label: 'Dog' });
    await pd.getByLabel('Price, paid up front').fill('15000');
    const item = pd.locator('[id^="wi-item-"]').first();
    await item.selectOption((await item.locator('option', { hasText: 'Nail clip' }).getAttribute('value'))!);
    await pd.getByLabel('Services and lab tests (%)').fill('10');
    await pd.getByRole('button', { name: 'Create plan' }).click();
    await expect(page.getByText(`${plan} created`)).toBeVisible();

    const dog = await newDog(page);
    await page.goto(`/patients/${dog.id}?tab=wellness`);
    await page.getByRole('button', { name: 'Join a plan' }).click();
    const ed = page.getByRole('dialog');
    await ed.getByRole('radio', { name: new RegExp(plan) }).click();
    await ed.getByRole('button', { name: 'Join plan' }).click();
    await expect(page.getByText(`${dog.name} joined ${plan}`)).toBeVisible();
    await expect(page.getByText('0 of 1 used · 1 left')).toBeVisible();

    // The vet records a dental chart.
    await login(page, 'vet@demo.pk');
    await page.goto(`/patients/${dog.id}?tab=dental`);
    await page.getByRole('button', { name: 'New dental chart' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start chart' }).click();
    await expect(page).toHaveURL(/\/dental\/[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: /\(108\)/ }).first().click();
    await page.getByRole('button', { name: /CCF · Crown fracture, pulp exposed/ }).click();
    await page.locator('#te-pd').getByRole('radio', { name: 'PD3' }).click();
    await page.getByRole('button', { name: /^Save tooth/ }).click();
    await expect(page.getByText('Saved 108')).toBeVisible();
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await page.getByLabel('Procedure').selectOption('SP');
    await page.getByRole('button', { name: 'Add procedure' }).click();
    await expect(page.getByText('Scale and polish recorded')).toBeVisible();
    await page.getByRole('button', { name: 'Sign', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign and lock' }).click();
    await expect(page.getByText('Dental chart signed and locked')).toBeVisible();
    await expect(page.getByText('Unchanged since signing')).toBeVisible();
  });
});
