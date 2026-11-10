import { expect, test, type Page } from '@playwright/test';
import { login, uniq } from './helpers';

/** Opens a step of the consultation from the step list. */
const step = (page: Page, name: string) => page.getByRole('navigation', { name: 'Consultation steps' }).getByRole('button', { name: new RegExp(`${name}$`) }).click();

test.describe('Everyday flow', () => {
  test('“Still to do” / “Needs your attention” only links to pages the role can open', async ({ page }) => {
    test.setTimeout(300_000);
    for (const email of ['reception@demo.pk', 'vet@demo.pk', 'nurse@demo.pk']) {
      // Leave the app first: a page left open would redirect itself to sign-in once the cookies are gone.
      await page.goto('about:blank');
      await page.context().clearCookies();
      await login(page, email);
      const list = page.getByRole('region', { name: /^(Needs your attention|Still to do)$/ });
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
    await page.getByPlaceholder(/Search by name, patient or phone/).fill('book');
    await page.getByRole('option', { name: 'Book appointment' }).click();
    await expect(page).toHaveURL(/\/calendar/);
    await expect(page.getByRole('dialog', { name: /Book appointment/ })).toBeVisible();
    await page.keyboard.press('Escape');

    const complaint = uniq('E2E flow check ');
    await page.goto('/consultations');
    await page.getByRole('button', { name: 'Start consultation' }).click();
    const dlg = page.getByRole('dialog');
    // Owner → animal → start (the window opens on "Start consultation now").
    await dlg.getByLabel('Owner’s name').fill('Kamran Akmal');
    await dlg.getByRole('list', { name: 'Clients found' }).getByRole('button').first().click();
    await dlg.getByRole('button', { name: 'Visit for Toto' }).click();
    await expect(dlg.getByRole('radio', { name: /Start consultation now/ })).toHaveAttribute('aria-checked', 'true');
    if (await dlg.locator('#nv-complaint').isVisible()) await dlg.locator('#nv-complaint').fill(complaint);
    await dlg.getByRole('button', { name: 'Start consultation', exact: true }).click();
    await expect(page).toHaveURL(/\/consultations\/[0-9a-f-]{36}/);
    // Quick consult: nothing written, straight to review — completing is still allowed.
    await step(page, 'Review & sign');
    await expect(page.getByText('Before you finish')).toBeVisible();
    await page.getByRole('button', { name: 'Sign and complete' }).click();
    // Finished: only the three next steps — bill, view & print, next consultation.
    const next = page.getByRole('region', { name: 'Consultation finished' });
    await expect(next).toBeVisible();
    await expect(next.getByRole('button', { name: /View & print consultation/ })).toBeVisible();
    await expect(next.getByRole('group', { name: 'Next consultation in' }).getByRole('button', { name: '1 week' })).toBeVisible();
    await next.getByRole('link', { name: /Bill this consultation/ }).click();
    await expect(page).toHaveURL(/\/billing\/invoices\/new\?clientId=/);
    await expect(page.getByText(/Akmal|Kamran/).first()).toBeVisible(); // Toto's owner is preselected
  });

  test('walk-in → vet starts from the dashboard → notes typed just before finishing are kept → front desk bills the visit', async ({ browser }) => {
    const reception = await (await browser.newContext()).newPage();
    await login(reception, 'reception@demo.pk');
    await reception.goto('/front-desk');
    await reception.getByRole('button', { name: 'Walk-in' }).click();
    const walkIn = reception.getByRole('dialog');
    await walkIn.getByRole('combobox').first().click();
    await reception.getByLabel('Search patients').fill('Rocky');
    await reception.getByRole('option', { name: /Rocky/ }).first().click();
    await walkIn.getByLabel('Vet', { exact: true }).selectOption({ label: 'Dr. Ayesha Raza' });
    await walkIn.getByLabel('Reason', { exact: true }).fill(uniq('E2E itchy skin '));
    await walkIn.getByRole('button', { name: 'Check in' }).click();
    await expect(reception.getByText(/Checked in: Rocky/)).toBeVisible();

    const vet = await (await browser.newContext()).newPage();
    await login(vet, 'vet@demo.pk');
    await vet.getByRole('button', { name: 'Start consultation for Rocky' }).first().click();
    await expect(vet).toHaveURL(/\/consultations\/[0-9a-f-]{36}/);
    // Typed and finished at once, before the autosave: the words are still saved and signed.
    await step(vet, 'Diagnosis');
    await vet.getByRole('button', { name: 'Add clinical reasoning' }).click();
    await vet.locator('#qc-assess').fill('Flea allergy dermatitis');
    await step(vet, 'Review & sign');
    await vet.getByRole('button', { name: 'Sign and complete' }).click();
    await expect(vet.getByRole('region', { name: 'Consultation finished' })).toBeVisible();
    await vet.getByRole('button', { name: 'Show full details' }).click();
    await expect(vet.getByText('Flea allergy dermatitis').first()).toBeVisible();

    await reception.reload();
    const card = reception.getByRole('listitem').filter({ hasText: 'Rocky' }).filter({ has: reception.getByRole('link', { name: 'Bill', exact: true }) }).first();
    await card.getByRole('link', { name: 'Bill', exact: true }).click();
    await expect(reception).toHaveURL(/\/billing\/invoices\/new\?clientId=/);
    await expect(reception.getByRole('button', { name: 'Finish & take payment' })).toBeEnabled();
  });

  test('pharmacy: Hand over opens the dispense window straight from the list', async ({ page }) => {
    await login(page, 'pharmacy@demo.pk');
    await page.goto('/pharmacy');
    const handOver = page.getByRole('button', { name: /^Hand over RX-/ }).first();
    await expect(handOver).toBeVisible();
    await handOver.click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: /^Dispense RX-/ })).toBeVisible();
    await expect(page).toHaveURL(/\/pharmacy$/); // no detour through the prescription page
  });

  test('vaccines & reminders: Book opens the booking with the patient and reason filled in', async ({ page }) => {
    await login(page, 'reception@demo.pk');
    await page.goto('/preventive');
    const row = page.getByRole('row').filter({ hasText: /vaccination/i }).filter({ has: page.getByRole('link', { name: 'Book', exact: true }) }).first();
    await expect(row).toBeVisible();
    await row.getByRole('link', { name: 'Book', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: /Book appointment/ });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('combobox').first()).not.toContainText('Search by name');
    await expect(dlg.getByLabel('Reason for visit')).not.toHaveValue('');
    await expect(dlg.getByLabel(/Appointment type/)).toContainText('Vaccination');
  });
});
