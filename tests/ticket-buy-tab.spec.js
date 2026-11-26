const { test, expect } = require('@playwright/test');

// The Buy a ticket tab (tickets.js): choose a route and stops on the tickets page, then pay.
// The route list (data/index.json) and ticket.php are faked with page.route.

const TIMES = { first: '06:00', last: '23:00', step: 15, days_ahead: 30, valid_minutes: 90, today: '2026-11-18', now: '14:40' };

// index.json: stops [id, name, lat, lon, wheelchair], routes [id, number, name, operator, region, label, geoKey, [stop positions], wheelchair]
const INDEX = {
  stops: [
    ['s1', 'Eyre Square', 53.2744, -9.0490, 0],
    ['s2', 'Salthill', 53.2590, -9.0830, 0],
    ['s3', 'ATU Galway', 53.2790, -9.0100, 0],
    ['s4', 'Parkmore Business Park', 53.2800, -8.9900, 0]
  ],
  routes: [
    ['r409', '409', 'Eyre Square - Parkmore', 'Bus Éireann', 'Galway', '409 Eyre Square - Parkmore', 'k1', [0, 1, 2, 3], 0],
    ['r409b', '409', 'Parkmore - Eyre Square', 'Bus Éireann', 'Galway', '409 Parkmore - Eyre Square', 'k2', [3, 2, 1, 0], 0],
    ['r401', '401', 'Salthill - Eyre Square', 'Bus Éireann', 'Galway', '401 Salthill - Eyre Square', 'k3', [1, 0], 0],
    ['r763', '763', 'Galway - Dublin Airport', 'Citylink', 'Galway', '763 Galway - Dublin Airport', 'k4', [0, 3], 0]
  ]
};

const NEW_TICKET = { id: 7, route: '409 Eyre Square → ATU Galway', travel_at: '2026-11-19 09:30:00', status: 'active', qr_token: 'abc123abc123abc123abc123abc123ab' };

async function openTickets(page, { draft, tickets = [], index = INDEX } = {}) {
  const sent = [];
  if (draft) await page.addInitScript((j) => sessionStorage.setItem('hop.ticketDraft', JSON.stringify(j)), draft);
  await page.route('**/map/data/index.json', (route) =>
    index ? route.fulfill({ json: index }) : route.fulfill({ status: 404, body: 'missing' }));
  await page.route('**/backend/auth/ticket.php', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { logged_in: true, card_type: 'Adult', card_status: 'active', price: 2, balance: 10, times: TIMES, tickets } });
    }
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true, replayed: false, price: 2, balance: 8, ticket_id: 7, tickets: [NEW_TICKET] } });
  });
  await page.goto('/frontend/tickets/tickets.html');
  return sent;
}

async function chooseRoute409(page) {
  await page.getByRole('tab', { name: 'Buy a ticket' }).click();
  await page.locator('#route-search').fill('409');
  await page.locator('.builder-result', { hasText: 'Eyre Square - Parkmore' }).click();
}

