const { test, expect } = require('@playwright/test');

// Date & time of ticket (SCRUM-120) and QR code of ticket (SCRUM-122).
// ticket.php is faked with page.route; every POST is recorded.

const TIMES = { first: '06:00', last: '23:00', step: 15, days_ahead: 30, valid_minutes: 90, today: '2026-11-18', now: '14:40' };

const JOURNEY = {
  routeId: 'r1', shortName: '409', longName: 'Eyre Square - An Pháirc Mhór', agency: 'Bus Éireann',
  fromId: 's1', fromName: 'Eyre Square', toId: 's2', toName: 'ATU Galway', stopsBetween: 9
};

const NEW_TICKET = { id: 7, route: '409 Eyre Square → ATU Galway', travel_at: '2026-11-19 09:30:00', status: 'active', qr_token: 'abc123abc123abc123abc123abc123ab' };

async function openTickets(page, { draft = true, times = TIMES, tickets = [], buyReply } = {}) {
  const sent = [];
  if (draft) await page.addInitScript((j) => sessionStorage.setItem('hop.ticketDraft', JSON.stringify(j)), JOURNEY);
  await page.route('**/backend/auth/ticket.php', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { logged_in: true, card_type: 'Adult', card_status: 'active', price: 2, balance: 10, times, tickets } });
    }
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: buyReply || { success: true, replayed: false, price: 2, balance: 8, ticket_id: 7, tickets: [NEW_TICKET] } });
  });
  await page.goto('/frontend/tickets/tickets.html');
  return sent;
}

// ---------- SCRUM-120: date and time ----------

test('Today only offers departures that have not gone yet', async ({ page }) => {
  await openTickets(page);
  await expect(page.locator('#travel-date')).toHaveValue('2026-11-18');
  await expect(page.locator('#travel-time option').first()).toHaveText('14:30');
  await expect(page.locator('#travel-time option').last()).toHaveText('23:00');
  await expect(page.getByRole('button', { name: 'Buy ticket' })).toBeEnabled();
});

test('Another day offers every departure from 06:00', async ({ page }) => {
  await openTickets(page);
  await page.locator('#travel-date').fill('2026-11-20');
  await expect(page.locator('#travel-time option').first()).toHaveText('06:00');
  await expect(page.locator('#travel-time option')).toHaveCount(69);   // 06:00 to 23:00, every 15 minutes
});

test('A past date or one too far ahead is refused before paying', async ({ page }) => {
  await openTickets(page);
  await page.locator('#travel-date').fill('2026-11-10');
  await expect(page.locator('#when-error')).toHaveText('That date has already passed. Choose today or a later date.');
  await expect(page.getByRole('button', { name: 'Buy ticket' })).toBeDisabled();

  await page.locator('#travel-date').fill('2027-01-30');
  await expect(page.locator('#when-error')).toHaveText('Tickets can only be bought up to 30 days ahead.');
  await expect(page.getByRole('button', { name: 'Buy ticket' })).toBeDisabled();
});

test('After the last bus, today is skipped and tomorrow is picked', async ({ page }) => {
  await openTickets(page, { times: { ...TIMES, now: '23:40' } });
  await expect(page.locator('#travel-date')).toHaveValue('2026-11-19');
  await page.locator('#travel-date').fill('2026-11-18');
  await expect(page.locator('#when-error')).toHaveText('There are no more buses today. Choose another date.');
});

test('The chosen date and time are shown before payment and sent with it', async ({ page }) => {
  const sent = await openTickets(page);
  await page.locator('#travel-date').fill('2026-11-19');
  await page.locator('#travel-time').selectOption('09:30');
  await page.getByRole('button', { name: 'Buy ticket' }).click();
  await expect(page.locator('#pay-when')).toHaveText('Thu 19 Nov 2026, 09:30');
  await page.getByRole('button', { name: 'Confirm payment' }).click();
  expect(sent[0].travel_date).toBe('2026-11-19');
  expect(sent[0].travel_time).toBe('09:30');
});

test('A time the server says is unavailable is declined without charging', async ({ page }) => {
  await openTickets(page, {
    buyReply: { success: false, declined: 'time_unavailable', error: 'That time has already passed. Choose a later time.', price: 2, balance: 10 }
  });
  await page.getByRole('button', { name: 'Buy ticket' }).click();
  await page.getByRole('button', { name: 'Confirm payment' }).click();
  await expect(page.locator('#pay-title')).toHaveText('Payment declined');
  await expect(page.locator('#pay-result-title')).toHaveText('That time has already passed. Choose a later time.');
  await expect(page.locator('#pay-result-text')).toContainText('You have not been charged');
});

// ---------- SCRUM-122: QR code ----------

test('A QR code is shown right after buying', async ({ page }) => {
  await openTickets(page);
  await page.getByRole('button', { name: 'Buy ticket' }).click();
  await page.getByRole('button', { name: 'Confirm payment' }).click();
  await expect(page.getByRole('img', { name: 'QR code for your new ticket' })).toBeVisible();
  await expect(page.locator('.ticket-item')).toHaveCount(1);   // also saved in My tickets
  // Once bought, the journey form goes away: just Plan a journey and the tickets
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#journey')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Plan a journey' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('hop.ticketDraft'))).toBeNull();
});

test('My tickets lists the ticket with its details, and opens a big QR code', async ({ page }) => {
  await openTickets(page, { draft: false, tickets: [NEW_TICKET] });
  await expect(page.locator('#tickets-empty')).toBeHidden();
  const item = page.locator('.ticket-item').first();
  await expect(item).toContainText('409 Eyre Square → ATU Galway');
  await expect(item).toContainText('Thu 19 Nov 2026, 09:30');
  await expect(item).toContainText('Valid');
  await item.click();
  await expect(page.locator('#qr-code svg')).toBeVisible();
  await expect(page.locator('#qr-hint')).toContainText('Valid for 90 minutes from 09:30');
});

test('Expired and used tickets have no QR code', async ({ page }) => {
  await openTickets(page, { draft: false, tickets: [
    { id: 1, route: '404 Newcastle → Eyre Square', travel_at: '2026-11-18 09:00:00', status: 'expired', qr_token: null },
    { id: 2, route: '401 Salthill → Eyre Square', travel_at: '2026-11-17 08:30:00', status: 'used', qr_token: null }
  ] });
  await expect(page.locator('.ticket-item svg')).toHaveCount(0);
  await page.locator('.ticket-item').first().click();
  await expect(page.locator('#qr-code')).toBeHidden();
  await expect(page.locator('#qr-hint')).toContainText('This ticket has expired');
});

test('With no journey and no tickets the empty message shows', async ({ page }) => {
  await openTickets(page, { draft: false });
  await expect(page.getByRole('heading', { name: 'No tickets yet' })).toBeVisible();
  await expect(page.locator('#my-tickets')).toBeHidden();
});
