const { test, expect } = require('@playwright/test');

// Wheelchair accessible stops and routes on the bus map (frontend/map/map.js).
// data/accessibility.json is faked with page.route so the tests don't depend on what the real
// file holds. Map tiles and the live server are blocked or faked to keep the tests fast.

const EYRE_SQUARE = '8460B525641';    // Galway stop on route 409
const COLLEGE_ROAD = '8460B5232301';  // another stop on route 409
const ROUTE_409 = '2_409_c_a';

const MARKED = {
  stops: { [EYRE_SQUARE]: true, [COLLEGE_ROAD]: 1 },
  routes: { [ROUTE_409]: true }
};

async function openMap(page, { access = MARKED, query = '' } = {}) {
  await page.addInitScript(() => {
    // Skip the first-visit "use my location?" question
    localStorage.setItem('hop.location', JSON.stringify({ on: false, asked: true }));
  });
  await page.route('**/server.arcgisonline.com/**', route => route.abort());
  await page.route('**/hopapp.onrender.com/**', route => route.fulfill({ json: [] }));
  await page.route('**/data/accessibility.json*', route => access === null
    ? route.fulfill({ status: 404, body: 'Not found' })
    : route.fulfill({ json: access }));

  await page.goto('/frontend/map/map.html' + query);
  await page.waitForFunction(() => typeof stopIndex !== 'undefined' && stopIndex.size > 0, null, { timeout: 20000 });
}

const accessBox = page => page.getByRole('checkbox', { name: 'Only show wheelchair accessible stops' });
const status = page => page.locator('#access-status');
const fromOptions = page => page.locator('#depart-list option');
const toOptions = page => page.locator('#arrive-list option');

async function openSheet(page) {
  if (await page.locator('#plan-sheet').evaluate(el => el.classList.contains('is-collapsed'))) {
    await page.locator('#sheet-toggle').click();
  }
}

test('Stops and routes from accessibility.json are marked accessible', async ({ page }) => {
  await openMap(page);
  const result = await page.evaluate(({ stop, route }) => ({
    stop: stopIndex.get(stop).wheelchair,
    route: allRoutes.find(f => f.properties.route_id === route).properties.wheelchair,
    other: allRoutes.find(f => f.properties.route_id !== route).properties.wheelchair
  }), { stop: EYRE_SQUARE, route: ROUTE_409 });
  expect(result).toEqual({ stop: 1, route: 1, other: 0 });
});

test('Imported PTIMS stops are used, and hand-checked stops win over them', async ({ page }) => {
  await openMap(page, { access: {
    stops: { [COLLEGE_ROAD]: false },
    routes: {},
    ptims: { accessible: [EYRE_SQUARE, COLLEGE_ROAD], not_accessible: ['8460B5232101'] }
  } });
  const values = await page.evaluate((ids) => ids.map(id => stopIndex.get(id).wheelchair),
    [EYRE_SQUARE, COLLEGE_ROAD, '8460B5232101']);
  expect(values).toEqual([1, 2, 2]);
  await expect(page.locator('.leaflet-control-attribution')).toContainText('NTA PTIMS (CC BY 4.0)');
});

test('The stop card says when a stop is wheelchair accessible', async ({ page }) => {
  await openMap(page);
  await page.evaluate((id) => {
    const stop = stopIndex.get(id);
    L.popup().setLatLng([stop.lat, stop.lon]).setContent(stopCard(stop, [])).openOn(map);
  }, EYRE_SQUARE);
  await expect(page.locator('.stop-card')).toContainText('Wheelchair accessible stop');
});

// Galway, then route 409 from the route search
async function pickRoute409(page) {
  await openSheet(page);
  await page.locator('#region-select').selectOption('Galway');
  await page.locator('#route-input').click();
  await page.locator('#route-input').fill('409');
  await page.locator('#route-input').press('Enter');
  await expect(page.locator('#stop-selectors')).toBeVisible();
}

test('The checkbox only appears once a route is picked, next to From and To', async ({ page }) => {
  await openMap(page);
  await openSheet(page);
  await expect(accessBox(page)).toBeHidden();
  await pickRoute409(page);
  await expect(accessBox(page)).toBeVisible();
  await expect(accessBox(page)).not.toBeChecked();
});

test('Ticking it limits From and To to accessible stops, unticking brings them all back', async ({ page }) => {
  await openMap(page);
  await pickRoute409(page);
  const total = await fromOptions(page).count();
  expect(total).toBeGreaterThan(2);
  await expect(status(page)).toBeHidden();

  await accessBox(page).check();
  await expect(fromOptions(page)).toHaveCount(2);
  await expect(toOptions(page)).toHaveCount(2);
  const labels = await fromOptions(page).evaluateAll(list => list.map(o => o.value));
  expect(labels.some(l => l.includes('Eyre Square'))).toBe(true);
  expect(labels.some(l => l.includes('College Road'))).toBe(true);
  await expect(status(page)).toHaveText('2 of ' + total + ' stops on this route are wheelchair accessible.');

  await accessBox(page).uncheck();
  await expect(fromOptions(page)).toHaveCount(total);
  await expect(status(page)).toBeHidden();
});

test('Only accessible stops can be chosen, and a non-accessible From is cleared', async ({ page }) => {
  await openMap(page);
  await pickRoute409(page);
  const all = await fromOptions(page).evaluateAll(list => list.map(o => o.value));
  const notAccessible = all.find(l => !l.includes('Eyre Square') && !l.includes('College Road'));
  const eyre = all.find(l => l.includes('Eyre Square'));

  await page.locator('#depart-input').fill(notAccessible);
  await page.locator('#arrive-input').fill(eyre);
  await accessBox(page).check();
  await expect(page.locator('#depart-input')).toHaveValue('');   // not accessible, so cleared
  await expect(page.locator('#arrive-input')).toHaveValue(eyre); // accessible, so kept

  // Typing a stop that isn't listed doesn't pick it
  await page.locator('#depart-input').fill(notAccessible);
  expect(await page.evaluate(() => stopLookup.get(document.getElementById('depart-input').value))).toBeUndefined();
});

test('A route with no accessible stops says so', async ({ page }) => {
  await openMap(page, { access: { stops: {}, routes: {} } });
  await pickRoute409(page);
  await accessBox(page).check();
  await expect(fromOptions(page)).toHaveCount(0);
  await expect(status(page)).toHaveText('None of the stops on this route are marked wheelchair accessible yet.');
});

test('Routes and the map are not filtered by the checkbox', async ({ page }) => {
  await openMap(page);
  await pickRoute409(page);
  const before = await page.evaluate(() => stopsLayer.getLayers().length);
  await accessBox(page).check();
  expect(await page.evaluate(() => stopsLayer.getLayers().length)).toBe(before);
  await page.locator('#route-input').click();
  await page.locator('#route-input').fill('');
  await expect.poll(() => page.locator('#route-results .route-option .bus-badge').count()).toBeGreaterThan(1);
});

test('The menu link opens the map with the checkbox already ticked', async ({ page }) => {
  await openMap(page, { query: '?accessible=1' });
  await pickRoute409(page);
  await expect(accessBox(page)).toBeChecked();
  await expect(fromOptions(page)).toHaveCount(2);
});

test('The map still loads without an accessibility file', async ({ page }) => {
  await openMap(page, { access: null });
  await expect(page.locator('#region-select')).toBeEnabled();
  const marked = await page.evaluate(() => stopList.filter(s => s.wheelchair === 1).length);
  expect(marked).toBe(0);
});
