const { test, expect } = require('@playwright/test');

// Change name, email, phone number or password in Settings (frontend/setting/account.js).
// The PHP backend is faked: tests-db/account.db.spec.js checks the real backend/auth/account.php.

const ME = { logged_in: true, user_id: 7, f_name: 'Test', l_name: 'User', email: 'test@example.com',
  phone_last4: '4567', card_type: 'Student', card_number: '12345678', card_status: 'active', wallet_balance: 10 };

// reply(body) returns what account.php answers; every request body is kept in `sent`
async function openSettings(page, reply = () => ({ success: true, message: 'Saved.' }), me = ME) {
  const sent = [];
  await page.route('**/backend/auth/session.php', r => r.fulfill({ json: me }));
  await page.route('**/backend/auth/topup.php', r => r.fulfill({ json: { logged_in: true, mode: 'mock', balance: 10, cards: [] } }));
  await page.route('**/backend/auth/user_settings.php', r => r.fulfill({ json: { logged_in: true, success: true } }));
  await page.route('**/backend/auth/account.php', r => {
    const body = r.request().postDataJSON();
    sent.push(body);
    const answer = reply(body);
    return r.fulfill({ status: answer.status || 200, json: answer });
  });
  await page.goto('/frontend/setting/setting.html');
  await expect(page.locator('#profile-name')).toHaveText([me.f_name, me.l_name].join(' '));
  return sent;
}

const pencil = (page, name) => page.getByRole('button', { name: 'Edit ' + name });

test('Name, email and phone each have a pencil button; card type does not', async ({ page }) => {
  await openSettings(page);
  await expect(page.getByText('To change your name or email, contact Help')).toHaveCount(0);
  for (const name of ['name', 'email', 'phone number']) {
    await expect(pencil(page, name)).toBeVisible();
    await expect(pencil(page, name)).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(page.locator('.profile-row', { hasText: 'Card type' }).locator('.edit-btn')).toHaveCount(0);
  await expect(page.locator('form#name-form')).toBeHidden();   // forms stay closed until a pencil is pressed
});

test('The phone number shows only its last four digits', async ({ page }) => {
  await openSettings(page);
  await expect(page.locator('#profile-phone')).toHaveText('••• 4567');
});

test('A missing phone number says so', async ({ page }) => {
  await openSettings(page, undefined, { ...ME, phone_last4: '' });
  await expect(page.locator('#profile-phone')).toHaveText('Not added');
});

test('A pencil opens its form under the row, and Cancel or Escape closes it', async ({ page }) => {
  await openSettings(page);
  await pencil(page, 'name').click();
  await expect(page.getByLabel('First name')).toBeVisible();
  await expect(page.getByLabel('First name')).toBeFocused();
  await expect(page.getByLabel('First name')).toHaveValue('Test');
  await expect(pencil(page, 'name')).toHaveAttribute('aria-expanded', 'true');

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('form#name-form')).toBeHidden();
  await expect(pencil(page, 'name')).toBeFocused();

  await pencil(page, 'email').click();
  await expect(page.getByLabel('New email')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('form#email-form')).toBeHidden();
  await expect(pencil(page, 'email')).toBeFocused();
});

test('Only one form is open at a time', async ({ page }) => {
  await openSettings(page);
  await pencil(page, 'name').click();
  await pencil(page, 'phone number').click();
  await expect(page.locator('form#name-form')).toBeHidden();
  await expect(page.locator('form#phone-form')).toBeVisible();
  await expect(pencil(page, 'name')).toHaveAttribute('aria-expanded', 'false');
});

