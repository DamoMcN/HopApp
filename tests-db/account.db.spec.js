const { test, expect } = require('@playwright/test');
const { one, q } = require('./db');
const { PASSWORD, uniqueEmail, login, newUser, postJson, signup } = require('./helpers');

// backend/auth/account.php (change name, email or password) against the real test database

const ACCOUNT = 'backend/auth/account.php';
const NEW_PASSWORD = 'New-Pass456!';
const session = async (request) => (await request.get('backend/auth/session.php')).json();
const row = (userId) => {
  const [first, last, email, hash] = one(`SELECT f_name, l_name, email, password_hash FROM users WHERE user_id = ${userId}`);
  return { first, last, email, hash };
};

test('Not logged in: nothing can be changed', async ({ request }) => {
  const res = await postJson(request, ACCOUNT, { action: 'name', first_name: 'A', last_name: 'B' });
  expect(res).toEqual({ status: 401, body: { logged_in: false } });
});

test('Only JSON POSTs are accepted', async ({ request }) => {
  await newUser(request);
  const asForm = await request.post(ACCOUNT, { form: { action: 'name', first_name: 'A', last_name: 'B' } });
  expect(asForm.status()).toBe(415);
  const asGet = await request.get(ACCOUNT);
  expect(asGet.status()).toBe(405);
  const unknown = await postJson(request, ACCOUNT, { action: 'delete_everything' });
  expect(unknown.status).toBe(400);
});

test('Changing the name saves it, trimmed, and the session shows it', async ({ request }) => {
  const { userId } = await newUser(request);
  const res = await postJson(request, ACCOUNT, { action: 'name', first_name: '  Aoife ', last_name: "O'Brien" });
  expect(res).toEqual({ status: 200, body: { success: true, message: 'Your name has been updated.', f_name: 'Aoife', l_name: "O'Brien" } });
  expect(row(userId)).toMatchObject({ first: 'Aoife', last: "O'Brien" });
  expect(await session(request)).toMatchObject({ f_name: 'Aoife', l_name: "O'Brien" });
});

test('Names that are empty, too long or contain markup are refused', async ({ request }) => {
  const { userId } = await newUser(request);
  const cases = [
    [{ first_name: '', last_name: 'B' }, 'first_name', 'missing'],
    [{ first_name: 'A', last_name: '   ' }, 'last_name', 'missing'],
    [{ first_name: 'A'.repeat(51), last_name: 'B' }, 'first_name', 'too_long'],
    [{ first_name: '<script>', last_name: 'B' }, 'first_name', 'bad_characters'],
    [{ first_name: ['A'], last_name: 'B' }, 'first_name', 'missing'],
  ];
  for (const [fields, field, code] of cases) {
    const res = await postJson(request, ACCOUNT, { action: 'name', ...fields });
    expect(res.status, JSON.stringify(fields)).toBe(422);
    expect(res.body).toMatchObject({ success: false, field, code });
  }
  expect(row(userId)).toMatchObject({ first: 'Test', last: 'User' });   // unchanged
});

test('Changing the email needs the right password, then the new email logs in', async ({ request, playwright, baseURL }) => {
  const { userId, email } = await newUser(request);
  const newEmail = uniqueEmail('changed');

  const wrong = await postJson(request, ACCOUNT, { action: 'email', new_email: newEmail, current_password: 'Wrong-Pass123!' });
  expect(wrong.body).toMatchObject({ success: false, field: 'current_password', code: 'wrong_password' });
  expect(row(userId).email).toBe(email);

  const ok = await postJson(request, ACCOUNT, { action: 'email', new_email: newEmail, current_password: PASSWORD });
  expect(ok.body).toEqual({ success: true, message: 'Your email has been updated. Use it the next time you log in.', email: newEmail });
  expect(row(userId).email).toBe(newEmail);
  expect(await session(request)).toMatchObject({ logged_in: true, email: newEmail });   // still logged in

  const fresh = await playwright.request.newContext({ baseURL });
  try {
    expect(await login(fresh, email)).toMatchObject({ success: false, code: 'bad_credentials' });
    expect(await login(fresh, newEmail)).toMatchObject({ success: true });
  } finally {
    await fresh.dispose();
  }
});

test('An email another account uses, the same email or a bad one is refused', async ({ request, playwright, baseURL }) => {
  const other = await playwright.request.newContext({ baseURL });
  let otherEmail;
  try {
    ({ form: { user_email: otherEmail } } = await signup(other));
  } finally {
    await other.dispose();
  }
  const { userId, email } = await newUser(request);

  const taken = await postJson(request, ACCOUNT, { action: 'email', new_email: otherEmail, current_password: PASSWORD });
  expect(taken.body).toMatchObject({ success: false, field: 'new_email', code: 'email_taken' });
  const same = await postJson(request, ACCOUNT, { action: 'email', new_email: email.toUpperCase(), current_password: PASSWORD });
  expect(same.body).toMatchObject({ success: false, code: 'same_email' });
  const bad = await postJson(request, ACCOUNT, { action: 'email', new_email: 'not-an-email', current_password: PASSWORD });
  expect(bad.body).toMatchObject({ success: false, code: 'bad_email' });
  expect(row(userId).email).toBe(email);
});

