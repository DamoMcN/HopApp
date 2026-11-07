const { test, expect } = require('@playwright/test');

// Saving a Payment Card. topup.php is faked with page.route, and every POST
// is recorded so we can check exactly what would be sent to the server.

async function openTopUp(page, cards = []) {
  const sent = [];
  await page.route('**/backend/auth/topup.php', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      return route.fulfill({ json: { logged_in: true, mode: 'mock', balance: 5, cards } });
    }
    const body = req.postDataJSON();
    sent.push(body);
    if (body.action === 'remove_card') {
      cards = cards.filter((c) => c.id !== body.card_id);
      return route.fulfill({ json: { success: true, cards } });
    }
    if (body.save) cards = [...cards, { id: 9, ...body.card }];
    return route.fulfill({ json: { success: true, replayed: false, balance: 15, card_saved: !!body.save, cards } });
  });
  await page.goto('/frontend/topup/topup.html');
  return sent;
}

async function fillCard(page, number, exp = '12/30', csc = '123') {
  await page.getByRole('button', { name: '+ Pay with a new card' }).click();
  await page.fill('#cc-name', 'Test Person');
  await page.fill('#cc-number', number);
  await page.fill('#cc-exp', exp);
  await page.fill('#cc-csc', csc);
}

test('Card form fields can be autofilled by the browser', async ({ page }) => {
  await openTopUp(page);
  for (const [id, ac] of [['cc-name', 'cc-name'], ['cc-number', 'cc-number'], ['cc-exp', 'cc-exp'], ['cc-csc', 'cc-csc']]) {
    await expect(page.locator('#' + id)).toHaveAttribute('autocomplete', ac);
  }
});

test('Saving a card sends only brand, last 4 and expiry, and confirms', async ({ page }) => {
  const sent = await openTopUp(page);
  await fillCard(page, '4242424242424242');
  await expect(page.locator('#cc-number')).toHaveValue('4242 4242 4242 4242');
  await page.getByRole('button', { name: /^Pay €/ }).click();

  await expect(page.locator('#message')).toContainText('Visa •••• 4242 is saved for future top ups');
  await expect(page.locator('.saved-card')).toContainText('Visa •••• 4242');
  await expect(page.locator('#card-dialog')).not.toBeVisible();

  expect(sent[0].source).toBe('new_card');
  expect(sent[0].save).toBe(true);
  expect(sent[0].card).toEqual({ brand: 'Visa', last4: '4242', exp_month: 12, exp_year: 2030 });
  expect(JSON.stringify(sent[0])).not.toContain('4242424242424242');
  expect(JSON.stringify(sent[0])).not.toContain('"123"');   // the CVC is never sent
});

test('Paying without ticking "Save" does not save the card', async ({ page }) => {
  const sent = await openTopUp(page);
  await fillCard(page, '5555555555554444');
  await page.locator('#cc-save').uncheck();
  await page.getByRole('button', { name: /^Pay €/ }).click();
  await expect(page.locator('#message')).toHaveText('Added €10.00 to your card.');
  expect(sent[0].save).toBe(false);
  await expect(page.locator('.saved-card')).toHaveCount(0);
});

test('Wrong card details are caught before anything is sent', async ({ page }) => {
  const sent = await openTopUp(page);
  await fillCard(page, '4242424242424241');
  await page.getByRole('button', { name: /^Pay €/ }).click();
  await expect(page.locator('#card-error')).toContainText("doesn't look right");

  await page.fill('#cc-number', '4242424242424242');
  await page.fill('#cc-exp', '01/20');
  await page.getByRole('button', { name: /^Pay €/ }).click();
  await expect(page.locator('#card-error')).toContainText('expired');
  expect(sent).toHaveLength(0);
});

test('A saved card can be removed', async ({ page }) => {
  const sent = await openTopUp(page, [{ id: 3, brand: 'Visa', last4: '4242', exp_month: 8, exp_year: 2029 }]);
  await expect(page.locator('.saved-card')).toContainText('Visa •••• 4242Expires 08/29');
  await page.getByRole('button', { name: 'Remove Visa ending 4242' }).click();
  await expect(page.locator('.remove-card')).toHaveText('Remove?');
  await page.getByRole('button', { name: 'Remove Visa ending 4242' }).click();
  await expect(page.locator('#message')).toHaveText('Visa •••• 4242 removed.');
  await expect(page.locator('.saved-card')).toHaveCount(0);
  expect(sent[0]).toEqual({ action: 'remove_card', card_id: 3 });
});