test('Changing the name saves it, closes the form and updates the profile', async ({ page }) => {
  const sent = await openSettings(page, (body) => ({
    success: true, message: 'Your name has been updated.', f_name: body.first_name, l_name: body.last_name }));
  await pencil(page, 'name').click();
  await page.getByLabel('First name').fill('  Aoife ');
  await page.getByLabel('Last name').fill("O'Brien");
  await page.getByRole('button', { name: 'Save name' }).click();

  await expect(page.locator('#profile-message')).toHaveText('Your name has been updated.');
  await expect(page.locator('#profile-name')).toHaveText("Aoife O'Brien");
  await expect(page.locator('form#name-form')).toBeHidden();
  await expect(pencil(page, 'name')).toBeFocused();
  expect(sent).toEqual([{ action: 'name', first_name: 'Aoife', last_name: "O'Brien" }]);

  await pencil(page, 'name').click();   // opens again with the new name filled in
  await expect(page.getByLabel('First name')).toHaveValue('Aoife');
});

test('An empty name is caught before anything is sent', async ({ page }) => {
  const sent = await openSettings(page);
  await pencil(page, 'name').click();
  await page.getByLabel('Last name').fill('   ');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.locator('#name-message')).toHaveText('Enter your last name.');
  await expect(page.getByLabel('Last name')).toBeFocused();
  await expect(page.getByLabel('Last name')).toHaveAttribute('aria-invalid', 'true');
  expect(sent).toHaveLength(0);
});

test('Changing the email needs the current password and updates the profile', async ({ page }) => {
  const sent = await openSettings(page, (body) => ({
    success: true, message: 'Your email has been updated. Use it the next time you log in.', email: body.new_email }));
  await pencil(page, 'email').click();

  await page.getByLabel('New email').fill('new@example.com');
  await page.getByRole('button', { name: 'Save email' }).click();
  await expect(page.locator('#email-message')).toHaveText('Enter your current password.');
  expect(sent).toHaveLength(0);

  await page.locator('#email-current-password').fill('Old-Pass123!');
  await page.getByRole('button', { name: 'Save email' }).click();
  await expect(page.locator('#profile-message')).toHaveText('Your email has been updated. Use it the next time you log in.');
  await expect(page.locator('#profile-email')).toHaveText('new@example.com');
  await expect(page.locator('#profile-email')).toHaveAttribute('href', 'mailto:new@example.com');
  expect(sent).toEqual([{ action: 'email', new_email: 'new@example.com', current_password: 'Old-Pass123!' }]);

  await pencil(page, 'email').click();   // the password isn't left in the box
  await expect(page.locator('#email-current-password')).toHaveValue('');
});

test('A bad email address is caught before anything is sent', async ({ page }) => {
  const sent = await openSettings(page);
  await pencil(page, 'email').click();
  await page.getByLabel('New email').fill('not-an-email');
  await page.locator('#email-current-password').fill('Old-Pass123!');
  await page.getByRole('button', { name: 'Save email' }).click();
  await expect(page.locator('#email-message')).toHaveText('Enter a valid email address.');
  expect(sent).toHaveLength(0);
});

test('The server\'s answer is shown on the box that needs fixing', async ({ page }) => {
  await openSettings(page, () => ({ success: false, message: 'Your current password is not right.',
    field: 'current_password', code: 'wrong_password', status: 422 }));
  await pencil(page, 'email').click();
  await page.getByLabel('New email').fill('new@example.com');
  await page.locator('#email-current-password').fill('Wrong-Pass123!');
  await page.getByRole('button', { name: 'Save email' }).click();
  await expect(page.locator('#email-message')).toHaveText('Your current password is not right.');
  await expect(page.locator('#email-current-password')).toBeFocused();
  await expect(page.locator('form#email-form')).toBeVisible();          // stays open to fix it
  await expect(page.locator('#profile-email')).toHaveText('test@example.com');   // unchanged
});

