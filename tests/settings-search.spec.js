const { test, expect } = require('@playwright/test');

// Search in Settings (SCRUM-127): frontend/setting/settings-search.js.
// The PHP backend is faked so the page loads like for a logged-in user.

async function openSettings(page) {
  await page.route('**/backend/auth/session.php', r => r.fulfill({ json: {
    logged_in: true, f_name: 'Test', l_name: 'User', email: 'test@example.com', card_type: 'Student',
    card_number: '12345678', card_status: 'active', wallet_balance: 10 } }));
  await page.route('**/backend/auth/topup.php', r => r.fulfill({ json: { logged_in: true, mode: 'mock', balance: 10, cards: [] } }));
  await page.route('**/backend/auth/user_settings.php', r => r.fulfill({ json: { logged_in: true, success: true } }));
  await page.route('**/backend/auth/*.php', r => r.fallback());
  await page.goto('/frontend/setting/setting.html');
}

const search = page => page.getByRole('searchbox', { name: 'Search settings' });
const results = page => page.locator('#settings-search-results .settings-result');

test('A search bar is available in Settings', async ({ page }) => {
  await openSettings(page);
  await expect(search(page)).toBeVisible();
  await expect(results(page)).toHaveCount(0);
  await expect(page.locator('#settings-search-empty')).toBeHidden();
});

test('Typing a keyword shows matching settings', async ({ page }) => {
  await openSettings(page);
  await search(page).fill('freeze');
  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first()).toContainText('Freeze or unfreeze card');
  await expect(results(page).first()).toContainText('Card settings');

  await search(page).fill('topup');            // "topup" also finds "top up"
  await expect(results(page).filter({ hasText: 'Automatic top up amount' })).toHaveCount(1);
});

test('Choosing a result jumps to that setting', async ({ page }) => {
  await openSettings(page);
  await expect(page.locator('#card-status-button')).toBeEnabled();
  await search(page).fill('freeze');
  await results(page).first().click();
  await expect(page.locator('#card-status-button')).toBeFocused();
  await expect(page.locator('.settings-panel', { has: page.locator('#card-status-button') })).toHaveClass(/search-highlight/);
});

test('A setting that is switched off still gets highlighted', async ({ page }) => {
  await openSettings(page);   // no saved cards, so the top up controls are disabled
  await expect(page.locator('#auto-topup-amount')).toBeDisabled();
  await search(page).fill('amount');
  await results(page).filter({ hasText: 'Automatic top up amount' }).click();
  const panel = page.locator('.settings-panel', { has: page.locator('#auto-topup-amount') });
  await expect(panel).toHaveClass(/search-highlight/);
  await expect(panel).toBeFocused();
});

test('A result on another page opens that page', async ({ page }) => {
  await openSettings(page);
  await search(page).fill('recurring');
  await results(page).first().click();
  await expect(page).toHaveURL(/recurring\/recurring\.html$/);
});

test('A message appears if no settings match', async ({ page }) => {
  await openSettings(page);
  await search(page).fill('zzzz');
  await expect(page.locator('#settings-search-empty')).toHaveText('No settings match "zzzz".');
  await expect(results(page)).toHaveCount(0);
  await search(page).fill('');
  await expect(page.locator('#settings-search-empty')).toBeHidden();
});
