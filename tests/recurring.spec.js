// Recurring top up page.
// The test server can't run PHP, so page.route() answers recurring.php instead.

const { test, expect } = require('@playwright/test');

const TODAY = '2026-11-06';   // a Friday

const WEEKLY_FIVE = {
  amount: 5, interval: 'weekly', interval_label: 'Every week', pay_with: 'Visa •••• 4242',
  card_id: 7, start_date: TODAY, next_run_date: '2026-11-13', enabled: true
};

// Fake server: remembers the recurring top up and records every POST
async function mockApi(page, recurring) {
  const posts = [];
  await page.route('**/backend/auth/recurring.php', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      posts.push(body);
      if (body.action === 'save') recurring = { ...WEEKLY_FIVE, amount: body.amount_cents / 100 };
      if (body.action === 'set_enabled') recurring = { ...recurring, enabled: body.enabled };
      if (body.action === 'cancel') recurring = null;
    }
    await route.fulfill({ json: {
      logged_in: true, success: true, today: TODAY, balance: 12.5, added_now: 1,
      cards: [{ id: 7, label: 'Visa •••• 4242' }], recurring
    } });
  });
  return posts;
}

test('Top Up page links to the recurring top up page', async ({ page }) => {
  await page.goto('/frontend/topup/topup.html');
  await expect(page.getByRole('link', { name: 'Set up a recurring payment today' }))
    .toHaveAttribute('href', '../recurring/recurring.html');
});

test('Settings are reviewed before they are saved', async ({ page }) => {
  const posts = await mockApi(page, null);
  await page.goto('/frontend/recurring/recurring.html');

  await page.getByText('€10', { exact: true }).click();
  await page.getByText('Every 2 weeks', { exact: true }).click();
  await expect(page.locator('#schedule-hint')).toHaveText('First top up today, then every other Friday.');

  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.locator('#review-amount')).toHaveText('€10.00');
  await expect(page.locator('#review-interval')).toHaveText('Every 2 weeks');
  await expect(page.locator('#review-pay')).toHaveText('Visa •••• 4242');
  expect(posts).toHaveLength(0);   // nothing saved yet

  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('#review-title')).toHaveText('Recurring top up set up');
  expect(posts[0]).toEqual({ action: 'save', amount_cents: 1000, interval: 'fortnightly', start_date: TODAY, card_id: 7 });
});

test('A recurring top up can be turned off and on', async ({ page }) => {
  const posts = await mockApi(page, WEEKLY_FIVE);
  await page.goto('/frontend/recurring/recurring.html');

  await page.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.locator('#summary-next')).toHaveText('Turned off');
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.locator('#status')).toHaveText('On');
  expect(posts).toEqual([{ action: 'set_enabled', enabled: false }, { action: 'set_enabled', enabled: true }]);
});

test('Change opens the form with the current settings', async ({ page }) => {
  await mockApi(page, WEEKLY_FIVE);
  await page.goto('/frontend/recurring/recurring.html');

  await page.getByRole('button', { name: 'Change' }).click();
  await expect(page.locator('input[name="amount"][value="500"]')).toBeChecked();
  await expect(page.locator('input[name="interval"][value="weekly"]')).toBeChecked();
});

test('A recurring top up can be cancelled', async ({ page }) => {
  const posts = await mockApi(page, WEEKLY_FIVE);
  await page.goto('/frontend/recurring/recurring.html');

  await page.getByRole('button', { name: 'Cancel recurring top up' }).click();
  await page.getByRole('button', { name: 'Yes, cancel it' }).click();
  await expect(page.locator('#setup-form')).toBeVisible();
  expect(posts[0]).toEqual({ action: 'cancel' });
});