test('Changing the phone number shows only the new last four digits', async ({ page }) => {
  const sent = await openSettings(page, () => ({ success: true, message: 'Your phone number has been updated.', phone_last4: '9876' }));
  await pencil(page, 'phone number').click();
  await expect(page.getByLabel('New phone number')).toBeFocused();
  await expect(page.getByLabel('New phone number')).toHaveValue('');   // the full number is never on the page

  await page.getByLabel('New phone number').fill('12ab');
  await page.getByRole('button', { name: 'Save phone number' }).click();
  await expect(page.locator('#phone-message')).toContainText('Enter a valid phone number');
  expect(sent).toHaveLength(0);

  await page.getByLabel('New phone number').fill('+353 (87) 765-9876');
  await page.getByRole('button', { name: 'Save phone number' }).click();
  await expect(page.locator('#profile-phone')).toHaveText('••• 9876');
  await expect(page.locator('#profile-message')).toHaveText('Your phone number has been updated.');
  expect(sent).toEqual([{ action: 'phone', new_phone: '+353 (87) 765-9876' }]);
});

test('Changing the password checks the rules, then clears the boxes', async ({ page }) => {
  const sent = await openSettings(page, () => ({ success: true, message: 'Your password has been changed.' }));
  await page.locator('summary', { hasText: 'Change password' }).click();
  const save = page.getByRole('button', { name: 'Save password' });

  await page.locator('#password-form').getByLabel('Current password').fill('Old-Pass123!');
  await page.getByLabel('New password', { exact: true }).fill('short');
  await save.click();
  await expect(page.locator('#password-message')).toContainText('needs 8 to 72 characters');

  await page.getByLabel('New password', { exact: true }).fill('New-Pass456!');
  await page.getByLabel('Confirm new password').fill('New-Pass456?');
  await save.click();
  await expect(page.locator('#password-message')).toHaveText("The two new passwords don't match.");
  await expect(page.getByLabel('Confirm new password')).toBeFocused();

  await page.getByLabel('New password', { exact: true }).fill('Old-Pass123!');
  await page.getByLabel('Confirm new password').fill('Old-Pass123!');
  await save.click();
  await expect(page.locator('#password-message')).toHaveText('Your new password must be different from your current one.');
  expect(sent).toHaveLength(0);

  await page.getByLabel('New password', { exact: true }).fill('New-Pass456!');
  await page.getByLabel('Confirm new password').fill('New-Pass456!');
  await save.click();
  await expect(page.locator('#password-message')).toHaveText('Your password has been changed.');
  for (const id of ['#current-password', '#new-password', '#confirm-password']) {
    await expect(page.locator(id)).toHaveValue('');
  }
  expect(sent).toEqual([{ action: 'password', current_password: 'Old-Pass123!',
    new_password: 'New-Pass456!', confirm_password: 'New-Pass456!' }]);
});

test('Show passwords reveals the password boxes', async ({ page }) => {
  await openSettings(page);
  await page.locator('summary', { hasText: 'Change password' }).click();
  await expect(page.locator('#new-password')).toHaveAttribute('type', 'password');
  await page.getByLabel('Show passwords').check();
  for (const id of ['#current-password', '#new-password', '#confirm-password']) {
    await expect(page.locator(id)).toHaveAttribute('type', 'text');
  }
});

test('Being logged out while saving goes to the login page', async ({ page }) => {
  await openSettings(page, () => ({ logged_in: false, status: 401 }));
  await pencil(page, 'name').click();
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.waitForURL('**/frontend/auth/index.html');
});

test('Settings search opens the phone form and the Change password section', async ({ page }) => {
  await openSettings(page);
  const search = page.getByRole('searchbox', { name: 'Search settings' });
  const result = (text) => page.locator('#settings-search-results .settings-result', { hasText: text });

  await search.fill('phone');
  await result('Change phone number').click();
  await expect(page.locator('form#phone-form')).toBeVisible();
  await expect(page.getByLabel('New phone number')).toBeFocused();

  await search.fill('password');
  await result('Change password').click();
  await expect(page.locator('#change-password')).toHaveAttribute('open', '');
  await expect(page.locator('#change-password-toggle')).toBeFocused();
});
