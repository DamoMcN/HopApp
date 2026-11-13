const { test, expect } = require('@playwright/test');

// Contact Support (SCRUM-125) on the Help & Support page.

test.beforeEach(async ({ page }) => {
  await page.goto('/frontend/support/support.html');
});

test('Phone number and email are shown and open the dialler / email app', async ({ page }) => {
  await page.getByRole('button', { name: 'Contact Support' }).click();
  await expect(page.locator('#answerTitle')).toHaveText('Contact Support');

  const phone = page.getByRole('link', { name: /Call us/ });
  const email = page.getByRole('link', { name: /Email us/ });
  await expect(phone).toBeVisible();
  await expect(email).toBeVisible();
  await expect(phone).toHaveAttribute('href', /^tel:\+?\d+$/);
  await expect(email).toHaveAttribute('href', /^mailto:.+@.+/);
});

test('A message is shown if support contact details are unavailable', async ({ page }) => {
  await page.evaluate(() => { SUPPORT_CONTACT.phone = ''; SUPPORT_CONTACT.email = ''; });
  await page.getByRole('button', { name: 'Contact Support' }).click();
  await expect(page.locator('#answerText')).toContainText("aren't available right now");
  await expect(page.locator('#contactOptions')).toBeHidden();
});

test('Only the details that exist are shown', async ({ page }) => {
  await page.evaluate(() => { SUPPORT_CONTACT.phone = ''; });
  await page.getByRole('button', { name: 'Contact Support' }).click();
  await expect(page.getByRole('link', { name: /Call us/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Email us/ })).toBeVisible();
});

test('Contact options are hidden again on a normal answer', async ({ page }) => {
  await page.getByRole('button', { name: 'Contact Support' }).click();
  await page.evaluate(() => showAnswer({ question: 'Q', answer: 'A' }));
  await expect(page.locator('#contactOptions')).toBeHidden();
});
