import { expect, test, type Page } from '@playwright/test';
import { ensureStock, login } from './helpers';

interface PrintDetail { paperWidthMm: number; heightMm: number; copies: number; logoLoaded: boolean; text: string }

/** Records what the next receipt print sends to the printer. */
async function capturePrints(page: Page) {
  await page.evaluate(() => {
    (window as any).__prints = [];
    window.addEventListener('vcms:receipt-print', (e) => (window as any).__prints.push((e as CustomEvent).detail));
  });
}
async function lastPrint(page: Page): Promise<PrintDetail> {
  await page.waitForFunction(() => (window as any).__prints?.length > 0, null, { timeout: 15_000 });
  return page.evaluate(() => (window as any).__prints.at(-1));
}

test.describe('Receipts & printing', () => {
  test('owner sets a 58 mm layout with its own logo and two copies; counter receipts print with it', async ({ page, browser }) => {
    await ensureStock(browser, 'ECOL-M');
    // A real image to use as the receipt logo.
    await page.setContent('<div id="l" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;font:700 40px Arial">PAWS</div>');
    const logo = await page.locator('#l').screenshot();

    await login(page, 'owner@demo.pk');
    await page.goto('/settings/receipts');
    await page.waitForLoadState('networkidle');
    const preview = page.getByTestId('receipt-preview');
    await expect(preview).toContainText('TAX INVOICE / RECEIPT');

    await page.getByRole('radio', { name: '58 mm' }).click();
    await page.getByRole('radio', { name: 'Separate receipt logo' }).click();
    await page.getByLabel('Receipt logo file').setInputFiles({ name: 'paws.png', mimeType: 'image/png', buffer: logo });
    await expect(page.getByText('Logo uploaded — save to use it')).toBeVisible();
    await expect(preview.locator('img')).toBeVisible();
    await page.locator('#rc-lw').focus();
    await page.keyboard.press('Home'); // 15 %
    for (let i = 0; i < 11; i++) await page.keyboard.press('ArrowRight'); // +5 % each
    await expect(page.getByText('Logo size: 70% of the width')).toBeVisible();
    await page.locator('#rc-h').fill('Open daily 9 am – 9 pm');
    await page.locator('#rc-c').selectOption('2');
    await expect(preview).toContainText('Open daily 9 am – 9 pm');
    await expect(preview.locator('article')).toHaveCSS('width', /^219\.|^219px/); // 58 mm at 96 dpi
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Receipt settings saved')).toBeVisible();

    // Saved: still there after reloading.
    await page.reload();
    await expect(page.locator('#rc-h')).toHaveValue('Open daily 9 am – 9 pm');
    await expect(page.getByRole('radio', { name: '58 mm' })).toHaveAttribute('aria-checked', 'true');

    // Test print: exact roll width, both copies, logo loaded.
    await capturePrints(page);
    await page.getByRole('button', { name: 'Print test receipt' }).click();
    const test1 = await lastPrint(page);
    expect(test1).toMatchObject({ paperWidthMm: 58, copies: 2, logoLoaded: true });
    expect(test1.text).toContain('Customer copy');
    expect(test1.text).toContain('Clinic copy');
    expect(test1.heightMm).toBeGreaterThan(60);

    // A counter sale prints with the saved layout.
    await page.goto('/pos');
    await page.getByLabel('Scan or search items').fill('ECOL-M');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('list', { name: 'Basket' }).getByText('Elizabethan collar (medium)')).toBeVisible();
    await page.keyboard.press('F9');
    const pay = page.getByRole('dialog');
    await pay.getByLabel('Amount', { exact: true }).fill('1000');
    await pay.getByRole('button', { name: /Finish sale · give .* change/ }).click();
    await expect(page.getByText(/Sale INV-\d{6} complete/)).toBeVisible();
    const shown = page.getByLabel(/^Receipt INV-\d{6}/).first();
    await expect(shown).toContainText('Open daily 9 am – 9 pm');
    await expect(shown).toContainText('Cash given');
    const invoiceNo = ((await shown.getAttribute('aria-label')) ?? '').replace('Receipt ', '');
    await capturePrints(page);
    await page.getByRole('button', { name: 'Print receipt' }).click();
    const sale = await lastPrint(page);
    expect(sale).toMatchObject({ paperWidthMm: 58, copies: 2, logoLoaded: true });
    expect(sale.text).toContain(invoiceNo);
    expect(sale.text).toContain('Elizabethan collar (medium)');

    // Back to the defaults for the demo clinic.
    await page.goto('/settings/receipts');
    await page.waitForLoadState('networkidle');
    await page.getByRole('radio', { name: '80 mm' }).click();
    await page.getByRole('radio', { name: 'Branding logo' }).click();
    await page.locator('#rc-h').fill('');
    await page.locator('#rc-c').selectOption('1');
    await page.locator('#rc-lw').focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight'); // back to 55 %
    await expect(page.getByText('Logo size: 55% of the width')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Receipt settings saved')).toBeVisible();
  });
});
