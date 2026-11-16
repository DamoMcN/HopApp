const { test, expect } = require('@playwright/test');
const { runSql } = require('./db');
const { PASSWORD, signup, login, newUser } = require('./helpers');

// backend/auth/login.php, session.php and frontend/auth/logout.php against the real test database

const session = async (request) => (await request.get('backend/auth/session.php')).json();

test('Logging in starts a session with the user\'s details from the database', async ({ request }) => {
  const { form } = await signup(request, { first_name: 'Niamh', card_type: 'student' });
  expect(await session(request)).toEqual({ logged_in: false });

  expect(await login(request, form.user_email)).toMatchObject({ success: true });

  const me = await session(request);
  expect(me).toMatchObject({ logged_in: true, f_name: 'Niamh', card_type: 'Student', card_status: 'active', wallet_balance: 0 });
  expect(me.card_number).toMatch(/^\d{8}$/);
  expect(me.card_expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('The session always shows the latest balance and status from the database', async ({ request }) => {
  const { userId } = await newUser(request);
  runSql(`UPDATE users SET wallet_balance = 23.45, card_status = 'frozen' WHERE user_id = ${userId}`);
  expect(await session(request)).toMatchObject({ wallet_balance: 23.45, card_status: 'frozen' });
});

test('A wrong password and an unknown email get the same answer', async ({ request }) => {
  const { form } = await signup(request);
  const wrongPassword = await login(request, form.user_email, 'Wrong-Pass123!');
  const unknownEmail = await login(request, 'nobody.' + Date.now() + '@example.test', PASSWORD);

  expect(wrongPassword).toEqual({ success: false, message: 'Incorrect email or password.', code: 'bad_credentials' });
  expect(unknownEmail).toEqual(wrongPassword);   // can't tell which accounts exist
  expect(await session(request)).toEqual({ logged_in: false });
});

test('Passwords are case-sensitive', async ({ request }) => {
  const { form } = await signup(request);
  expect(await login(request, form.user_email, PASSWORD.toLowerCase())).toMatchObject({ code: 'bad_credentials' });
});

test('Empty email or password is refused', async ({ request }) => {
  const body = await login(request, '', '');
  expect(body.success).toBe(false);
  expect(body.message).toBe('Please enter your email and password.');
});

test('Text that looks like SQL is not run as SQL', async ({ request }) => {
  const { form } = await signup(request);
  const body = await login(request, form.user_email + "' OR '1'='1", "' OR '1'='1");
  expect(body).toMatchObject({ success: false, code: 'bad_credentials' });
  expect(await session(request)).toEqual({ logged_in: false });
});

test('Logging out ends the session', async ({ request }) => {
  await newUser(request);
  expect((await session(request)).logged_in).toBe(true);

  const res = await request.get('frontend/auth/logout.php');
  expect(await res.json()).toEqual({ success: true });
  expect(await session(request)).toEqual({ logged_in: false });
});

test('A deleted account is logged out', async ({ request }) => {
  const { userId } = await newUser(request);
  runSql(`DELETE FROM users WHERE user_id = ${userId}`);
  expect(await session(request)).toEqual({ logged_in: false });
});

test('Two users get separate sessions', async ({ playwright, baseURL }) => {
  const a = await playwright.request.newContext({ baseURL });
  const b = await playwright.request.newContext({ baseURL });
  try {
    await signup(a, { first_name: 'Alice' }).then(({ form }) => login(a, form.user_email));
    await signup(b, { first_name: 'Bob' }).then(({ form }) => login(b, form.user_email));
    expect((await session(a)).f_name).toBe('Alice');
    expect((await session(b)).f_name).toBe('Bob');
  } finally {
    await a.dispose();
    await b.dispose();
  }
});

test('Only POST is accepted', async ({ request }) => {
  const body = await (await request.get('backend/auth/login.php')).json();
  expect(body).toMatchObject({ success: false, code: 'bad_request' });
});
