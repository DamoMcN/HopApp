const { test, expect } = require('@playwright/test');

// Bus alerts (frontend/map/bus-alerts.js). The hosted live server is faked with page.route,
// so these tests don't depend on it being deployed or awake. Map tiles are blocked to keep
// the tests fast. Leaflet still loads from unpkg.

const STOP = { id: '8460B525641', name: 'Eyre Square' };
const ROUTE_409 = '2_409_c_a';    // a Galway route id from data/index.json that stops at Eyre Square

// arrivals(now) returns the fake stop-times list; null makes the server answer 404
async function openMap(page, { arrivals = () => [], saved, hidden = false } = {}) {
  const state = { arrivals, requests: 0 };

  await page.addInitScript(({ saved, hidden }) => {
    // Skip the first-visit "use my location?" question
    localStorage.setItem('hop.location', JSON.stringify({ on: false, asked: true }));
    if (saved !== undefined && !sessionStorage.getItem('test.seeded')) {
      localStorage.setItem('hop.busAlerts', typeof saved === 'string' ? saved : JSON.stringify(saved));
      sessionStorage.setItem('test.seeded', '1');
    }
    // Record browser notifications instead of showing them
    window.__notes = [];
    window.Notification = class {
      constructor(title, options) { window.__notes.push({ title, body: options && options.body }); }
      static get permission() { return 'granted'; }
      static requestPermission() { return Promise.resolve('granted'); }
    };
    if (hidden) Object.defineProperty(document, 'hidden', { get: () => true });
  }, { saved, hidden });

  await page.route('**/server.arcgisonline.com/**', route => route.abort());
  await page.route('**/hopapp.onrender.com/api/vehicles**', route => route.fulfill({ json: [] }));
  await page.route('**/hopapp.onrender.com/api/stop-times**', route => {
    state.requests++;
    const now = Math.floor(Date.now() / 1000);
    const list = state.arrivals(now);
    if (list === null) return route.fulfill({ status: 404, json: { error: 'Not found' } });
    return route.fulfill({ json: { now, arrivals: list } });
  });

  await page.goto('/frontend/map/map.html');
  await page.waitForFunction(() => typeof stopIndex !== 'undefined' && stopIndex.size > 0, null, { timeout: 20000 });
  return state;
}

// Opens the map's own stop card for a stop, the same card you get by tapping it
async function openStopCard(page, stopId = STOP.id) {
  await page.evaluate(() => map.closePopup());
  await expect(page.locator('.bus-alert-form')).toHaveCount(0);   // the old card fades out first
  await page.evaluate((id) => {
    const stop = stopIndex.get(id);
    L.popup({ minWidth: 230, maxWidth: 290 }).setLatLng([stop.lat, stop.lon]).setContent(stopCard(stop, [])).openOn(map);
  }, stopId);
  await expect(page.locator('.bus-alert-form')).toBeVisible();
}

async function setAlert(page, { bus = '409', due = '5' } = {}) {
  await openStopCard(page);
  const form = page.locator('.bus-alert-form');
  await expect(form.getByLabel('Which bus').locator('option', { hasText: new RegExp('^' + bus + '$') })).toHaveCount(1);
  await form.getByLabel('Which bus').selectOption(bus === 'Any bus' ? '' : bus);
  await form.getByLabel('How many minutes away').selectOption(due);
  await form.getByRole('button', { name: 'Alert me' }).click();
  await expect(form.getByRole('button', { name: 'Alert set' })).toBeDisabled();
}

const toasts = page => page.locator('.bus-alert-toast');
const checkNow = page => page.evaluate(() => window.HopBusAlerts.checkNow());

test('The stop card offers alerts for the buses that stop there', async ({ page }) => {
  await openMap(page);
  await openStopCard(page);
  const form = page.locator('.bus-alert-form');
  await expect(form.getByRole('heading', { name: 'Bus alerts' })).toBeVisible();
  await expect(form.getByLabel('Which bus').locator('option').first()).toHaveText('Any bus');
  await expect(form.getByLabel('Which bus').locator('option', { hasText: /^409$/ })).toHaveCount(1);
  await expect(form.getByLabel('How many minutes away')).toHaveValue('5');
  await expect(form.getByRole('checkbox')).toBeChecked();
});

test('An alert is listed with the next bus, and kept after a reload', async ({ page }) => {
  await openMap(page, { arrivals: now => [{ routeId: ROUTE_409, tripId: 't1', time: now + 20 * 60, delay: 120 }] });
  await setAlert(page);

  await expect(page.getByRole('button', { name: 'Bus alerts, 1 on' })).toHaveText('Alerts (1)');
  await page.getByRole('button', { name: 'Bus alerts, 1 on' }).click();
  const item = page.locator('.bus-alerts-item');
  await expect(item.locator('strong')).toHaveText('409 at Eyre Square');
  await expect(item.locator('small')).toHaveText('When 5 min away, and if 5+ min late');
  await expect(item.locator('.bus-alerts-status')).toHaveText('Next 409: in 20 minutes, 2 min late.');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Bus alerts, 1 on' })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hop.busAlerts')));
  expect(saved[0]).toMatchObject({ stopId: STOP.id, stopName: 'Eyre Square', routeLabel: '409', dueMin: 5, late: true });
  expect(saved[0].routeIds).toContain(ROUTE_409);
});

test('Says when the bus is close, only once per bus', async ({ page }) => {
  await openMap(page, { arrivals: now => [{ routeId: ROUTE_409, tripId: 't1', time: now + 4 * 60, delay: 0 }] });
  await setAlert(page);

  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page).first()).toContainText('409 is 4 minutes away');
  await expect(toasts(page).first()).toContainText('Due at Eyre Square at');
  await expect(toasts(page).first()).toContainText('(on time)');

  await checkNow(page);
  await checkNow(page);
  await expect(toasts(page)).toHaveCount(1);
});

