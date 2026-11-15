const { test, expect } = require('@playwright/test');
const { q, one, runSql } = require('./db');
const { PASSWORD, signup, signupForm } = require('./helpers');

// backend/auth/signup.php against the real test database

const userByEmail = (email) => one(
  `SELECT f_name, l_name, card_number, card_status, card_type, is_student, wallet_balance, password_hash,
          card_expiry = DATE_ADD(CURRENT_DATE, INTERVAL 1 YEAR), dob, nationality, phone_number
   FROM users WHERE email = ${q(email)}`);
const countByEmail = (email) => Number(one(`SELECT COUNT(*) FROM users WHERE email = ${q(email)}`)[0]);

test('Signing up stores the new user', async ({ request }) => {
  const { form, body } = await signup(request, { first_name: 'Aoife', last_name: "O'Brien", card_type: 'young-adult' });
  expect(body).toMatchObject({ success: true });

  const [fName, lName, cardNumber, status, cardType, isStudent, balance, hash, expiryIsOneYear, dob, nationality, phone] =
    userByEmail(form.user_email);
  expect(fName).toBe('Aoife');
  expect(lName).toBe("O'Brien");             // stored exactly, quotes included
  expect(cardNumber).toMatch(/^\d{8}$/);
  expect(status).toBe('active');
  expect(cardType).toBe('Young Adult');       // 'young-adult' from the form is mapped to the DB value
  expect(isStudent).toBe('0');
  expect(balance).toBe('0.00');
  expect(expiryIsOneYear).toBe('1');          // card valid for exactly one year
  expect(dob).toBe('2000-01-15');
  expect(nationality).toBe('Ireland');
  expect(phone).toBe('0871234567');

  expect(hash).not.toContain(PASSWORD);       // the password is never stored as typed
  expect(hash).toMatch(/^\$2y\$/);            // bcrypt hash
});

test('Every card type from the form is stored with its database value', async ({ request }) => {
  const types = { adult: 'Adult', 'young-adult': 'Young Adult', student: 'Student', child: 'Child' };
  for (const [formValue, dbValue] of Object.entries(types)) {
    const { form, body } = await signup(request, { card_type: formValue });
    expect(body.success).toBe(true);
    expect(one(`SELECT card_type FROM users WHERE email = ${q(form.user_email)}`)[0]).toBe(dbValue);
  }
});

test('The student tick box is stored', async ({ request }) => {
  const { form } = await signup(request, { card_type: 'student', 'is-student': 'on' });
  expect(one(`SELECT is_student FROM users WHERE email = ${q(form.user_email)}`)[0]).toBe('1');
});

test('Each user gets a different 8-digit card number', async ({ request }) => {
  const a = await signup(request);
  const b = await signup(request);
  const numbers = runSql(`SELECT card_number FROM users WHERE email IN (${q(a.form.user_email)}, ${q(b.form.user_email)})`)
    .map(([n]) => n);
  expect(numbers).toHaveLength(2);
  expect(numbers[0]).not.toBe(numbers[1]);
});

test('An email that is already registered is refused, and no second account is made', async ({ request }) => {
  const first = await signup(request);
  const again = await signup(request, { user_email: first.form.user_email, first_name: 'Someone else' });
  expect(again.body).toMatchObject({ success: false, code: 'email_taken', field: 'signup-email' });
  expect(countByEmail(first.form.user_email)).toBe(1);
  expect(userByEmail(first.form.user_email)[0]).toBe('Test');   // the first account is unchanged
});

const BAD_SIGNUPS = {
  'passwords that do not match': [{ confirm_password: 'Other-Pass123!' }, 'password_mismatch'],
  'a password with no symbol':   [{ user_password: 'TestPass123', confirm_password: 'TestPass123' }, 'weak_password'],
  'a password that is too short': [{ user_password: 'Ab1!', confirm_password: 'Ab1!' }, 'weak_password'],
  'a password with no capital':  [{ user_password: 'test-pass123!', confirm_password: 'test-pass123!' }, 'weak_password'],
  'an invalid email':            [{ user_email: 'not-an-email' }, null],
  'a date of birth in the future': [{ dob: '2999-01-01' }, null],
  'a date of birth in the wrong format': [{ dob: '15/01/2000' }, null],
  'an unknown card type':        [{ card_type: 'premium' }, null],
  'no first name':               [{ first_name: '   ' }, null],
};

for (const [name, [overrides, code]] of Object.entries(BAD_SIGNUPS)) {
  test(`Sign up is refused with ${name}`, async ({ request }) => {
    const form = signupForm(overrides);
    const res = await request.post('backend/auth/signup.php', { form });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBeTruthy();
    if (code) expect(body.code).toBe(code);
    expect(countByEmail(form.user_email)).toBe(0);
  });
}

test('Only POST is accepted', async ({ request }) => {
  const body = await (await request.get('backend/auth/signup.php')).json();
  expect(body).toMatchObject({ success: false, code: 'bad_request' });
});
