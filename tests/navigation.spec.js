const { test, expect } = require('@playwright/test');

// The side menu (shared/js/menu.js) and the bottom bar (shared/js/navbar.js).
// The Tickets page is used because it makes no server calls.

const TICKETS = '/frontend/tickets/tickets.html';

const menuButton = page => page.getByRole('button', { name: 'Open menu' });
const sideMenu = page => page.locator('#side-menu');

test('The menu opens and closes with the close button', async ({ page }) => {
  await page.goto(TICKETS);
  await menuButton(page).click();
  await expect(sideMenu(page)).toHaveClass(/open/);
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Close menu' })).toBeFocused();

  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect(sideMenu(page)).not.toHaveClass(/open/);
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(menuButton(page)).toBeFocused();
});

test('Escape and pressing outside the menu close it', async ({ page }) => {
  await page.goto(TICKETS);
  await menuButton(page).click();
  await page.keyboard.press('Escape');
  await expect(sideMenu(page)).not.toHaveClass(/open/);

  await menuButton(page).click();
  const size = page.viewportSize();
  await page.locator('.menu-overlay').click({ position: { x: size.width - 20, y: size.height / 2 } });
  await expect(sideMenu(page)).not.toHaveClass(/open/);
});

test('The menu lists every page, with Log Out at the bottom', async ({ page }) => {
  await page.goto(TICKETS);
  await menuButton(page).click();
  // last span = the label (Help & Support also has a "?" icon span)
  await expect(sideMenu(page).locator('.side-menu-list a > span:last-child')).toHaveText([
    'My Card', 'Map', 'Tickets', 'Top Up', 'Recurring Top Up', 'Settings', 'Help & Support'
  ]);
  await expect(sideMenu(page).locator('.side-menu-footer')).toHaveText('Log Out');
});

test('Every menu link points to a page that exists', async ({ page }) => {
  await page.goto(TICKETS);
  const hrefs = await sideMenu(page).locator('.side-menu-list a')
    .evaluateAll(links => links.map(a => a.href));
  for (const href of hrefs) {
    const response = await page.request.get(href);
    expect(response.status(), href).toBe(200);
  }
});

test('Log Out goes to the login page', async ({ page }) => {
  await page.goto(TICKETS);
  await menuButton(page).click();
  await page.getByRole('button', { name: 'Log Out' }).click();
  await page.waitForURL('**/frontend/auth/index.html');
});

test('The bottom bar shows the default tabs and marks the current page', async ({ page }) => {
  await page.goto(TICKETS);
  const items = page.locator('.bottom-nav .bottom-nav-item');
  await expect(items).toHaveText(['Card', 'Map', 'Tickets']);
  await expect(page.locator('.bottom-nav [aria-current="page"]')).toHaveText('Tickets');
});

test('Every bottom bar tab points to a page that exists', async ({ page }) => {
  await page.goto(TICKETS);
  const hrefs = await page.evaluate(() =>
    Object.values(window.HopNav.TABS).map(t => new URL(t.href, location.href).href));
  for (const href of hrefs) {
    const response = await page.request.get(href);
    expect(response.status(), href).toBe(200);
  }
});

test('A bad saved bar layout can never break the bar', async ({ page }) => {
  await page.goto(TICKETS);
  const result = await page.evaluate(() => {
    const s = window.HopNav.sanitise;
    return {
      nothing:       s(null),
      junk:          s('not an object'),
      unknownTabs:   s({ tabs: ['card', 'bogus', 'map'] }),
      tooFew:        s({ tabs: ['card', 'bogus'] }),
      duplicates:    s({ tabs: ['home', 'card', 'map', 'map'] }),
      allTabs:       s({ tabs: ['card', 'map', 'tickets', 'topup', 'support'], startPage: 'topup' }),
      badStartPage:  s({ tabs: ['card', 'map'], startPage: 'nowhere' })
    };
  });
  const defaults = { tabs: ['card', 'map', 'tickets'], startPage: 'card' };

  expect(result.nothing).toEqual(defaults);
  expect(result.junk).toEqual(defaults);
  expect(result.unknownTabs).toEqual({ tabs: ['card', 'map'], startPage: 'card' });
  expect(result.tooFew).toEqual(defaults);
  expect(result.duplicates).toEqual({ tabs: ['card', 'map'], startPage: 'card' });   // 'home' means card
  expect(result.allTabs).toEqual({ tabs: ['card', 'map', 'tickets', 'topup', 'support'], startPage: 'topup' });
  expect(result.badStartPage.startPage).toBe('card');
});

test('A custom bar layout is drawn in the saved order', async ({ page }) => {
  await page.goto(TICKETS);
  await page.evaluate(() => window.HopNav.init({ tabs: ['support', 'tickets', 'topup'], startPage: 'map' }));
  await expect(page.locator('.bottom-nav')).toHaveCount(1);   // re-drawn, not duplicated
  await expect(page.locator('.bottom-nav .bottom-nav-item')).toHaveText(['Help', 'Tickets', 'Top Up']);
  expect(await page.evaluate(() => window.HopNav.startPageHref())).toBe('../map/map.html');
});