test('A bus further away than the chosen time is not announced yet', async ({ page }) => {
  await openMap(page, { arrivals: now => [{ routeId: ROUTE_409, tripId: 't1', time: now + 8 * 60, delay: 0 }] });
  await setAlert(page, { due: '5' });
  await checkNow(page);
  await expect(toasts(page)).toHaveCount(0);
});

test('Says when the bus is running late, and again if it gets later', async ({ page }) => {
  let delay = 7 * 60;
  const state = await openMap(page, { arrivals: now => [{ routeId: ROUTE_409, tripId: 't1', time: now + 30 * 60, delay }] });
  await setAlert(page);
  await expect(toasts(page).first()).toContainText('409 is running 7 min late');

  delay = 8 * 60;   // later, but not another 5 minutes later
  await checkNow(page);
  await expect(toasts(page)).toHaveCount(1);

  delay = 11 * 60;
  await checkNow(page);
  await expect(toasts(page)).toHaveCount(2);
  await expect(toasts(page).first()).toContainText('409 is running 11 min late');
  await expect(toasts(page).first()).toHaveClass(/is-late/);
  expect(state.requests).toBeGreaterThanOrEqual(3);
});

test('Late alerts can be turned off', async ({ page }) => {
  await openMap(page, { arrivals: now => [{ routeId: ROUTE_409, tripId: 't1', time: now + 30 * 60, delay: 15 * 60 }] });
  await openStopCard(page);
  await page.locator('.bus-alert-form').getByRole('checkbox').uncheck();
  await page.locator('.bus-alert-form').getByRole('button', { name: 'Alert me' }).click();
  await checkNow(page);
  await expect(toasts(page)).toHaveCount(0);
});

test('An alert for one bus ignores other buses at the stop', async ({ page }) => {
  await openMap(page, { arrivals: now => [
    { routeId: 'another-route', tripId: 'x1', time: now + 2 * 60, delay: 900 },
    { routeId: ROUTE_409, tripId: 't1', time: now + 25 * 60, delay: 0 }
  ] });
  await setAlert(page, { bus: '409' });
  await checkNow(page);
  await expect(toasts(page)).toHaveCount(0);
  await page.getByRole('button', { name: /Bus alerts/ }).click();
  await expect(page.locator('.bus-alerts-status')).toHaveText('Next 409: in 25 minutes, on time.');
});

test('"Any bus" alerts for every bus at the stop', async ({ page }) => {
  await openMap(page, { arrivals: now => [{ routeId: 'another-route', tripId: 'x1', time: now + 3 * 60, delay: 0 }] });
  await setAlert(page, { bus: 'Any bus' });
  await expect(toasts(page).first()).toContainText('A bus is 3 minutes away');
});

test('When live times are unavailable it says so, without alerts', async ({ page }) => {
  await openMap(page, { arrivals: () => null });   // the server answers 404, like before the new server is deployed
  await setAlert(page);
  await page.getByRole('button', { name: /Bus alerts/ }).click();
  await expect(page.locator('.bus-alerts-status')).toHaveText('Live times are not available right now.');
  await expect(toasts(page)).toHaveCount(0);
});

test('A browser notification is sent when the page is in the background', async ({ page }) => {
  await openMap(page, { hidden: true, arrivals: now => [{ routeId: ROUTE_409, tripId: 't1', time: now + 2 * 60, delay: 0 }] });
  await setAlert(page);
  await expect.poll(() => page.evaluate(() => window.__notes.length)).toBe(1);
  const note = await page.evaluate(() => window.__notes[0]);
  expect(note.title).toBe('409 is 2 minutes away');
});

test('An alert can be removed', async ({ page }) => {
  await openMap(page);
  await setAlert(page);
  await page.getByRole('button', { name: /Bus alerts/ }).click();
  await page.getByRole('button', { name: 'Remove alert for 409 at Eyre Square' }).click();
  await expect(page.locator('.bus-alerts-panel')).toContainText('No alerts yet.');
  await expect(page.getByRole('button', { name: 'Bus alerts, none set' })).toHaveText('Alerts');
  expect(await page.evaluate(() => localStorage.getItem('hop.busAlerts'))).toBe('[]');
});

test('Setting the same alert again replaces it', async ({ page }) => {
  await openMap(page);
  for (const due of ['2', '5', '10']) await setAlert(page, { bus: 'Any bus', due });   // same stop and bus: replaced
  await expect(page.getByRole('button', { name: /Bus alerts/ })).toHaveText('Alerts (1)');
  expect((await page.evaluate(() => window.HopBusAlerts.list()))[0].dueMin).toBe(10);
});

test('Broken saved alerts are ignored', async ({ page }) => {
  await openMap(page, { saved: '{not json' });
  await expect(page.getByRole('button', { name: 'Bus alerts, none set' })).toBeVisible();
});

test('Tampered saved alerts are ignored', async ({ page }) => {
  await openMap(page, { saved: [
    { id: 'a', stopId: '../../etc', stopName: 'X', routeIds: [], routeLabel: 'Any bus', dueMin: 5, late: true },
    { id: 'b', stopId: STOP.id, stopName: 'Eyre Square', routeIds: [], routeLabel: 'Any bus', dueMin: 99, late: true },
    { id: 'c', stopId: STOP.id, stopName: 'Eyre Square', routeIds: [], routeLabel: 'Any bus', dueMin: 5, late: true }
  ] });
  expect((await page.evaluate(() => window.HopBusAlerts.list())).map(a => a.id)).toEqual(['c']);
});
