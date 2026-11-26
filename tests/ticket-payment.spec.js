const { test, expect } = require('@playwright/test');

// HOP Up Priority Payment (SCRUM-121): pay for a ticket with the Hop Card balance.
// ticket.php is faked with page.route; every POST is recorded.

// When tickets can be bought for, as ticket.php sends it (date and time choice, SCRUM-120)
const TIMES = { first: '06:00', last: '23:00', step: 15, days_ahead: 30, valid_minutes: 90, today: '2026-11-18', now: '09:00' };

const JOURNEY = {
  routeId: 'r1', shortName: '409', longName: 'Eyre Square - An Pháirc Mhór', agency: 'Bus Éireann',
  fromId: 's1', fromName: 'Eyre Square', toId: 's2', toName: 'ATU Galway', stopsBetween: 9
};

async function openTickets(page, { balance = 10, cardType = 'Adult', price = 2, buyReply } = {}) {
  const sent = [];
  await page.addInitScript((j) => sessionStorage.setItem('hop.ticketDraft', JSON.stringify(j)), JOURNEY);
  await page.route('**/backend/auth/ticket.php', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { logged_in: true, card_type: cardType, card_status: 'active', price, balance, times: TIMES, tickets: [] } });
    }
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: buyReply || { success: true, replayed: false, price, balance: balance - price, ticket_id: 1 } });
  });
  await page.goto('/frontend/tickets/tickets.html');
  return sent;
}

test('The ticket price is shown before paying', async ({ page }) => {
  await openTickets(page, { cardType: 'Student', price: 1 });
  await expect(page.locator('#ticket-price')).toHaveText('Ticket price: €1.00 (Student fare)');
  await page.getByRole('button', { name: 'Buy ticket' }).click();
  await expect(page.locator('#pay-price')).toHaveText('€1.00');
  await expect(page.locator('#pay-balance')).toHaveText('€10.00');
  await expect(page.locator('#pay-after')).toHaveText('€9.00');
  await expect(page.locator('#pay-journey')).toHaveText('409 Eyre Square → ATU Galway');
});

test('Confirming pays and shows the payment was successful', async ({ page }) => {
  const sent = await openTickets(page);
  await page.getByRole('button', { name: 'Buy ticket' }).click();
  await page.getByRole('button', { name: 'Confirm payment' }).click();
  await expect(page.locator('#pay-title')).toHaveText('Payment successful');
  await expect(page.locator('#pay-result-text')).toContainText('€8.00');
  expect(sent).toHaveLength(1);
  expect(sent[0].action).toBe('buy');
  expect(sent[0].route).toBe('409 Eyre Square → ATU Galway');
  expect(sent[0]).not.toHaveProperty('price');   // the server decides the price
});

test('Cancel closes without paying', async ({ page }) => {
  const sent = await openTickets(page);
  await page.getByRole('button', { name: 'Buy ticket' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#pay-dialog')).toBeHidden();
  expect(sent).toHaveLength(0);
});

test('Not enough balance: payment declined, with a Top up button', async ({ page }) => {
  await openTickets(page, {
    balance: 1.2,
    buyReply: { success: false, declined: 'insufficient_balance', price: 2, balance: 1.2, error: 'Not enough balance on your Hop Card.' }
  });
  await page.getByRole('button', { name: 'Buy ticket' }).click();
  await page.getByRole('button', { name: 'Confirm payment' }).click();
  await expect(page.locator('#pay-title')).toHaveText('Payment declined');
  await expect(page.locator('#pay-result-title')).toHaveText('Not enough balance on your Hop Card.');
  await expect(page.locator('#pay-topup')).toBeVisible();
});

test('A frozen card is declined without a Top up button', async ({ page }) => {
  await openTickets(page, {
    buyReply: { success: false, declined: 'card_not_active', price: 2, balance: 10, error: 'Your card is not active, so it cannot be used to pay.' }
  });
  await page.getByRole('button', { name: 'Buy ticket' }).click();
  await page.getByRole('button', { name: 'Confirm payment' }).click();
  await expect(page.locator('#pay-title')).toHaveText('Payment declined');
  await expect(page.locator('#pay-topup')).toBeHidden();
});

test('A failed request says nothing was charged and a retry reuses the same key', async ({ page }) => {
  const keys = [];
  await page.addInitScript((j) => sessionStorage.setItem('hop.ticketDraft', JSON.stringify(j)), JOURNEY);
  await page.route('**/backend/auth/ticket.php', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { logged_in: true, card_type: 'Adult', card_status: 'active', price: 2, balance: 10, times: TIMES, tickets: [] } });
    }
    keys.push(route.request().postDataJSON().idempotency_key);
    return route.fulfill({ status: 500, json: { success: false, error: 'Payment failed' } });
  });
  await page.goto('/frontend/tickets/tickets.html');
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Buy ticket' }).click();
    await page.getByRole('button', { name: 'Confirm payment' }).click();
    await expect(page.locator('#pay-result-title')).toHaveText('Payment failed, you have not been charged.');
    await page.getByRole('button', { name: 'Close' }).click();
  }
  expect(keys[0]).toBe(keys[1]);
});
