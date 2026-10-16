import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { login, uniq } from './helpers';

test.describe('Privacy requests and audit export', () => {
  test('manager downloads a client’s data, anonymises the client, and finds both in the exported audit log', async ({ page }) => {
    await login(page, 'manager@demo.pk');
    const surname = uniq('Privacy');

    await page.goto('/clients/new');
    await page.getByLabel('First name').fill('Sana');
    await page.locator('#lastName').fill(surname);
    await page.getByLabel('Mobile').fill(`0301 ${Math.floor(1000000 + Math.random() * 8999999)}`);
    await page.locator('#a1').fill('House 1, Street 2');
    await page.getByLabel('City / town / village').fill('Lahore');
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(surname) })).toBeVisible();

    // Access request: one JSON file with everything held about the client.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download all data (JSON)' }).click()]);
    const data = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(data.format).toBe('nextcore-vcms/client-export');
    expect(data.client.lastName).toBe(surname);

    // Erasure request: a reason is required, then personal details are gone.
    await page.getByRole('button', { name: 'Anonymise on request' }).click();
    const confirmButton = page.getByRole('button', { name: 'Anonymise permanently' });
    await expect(confirmButton).toBeDisabled();
    await page.getByLabel(/Reference to the client’s request/).fill('Email request, ref E2E');
    await confirmButton.click();
    await expect(page.getByText('Client anonymised')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Anonymised client C-/ })).toBeVisible();
    await expect(page.getByText(surname)).toHaveCount(0);
    await expect(page.getByText('Personal details were removed on request.')).toBeVisible();

    // Both requests are in the audit log, and the filtered log can be exported.
    await page.goto('/audit');
    await page.getByLabel('Action').selectOption({ label: 'Privacy requests' });
    await expect(page).toHaveURL(/action=client\.data_exported/);
    await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', /action=client\.data_exported%2Cclient\.anonymised/);
    await expect(page.getByText('client.created')).toHaveCount(0);
    await expect(page.getByText('client.anonymised').first()).toBeVisible();
    await expect(page.getByText('client.data_exported').first()).toBeVisible();
    await expect(page.getByText(/Email request, ref E2E/).first()).toBeVisible();
    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV' }).click()]);
    const text = await readFile((await csv.path())!, 'utf8');
    expect(text.split(/\r?\n/)[0]).toBe('createdAt,actorName,actorUserId,action,entityType,entityId,summary,changes,ip,userAgent,requestId,branchId,id');
    expect(text).toContain('client.anonymised');
    expect(text).not.toContain('client.created');
  });

  test('reception does not get the privacy tools', async ({ page }) => {
    await login(page, 'reception@demo.pk');
    await page.goto('/clients?q=Khan');
    await page.getByRole('link', { name: /Khan/ }).first().click();
    await expect(page.getByRole('heading', { name: /Khan/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download all data (JSON)' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Anonymise on request' })).toHaveCount(0);
  });
});
