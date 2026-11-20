const { test, expect } = require('@playwright/test');

// Search for a Bus Stop: the search box in Route view (frontend/map/map.js).
// Map tiles and the live server are blocked to keep the tests fast. Leaflet loads from unpkg.

async function openMap(page) {
  await page.addInitScript(() => {
    localStorage.setItem('hop.location', JSON.stringify({ on: false, asked: true }));   // skip the location question
  });
  await page.route('**/server.arcgisonline.com/**', route => route.abort());
  await page.route('**/hopapp.onrender.com/**', route => route.fulfill({ json: [] }));
  await page.goto('/frontend/map/map.html');
  await page.waitForFunction(() => typeof placeList !== 'undefined' && placeList.length > 0, null, { timeout: 20000 });
  if (await page.locator('#plan-sheet').evaluate(el => el.classList.contains('is-collapsed'))) {
    await page.getByRole('button', { name: 'Show or hide the route finder' }).click();
  }
}

const search = (page) => page.getByRole('combobox', { name: 'Search for a bus stop' });
const results = (page) => page.locator('#stop-search-results li');

test('The search box is in Route view', async ({ page }) => {
  await openMap(page);
  await expect(search(page)).toBeVisible();
});

test('Typing a name shows matching stops, each place only once', async ({ page }) => {
  await openMap(page);
  await search(page).fill('eyre sq');
  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first()).toContainText('Eyre Square');
  await expect(results(page).first()).toContainText('Galway · 10 stops');
});

test('A stop can be found by its number too', async ({ page }) => {
  await openMap(page);
  await search(page).fill('8460B525641');
  await expect(results(page).first()).toContainText('Eyre Square');
});

test('Picking a stop shows where it is and the buses that stop there', async ({ page }) => {
  await openMap(page);
  await search(page).fill('loyola park');
  await results(page).first().click();

  const found = page.locator('#stop-found');
  await expect(found.getByRole('heading', { name: 'Loyola Park' })).toBeAttached();
  await expect(page.locator('#stop-found-meta')).toContainText('2 stops');
  await expect(page.locator('#stop-found-routes .bus-badge', { hasText: /^409$/ })).toBeAttached();

  // One dot per stop on the map, and the busiest stop's card opens
  expect(await page.evaluate(() => stopSearchLayer.getLayers().length)).toBe(2);
  await expect(page.locator('.leaflet-popup .stop-card')).toContainText('Loyola Park');
  await expect(page.locator('.leaflet-popup .stop-card')).toContainText('Buses that stop here');
});

test('A message appears when no stop matches', async ({ page }) => {
  await openMap(page);
  await search(page).fill('zzqqxx');
  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first()).toHaveText('No bus stops match "zzqqxx". Check the spelling or try part of the name.');
});

test('Clearing the search removes the stop from the map', async ({ page }) => {
  await openMap(page);
  await search(page).fill('eyre square');
  await results(page).first().click();
  expect(await page.evaluate(() => stopSearchLayer.getLayers().length)).toBe(10);
  await page.getByRole('button', { name: 'Show or hide the route finder' }).click();
  await page.getByRole('button', { name: 'Clear the stop search' }).click();
  await expect(page.locator('#stop-found')).toBeHidden();
  await expect(search(page)).toHaveValue('');
  expect(await page.evaluate(() => stopSearchLayer.getLayers().length)).toBe(0);
});
