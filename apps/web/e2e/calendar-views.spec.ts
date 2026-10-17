import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** A future Wednesday, 3–40 weeks ahead so repeated runs rarely meet earlier test data (demo clinicians work 09:00–17:00 Mon–Sat). */
function futureWednesday() {
  const d = new Date();
  d.setDate(d.getDate() + 7 * (3 + Math.floor(Math.random() * 38)) + ((3 - d.getDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

test.describe('Calendar: drag to reschedule and month view', () => {
  test('reception drags an appointment to a later time, then finds it in the month view', async ({ page }) => {
    await login(page, 'reception@demo.pk');
    const date = futureWednesday();
    await page.goto(`/calendar?date=${date}`);
    await page.getByRole('button', { name: 'Book appointment' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox').first().click();
    await page.getByLabel('Search patients').fill('Snowy');
    await page.getByRole('option', { name: /Snowy/ }).first().click();
    await dialog.locator('#bk-clin').selectOption({ label: 'Dr. Ayesha Raza' });
    const slot = dialog.locator('button.tabular').first();
    await expect(slot).toBeVisible();
    const slotTime = (await slot.textContent())!.trim();
    await slot.click();
    await dialog.locator('#bk-reason').fill('E2E: drag me');
    await dialog.getByRole('button', { name: 'Book appointment' }).click();
    await expect(page.getByText(/Appointment booked: .*\(A-\d+\)/)).toBeVisible();

    // Drag it within Dr. Ayesha's column so that its top lands on the next full hour at least an hour later.
    const [h, m] = slotTime.split(':').map(Number);
    const target = `${String(Math.ceil((h * 60 + m + 60) / 60)).padStart(2, '0')}:00`;
    const appt = page.getByRole('button', { name: new RegExp(`^${slotTime} Snowy`) });
    await expect(appt).toHaveAttribute('draggable', 'true');
    await appt.scrollIntoViewIfNeeded();
    const src = (await appt.boundingBox())!;
    const line = (await page.getByText(target, { exact: true }).first().boundingBox())!;
    const grabY = 8; // px below the appointment's top edge
    await page.mouse.move(src.x + 10, src.y + grabY);
    await page.mouse.down();
    await page.mouse.move(src.x + 14, src.y + grabY + 12, { steps: 4 });
    await page.mouse.move(src.x + 20, line.y + line.height / 2 + grabY, { steps: 12 });
    await page.mouse.up();
    // If that time is already taken, the clash is explained and can be overridden, as in the reschedule dialog.
    const moved = page.getByText('Appointment moved');
    const moveAnyway = page.getByRole('button', { name: 'Move anyway' });
    await expect(moved.or(moveAnyway)).toBeVisible();
    if (await moveAnyway.isVisible()) await moveAnyway.click();
    await expect(moved).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`^${target} Snowy`) }).first()).toBeVisible();

    // Month view: the appointment is listed on its day, and the day opens the day view.
    await page.getByRole('tab', { name: 'month' }).click();
    // The cell for exactly this date (the grid also shows days of the neighbouring months).
    const dayName = new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
    const cell = page.getByRole('gridcell', { name: new RegExp(`^${dayName}:`) });
    await expect(cell.getByRole('button', { name: new RegExp(`^${target}\\s*Snowy`) }).first()).toBeVisible();
    await cell.getByRole('button', { name: /^Open / }).click();
    await expect(page).toHaveURL(new RegExp(`view=day`));
    await expect(page).toHaveURL(new RegExp(`date=${date}`));
    await expect(page.getByRole('button', { name: new RegExp(`^${target} Snowy`) }).first()).toBeVisible();
  });
});
