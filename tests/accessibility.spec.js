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
  await page.route('**/photon.komoot.io/**', route => route.fulfill({ json: { features: [] } }));
  await page.route('**/data/accessibility.json*', route => access === null
    ? route.fulfill({ status: 404, body: 'Not found' })
    : route.fulfill({ json: access }));

  await page.goto('/frontend/map/map.html' + query);
  await page.waitForFunction(() => typeof stopIndex !== 'undefined' && stopIndex.size > 0, null, { timeout: 20000 });
}

const accessBox = page => page.getByRole('checkbox', { name: 'Only show wheelchair accessible stops' });
const status = page => page.locator('#access-status');
const stopResults = page => page.locator('#search-results .result-stop');

async function openSheet(page) {
  if (await page.locator('#plan-sheet').evaluate(el => el.classList.contains('is-collapsed'))) {
    await page.locator('#sheet-toggle').click();
  }
}

// Types in a search box and taps the first stop it suggests
async function pickStop(page, inputId, text) {
  await page.locator('#' + inputId).fill(text);
  const result = page.locator('#' + (inputId === 'search-input' ? 'search-results' : 'origin-results') + ' .result-stop').first();
  await expect(result).toBeVisible();
  await result.click();
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

// The checkbox sits in the journey panel and works on the search bar and journeys
test('The checkbox is in the journey panel and starts unticked', async ({ page }) => {
  await openMap(page);
  await openSheet(page);
  await expect(accessBox(page)).toBeVisible();
  await expect(accessBox(page)).not.toBeChecked();
  await expect(status(page)).toBeHidden();
});

test('Ticking it limits the stop search to accessible stops, unticking brings them all back', async ({ page }) => {
  await openMap(page);
  await openSheet(page);
  const total = await page.evaluate(() => stopList.length);

  await page.locator('#search-input').fill('Salthill');
  await expect(stopResults(page).first()).toBeVisible();

  await accessBox(page).check();
  await expect(status(page)).toHaveText('Only stops marked wheelchair accessible are shown (2 of ' + total.toLocaleString('en-IE') + ').');
  await page.locator('#search-input').fill('Salthil');
  await page.locator('#search-input').fill('Salthill');
  await expect(stopResults(page)).toHaveCount(0);

  await page.locator('#search-input').fill('College Road');
  await expect(stopResults(page)).toHaveCount(1);

  await accessBox(page).uncheck();
  await expect(status(page)).toBeHidden();
  await page.locator('#search-input').fill('Salthil');
  await page.locator('#search-input').fill('Salthill');
  await expect(stopResults(page).first()).toBeVisible();
});

test('Journeys only get on and off at accessible stops', async ({ page }) => {
  await openMap(page);
  await openSheet(page);
  await accessBox(page).check();
  await pickStop(page, 'search-input', 'College Road');
  await pickStop(page, 'origin-input', 'Eyre Square');

  const cards = page.locator('.option-card');
  await expect(cards.first()).toContainText('409');
  await expect(cards.first()).toContainText('Board at Eyre Square');
  await expect(page.locator('.option-card', { hasText: '401' })).toHaveCount(0);

  // Unticked, the 401 from the Eyre Square stop across the road is offered too
  await accessBox(page).uncheck();
  await expect(page.locator('.option-card', { hasText: '401' })).not.toHaveCount(0);
});

test('A chosen stop that is not accessible is cleared', async ({ page }) => {
  await openMap(page);
  await openSheet(page);
  await accessBox(page).check();
  await pickStop(page, 'search-input', 'College Road');   // an accessible College Road stop
  await accessBox(page).uncheck();
  await pickStop(page, 'origin-input', 'Salthill Prom');
  await expect(page.locator('.option-card').first()).toBeVisible();

  // The starting point is not accessible: it is cleared and you are asked again
  await accessBox(page).check();
  await expect(page.locator('#map-message')).toContainText("Salthill Prom isn't marked wheelchair accessible, so it was cleared.");
  await expect(page.locator('#origin-prompt')).toBeVisible();
  await expect(page.locator('.option-card')).toHaveCount(0);
  await expect(page.locator('#dest-name')).toHaveText('College Road');   // accessible, so kept

  // A destination that is not accessible goes back to the start
  await accessBox(page).uncheck();
  await pickStop(page, 'search-input', 'Salthill Prom');
  await accessBox(page).check();
  await expect(page.locator('#view-idle')).toBeVisible();
  await expect(page.locator('#search-input')).toHaveValue('');
});

test('With no accessible stops marked, it says so', async ({ page }) => {
  await openMap(page, { access: { stops: {}, routes: {} } });
  await openSheet(page);
  await accessBox(page).check();
  await expect(status(page)).toHaveText('No stops are marked wheelchair accessible yet, so no stops or journeys can be shown.');
  await page.locator('#search-input').fill('Eyre Square');
  await expect(stopResults(page)).toHaveCount(0);
});

test('Routes are not filtered by the checkbox', async ({ page }) => {
  await openMap(page);
  await openSheet(page);
  await accessBox(page).check();
  await page.locator('#search-input').fill('409');
  await expect(page.locator('#search-results .result-route').first()).toBeVisible();
  await page.locator('#search-results .result-route').first().click();
  await expect(page.locator('#view-route')).toBeVisible();
});

test('The menu link opens the map with the checkbox already ticked', async ({ page }) => {
  await openMap(page, { query: '?accessible=1' });
  await expect(accessBox(page)).toBeVisible();   // the panel opens so the ticked box is seen
  await expect(accessBox(page)).toBeChecked();
  await expect(status(page)).toBeVisible();
  await page.locator('#search-input').fill('Salthill');
  await expect(stopResults(page)).toHaveCount(0);
});

test('The map still loads without an accessibility file', async ({ page }) => {
  await openMap(page, { access: null });
  await expect(page.locator('#search-input')).toBeEnabled();
  const marked = await page.evaluate(() => stopList.filter(s => s.wheelchair === 1).length);
  expect(marked).toBe(0);
});
