
const { test, expect } = require('@playwright/test');

test('Registration page loads successfully', async ({ page }) => {
  const response = await page.goto('/frontend/auth/signup.html');

  expect(response.status()).toBe(200);
  await expect(page.locator('#first-name')).toBeVisible();
  await expect(page.locator('#last-name')).toBeVisible();
});

test('Login page loads successfully', async ({ page }) => {
  const response = await page.goto('/frontend/auth/index.html');

  expect(response.status()).toBe(200);
  await expect(page.locator('#login-form')).toBeVisible();
});

test('Support page loads successfully', async ({ page }) => {
  const response = await page.goto('/frontend/support/support.html');

  expect(response.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Help & Support' })).toBeVisible();
});


test('Registration form has required fields', async ({ page }) => {
  await page.goto('/frontend/auth/signup.html');

  const requiredFields = [
    '#first-name',
    '#last-name',
    '#phone-number',
    '#dob',
    '#nationality',
    '#signup-email',
    '#signup-password',
    '#confirm-password'
  ];

  for (const selector of requiredFields) {
    await expect(page.locator(selector)).toHaveAttribute('required', '');
  }
});

test('Invalid email is rejected by browser validation', async ({ page }) => {
  await page.goto('/frontend/auth/signup.html');

  await page.locator('#signup-email').fill('invalid-email');

  const isValid = await page.locator('#signup-email').evaluate(
    element => element.checkValidity()
  );

  expect(isValid).toBe(false);
});

test('Empty registration form cannot be submitted', async ({ page }) => {
  await page.goto('/frontend/auth/signup.html');

  await page.locator('button[type="submit"]').click();

  const formIsValid = await page.locator('form').evaluate(
    element => element.checkValidity()
  );

  expect(formIsValid).toBe(false);
});



async function checkEligibility(page, age, isStudent = false) {
  const today = new Date();
  const birthDate = new Date(
    today.getFullYear() - age,
    today.getMonth(),
    today.getDate()
  );

  const dob = [
    birthDate.getFullYear(),
    String(birthDate.getMonth() + 1).padStart(2, '0'),
    String(birthDate.getDate()).padStart(2, '0')
  ].join('-');

  await page.goto('/frontend/auth/signup.html');

  await page.locator('#first-name').fill('Test');
  await page.locator('#last-name').fill('User');
  await page.locator('#phone-number').fill('0871234567');
  await page.locator('#dob').fill(dob);
  await page.locator('#nationality').selectOption({ label: 'Ireland' });
  await page.locator('#signup-email').fill('test@example.com');
  await page.locator('#signup-password').fill('TestPassword123!');
  await page.locator('#confirm-password').fill('TestPassword123!');

  if (isStudent) {
    await page.locator('#is-student').check();
  }

  await page.locator('button[type="submit"]').click();

  await expect(page.locator('#eligibility-modal')).toBeVisible();

  return page.locator('#card-result');
}

test('Age 4 receives free-travel message', async ({ page }) => {
  await checkEligibility(page, 4);
  await expect(page.locator('#modal-title')).toHaveText('Free Travel!');
});

test('Age 5 receives Child Card recommendation', async ({ page }) => {
  const cards = await checkEligibility(page, 5);
  await expect(cards.locator('.card-option.recommended .card-title'))
    .toHaveText('Child Card');
});

test('Age 18 receives Child Card recommendation', async ({ page }) => {
  const cards = await checkEligibility(page, 18);
  await expect(cards.locator('.card-option.recommended .card-title'))
    .toHaveText('Child Card');
});

test('Age 19 receives Young Adult recommendation', async ({ page }) => {
  const cards = await checkEligibility(page, 19);
  await expect(cards.locator('.card-option.recommended .card-title'))
    .toHaveText('Young Adult');
});

test('Age 25 student still receives Young Adult recommendation', async ({ page }) => {
  const cards = await checkEligibility(page, 25, true);
  await expect(cards.locator('.card-option.recommended .card-title'))
    .toHaveText('Young Adult');
});

test('Age 26 student receives Student Card recommendation', async ({ page }) => {
  const cards = await checkEligibility(page, 26, true);
  await expect(cards.locator('.card-option.recommended .card-title'))
    .toHaveText('Student Card');
});

test('Age 26 non-student receives Adult Card recommendation', async ({ page }) => {
  const cards = await checkEligibility(page, 26);
  await expect(cards.locator('.card-option.recommended .card-title'))
    .toHaveText('Adult Card');
});

test('Age 66 receives free-travel message', async ({ page }) => {
  await checkEligibility(page, 66);
  await expect(page.locator('#modal-title')).toHaveText('Free Travel!');
});
