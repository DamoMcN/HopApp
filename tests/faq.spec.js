const { test, expect } = require('@playwright/test');

// Frequently Asked Questions (SCRUM-126) on the Help & Support page.

test.beforeEach(async ({ page }) => {
  await page.goto('/frontend/support/support.html');
});

test('FAQs are listed in sections', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Frequently Asked Questions' })).toBeVisible();
  await expect(page.locator('.faq-section')).not.toHaveCount(0);
  await expect(page.locator('#empty')).toBeHidden();
});

test('Selecting a question shows its answer', async ({ page }) => {
  await page.getByRole('button', { name: /My Card/ }).click();
  const question = page.getByRole('button', { name: 'When does my card expire?' });
  await question.click();
  await expect(question).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('valid for one year from the day it was created')).toBeVisible();
});

test('A search with no matches says so', async ({ page }) => {
  await page.fill('#search', 'zzzz');
  await expect(page.locator('#empty')).toHaveText('No matching questions found.');
  await expect(page.locator('#empty')).toBeVisible();
});

test('A message appears if no FAQ content is available', async ({ page }) => {
  // Empty every section, as if there were no FAQs yet
  await page.evaluate(() => {
    faqSections.forEach(section => { section.items = []; });
    renderQuestions(faqSections, false);
  });
  await expect(page.locator('.faq-section')).toHaveCount(0);
  await expect(page.locator('#empty')).toContainText('There are no FAQs available right now');
  await expect(page.locator('#empty')).toBeVisible();
});
