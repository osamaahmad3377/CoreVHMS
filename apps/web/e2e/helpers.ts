import { expect, type Page } from '@playwright/test';

export const DEMO_PASSWORD = 'DemoVet2026!';

export async function login(page: Page, email = 'owner@demo.pk') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export const uniq = (p: string) => `${p}${Date.now().toString(36).slice(-5)}`;
