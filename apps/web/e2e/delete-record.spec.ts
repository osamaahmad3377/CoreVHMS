import { expect, test, type Page } from '@playwright/test';
import { login, uniq } from './helpers';

/** A new client with one animal, made through the API (from the page, with its session). */
async function newClientWithAnimal(page: Page) {
  const name = uniq('Oops');
  const ids = await page.evaluate(
    async ([name, lastName, phone]) => {
      const csrf = document.cookie.split('; ').find((c) => c.startsWith('vcms_csrf='))?.split('=')[1] ?? '';
      const call = async (path: string, body?: unknown) => {
        const r = await fetch(`/api/v1${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body ? JSON.stringify(body) : undefined });
        if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
        return r.json();
      };
      const species: { id: string; name: string }[] = await call('/species');
      const client = await call('/clients', { type: 'INDIVIDUAL', firstName: 'Mistake', lastName, mobilePhone: phone });
      const patient = await call('/patients', { ownerId: client.id, name, speciesId: species.find((s) => s.name === 'Dog')!.id, sex: 'MALE' });
      return { clientId: client.id as string, patientId: patient.id as string };
    },
    [name, uniq('E2E'), `0301 ${String(Date.now()).slice(-7)}`],
  );
  return { ...ids, name };
}

test.describe('Deleting records added by mistake', () => {
  test('an owner deletes a client and their unused animal, and is told why an animal with history can’t go', async ({ page }) => {
    await login(page, 'owner@demo.pk');
    const m = await newClientWithAnimal(page);

    await page.goto(`/clients/${m.clientId}`);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /Delete client/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`Their animal ${m.name} is deleted too.`);
    await dialog.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(page).toHaveURL(/\/clients$/);
    expect(await page.evaluate(async (id) => (await fetch(`/api/v1/patients/${id}`)).status, m.patientId)).toBe(404);

    // Bano (demo farm goat) has hospital and breeding history: no delete, archive offered instead.
    await page.goto('/patients?q=Bano');
    await page.getByRole('link', { name: /Bano/ }).first().click();
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /Delete/ }).click();
    await expect(dialog).toContainText('Bano can’t be deleted');
    await expect(dialog).toContainText('1 hospital stay');
    await expect(dialog.getByRole('button', { name: 'Archive instead' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(dialog).toBeHidden();
  });
});
