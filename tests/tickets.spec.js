const { test, expect } = require('@playwright/test');

// Tickets page. It shows the journey the map saved in sessionStorage
// ('hop.ticketDraft'), and must ignore anything missing or tampered with.

const DRAFT_KEY = 'hop.ticketDraft';

const JOURNEY = {
  routeId: '4321_12345', shortName: '409', longName: 'Eyre Square - Parkmore',
  agency: 'Bus Éireann', fromId: 'stop-1', fromName: 'Eyre Square',
  toId: 'stop-2', toName: 'Parkmore Business Park', stopsBetween: 12
};

// Puts the draft in sessionStorage before the page's scripts run.
// Pass a string to store it exactly as given (e.g. broken JSON).
async function openTickets(page, draft) {
  if (draft !== undefined) {
    const raw = typeof draft === 'string' ? draft : JSON.stringify(draft);
    await page.addInitScript(([key, value]) => {
      if (!sessionStorage.getItem('test.seeded')) {
        sessionStorage.setItem(key, value);
        sessionStorage.setItem('test.seeded', '1');
      }
    }, [DRAFT_KEY, raw]);
  }
  await page.goto('/frontend/tickets/tickets.html');
}

async function expectEmpty(page) {
  await expect(page.locator('#tickets-empty')).toBeVisible();
  await expect(page.locator('#journey')).toBeHidden();
}

test('With no journey saved, the empty state links to the map', async ({ page }) => {
  await openTickets(page);
  await expectEmpty(page);
  await expect(page.getByRole('link', { name: 'Plan a journey' }))
    .toHaveAttribute('href', '../map/map.html?mode=tickets');
});

test('A saved journey is shown', async ({ page }) => {
  await openTickets(page, JOURNEY);
  await expect(page.locator('#journey')).toBeVisible();
  await expect(page.locator('#tickets-empty')).toBeHidden();
  await expect(page.locator('#j-badge')).toHaveText('409');
  await expect(page.locator('#j-badge')).not.toHaveClass(/is-citylink/);
  await expect(page.locator('#j-name')).toHaveText('Eyre Square - Parkmore');
  await expect(page.locator('#j-agency')).toHaveText('Bus Éireann');
  await expect(page.locator('#j-from')).toHaveText('Eyre Square');
  await expect(page.locator('#j-to')).toHaveText('Parkmore Business Park');
  await expect(page.locator('#j-between')).toHaveText('12 stops on this journey.');
  await expect(page.getByRole('button', { name: 'Buy ticket' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Change journey' }))
    .toHaveAttribute('href', '../map/map.html?mode=tickets');
});

test('One stop is singular', async ({ page }) => {
  await openTickets(page, { ...JOURNEY, stopsBetween: 1 });
  await expect(page.locator('#j-between')).toHaveText('1 stop on this journey.');
});

test('Citylink routes get the Citylink badge', async ({ page }) => {
  await openTickets(page, { ...JOURNEY, agency: 'Citylink' });
  await expect(page.locator('#j-badge')).toHaveClass(/is-citylink/);
});

test('Missing route name and operator get sensible defaults', async ({ page }) => {
  await openTickets(page, { ...JOURNEY, longName: '', agency: '' });
  await expect(page.locator('#j-name')).toHaveText('Bus route');
  await expect(page.locator('#j-agency')).toHaveText('Unknown operator');
});

test('Clear removes the saved journey and goes back to choosing one', async ({ page }) => {
  await openTickets(page, JOURNEY);
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('#journey')).toBeHidden();
  await expect(page.locator('#builder')).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), DRAFT_KEY)).toBeNull();
});

test('Text from storage is shown as text, never as HTML', async ({ page }) => {
  const attack = '<img src=x onerror="window.hacked=1">';
  await openTickets(page, { ...JOURNEY, fromName: attack, shortName: '<b>9</b>' });
  await expect(page.locator('#j-from')).toHaveText(attack);
  await expect(page.locator('#j-badge')).toHaveText('<b>9</b>');
  await expect(page.locator('#journey img, #journey b')).toHaveCount(0);
  expect(await page.evaluate(() => window.hacked)).toBeUndefined();
});

const BAD_DRAFTS = {
  'broken JSON':                '{not json',
  'not an object':              '"just a string"',
  'missing route':              { ...JOURNEY, routeId: undefined },
  'missing from stop':          { ...JOURNEY, fromName: '' },
  'missing to stop':            { ...JOURNEY, toId: null },
  'zero stops':                 { ...JOURNEY, stopsBetween: 0 },
  'too many stops':             { ...JOURNEY, stopsBetween: 501 },
  'fractional stops':           { ...JOURNEY, stopsBetween: 1.5 },
  'stops as text':              { ...JOURNEY, stopsBetween: '12' },
  'route number too long':      { ...JOURNEY, shortName: 'x'.repeat(21) },
  'stop name too long':         { ...JOURNEY, toName: 'x'.repeat(161) },
  'number instead of text':     { ...JOURNEY, fromId: 42 }
};

for (const [name, draft] of Object.entries(BAD_DRAFTS)) {
  test(`A tampered journey is ignored: ${name}`, async ({ page }) => {
    await openTickets(page, draft);
    await expectEmpty(page);
  });
}

test('The longest allowed values are still accepted', async ({ page }) => {
  await openTickets(page, { ...JOURNEY, shortName: 'x'.repeat(20), toName: 'y'.repeat(160), stopsBetween: 500 });
  await expect(page.locator('#journey')).toBeVisible();
  await expect(page.locator('#j-between')).toHaveText('500 stops on this journey.');
});
