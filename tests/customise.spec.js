const { test, expect } = require('@playwright/test');

// Settings > Customise app: choose and order the buttons in the bottom bar, pick the start page, and
// check the saved choice is used on the other pages, at login and when the app opens.
// nav_settings.php is faked with page.route; every POST is recorded.

const DEFAULT_TABS = ['card', 'topup', 'map', 'tickets'];

async function openCustomise(page, { tabs = DEFAULT_TABS, start = 'card', saveError } = {}) {
  const sent = [];
  let current = { tabs, start_page: start };
  await page.route('**/backend/auth/nav_settings.php', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { logged_in: true, ...current } });
    const body = route.request().postDataJSON();
    sent.push(body);
    if (saveError) return route.fulfill({ status: 422, json: { error: saveError } });
    current = { tabs: body.tabs, start_page: body.start_page };
    return route.fulfill({ json: { success: true, ...current } });
  });
  await page.goto('/frontend/setting/customise.html');
  return sent;
}

const inRows = page => page.locator('#in-list .nav-row .nav-row-name');
const outRows = page => page.locator('#out-list .nav-row .nav-row-name');
const previewLabels = page => page.locator('#preview .bottom-nav-label');
const barLabels = page => page.locator('.bottom-nav .bottom-nav-label');
const sw = (page, name) => page.getByRole('switch', { name: 'Show ' + name + ' in the bar' });

// ---------- The screen ----------

