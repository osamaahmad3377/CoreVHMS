import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a running stack (API on :4000, web on :3000) seeded with demo data:
 *   npm run db:seed && npm run dev:api & npm run dev:web & npm run test:e2e -w @vcms/web
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
