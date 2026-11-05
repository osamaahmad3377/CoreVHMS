import { expect, test, type Page } from '@playwright/test';
import { login, uniq } from './helpers';

/** A new client with a dog, made through the API (from the page, with its session) so every run starts clean. */
async function newDog(page: Page) {
  const name = uniq('Cert');
  const id = await page.evaluate(
    async ([name, lastName, phone]) => {
      const csrf = document.cookie.split('; ').find((c) => c.startsWith('vcms_csrf='))?.split('=')[1] ?? '';
      const call = async (path: string, body?: unknown) => {
        const r = await fetch(`/api/v1${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body ? JSON.stringify(body) : undefined });
        if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
        return r.json();
      };
      const species: { id: string; name: string }[] = await call('/species');
      const client = await call('/clients', { type: 'INDIVIDUAL', firstName: 'Certificate', lastName, mobilePhone: phone });
      const patient = await call('/patients', { ownerId: client.id, name, speciesId: species.find((s) => s.name === 'Dog')!.id, sex: 'MALE' });
      return patient.id as string;
    },
    [name, uniq('E2E'), `0300 ${String(Date.now()).slice(-7)}`],
  );
  return { id, name };
}

test.describe('Certificates', () => {
  test('a vet issues a fitness-to-travel certificate, anyone can verify it, and revoking it shows', async ({ page, browser }) => {
    await login(page, 'vet@demo.pk');
    const dog = await newDog(page);
    await page.goto(`/patients/${dog.id}?tab=certificates`);
    await page.getByRole('tab', { name: 'Certificates' }).click();
    await page.getByRole('button', { name: 'Issue certificate' }).click();
    const d = page.getByRole('dialog');
    await d.getByRole('button', { name: /Fitness to travel/ }).click();
    await d.getByLabel(/Destination/).fill('Dubai, UAE');
    // The preview shows the wording, filled in.
    await expect(d.getByText(/fit to travel by air to Dubai, UAE/)).toBeVisible();
    await d.getByRole('button', { name: 'Issue certificate' }).click();
    await expect(page).toHaveURL(/\/certificates\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: /Fitness to Travel Certificate/ })).toBeVisible();
    const code = (await page.getByText(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/).first().textContent())!.replace(/-/g, '');

    // Anyone, signed in or not, can check it.
    const anon = await browser.newPage();
    await anon.goto(`/verify/${code}`);
    await expect(anon.getByText('Genuine and valid')).toBeVisible();
    await expect(anon.getByText(new RegExp(`^${dog.name} — Dog`))).toBeVisible();

    // Revoked: the same check now says so.
    await page.getByRole('button', { name: 'Revoke' }).click();
    await page.getByRole('dialog').getByLabel('Reason').fill('Travel cancelled');
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('Revoked', { exact: true }).first()).toBeVisible();
    await anon.reload();
    await expect(anon.getByText('This certificate was revoked')).toBeVisible();
    await expect(anon.getByText(/Travel cancelled/)).toBeVisible();
    await anon.close();
  });
});