test('Shows the bar as it is now, with Help available to add', async ({ page }) => {
  await openCustomise(page);
  await expect(page.getByRole('heading', { name: 'Customise app' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Navigation bar' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#in-title')).toHaveText('In your bar · 4 of 5');
  await expect(inRows(page)).toHaveText(['Card', 'Top Up', 'Map', 'Tickets']);
  await expect(outRows(page)).toHaveText(['Help']);
  await expect(previewLabels(page)).toHaveText(['Card', 'Top Up', 'Map', 'Tickets']);
  await expect(page.locator('#save')).toBeDisabled();
});

test('Card and Top Up are locked in the bar, the others can be taken out', async ({ page }) => {
  await openCustomise(page);
  await expect(sw(page, 'Card')).toBeDisabled();
  await expect(sw(page, 'Top Up')).toBeDisabled();
  await expect(sw(page, 'Map')).toBeEnabled();
  await expect(sw(page, 'Tickets')).toBeEnabled();
  await expect(page.getByRole('img', { name: 'Always in the bar' })).toHaveCount(2);
});

test('Taking a button out moves it to Not in your bar and updates the preview', async ({ page }) => {
  await openCustomise(page);
  await sw(page, 'Map').click();
  await expect(page.locator('#in-title')).toHaveText('In your bar · 3 of 5');
  await expect(inRows(page)).toHaveText(['Card', 'Top Up', 'Tickets']);
  await expect(outRows(page)).toHaveText(['Map', 'Help']);
  await expect(previewLabels(page)).toHaveText(['Card', 'Top Up', 'Tickets']);
  await expect(page.locator('#save')).toBeEnabled();
});

test('Adding a button puts it at the end of the bar', async ({ page }) => {
  await openCustomise(page);
  await sw(page, 'Help').click();
  await expect(inRows(page)).toHaveText(['Card', 'Top Up', 'Map', 'Tickets', 'Help']);
  await expect(page.locator('#in-title')).toHaveText('In your bar · 5 of 5');
  await expect(page.locator('#out-group')).toBeHidden();
  await expect(previewLabels(page)).toHaveText(['Card', 'Top Up', 'Map', 'Tickets', 'Help']);
});

test('The arrows reorder the bar, and the end ones are off', async ({ page }) => {
  await openCustomise(page);
  await expect(page.getByRole('button', { name: 'Move Card up' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move Tickets down' })).toBeDisabled();

  await page.getByRole('button', { name: 'Move Map up' }).click();
  await expect(inRows(page)).toHaveText(['Card', 'Map', 'Top Up', 'Tickets']);
  await expect(previewLabels(page)).toHaveText(['Card', 'Map', 'Top Up', 'Tickets']);
  await expect(page.getByRole('button', { name: 'Move Map up' })).toBeFocused();   // keeps your place

  await page.getByRole('button', { name: 'Move Card down' }).click();
  await expect(inRows(page)).toHaveText(['Map', 'Card', 'Top Up', 'Tickets']);
});

test('A button can be dragged to a new place by its handle', async ({ page }) => {
  await openCustomise(page);
  const grip = page.locator('#in-list .nav-row[data-tab="map"] .nav-grip');
  const box = await grip.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 30, { steps: 4 });
  await page.mouse.move(x, y + 64, { steps: 4 });
  await page.mouse.up();
  await expect(inRows(page)).toHaveText(['Card', 'Top Up', 'Tickets', 'Map']);
  await expect(previewLabels(page)).toHaveText(['Card', 'Top Up', 'Tickets', 'Map']);
  await expect(page.locator('#save')).toBeEnabled();
});

// ---------- Saving ----------

test('Save sends the bar and start page, and the real bar changes', async ({ page }) => {
  const sent = await openCustomise(page);
  await sw(page, 'Tickets').click();
  await sw(page, 'Help').click();
  await page.getByRole('button', { name: 'Move Help up' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.locator('#customise-message')).toContainText('Saved');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toEqual({ tabs: ['card', 'topup', 'support', 'map'], start_page: 'card' });
  await expect(barLabels(page)).toHaveText(['Card', 'Top Up', 'Help', 'Map']);
  await expect(page.locator('#save')).toBeDisabled();
});

test('A save the server refuses says why and keeps the choice', async ({ page }) => {
  await openCustomise(page, { saveError: 'Card and Top Up always stay in the bar.' });
  await sw(page, 'Map').click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('#customise-message')).toHaveText('Card and Top Up always stay in the bar.');
  await expect(page.locator('#customise-message')).toHaveClass(/is-error/);
  await expect(inRows(page)).toHaveText(['Card', 'Top Up', 'Tickets']);
  await expect(page.locator('#save')).toBeEnabled();
});

test('Reset goes back to the default bar and start page, but only saves when asked', async ({ page }) => {
  const sent = await openCustomise(page, { tabs: ['card', 'topup', 'support'], start: 'support' });
  await expect(inRows(page)).toHaveText(['Card', 'Top Up', 'Help']);
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(inRows(page)).toHaveText(['Card', 'Top Up', 'Map', 'Tickets']);
  await expect(page.locator('#customise-message')).toContainText('Press Save changes');
  expect(sent).toHaveLength(0);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('#customise-message')).toContainText('Saved');
  expect(sent[0]).toEqual({ tabs: DEFAULT_TABS, start_page: 'card' });
});

// ---------- Start page ----------

test('The start page tab lists every page, with Card as the default', async ({ page }) => {
  await openCustomise(page);
  await page.getByRole('tab', { name: 'Start page' }).click();
  await expect(page.locator('#panel-start')).toBeVisible();
  await expect(page.locator('#panel-bar')).toBeHidden();
  await expect(page.getByRole('radio')).toHaveCount(5);
  await expect(page.getByRole('radio', { name: /Card/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: /Help/ })).toContainText('Not in your bar');
});

test('Choosing a start page is saved, and a page outside the bar can be chosen', async ({ page }) => {
  const sent = await openCustomise(page);
  await page.getByRole('tab', { name: 'Start page' }).click();
  await page.getByRole('radio', { name: /Help/ }).click();
  await expect(page.getByRole('radio', { name: /Help/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: /Card/ })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('#customise-message')).toContainText('Saved');
  expect(sent[0].start_page).toBe('support');
  expect(sent[0].tabs).toEqual(DEFAULT_TABS);
});

test('The arrow keys move through the start pages', async ({ page }) => {
  await openCustomise(page);
  await page.getByRole('tab', { name: 'Start page' }).click();
  await page.getByRole('radio', { name: /Card/ }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: /Top Up/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: /Top Up/ })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('radio', { name: /Help/ })).toHaveAttribute('aria-checked', 'true');
});

test('The preview marks the start page when it is in the bar', async ({ page }) => {
  await openCustomise(page);
  await expect(page.locator('#preview [aria-current="page"]')).toHaveText('Card');
  await page.getByRole('tab', { name: 'Start page' }).click();
  await page.getByRole('radio', { name: /Map/ }).click();
  await expect(page.locator('#preview [aria-current="page"]')).toHaveText('Map');
});

// ---------- The bar fills the width ----------

for (const tabs of [['card', 'topup'], ['card', 'topup', 'map'], ['card', 'topup', 'map', 'tickets', 'support']]) {
  test('The bar with ' + tabs.length + ' buttons fills its whole width', async ({ page }) => {
    await openCustomise(page, { tabs });
    await expect(page.locator('.bottom-nav-inner .bottom-nav-item')).toHaveCount(tabs.length);
    const widths = await page.locator('.bottom-nav-inner .bottom-nav-item').evaluateAll(
      items => items.map(i => i.getBoundingClientRect().width));
    const inner = await page.locator('.bottom-nav-inner').evaluate(e => e.getBoundingClientRect().width);
    expect(widths.reduce((a, b) => a + b, 0)).toBeGreaterThan(inner - 2);
    widths.forEach(w => expect(Math.abs(w - widths[0])).toBeLessThan(1.5));
  });
}

