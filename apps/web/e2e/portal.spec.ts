import { expect, test, type APIRequestContext } from '@playwright/test';
import { DEMO_PASSWORD, login } from './helpers';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/** Waits for the portal invitation email (sent by the background dispatcher via SMTP to Mailpit). */
async function inviteLink(request: APIRequestContext, email: string, since: number) {
  for (let i = 0; i < 40; i++) {
    const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const msgs = (await res.json()).messages as { ID: string; Created: string }[];
    const fresh = msgs.find((m) => new Date(m.Created).getTime() >= since - 5000);
    if (fresh) {
      const body = await (await request.get(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json();
      const m = (body.Text as string).match(/https?:\/\/[^\s]+\/portal\/accept\?token=[\w-]+/);
      if (m) return new URL(m[0]).pathname + new URL(m[0]).search;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Invitation email not received');
}

// The client portal is switched off by default; these run only with CLIENT_PORTAL_ENABLED=true
// (on the API, the web app and when seeding).
test.describe('Client portal', () => {
  test.skip(process.env.CLIENT_PORTAL_ENABLED !== 'true', 'Client portal is switched off');

  test('reception invites a client; the client sets a password from the email and signs in', async ({ page, browser, request }) => {
    await login(page, 'reception@demo.pk');
    await page.goto('/clients?q=Hussain');
    await page.getByRole('link', { name: /Zainab Hussain/ }).first().click();
    const since = Date.now();
    await page.getByRole('button', { name: /Invite to portal|Resend invitation/ }).click();
    await expect(page.getByText(/Invitation emailed to/)).toBeVisible();
    const path = await inviteLink(request, 'zainab.h@example.pk', since);

    const ctx = await browser.newContext();
    const portal = await ctx.newPage();
    await portal.goto(path);
    await portal.locator('#pa-pw').fill('Zainab-Portal-2026');
    await portal.locator('#pa-pw2').fill('Zainab-Portal-2026');
    await portal.getByRole('button', { name: 'Create account' }).click();
    await expect(portal.getByRole('heading', { name: /Hello Zainab/ })).toBeVisible();
    await expect(portal.getByText('My animals').first()).toBeVisible();
    await ctx.close();
  });

  test('client messages the clinic and requests an appointment; staff reply and decline', async ({ page, browser }) => {
    const ctx = await browser.newContext();
    const portal = await ctx.newPage();
    await portal.goto('/portal/login');
    await portal.locator('#pl-email').fill('client@demo.pk');
    await portal.locator('#pl-pw').fill(DEMO_PASSWORD);
    await portal.getByRole('button', { name: 'Sign in' }).click();
    await expect(portal).toHaveURL(/\/portal$/);
    await portal.goto('/portal/messages');
    await portal.getByLabel('Your message').fill('Is Sheru due for deworming? (E2E)');
    await portal.getByRole('button', { name: 'Send' }).click();
    await expect(portal.getByText('Message sent to the clinic')).toBeVisible();
    await portal.goto('/portal/appointments');
    await portal.getByRole('button', { name: 'Request appointment' }).click();
    await portal.locator('#rq-reason').fill('Deworming (E2E)');
    await portal.locator('#rq-date').fill(new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10));
    await portal.getByRole('button', { name: 'Send request' }).click();
    await expect(portal.getByText('Request sent')).toBeVisible();

    await login(page, 'reception@demo.pk');
    await page.goto('/communications?tab=inbox');
    await page.getByRole('button', { name: /Ahmed Khan/ }).click();
    await expect(page.getByText('Is Sheru due for deworming? (E2E)')).toBeVisible();
    await page.getByLabel('Reply').fill('Yes, please book a visit this week. (E2E)');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Yes, please book a visit this week. (E2E)')).toBeVisible();
    await page.goto('/communications?tab=requests');
    await page.getByRole('row', { name: /Deworming \(E2E\)/ }).getByRole('button', { name: 'Decline' }).click();
    await page.getByRole('dialog').locator('#confirm-reason').fill('Fully booked that day, please call us (E2E)');
    await page.getByRole('dialog').getByRole('button', { name: 'Decline' }).click();
    await expect(page.getByText('The client has been told in the portal')).toBeVisible();

    await portal.goto('/portal/messages');
    await expect(portal.getByText('Yes, please book a visit this week. (E2E)')).toBeVisible();
    await expect(portal.getByText(/Fully booked that day/)).toBeVisible();
    await ctx.close();
  });
});
