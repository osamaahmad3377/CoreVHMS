import { expect, test } from '@playwright/test';
import { login, uniq } from './helpers';

test.describe('Everyday flow', () => {
  test('“Needs your attention” only links to pages the role can open', async ({ page }) => {
    test.setTimeout(300_000);
    for (const email of ['reception@demo.pk', 'vet@demo.pk', 'nurse@demo.pk']) {
      await page.context().clearCookies();
      await login(page, email);
      const list = page.getByRole('region', { name: 'Needs your attention' });
      const caughtUp = page.getByText('You’re all caught up');
      await expect(list.or(caughtUp)).toBeVisible();
      if (await caughtUp.isVisible()) continue;
      const hrefs = await list.getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('href')!).filter((h) => !h.startsWith('#')));
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        await page.goto(href);
        await page.waitForLoadState('networkidle');
        await expect(page.getByText('Access denied'), `${email} → ${href}`).toHaveCount(0);
      }
      await page.goto('/dashboard');
    }
  });

  test('⌘K offers actions, and a completed consultation leads straight to billing', async ({ page }) => {
    await login(page, 'vet@demo.pk');
    await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
    await page.keyboard.press('Meta+k');
    await page.getByPlaceholder(/Search patients, owners/).fill('book');
    await page.getByRole('option', { name: 'New appointment' }).click();
    await expect(page).toHaveURL(/\/calendar/);

    const complaint = uniq('E2E flow check ');
    await page.goto('/consultations');
    await page.getByRole('button', { name: 'Start consultation' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('combobox').first().click();
    await page.getByLabel('Search patients').fill('Toto');
    await page.getByRole('option', { name: /Toto/ }).first().click();
    await expect(page.getByLabel('Search patients')).toHaveCount(0); // picker closed
    await dlg.locator('#sc-c').fill(complaint);
    await dlg.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page).toHaveURL(/\/consultations\/[0-9a-f-]{36}/);
    await page.getByRole('button', { name: 'Complete consultation' }).click();
    const next = page.getByRole('region', { name: 'Next steps' });
    await expect(next).toBeVisible();
    await expect(next.getByRole('button', { name: /Book a recheck/ })).toBeVisible();
    await next.getByRole('link', { name: /Bill this visit/ }).click();
    await expect(page).toHaveURL(/\/billing\/invoices\/new\?clientId=/);
    await expect(page.getByText(/Akmal|Kamran/).first()).toBeVisible(); // Toto's owner is preselected
  });
});