// ---------- The saved choice is used everywhere ----------

test('Other pages show the saved bar', async ({ page }) => {
  await page.route('**/backend/auth/nav_settings.php', route => route.fulfill({
    json: { logged_in: true, tabs: ['support', 'topup', 'tickets'], start_page: 'card' }
  }));
  await page.goto('/frontend/tickets/tickets.html');
  // Card and Top Up always stay, so Card is put back at the front
  await expect(barLabels(page)).toHaveText(['Card', 'Help', 'Top Up', 'Tickets']);
});

test('The bar draws from this device at once, before the server answers', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hop.nav', JSON.stringify({ tabs: ['card', 'topup', 'tickets'], startPage: 'card' })));
  await page.route('**/backend/auth/nav_settings.php', route => route.abort());
  await page.goto('/frontend/tickets/tickets.html');
  await expect(barLabels(page)).toHaveText(['Card', 'Top Up', 'Tickets']);
});

test('Without a saved choice the default bar shows', async ({ page }) => {
  await page.route('**/backend/auth/nav_settings.php', route => route.fulfill({ status: 401, json: { logged_in: false } }));
  await page.goto('/frontend/tickets/tickets.html');
  await expect(barLabels(page)).toHaveText(['Card', 'Top Up', 'Map', 'Tickets']);
});

test('Logging out forgets the saved bar on this device', async ({ page }) => {
  await page.route('**/backend/auth/nav_settings.php', route => route.abort());
  await page.goto('/frontend/tickets/tickets.html');
  await page.evaluate(() => localStorage.setItem('hop.nav', JSON.stringify({ tabs: ['card', 'topup'], startPage: 'map' })));
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('button', { name: 'Log Out' }).click();
  await page.waitForURL('**/frontend/auth/index.html');
  expect(await page.evaluate(() => localStorage.getItem('hop.nav'))).toBeNull();
});

// ---------- The start page ----------

test('Logging in opens the start page that was chosen', async ({ page }) => {
  await page.route('**/backend/auth/login.php', route => route.fulfill({ json: { success: true } }));
  await page.route('**/backend/auth/nav_settings.php', route => route.fulfill({
    json: { logged_in: true, tabs: DEFAULT_TABS, start_page: 'tickets' }
  }));
  await page.goto('/frontend/auth/index.html');
  await page.fill('#login-email', 'test@example.com');
  await page.fill('#login-password', 'Secret123!');
  await page.getByRole('button', { name: 'Log In' }).click();
  await page.waitForURL('**/frontend/tickets/tickets.html');
});

test('If the start page cannot be found, logging in opens the card page', async ({ page }) => {
  await page.route('**/backend/auth/login.php', route => route.fulfill({ json: { success: true } }));
  await page.route('**/backend/auth/nav_settings.php', route => route.fulfill({
    json: { logged_in: true, tabs: DEFAULT_TABS, start_page: '../../evil.html' }
  }));
  await page.goto('/frontend/auth/index.html');
  await page.fill('#login-email', 'test@example.com');
  await page.fill('#login-password', 'Secret123!');
  await page.getByRole('button', { name: 'Log In' }).click();
  await page.waitForURL('**/frontend/card/card.html');
});

test('Opening the app while logged in goes straight to the start page', async ({ page }) => {
  await page.route('**/backend/auth/session.php', route => route.fulfill({ json: { logged_in: true } }));
  await page.route('**/backend/auth/nav_settings.php', route => route.fulfill({
    json: { logged_in: true, tabs: DEFAULT_TABS, start_page: 'topup' }
  }));
  await page.goto('/frontend/auth/index.html');
  await page.waitForURL('**/frontend/topup/topup.html');
});

test('Someone who is not logged in stays on the login page', async ({ page }) => {
  await page.route('**/backend/auth/session.php', route => route.fulfill({ json: { logged_in: false } }));
  await page.goto('/frontend/auth/index.html');
  await expect(page.locator('#login-form')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/auth\/index\.html$/);
});

// ---------- Where it lives ----------

test('Settings has a Customise app button that opens this screen', async ({ page }) => {
  await page.route('**/backend/**', route => route.abort());
  await page.goto('/frontend/setting/setting.html');
  const link = page.getByRole('link', { name: 'Customise app' });
  await expect(link).toHaveAttribute('href', 'customise.html');
  await link.click();
  await page.waitForURL('**/frontend/setting/customise.html');
  await expect(page.getByRole('heading', { name: 'Customise app' })).toBeVisible();
});

test('The back button on Customise app goes back to Settings', async ({ page }) => {
  await openCustomise(page);
  await page.getByRole('link', { name: 'Back to Settings' }).click();
  await page.waitForURL('**/frontend/setting/setting.html');
});
