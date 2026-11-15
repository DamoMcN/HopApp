const { test, expect } = require('@playwright/test');

// Login page (frontend/auth/auth.js). login.php is faked with page.route,
// because the test server doesn't run PHP.

async function fakeLogin(page, reply) {
  const sent = [];
  await page.route('**/backend/auth/login.php', async (route) => {
    sent.push(route.request().postData());
    await reply(route);
  });
  return sent;
}

async function fillAndSubmit(page, password = 'Secret123!') {
  await page.goto('/frontend/auth/index.html');
  await page.fill('#login-email', 'test@example.com');
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'Log In' }).click();
}

test('A successful login opens the card page', async ({ page }) => {
  const sent = await fakeLogin(page, route => route.fulfill({ json: { success: true } }));
  await fillAndSubmit(page);
  await page.waitForURL('**/frontend/card/card.html');
  expect(sent[0]).toContain('test@example.com');   // the form fields are posted
});

test('Wrong email or password clears the password and explains why', async ({ page }) => {
  await fakeLogin(page, route => route.fulfill({
    json: { success: false, code: 'bad_credentials', message: 'Invalid' }
  }));
  await fillAndSubmit(page);

  const notice = page.getByRole('alertdialog');
  await expect(notice.locator('#notice-title')).toHaveText("Those details don't match");
  await expect(page.locator('#login-password')).toHaveValue('');

  await notice.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('#login-password')).toBeFocused();
  await expect(page.locator('#login-password')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Log In' })).toBeEnabled();
});

test('Other server errors show the server message', async ({ page }) => {
  await fakeLogin(page, route => route.fulfill({
    json: { success: false, code: 'server_error', message: 'Something went wrong on our side.' }
  }));
  await fillAndSubmit(page);
  await expect(page.locator('#notice-title')).toHaveText("Couldn't log you in");
  await expect(page.locator('#notice-text')).toHaveText('Something went wrong on our side.');
  await expect(page.locator('#login-password')).not.toHaveValue('');   // only cleared for bad credentials
});

test('A PHP error page (not JSON) shows a friendly message', async ({ page }) => {
  await fakeLogin(page, route => route.fulfill({
    status: 500, contentType: 'text/html', body: '<b>Fatal error</b>: Uncaught PDOException'
  }));
  await fillAndSubmit(page);
  await expect(page.locator('#notice-title')).toHaveText('Something went wrong on our side');
  await expect(page.locator('#notice-text')).not.toContainText('PDOException');
});

test('No connection shows "Couldn\'t reach Hop"', async ({ page }) => {
  await fakeLogin(page, route => route.abort('internetdisconnected'));
  await fillAndSubmit(page);
  await expect(page.locator('#notice-title')).toHaveText("Couldn't reach Hop");
  await expect(page.getByRole('button', { name: 'Log In' })).toBeEnabled();
});

test('The button is disabled while logging in', async ({ page }) => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await fakeLogin(page, async (route) => {
    await held;
    await route.fulfill({ json: { success: false, code: 'bad_credentials' } });
  });
  await fillAndSubmit(page);

  const button = page.locator('#login-form .submit-btn');
  await expect(button).toHaveText('Logging in...');
  await expect(button).toBeDisabled();

  release();
  await expect(button).toHaveText('Log In');
  await expect(button).toBeEnabled();
});

test('Empty login form is not sent', async ({ page }) => {
  const sent = await fakeLogin(page, route => route.fulfill({ json: { success: true } }));
  await page.goto('/frontend/auth/index.html');
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL(/auth\/index\.html/);
  expect(sent).toHaveLength(0);
});

test('"Forgot your password?" says reset is coming soon and links to support', async ({ page }) => {
  await page.goto('/frontend/auth/index.html');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page.locator('#notice-title')).toHaveText('Password reset is coming soon');
  await expect(page.getByRole('link', { name: 'Go to Help & Support' }))
    .toHaveAttribute('href', '../support/support.html');
});

test('Login page links to sign up and Help & Support', async ({ page }) => {
  await page.goto('/frontend/auth/index.html');
  await expect(page.getByRole('link', { name: 'Sign up here' })).toHaveAttribute('href', 'signup.html');
  await expect(page.locator('.global-help-btn')).toHaveAttribute('href', '../support/support.html');
});
