const { test, expect } = require('@playwright/test');

// Card Expiry (SCRUM-77 Card Management). The PHP backend isn't running in
// these tests, so session.php and transactions.php are faked with page.route.

function isoDate(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

async function openCard(page, cardExpiry) {
  await page.route('**/backend/auth/session.php', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      logged_in: true, f_name: 'Test', card_type: 'Student', card_number: '12345678',
      card_status: 'active', card_expiry: cardExpiry, wallet_balance: 12.5
    })
  }));
  await page.route('**/backend/auth/transactions.php', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ logged_in: true, transactions: [] })
  }));
  await page.goto('/frontend/card/card.html');
  await expect(page.locator('#user-name')).toHaveText('Test');
}

test('Card shows the expiry date, clearly labelled', async ({ page }) => {
  await openCard(page, '2031-11-30');
  await expect(page.locator('.card-expiry-label')).toHaveText('Valid until');
  await expect(page.locator('#card-expiry-display')).toHaveText('11/31');
  await expect(page.locator('#card-expiry-note')).toHaveText('Card valid until 30 November 2031.');
});

test('Message is shown when the expiry date is unavailable', async ({ page }) => {
  await openCard(page, null);
  await expect(page.locator('#card-expiry-display')).toHaveText('—');
  await expect(page.locator('#card-expiry-note')).toContainText("isn't available");
});

test('A bad expiry value is treated as unavailable', async ({ page }) => {
  await openCard(page, '2031-02-31');
  await expect(page.locator('#card-expiry-note')).toContainText("isn't available");
});

test('Warns when the card expires soon', async ({ page }) => {
  await openCard(page, isoDate(10));
  await expect(page.locator('#card-expiry-note')).toHaveClass(/soon/);
  await expect(page.locator('#card-expiry-note')).toContainText('in 10 days');
});

test('Says when the card has expired', async ({ page }) => {
  await openCard(page, isoDate(-3));
  await expect(page.locator('#card-expiry-note')).toHaveClass(/expired/);
  await expect(page.locator('#card-expiry-note')).toContainText('expired on');
});
