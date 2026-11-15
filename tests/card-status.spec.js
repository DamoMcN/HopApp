const { test, expect } = require('@playwright/test');

// Card actions on the card page: freeze, unfreeze, report lost / stolen.
// session.php, transactions.php and card_status.php are faked with page.route,
// and every card_status.php POST is recorded.

const NEXT_STATUS = {
  freeze: 'frozen', unfreeze: 'active', report_lost: 'reported_lost', report_stolen: 'reported_stolen'
};

async function openCard(page, { status = 'active', reply } = {}) {
  const sent = [];
  await page.route('**/backend/auth/session.php', route => route.fulfill({ json: {
    logged_in: true, f_name: 'Test', card_type: 'Adult', card_number: '12345678',
    card_status: status, card_expiry: '2031-11-30', wallet_balance: 12.5
  } }));
  await page.route('**/backend/auth/transactions.php', route => route.fulfill({
    json: { logged_in: true, transactions: [] }
  }));
  await page.route('**/backend/auth/card_status.php', async (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    if (reply) return reply(route, body);
    return route.fulfill({ json: { success: true, card_status: NEXT_STATUS[body.action] } });
  });
  await page.goto('/frontend/card/card.html');
  await expect(page.locator('#user-name')).toHaveText('Test');
  return sent;
}

const card = page => page.locator('#active-hop-card');
const menu = page => page.locator('#card-menu');

async function chooseAction(page, name) {
  await card(page).click();
  await expect(menu(page)).toHaveClass(/is-open/);
  await page.getByRole('menuitem', { name }).click();
}

test('Pressing the card opens the actions menu, pressing elsewhere closes it', async ({ page }) => {
  await openCard(page);
  await card(page).click();
  await expect(menu(page)).toHaveClass(/is-open/);
  await expect(card(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menuitem')).toHaveText(['Freeze card', 'Report lost', 'Report stolen']);

  await page.locator('.app-header h1').click();   // the open menu covers the transactions
  await expect(menu(page)).not.toHaveClass(/is-open/);
  await expect(card(page)).toHaveAttribute('aria-expanded', 'false');
});

test('A card can be frozen and unfrozen', async ({ page }) => {
  const sent = await openCard(page);

  await chooseAction(page, 'Freeze card');
  await expect(page.locator('#card-message')).toHaveText('Card frozen.');
  await expect(card(page)).toHaveClass(/is-frozen/);
  await expect(page.locator('#frozen-badge')).toHaveText('Frozen');

  await chooseAction(page, 'Unfreeze card');
  await expect(page.locator('#card-message')).toHaveText('Card unfrozen.');
  await expect(card(page)).not.toHaveClass(/is-frozen/);

  expect(sent).toEqual([{ action: 'freeze' }, { action: 'unfreeze' }]);
});

test('A card that loads frozen offers "Unfreeze card"', async ({ page }) => {
  await openCard(page, { status: 'frozen' });
  await expect(card(page)).toHaveClass(/is-frozen/);
  await card(page).click();
  await expect(page.getByRole('menuitem').first()).toHaveText('Unfreeze card');
});

test('Cancelling a report sends nothing', async ({ page }) => {
  const sent = await openCard(page);
  await chooseAction(page, 'Report lost');

  const dialog = page.locator('#report-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#report-title')).toHaveText('Report card as lost?');
  await expect(page.locator('#report-text')).toContainText('freeze it instead');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).not.toBeVisible();
  expect(sent).toHaveLength(0);
});

test('Reporting a card lost blocks it for good', async ({ page }) => {
  const sent = await openCard(page);
  await chooseAction(page, 'Report lost');
  await page.getByRole('button', { name: 'Report lost' }).click();

  await expect(page.locator('#report-dialog')).not.toBeVisible();
  await expect(page.locator('#card-message'))
    .toHaveText('Card reported lost. Contact Help & Support for a replacement.');
  await expect(page.locator('#frozen-badge')).toHaveText('Reported lost');
  expect(sent).toEqual([{ action: 'report_lost' }]);

  // The menu no longer offers any actions
  await card(page).click();
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  await expect(menu(page)).toContainText('This card was reported lost.');
});

test('Reporting a card stolen mentions the police', async ({ page }) => {
  const sent = await openCard(page);
  await chooseAction(page, 'Report stolen');
  await expect(page.locator('#report-title')).toHaveText('Report card as stolen?');
  await expect(page.locator('#report-text')).toContainText('police');
  await page.getByRole('button', { name: 'Report stolen' }).click();
  await expect(page.locator('#frozen-badge')).toHaveText('Reported stolen');
  expect(sent).toEqual([{ action: 'report_stolen' }]);
});

test('A failed report keeps the dialog open with the reason', async ({ page }) => {
  await openCard(page, {
    reply: route => route.fulfill({ status: 409, json: {
      success: false, card_status: 'active', error: 'The card status could not be changed'
    } })
  });
  await chooseAction(page, 'Report lost');
  await page.getByRole('button', { name: 'Report lost' }).click();

  await expect(page.locator('#report-error')).toHaveText('The card status could not be changed');
  await expect(page.locator('#report-dialog')).toBeVisible();
  await expect(page.locator('#report-confirm')).toBeEnabled();
  await expect(page.locator('#report-cancel')).toBeEnabled();
});

test('A card that was already reported shows no actions', async ({ page }) => {
  await openCard(page, { status: 'reported_stolen' });
  await expect(page.locator('#frozen-badge')).toHaveText('Reported stolen');
  await expect(card(page)).toHaveAttribute('aria-label', /Reported stolen/);
  await card(page).click();
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  await expect(menu(page)).toContainText('Contact Help & Support for a replacement.');
});

test('Freeze errors are shown under the card', async ({ page }) => {
  await openCard(page, {
    reply: route => route.fulfill({ status: 500, json: { success: false, error: 'Database error' } })
  });
  await chooseAction(page, 'Freeze card');
  await expect(page.locator('#card-message')).toHaveText('Database error');
  await expect(page.locator('#card-message')).toHaveClass(/err/);
});

test('The card menu works with the keyboard', async ({ page }) => {
  await openCard(page);
  await card(page).focus();

  await page.keyboard.press('Enter');
  await expect(menu(page)).toHaveClass(/is-open/);
  await expect(page.getByRole('menuitem', { name: 'Freeze card' })).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Report lost' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Report stolen' })).toBeFocused();
  await page.keyboard.press('ArrowDown');   // wraps round to the top
  await expect(page.getByRole('menuitem', { name: 'Freeze card' })).toBeFocused();
  await page.keyboard.press('ArrowUp');     // and back to the bottom
  await expect(page.getByRole('menuitem', { name: 'Report stolen' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('menuitem', { name: 'Freeze card' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menu(page)).not.toHaveClass(/is-open/);
  await expect(card(page)).toBeFocused();
});

test('Being logged out during an action goes to the login page', async ({ page }) => {
  await openCard(page, { reply: route => route.fulfill({ json: { logged_in: false } }) });
  await chooseAction(page, 'Freeze card');
  await page.waitForURL('**/frontend/auth/index.html');
});
