import { expect, type Browser, type Page } from '@playwright/test';

export const DEMO_PASSWORD = 'DemoVet2026!';

export async function login(page: Page, email = 'owner@demo.pk') {
  await page.goto('/login');
  // Wait until the page is interactive: on a busy dev server a click before hydration is lost.
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export const uniq = (p: string) => `${p}${Date.now().toString(36).slice(-5)}`;

/**
 * Demo stock runs out after many test runs. Makes sure the product with this code has at least `min` on hand at
 * the signed-in user's branch by recording a small delivery (bought locally, no batch) — signs in as the owner in
 * a separate browser context so the test's own session is untouched.
 */
export async function ensureStock(browser: Browser, code: string, min = 5) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, 'owner@demo.pk');
  const csrf = (await ctx.cookies()).find((c) => c.name === 'vcms_csrf')?.value ?? '';
  const headers = { 'X-CSRF-Token': csrf, Origin: new URL(page.url()).origin };
  const cat = await (await page.request.get(`/api/v1/pos/catalog?q=${encodeURIComponent(code)}`)).json();
  const item = cat.exact ?? cat.items?.[0];
  if (item && (item.available ?? 0) < min) {
    const session = await (await page.request.get('/api/v1/auth/session')).json();
    const locations: { id: string; branchId: string; isDefault: boolean; isActive: boolean }[] = await (await page.request.get('/api/v1/stock-locations')).json();
    const here = locations.filter((l) => l.isActive && l.branchId === session.branch?.id);
    const loc = here.find((l) => l.isDefault) ?? here[0];
    const res = await page.request.post('/api/v1/stock/receipts', { headers, data: { locationId: loc?.id, lines: [{ productId: item.id, quantity: min * 4, unitCostMinor: 100 }] } });
    expect(res.ok(), `top up ${code}: ${res.status()} ${await res.text()}`).toBeTruthy();
  }
  await ctx.close();
}
