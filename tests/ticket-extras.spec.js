const { test, expect } = require('@playwright/test');

// Swap From and To, passengers, the closed list of used tickets, and planning a route on the map.
// ticket.php is faked with page.route; every POST is recorded.

const TIMES = { first: '06:00', last: '23:00', step: 15, days_ahead: 30, valid_minutes: 90, today: '2026-11-18', now: '09:00' };

const JOURNEY = {
  routeId: 'r1', shortName: '409', longName: 'Eyre Square - An Pháirc Mhór', agency: 'Bus Éireann',
  fromId: 's1', fromName: 'Eyre Square', toId: 's2', toName: 'ATU Galway', stopsBetween: 9
};

async function openTickets(page, { draft = true, tickets = [], price = 2 } = {}) {
  const sent = [];
  if (draft) await page.addInitScript((j) => sessionStorage.setItem('hop.ticketDraft', JSON.stringify(j)), JOURNEY);
  await page.route('**/backend/auth/ticket.php', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { logged_in: true, card_type: 'Adult', card_status: 'active', price, max_passengers: 10, balance: 20, times: TIMES, tickets } });
    }
    sent.push(route.request().postDataJSON());
    const total = price * sent[sent.length - 1].passengers;
    return route.fulfill({ json: { success: true, replayed: false, price: total, balance: 20 - total, ticket_id: 1 } });
  });
  await page.goto('/frontend/tickets/tickets.html');
  return sent;
}

// ---------- Swap From and To ----------

test('Swap puts From and To the other way round', async ({ page }) => {
  await openTickets(page);
  await expect(page.locator('#j-from')).toHaveText('Eyre Square');
  await expect(page.locator('#j-to')).toHaveText('ATU Galway');
  await page.getByRole('button', { name: 'Swap From and To' }).click();
  await expect(page.locator('#j-from')).toHaveText('ATU Galway');
  await expect(page.locator('#j-to')).toHaveText('Eyre Square');
  await expect(page.locator('#j-between')).toHaveText('9 stops on this journey.');
  await page.getByRole('button', { name: 'Swap From and To' }).click();
  await expect(page.locator('#j-from')).toHaveText('Eyre Square');
});

test('The swapped journey is saved and is the one that is paid for', async ({ page }) => {
  const sent = await openTickets(page);
  await page.getByRole('button', { name: 'Swap From and To' }).click();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('hop.ticketDraft')));
  expect(saved.fromName).toBe('ATU Galway');
  expect(saved.toName).toBe('Eyre Square');
  await page.getByRole('button', { name: 'Buy ticket' }).click();
  await expect(page.locator('#pay-journey')).toHaveText('409 ATU Galway → Eyre Square');
  await page.getByRole('button', { name: 'Confirm payment' }).click();
  await expect(page.locator('#pay-title')).toHaveText('Payment successful');
  expect(sent[0].route).toBe('409 ATU Galway → Eyre Square');
});

// ---------- Passengers ----------

test('Passengers start at one and go up to ten', async ({ page }) => {
  await openTickets(page);
  await expect(page.locator('#passengers')).toHaveValue('1');
  await expect(page.locator('#passengers option')).toHaveCount(10);
  await expect(page.locator('#ticket-price')).toHaveText('Ticket price: €2.00 (Adult fare)');
});

test('More passengers multiply the price, in the price line and in the payment box', async ({ page }) => {
  await openTickets(page);
  await page.locator('#passengers').selectOption('3');
  await expect(page.locator('#ticket-price')).toHaveText('Ticket price: €6.00 (3 × €2.00, Adult fare)');
  await page.getByRole('button', { name: 'Buy ticket' }).click();
  await expect(page.locator('#pay-price')).toHaveText('€6.00');
  await expect(page.locator('#pay-after')).toHaveText('€14.00');
  await expect(page.locator('#pay-journey')).toContainText('3 passengers');
});

test('The number of passengers is sent with the purchase, and goes back to one after', async ({ page }) => {
  const sent = await openTickets(page);
  await page.locator('#passengers').selectOption('2');
  await page.getByRole('button', { name: 'Buy ticket' }).click();
  await page.getByRole('button', { name: 'Confirm payment' }).click();
  await expect(page.locator('#pay-title')).toHaveText('Payment successful');
  expect(sent[0].passengers).toBe(2);
  expect(sent[0]).not.toHaveProperty('price');
  await expect(page.locator('#passengers')).toHaveValue('1');
});

test('A ticket for several people says so', async ({ page }) => {
  await openTickets(page, { draft: false, tickets: [
    { id: 5, route: '409 Eyre Square → ATU Galway', travel_at: '2026-11-19 09:30:00', passengers: 3, status: 'active', qr_token: 'abc123abc123abc123abc123abc123ab' }
  ] });
  await expect(page.locator('#ticket-list .ticket-item')).toContainText('3 passengers');
  await page.locator('#ticket-list .ticket-item').click();
  await expect(page.locator('#qr-when')).toContainText('3 passengers');
});

// ---------- Used and expired tickets ----------

