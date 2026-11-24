const { test, expect } = require('@playwright/test');

// The map's search bar and "alternative routes" (frontend/map/map.js and journey.js).
// The hosted live server and the place search (Photon) are faked with page.route, so these tests
// don't depend on either being online. Map tiles are blocked to keep the tests fast.
// Leaflet still loads from unpkg.

const ROUTE_401 = '2_401_c_a';   // Galway: Salthill Prom -> Eyre Square, from data/index.json

async function openMap(page, { arrivals = () => [], places = [], query = '' } = {}) {
  const state = { photonQueries: [] };

  await page.addInitScript(() => {
    // Skip the first-visit "use my location?" question
    localStorage.setItem('hop.location', JSON.stringify({ on: false, asked: true }));
  });

  await page.route('**/server.arcgisonline.com/**', route => route.abort());
  await page.route('**/hopapp.onrender.com/api/vehicles**', route => route.fulfill({ json: [] }));
  await page.route('**/hopapp.onrender.com/api/stop-times**', route => {
    const now = Math.floor(Date.now() / 1000);
    const list = arrivals(now);
    if (list === null) return route.fulfill({ status: 404, json: { error: 'Not found' } });
    return route.fulfill({ json: { now, arrivals: list } });
  });
  await page.route('**/photon.komoot.io/**', route => {
    state.photonQueries.push(new URL(route.request().url()).searchParams.get('q'));
    return route.fulfill({
      json: {
        features: places.map(p => ({
          geometry: { coordinates: [p.lon, p.lat] },
          properties: { name: p.name, city: p.city || '', country: 'Ireland', osm_key: p.key || 'tourism' }
        }))
      }
    });
  });

  await page.goto('/frontend/map/map.html' + query);
  await page.waitForFunction(() => typeof stopIndex !== 'undefined' && stopIndex.size > 0, null, { timeout: 20000 });
  return state;
}

// Types in a search box and taps the first result of the given kind
async function pick(page, inputId, text, kind) {
  const input = page.locator('#' + inputId);
  await input.fill(text);
  const result = page.locator('#' + (inputId === 'search-input' ? 'search-results' : 'origin-results') + ' .result-' + kind).first();
  await expect(result).toBeVisible();
  await result.click();
}

test('searching a stop asks where you are starting from', async ({ page }) => {
  await openMap(page);
  await pick(page, 'search-input', 'Eyre Square', 'stop');

  await expect(page.locator('#dest-name')).toHaveText('Eyre Square');
  await expect(page.locator('#origin-prompt')).toBeVisible();
  await expect(page.locator('#origin-use-location')).toBeVisible();
  await expect(page.locator('#origin-drop-pin')).toBeVisible();
  await expect(page.locator('.option-card')).toHaveCount(0);
});

test('a starting stop lists the buses, with their stops and a journey time', async ({ page }) => {
  await openMap(page);
  await pick(page, 'search-input', 'Eyre Square', 'stop');
  await pick(page, 'origin-input', 'Salthill Prom', 'stop');

  const first = page.locator('.option-card').first();
  await expect(first).toBeVisible();
  await expect(first).toContainText('401');
  await expect(first).toContainText('Board at Salthill Prom');
  await expect(first).toContainText('off at Eyre Square');
  await expect(first).toContainText(/\d+ stops?/);
  await expect(first).toContainText(/\d+ min/);
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#origin-prompt')).toBeHidden();
});

test('live times show the wait, and a late bus gets advice', async ({ page }) => {
  await openMap(page, {
    arrivals: now => [{ routeId: ROUTE_401, tripId: 't1', time: now + 12 * 60, delay: 9 * 60 }]
  });
  await pick(page, 'search-input', 'Eyre Square', 'stop');
  await pick(page, 'origin-input', 'Salthill Prom', 'stop');

  const card = page.locator('.option-card', { hasText: '401' }).first();
  await expect(card).toContainText('Next bus in');
  await expect(card).toContainText('9 min late');
  await expect(card.locator('.option-advice')).toBeVisible();
});

test('without live times the list says they are estimates', async ({ page }) => {
  await openMap(page, { arrivals: () => null });
  await pick(page, 'search-input', 'Eyre Square', 'stop');
  await pick(page, 'origin-input', 'Salthill Prom', 'stop');

  await expect(page.locator('.option-card').first()).toBeVisible();
  await expect(page.locator('#journey-hint')).toContainText('timetable estimates');
});

test('a message appears when there is no direct bus', async ({ page }) => {
  await openMap(page);
  // A pin in the Atlantic has no bus stops anywhere near it
  await page.evaluate(() => {
    setOrigin({ kind: 'pin', name: 'Dropped pin', lat: 53.8, lon: -11.5 });
  });
  await pick(page, 'search-input', 'Eyre Square', 'stop');
  await expect(page.locator('#journey-hint')).toContainText('no bus stops');
  await expect(page.locator('.option-card')).toHaveCount(0);
});

test('a place can be the destination, using the place search', async ({ page }) => {
  const state = await openMap(page, {
    places: [{ name: 'Galway Cathedral', city: 'Galway', lat: 53.2750, lon: -9.0583 }]
  });
  await pick(page, 'search-input', 'Galway Cathedral', 'place');

  await expect(page.locator('#dest-name')).toHaveText('Galway Cathedral');
  await expect(page.locator('#origin-prompt')).toBeVisible();
  expect(state.photonQueries.some(q => /Galway Cathedral/i.test(q))).toBe(true);
});

test('if the place search is down, stops and routes still work', async ({ page }) => {
  await openMap(page);
  await page.route('**/photon.komoot.io/**', route => route.abort());
  await page.locator('#search-input').fill('Eyre Square');
  await expect(page.locator('#search-results .result-stop').first()).toBeVisible();
});

test('a route number shows that route and its live buses', async ({ page }) => {
  await openMap(page);
  await page.locator('#search-input').fill('401');
  await page.locator('#search-results .result-route').first().click();

  await expect(page.locator('#view-route')).toBeVisible();
  await expect(page.locator('#route-title')).toContainText('Parkmore Road');
  await expect(page.locator('#live-status')).toContainText('live bus');
});

test('clearing the search goes back to the start', async ({ page }) => {
  await openMap(page);
  await pick(page, 'search-input', 'Eyre Square', 'stop');
  await page.locator('#dest-clear').click();

  await expect(page.locator('#view-idle')).toBeVisible();
  await expect(page.locator('#view-journey')).toBeHidden();
  await expect(page.locator('#search-input')).toHaveValue('');
});

test('the old tabs are gone, and the tickets link still opens the map', async ({ page }) => {
  await openMap(page, { query: '?mode=tickets' });
  await expect(page.locator('[role="tab"]')).toHaveCount(0);
  await expect(page.locator('#search-input')).toBeFocused();
});