const phoneOf = (userId) => one(`SELECT phone_number FROM users WHERE user_id = ${userId}`)[0];

test('The session gives only the last four digits of the phone number', async ({ request }) => {
  await newUser(request);   // signed up with 0871234567
  const me = await session(request);
  expect(me.phone_last4).toBe('4567');
  expect(JSON.stringify(me)).not.toContain('0871234567');
  expect(JSON.stringify(me)).not.toContain('phone_number');
});

test('Changing the phone number saves it tidied, and only the last four digits come back', async ({ request }) => {
  const { userId } = await newUser(request);
  const res = await postJson(request, ACCOUNT, { action: 'phone', new_phone: ' +353 (87) 765-9876 ' });
  expect(res).toEqual({ status: 200, body: { success: true, message: 'Your phone number has been updated.', phone_last4: '9876' } });
  expect(phoneOf(userId)).toBe('+353877659876');
  expect((await session(request)).phone_last4).toBe('9876');
});

test('Phone numbers that are too short, too long or not numbers are refused', async ({ request }) => {
  const { userId } = await newUser(request);
  for (const phone of ['', '123456', '1234567890123456', '087-CALL-ME', '++353871234567', '087 123 4567 ext 2']) {
    const res = await postJson(request, ACCOUNT, { action: 'phone', new_phone: phone });
    expect(res.status, phone).toBe(422);
    expect(res.body, phone).toMatchObject({ success: false, field: 'new_phone', code: 'bad_phone' });
  }
  expect(phoneOf(userId)).toBe('0871234567');   // unchanged
});

test('Changing the password needs the current one, then only the new one logs in', async ({ request, playwright, baseURL }) => {
  const { userId, email } = await newUser(request);
  const before = row(userId).hash;

  const wrong = await postJson(request, ACCOUNT,
    { action: 'password', current_password: 'Wrong-Pass123!', new_password: NEW_PASSWORD, confirm_password: NEW_PASSWORD });
  expect(wrong.body).toMatchObject({ success: false, code: 'wrong_password' });
  expect(row(userId).hash).toBe(before);

  const ok = await postJson(request, ACCOUNT,
    { action: 'password', current_password: PASSWORD, new_password: NEW_PASSWORD, confirm_password: NEW_PASSWORD });
  expect(ok.body).toEqual({ success: true, message: 'Your password has been changed.' });
  const after = row(userId).hash;
  expect(after).not.toBe(before);
  expect(after).not.toContain(NEW_PASSWORD);    // stored hashed, never as plain text
  expect(after).toMatch(/^\$2y\$/);

  const fresh = await playwright.request.newContext({ baseURL });
  try {
    expect(await login(fresh, email, PASSWORD)).toMatchObject({ success: false, code: 'bad_credentials' });
    expect(await login(fresh, email, NEW_PASSWORD)).toMatchObject({ success: true });
  } finally {
    await fresh.dispose();
  }
});

test('Weak, mismatched or unchanged new passwords are refused', async ({ request }) => {
  const { userId } = await newUser(request);
  const before = row(userId).hash;
  const cases = [
    ['Sh0rt!', 'Sh0rt?', 'weak_password'],                 // too short (the confirm doesn't matter: weak comes first)
    ['A1!' + 'a'.repeat(70), 'A1!' + 'a'.repeat(70), 'weak_password'],   // 73 characters: longer than bcrypt reads
    ['nouppercase1!', 'nouppercase1!', 'weak_password'],
    ['NoSymbol123', 'NoSymbol123', 'weak_password'],
    [NEW_PASSWORD, NEW_PASSWORD + 'x', 'password_mismatch'],
    [PASSWORD, PASSWORD, 'same_password'],
  ];
  for (const [next, confirm, code] of cases) {
    const res = await postJson(request, ACCOUNT, { action: 'password', current_password: PASSWORD, new_password: next, confirm_password: confirm });
    expect(res.body, next).toMatchObject({ success: false, code });
  }
  expect(row(userId).hash).toBe(before);
});

test('One user can\'t change another user\'s details', async ({ request, playwright, baseURL }) => {
  const victim = await playwright.request.newContext({ baseURL });
  let victimId;
  try {
    ({ userId: victimId } = await newUser(victim));
  } finally {
    await victim.dispose();
  }
  await newUser(request);
  // There is no way to name another account: the change always applies to whoever is logged in
  await postJson(request, ACCOUNT, { action: 'name', first_name: 'Hacker', last_name: 'X', user_id: victimId });
  expect(row(victimId)).toMatchObject({ first: 'Test', last: 'User' });
  expect(Number(one(`SELECT COUNT(*) FROM users WHERE f_name = ${q('Hacker')} AND user_id = ${victimId}`)[0])).toBe(0);
});
