import { expect, test, type Page } from '@playwright/test';
import { login, uniq } from './helpers';

/** A new client with a dog, made through the API (from the page, with its session) so every run starts clean. */
async function newDog(page: Page) {
  const name = uniq('Diary');
  const id = await page.evaluate(
    async ([name, lastName, phone]) => {
      const csrf = document.cookie.split('; ').find((c) => c.startsWith('vcms_csrf='))?.split('=')[1] ?? '';
      const call = async (path: string, body?: unknown) => {
        const r = await fetch(`/api/v1${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body ? JSON.stringify(body) : undefined });
        if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
        return r.json();
      };
      const species: { id: string; name: string }[] = await call('/species');
      const client = await call('/clients', { type: 'INDIVIDUAL', firstName: 'Diary', lastName, mobilePhone: phone });
      const patient = await call('/patients', { ownerId: client.id, name, speciesId: species.find((s) => s.name === 'Dog')!.id, sex: 'MALE' });
      return patient.id as string;
    },
    [name, uniq('E2E'), `0300 ${String(Date.now()).slice(-7)}`],
  );
  return { id, name };
}

test.describe('Pet diary', () => {
  test('a vet records a rabies antibody test and opens the diary with it', async ({ page }) => {
    await login(page, 'vet@demo.pk');
    const dog = await newDog(page);
    await page.goto(`/patients/${dog.id}`);
    await page.getByRole('tab', { name: 'Diary' }).click();
    await page.getByRole('button', { name: 'Record or plan a test' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Laboratory').fill('Idexx Lahore');
    await d.getByLabel('Result', { exact: true }).fill('1.8');
    await d.getByLabel('Outcome').selectOption('SATISFACTORY');
    await d.getByRole('button', { name: 'Save result' }).click();
    await expect(page.getByText('Test recorded')).toBeVisible();
    await expect(page.getByText('1.8 IU/mL').first()).toBeVisible();

    await page.getByRole('link', { name: /Open and print/ }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${dog.id}/diary$`));
    await expect(page.getByText('Pet Health Diary').first()).toBeVisible();
    await expect(page.getByText('Rabies serological test').first()).toBeVisible();
    await expect(page.getByText('Idexx Lahore').first()).toBeVisible();
    await expect(page.getByText('Page 12 of 14').first()).toBeVisible();
  });

  test('the owner opens the diary on the private link, and the clinic can restyle it', async ({ page, browser }) => {
    await login(page, 'owner@demo.pk');
    const dog = await newDog(page);
    await page.goto(`/patients/${dog.id}`);
    await page.getByRole('tab', { name: 'Diary' }).click();
    await expect(page.getByText('Online diary for the owner')).toBeVisible();
    const url = (await page.locator('code').filter({ hasText: '/d/' }).first().textContent())!.trim();
    expect(url).toMatch(/\/d\/[\w-]{30,}$/);
    await expect(page.getByRole('button', { name: /Email owner/ })).toBeVisible();

    // No sign-in: anyone with the link reads the diary.
    const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin });
    const v = await visitor.newPage();
    await v.goto(url);
    await expect(v.getByRole('heading', { name: dog.name })).toBeVisible();
    await expect(v.getByText('Coming up').or(v.getByText('Kept up to date by')).first()).toBeVisible();
    await expect(v.getByText('Rabies vaccination').first()).toBeVisible();
    await visitor.close();
    // A made-up link opens nothing.
    const bad = await browser.newContext({ baseURL: new URL(page.url()).origin });
    const b = await bad.newPage();
    await b.goto('/d/this-link-is-not-real');
    await expect(b.getByText('This diary link isn’t working')).toBeVisible();
    await bad.close();

    // Settings → Pet diary: the preview follows the choices (nothing is saved here).
    await page.goto('/settings/pet-diary');
    await expect(page.getByRole('heading', { name: 'Pet diary' })).toBeVisible();
    await page.getByRole('radio', { name: /Elegant/ }).click();
    await page.getByLabel('Title on the cover').fill('Pet Passport');
    await expect(page.getByText('Pet Passport').first()).toBeVisible();
    await expect(page.getByText('Send the links automatically')).toBeVisible();
  });
});
