const { test, expect } = require('@playwright/test');

// Top Up page: the amount dial, paying with a saved card, safe retries and
// the recurring top up status. topup.php and recurring.php are faked with
// page.route, and every top up POST is recorded.

const VISA = { id: 3, brand: 'Visa', last4: '4242', exp_month: 8, exp_year: 2029 };

async function openTopUp(page, { cards = [VISA], balance = 5, mode = 'mock', reply, recurring = null } = {}) {
  const sent = [];
  await page.route('**/backend/auth/topup.php', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      return route.fulfill({ json: { logged_in: true, mode, balance, cards } });
    }
    const body = req.postDataJSON();
    sent.push(body);
    if (reply) return reply(route, body, sent.length);
    return route.fulfill({ json: {
      success: true, replayed: false, balance: balance + body.amount_cents / 100, card_saved: false, cards
    } });
  });
  await page.route('**/backend/auth/recurring.php', route => route.fulfill({
    json: { logged_in: true, success: true, recurring }
  }));
  await page.goto('/frontend/topup/topup.html');
  await expect(page.locator('#balance-display')).toHaveText(`€${balance.toFixed(2)}`);
  return sent;
}

const dial = page => page.getByRole('slider', { name: 'Top up amount' });

async function expectAmount(page, euros) {
  await expect(page.locator('#dial-amount')).toHaveText(`€${euros}.00`);
  await expect(dial(page)).toHaveAttribute('aria-valuenow', String(euros));
}

test('The dial starts at €10 and shows the balance after the top up', async ({ page }) => {
  await openTopUp(page, { balance: 5 });
  await expectAmount(page, 10);
  await expect(page.locator('#dial-after')).toHaveText('Balance will be €15.00');
  await expect(page.locator('#pay-btn')).toHaveText('Top up €10.00');
});

test('The dial can be set with the keyboard and stays between €5 and €100', async ({ page }) => {
  await openTopUp(page);
  await dial(page).focus();

  await page.keyboard.press('ArrowRight');
  await expectAmount(page, 15);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  await expectAmount(page, 5);
  await page.keyboard.press('ArrowLeft');      // can't go below the minimum
  await expectAmount(page, 5);

  await page.keyboard.press('PageUp');         // four steps at a time
  await expectAmount(page, 25);
  await page.keyboard.press('PageDown');
  await expectAmount(page, 5);

  await page.keyboard.press('End');
  await expectAmount(page, 100);
  await page.keyboard.press('ArrowUp');        // can't go above the maximum
  await expectAmount(page, 100);
  await expect(page.locator('#pay-btn')).toHaveText('Top up €100.00');

  await page.keyboard.press('Home');
  await expectAmount(page, 5);
});

test('With no saved cards the Top up button is disabled', async ({ page }) => {
  await openTopUp(page, { cards: [] });
  await expect(page.locator('#card-list')).toHaveText('No saved cards yet.');
  await expect(page.locator('#pay-btn')).toBeDisabled();
});

test('Paying with a saved card sends the card and a payment key, then opens the card page', async ({ page }) => {
  const sent = await openTopUp(page, { balance: 5 });
  await dial(page).focus();
  await page.keyboard.press('ArrowRight');     // €15
  await page.locator('#pay-btn').click();

  await expect(page.locator('#message')).toHaveText('Added €15.00 to your card.');
  await expect(page.locator('#balance-display')).toHaveText('€20.00');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ action: 'top_up', amount_cents: 1500, source: 'saved_card', card_id: 3 });
  expect(sent[0].idempotency_key).toMatch(/^[0-9a-f]{32}$/);

  await page.waitForURL('**/frontend/card/card.html');
});

test('A failed top up is retried with the same key, a new amount gets a new key', async ({ page }) => {
  const sent = await openTopUp(page, {
    reply: route => route.fulfill({ status: 500, json: {
      success: false, error: 'Top up failed, you have not been charged'
    } })
  });

  await page.locator('#pay-btn').click();
  await expect(page.locator('#message')).toHaveText('Top up failed, you have not been charged');
  await expect(page.locator('#message')).toHaveClass(/err/);
  await expect(page.locator('#pay-btn')).toBeEnabled();

  await page.locator('#pay-btn').click();      // retry
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].idempotency_key).toBe(sent[0].idempotency_key);
  await expect(page.locator('#pay-btn')).toBeEnabled();   // the dial ignores keys while a payment is in flight

  await dial(page).focus();
  await page.keyboard.press('ArrowRight');     // a different top up
  await expectAmount(page, 15);
  await page.locator('#pay-btn').click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2].amount_cents).toBe(1500);
  expect(sent[2].idempotency_key).not.toBe(sent[0].idempotency_key);
});

test('A top up the server already applied is not reported twice', async ({ page }) => {
  await openTopUp(page, {
    reply: route => route.fulfill({ json: { success: true, replayed: true, balance: 15, cards: [VISA] } })
  });
  await page.locator('#pay-btn').click();
  await expect(page.locator('#message')).toHaveText('That top up was already applied.');
});

test('Demo mode shows the note and the demo wallet button', async ({ page }) => {
  await openTopUp(page, { mode: 'mock' });
  await expect(page.locator('#mode-note')).toHaveText('Demo mode: no real payments are taken.');
  await expect(page.getByRole('button', { name: 'Pay with wallet (demo)' })).toBeVisible();
});

test('Outside demo mode the demo wallet is hidden', async ({ page }) => {
  await openTopUp(page, { mode: 'live' });
  await expect(page.locator('#mode-note')).toBeHidden();
  await expect(page.locator('#wallet-btn')).toBeHidden();
});

test('An existing recurring top up is summarised with a Manage link', async ({ page }) => {
  await openTopUp(page, { recurring: {
    amount: 5, interval_label: 'Every week', next_run_date: '2026-11-13', enabled: true
  } });
  await expect(page.locator('#recurring-status')).toHaveText(/^€5\.00 every week\. Next top up: Fri,? 13 Nov\.$/);   // comma varies by ICU version
  await expect(page.locator('#recurring-link')).toHaveText('Manage recurring top up');
});

test('A recurring top up that is turned off says so', async ({ page }) => {
  await openTopUp(page, { recurring: {
    amount: 20, interval_label: 'Every month', next_run_date: '2026-12-01', enabled: false
  } });
  await expect(page.locator('#recurring-status')).toHaveText('€20.00 every month is turned off.');
});

test('Not logged in goes to the login page', async ({ page }) => {
  await page.route('**/backend/auth/topup.php', route => route.fulfill({ json: { logged_in: false } }));
  await page.goto('/frontend/topup/topup.html');
  await page.waitForURL('**/frontend/auth/index.html');
});

test('A load error asks the person to refresh', async ({ page }) => {
  await page.route('**/backend/auth/topup.php', route => route.fulfill({
    status: 500, json: { logged_in: true, error: 'Database error' }
  }));
  await page.goto('/frontend/topup/topup.html');
  await expect(page.locator('#message')).toHaveText("Couldn't load your cards. Please refresh the page.");
});