const MIXED = [
  { id: 3, route: '409 Eyre Square → ATU Galway', travel_at: '2026-11-19 09:30:00', passengers: 1, status: 'active', qr_token: 'abc123abc123abc123abc123abc123ab' },
  { id: 2, route: '401 Salthill → Eyre Square', travel_at: '2026-11-17 08:30:00', passengers: 1, status: 'used', qr_token: null },
  { id: 1, route: '404 Newcastle → Eyre Square', travel_at: '2026-11-16 09:00:00', passengers: 1, status: 'expired', qr_token: null }
];

test('Used and expired tickets are in a closed section you can open', async ({ page }) => {
  await openTickets(page, { draft: false, tickets: MIXED });
  await expect(page.locator('#ticket-list .ticket-item')).toHaveCount(1);
  await expect(page.locator('#past-tickets')).toBeVisible();
  await expect(page.locator('#past-tickets')).not.toHaveAttribute('open', '');
  await expect(page.locator('#past-count')).toHaveText('2');
  await expect(page.locator('#past-list .ticket-item').first()).toBeHidden();

  await page.locator('#past-tickets summary').click();
  await expect(page.locator('#past-list .ticket-item')).toHaveCount(2);
  await expect(page.locator('#past-list .ticket-item').first()).toBeVisible();

  await page.locator('#past-tickets summary').click();
  await expect(page.locator('#past-list .ticket-item').first()).toBeHidden();
});

test('With only used tickets the page says there are no valid ones', async ({ page }) => {
  await openTickets(page, { draft: false, tickets: MIXED.slice(1) });
  await expect(page.locator('#no-valid')).toBeVisible();
  await expect(page.locator('#past-tickets')).toBeVisible();
});

test('The closed section is not there when every ticket is valid', async ({ page }) => {
  await openTickets(page, { draft: false, tickets: MIXED.slice(0, 1) });
  await expect(page.locator('#past-tickets')).toBeHidden();
  await expect(page.locator('#no-valid')).toBeHidden();
});

// ---------- Plan a route on the map and carry it to the tickets page ----------

test('A route on the map lets you choose From and To and carries them to the tickets page', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hop.location', JSON.stringify({ on: false, asked: true }));
  });
  await page.route('**/server.arcgisonline.com/**', (route) => route.abort());
  await page.route('**/hopapp.onrender.com/api/vehicles**', (route) => route.fulfill({ json: [] }));
  await page.route('**/hopapp.onrender.com/api/stop-times**', (route) => route.fulfill({ json: { now: Math.floor(Date.now() / 1000), arrivals: [] } }));
  await page.route('**/backend/auth/ticket.php', (route) => route.fulfill({ json: { logged_in: false } , status: 401 }));
  await page.goto('/frontend/map/map.html?mode=tickets');
  await page.waitForFunction(() => typeof allRoutes !== 'undefined' && allRoutes.length > 0, null, { timeout: 20000 });

  await page.evaluate(() => showRoute(allRoutes.find((f) => String(f.properties.short_name) === '401' && f.properties.stops.length > 3)));
  await expect(page.locator('#route-ticket')).toBeVisible();
  await expect(page.locator('#route-ticket')).not.toHaveAttribute('open', '');   // closed at first
  await expect(page.locator('#rt-go')).toBeHidden();
  await page.locator('#route-ticket summary').click();
  await expect(page.locator('#rt-from option').first()).toContainText('1.');

  await page.locator('#rt-from').selectOption('0');
  await page.locator('#rt-to').selectOption('2');
  await expect(page.locator('#rt-between')).toHaveText('2 stops on this journey.');
  await page.locator('#rt-go').dispatchEvent('click');

  await page.waitForURL('**/tickets/tickets.html');
  const draft = await page.evaluate(() => JSON.parse(sessionStorage.getItem('hop.ticketDraft')));
  expect(draft.shortName).toBe('401');
  expect(draft.stopsBetween).toBe(2);
  expect(draft.fromName).toBeTruthy();
  expect(draft.toName).toBeTruthy();
  expect(draft.fromId).not.toBe(draft.toId);
});

test('To only offers stops after From', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hop.location', JSON.stringify({ on: false, asked: true }));
  });
  await page.route('**/server.arcgisonline.com/**', (route) => route.abort());
  await page.route('**/hopapp.onrender.com/api/**', (route) => route.fulfill({ json: [] }));
  await page.goto('/frontend/map/map.html');
  await page.waitForFunction(() => typeof allRoutes !== 'undefined' && allRoutes.length > 0, null, { timeout: 20000 });
  await page.evaluate(() => showRoute(allRoutes.find((f) => String(f.properties.short_name) === '401' && f.properties.stops.length > 5)));
  await expect(page.locator('#route-ticket')).toBeVisible();
  await page.locator('#route-ticket summary').click();

  const total = await page.locator('#rt-from option').count();
  await page.locator('#rt-from').selectOption(String(total - 1));   // the last stop that can be a From
  await expect(page.locator('#rt-to option')).toHaveCount(1);
  await expect(page.locator('#rt-between')).toHaveText('1 stop on this journey.');
});
