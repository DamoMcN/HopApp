const { test, expect } = require('@playwright/test');

// Choose a Bus Route (SCRUM-119): frontend/map/route-details.js.
// Picking a route in Route view shows where it goes and every stop on it.
// Map tiles and the live server are blocked to keep the tests fast. Leaflet loads from unpkg.

async function openMap(page) {
  await page.addInitScript(() => {
    localStorage.setItem('hop.location', JSON.stringify({ on: false, asked: true }));   // skip the location question
  });
  await page.route('**/server.arcgisonline.com/**', route => route.abort());
  await page.route('**/hopapp.onrender.com/**', route => route.fulfill({ json: [] }));
  await page.goto('/frontend/map/map.html');
  await page.waitForFunction(() => typeof allRoutes !== 'undefined' && allRoutes.length > 0, null, { timeout: 20000 });
  // The route finder starts folded down: open it like a person would
  if (await page.locator('#plan-sheet').evaluate(el => el.classList.contains('is-collapsed'))) {
    await page.getByRole('button', { name: 'Show or hide the route finder' }).click();
  }
  await page.locator('#region-select').selectOption('Galway');
}

async function pickRoute409(page) {
  await page.locator('#route-input').fill('409');
  await page.locator('#route-results .route-option', { hasText: 'Eyre Square - An Pháirc Mhór' }).first().click();
  await expect(page.locator('#route-details')).toBeVisible();
}

test('Available routes are listed and one can be picked', async ({ page }) => {
  await openMap(page);
  await page.locator('#route-input').click();
  await expect(page.locator('#route-results .route-option').nth(1)).toBeVisible();
  await pickRoute409(page);
  await expect(page.locator('#route-details')).toContainText('409');
  await expect(page.locator('#route-details')).toContainText('Bus Éireann');
});

test('The destination is clearly shown and the direction can be switched', async ({ page }) => {
  await openMap(page);
  await pickRoute409(page);
  const dest = page.locator('#route-destination');
  const first = await dest.textContent();
  expect(['Celestica', 'Eyre Square']).toContain(first);

  await page.getByRole('button', { name: /Switch direction/ }).click();
  await expect(dest).not.toHaveText(first);
  await expect(page.locator('#route-details')).toContainText('From ' + first);
});

test('Every stop along the route is listed in order', async ({ page }) => {
  await openMap(page);
  await pickRoute409(page);
  await page.getByText(/Show all \d+ stops/).click();
  const stops = page.locator('#route-details ol li');
  await expect(stops).toHaveCount(23);
  const dest = await page.locator('#route-destination').textContent();
  await expect(stops.last()).toContainText(dest);
  await expect(page.locator('#route-details')).toContainText('ATU Galway');
});

test('Clearing the route hides the details', async ({ page }) => {
  await openMap(page);
  await pickRoute409(page);
  await page.locator('#route-input').fill('');
  await expect(page.locator('#route-details')).toBeHidden();
});