test('The page opens on My tickets, and the tabs switch', async ({ page }) => {
  await openTickets(page);
  await expect(page.getByRole('tab', { name: 'My tickets' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#builder')).toBeHidden();
  await page.getByRole('tab', { name: 'Buy a ticket' }).click();
  await expect(page.getByRole('tab', { name: 'Buy a ticket' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#builder')).toBeVisible();
  await expect(page.locator('#tickets-empty')).toBeHidden();
  await page.getByRole('tab', { name: 'My tickets' }).click();
  await expect(page.locator('#tickets-empty')).toBeVisible();
});

test('A journey from the map opens on the Buy a ticket tab', async ({ page }) => {
  await openTickets(page, { draft: {
    routeId: 'r1', shortName: '409', longName: 'Eyre Square - ATU Galway', agency: 'Bus Éireann',
    fromId: 's1', fromName: 'Eyre Square', toId: 's3', toName: 'ATU Galway', stopsBetween: 2
  } });
  await expect(page.getByRole('tab', { name: 'Buy a ticket' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#journey')).toBeVisible();
  await expect(page.locator('#builder')).toBeHidden();
});

test('The empty message has a Buy a ticket button that opens the tab', async ({ page }) => {
  await openTickets(page);
  await page.locator('#empty-buy').click();
  await expect(page.locator('#builder')).toBeVisible();
});

test('The number of valid tickets shows on the My tickets tab', async ({ page }) => {
  await openTickets(page, { tickets: [NEW_TICKET] });
  await expect(page.locator('#tab-count')).toHaveText('1');
});

test('Routes are found by number or name', async ({ page }) => {
  await openTickets(page);
  await page.getByRole('tab', { name: 'Buy a ticket' }).click();
  await page.locator('#route-search').fill('409');
  await expect(page.locator('.builder-result')).toHaveCount(2);

  await page.locator('#route-search').fill('dublin');
  await expect(page.locator('.builder-result')).toHaveCount(1);
  await expect(page.locator('.builder-result .result-badge')).toHaveText('763');
  await expect(page.locator('.builder-result .result-badge')).toHaveClass(/is-citylink/);

  await page.locator('#route-search').fill('zzz');
  await expect(page.locator('.builder-none')).toContainText('No routes match');
});

test('Picking a route offers its stops in order, and To only comes after From', async ({ page }) => {
  await openTickets(page);
  await chooseRoute409(page);
  await expect(page.locator('#b-name')).toHaveText('Eyre Square - Parkmore');
  await expect(page.locator('#from-stop option')).toHaveText(['1. Eyre Square', '2. Salthill', '3. ATU Galway']);
  await expect(page.locator('#to-stop option')).toHaveText(['2. Salthill', '3. ATU Galway', '4. Parkmore Business Park']);
  await expect(page.locator('#to-stop')).toHaveValue('3');
  await expect(page.locator('#b-between')).toHaveText('3 stops on this journey.');

  await page.locator('#from-stop').selectOption('2');
  await expect(page.locator('#to-stop option')).toHaveText(['4. Parkmore Business Park']);
  await expect(page.locator('#b-between')).toHaveText('1 stop on this journey.');
});

test('Change route goes back to the search', async ({ page }) => {
  await openTickets(page);
  await chooseRoute409(page);
  await page.getByRole('button', { name: 'Change route' }).click();
  await expect(page.locator('#route-search')).toBeVisible();
  await expect(page.locator('#stop-fields')).toBeHidden();
});

test('A chosen journey is saved, shown with date and price, and paid for', async ({ page }) => {
  const sent = await openTickets(page);
  await chooseRoute409(page);
  await page.locator('#from-stop').selectOption('0');
  await page.locator('#to-stop').selectOption('2');
  await page.getByRole('button', { name: 'Use this journey' }).click();

  await expect(page.locator('#builder')).toBeHidden();
  await expect(page.locator('#journey')).toBeVisible();
  await expect(page.locator('#j-badge')).toHaveText('409');
  await expect(page.locator('#j-from')).toHaveText('Eyre Square');
  await expect(page.locator('#j-to')).toHaveText('ATU Galway');
  await expect(page.locator('#j-between')).toHaveText('2 stops on this journey.');
  await expect(page.locator('#ticket-price')).toHaveText('Ticket price: €2.00 (Adult fare)');
  await expect(page.locator('#travel-date')).toHaveValue('2026-11-18');
  await expect(page.getByRole('button', { name: 'Buy ticket' })).toBeEnabled();

  await page.locator('#travel-date').fill('2026-11-19');
  await page.locator('#travel-time').selectOption('09:30');
  await page.getByRole('button', { name: 'Buy ticket' }).click();
  await page.getByRole('button', { name: 'Confirm payment' }).click();
  await expect(page.locator('#pay-title')).toHaveText('Payment successful');
  expect(sent[0].route).toBe('409 Eyre Square → ATU Galway');
  expect(sent[0].travel_date).toBe('2026-11-19');

  // Closing the pop-up lands on My tickets with the new ticket
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('tab', { name: /My tickets/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.ticket-item')).toHaveCount(1);
});

test('Clear goes back to choosing a journey', async ({ page }) => {
  await openTickets(page);
  await chooseRoute409(page);
  await page.getByRole('button', { name: 'Use this journey' }).click();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('#journey')).toBeHidden();
  await expect(page.locator('#builder')).toBeVisible();
  await expect(page.locator('#route-search')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('hop.ticketDraft'))).toBeNull();
});

test('If the route list cannot load, it says so and points to the map', async ({ page }) => {
  await openTickets(page, { index: null });
  await page.getByRole('tab', { name: 'Buy a ticket' }).click();
  await expect(page.locator('#builder-status')).toContainText("Couldn't load the route list");
  await expect(page.getByRole('link', { name: 'find it on the map' })).toHaveAttribute('href', '../map/map.html?mode=tickets');
});
