const { test, expect } = require('@playwright/test');

// Two things on the map page (frontend/map/map.js):
//  - the bus numbers in a stop card are a filter for the Next buses list
//  - the picked bus in a journey has a button that carries the journey to the tickets page
// The hosted live server is faked with page.route. Map tiles are blocked to keep the tests fast.
// Leaflet still loads from unpkg.

const ORANMORE = '8470B556161';     // a Galway stop that 51 and 404 both serve, from data/index.json

async function openMap(page, { arrivals = () => [] } = {}) {
  await page.addInitScript(() => {
    // Skip the first-visit "use my location?" question
    localStorage.setItem('hop.location', JSON.stringify({ on: false, asked: true }));
  });
  await page.route('**/server.arcgisonline.com/**', route => route.abort());
  await page.route('**/hopapp.onrender.com/api/vehicles**', route => route.fulfill({ json: [] }));
  await page.route('**/hopapp.onrender.com/api/stop-times**', route => {
    const now = Math.floor(Date.now() / 1000);
    return route.fulfill({ json: { now, arrivals: arrivals(now) } });
  });
  await page.goto('/frontend/map/map.html');
  await page.waitForFunction(() => typeof stopIndex !== 'undefined' && stopIndex.size > 0, null, { timeout: 20000 });
}

// A route id for a bus number (any direction), so the fake arrivals can name the bus
const routeIdFor = (page, number) =>
  page.evaluate((n) => allRoutes.find(f => String(f.properties.short_name) === n).properties.route_id, number);

// Opens the map's own stop card, the same card you get by tapping a stop
async function openStopCard(page, stopId) {
  await page.evaluate((id) => {
    const stop = stopIndex.get(id);
    L.popup({ minWidth: 230, maxWidth: 290 }).setLatLng([stop.lat, stop.lon]).setContent(stopCard(stop, [])).openOn(map);
  }, stopId);
  await expect(page.locator('.stop-chips')).toBeVisible();
}

// Sends the click straight to the button. The card can sit under the search bar or the bottom bar on a
// small screen, and these tests are about what the card does, not where it lands.
const tap = locator => locator.dispatchEvent('click');

const chip = (page, number) => page.locator('.stop-chip', { hasText: new RegExp('^' + number + '$') });
const rows = page => page.locator('.stop-time-row');

async function openFilterCard(page) {
  let ids = {};
  await openMap(page, {
    arrivals: now => [
      { routeId: ids['51'], tripId: 't1', time: now + 5 * 60, delay: 0 },
      { routeId: ids['404'], tripId: 't2', time: now + 8 * 60, delay: 0 },
      { routeId: ids['51'], tripId: 't3', time: now + 20 * 60, delay: 0 }
    ]
  });
  ids = { '51': await routeIdFor(page, '51'), '404': await routeIdFor(page, '404') };
  await openStopCard(page, ORANMORE);
  await expect(rows(page)).toHaveCount(3);
}

test('tapping a bus number shows only that bus, and the others are greyed out', async ({ page }) => {
  await openFilterCard(page);
  await expect(page.locator('.stop-chips-clear')).toBeHidden();

  await tap(chip(page, '404'));
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().locator('.bus-badge')).toHaveText('404');
  await expect(chip(page, '404')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, '404')).not.toHaveClass(/is-dimmed/);
  await expect(chip(page, '51')).toHaveClass(/is-dimmed/);
  await expect(page.locator('.stop-chips-clear')).toBeVisible();
});

test('greyed out buses can be added, and tapping a picked bus removes it', async ({ page }) => {
  await openFilterCard(page);
  await tap(chip(page, '404'));
  await tap(chip(page, '51'));
  await expect(rows(page)).toHaveCount(3);
  await expect(chip(page, '51')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, '404')).toHaveAttribute('aria-pressed', 'true');

  await tap(chip(page, '404'));   // 404 is taken out again, 51 stays
  await expect(rows(page)).toHaveCount(2);
  await expect(chip(page, '404')).toHaveClass(/is-dimmed/);
});

test('tapping the only picked bus shows every bus again', async ({ page }) => {
  await openFilterCard(page);
  await tap(chip(page, '51'));
  await expect(rows(page)).toHaveCount(2);
  await tap(chip(page, '51'));
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator('.stop-chip.is-dimmed')).toHaveCount(0);
  await expect(page.locator('.stop-chips-clear')).toBeHidden();
});

test('the x clears every pick at once', async ({ page }) => {
  await openFilterCard(page);
  await tap(chip(page, '51'));
  await tap(chip(page, '404'));
  await tap(chip(page, '404'));   // 51 only
  await tap(page.getByRole('button', { name: 'Show all buses again' }));
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator('.stop-chip[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('.stop-chip.is-dimmed')).toHaveCount(0);
  await expect(page.locator('.stop-chips-clear')).toBeHidden();
});

test('a picked bus with nothing due says so', async ({ page }) => {
  await openMap(page, { arrivals: () => [] });
  await openStopCard(page, ORANMORE);
  await tap(chip(page, '51'));
  await expect(page.locator('.stop-times-note')).toHaveText('No bus due soon on the route you picked.');
});

test('a stop with many buses can show all their numbers, and each one can be picked', async ({ page }) => {
  await openMap(page);
  await openStopCard(page, '8440B352011');   // The Clock Tower: 13 different bus numbers
  const before = await page.locator('.stop-chip').count();
  expect(before).toBe(10);
  await tap(page.locator('.stop-chips-more'));
  await expect(page.locator('.stop-chip')).toHaveCount(13);
  await expect(page.locator('.stop-chips-more')).toHaveCount(0);
  await tap(page.locator('.stop-chip').last());
  await expect(page.locator('.stop-chip[aria-pressed="true"]')).toHaveCount(1);
});

// ---------- From the map to the tickets page ----------

async function planSalthillToEyreSquare(page) {
  await openMap(page);
  await page.locator('#search-input').fill('Eyre Square');
  await page.locator('#search-results .result-stop').first().click();
  await page.locator('#origin-input').fill('Salthill Prom');
  await page.locator('#origin-results .result-stop').first().click();
  await expect(page.locator('.option-card').first()).toHaveAttribute('aria-pressed', 'true');
}

test('the picked bus has a button that opens the tickets page with the journey', async ({ page }) => {
  await planSalthillToEyreSquare(page);
  await expect(page.locator('.option-ticket')).toHaveCount(1);

  await page.getByRole('button', { name: 'Get a ticket for this journey' }).click();
  await expect(page).toHaveURL(/\/frontend\/tickets\/tickets\.html$/);

  await expect(page.getByRole('tab', { name: 'Buy a ticket' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#j-badge')).toHaveText('401');
  await expect(page.locator('#j-from')).toHaveText('Salthill Prom');
  await expect(page.locator('#j-to')).toHaveText('Eyre Square');
  await expect(page.locator('#j-between')).toHaveText(/^\d+ stops? on this journey\.$/);
});
