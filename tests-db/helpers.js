// Helpers for talking to the real PHP endpoints like the app does.

const { expect } = require('@playwright/test');
const { q, one, runSql } = require('./db');

let counter = 0;
const uniqueEmail = (label = 'user') =>
  `${label}.${Date.now()}.${process.pid}.${++counter}@example.test`;

const PASSWORD = 'Test-Pass123!';

// A valid sign-up form, as auth.js sends it. Override any field.
function signupForm(overrides = {}) {
  return {
    first_name: 'Test',
    last_name: 'User',
    phone_number: '0871234567',
    dob: '2000-01-15',
    nationality: 'Ireland',
    user_email: uniqueEmail(),
    user_password: PASSWORD,
    confirm_password: PASSWORD,
    card_type: 'adult',
    ...overrides
  };
}

async function signup(request, overrides) {
  const form = signupForm(overrides);
  const res = await request.post('backend/auth/signup.php', { form });
  return { form, body: await res.json() };
}

async function login(request, email, password = PASSWORD) {
  const res = await request.post('backend/auth/login.php', { form: { user_email: email, user_password: password } });
  return res.json();
}

// Signs up and logs in a new user on this request context. Returns { email, userId }.
async function newUser(request, { status, balance } = {}) {
  const { form, body } = await signup(request);
  expect(body.success, JSON.stringify(body)).toBe(true);
  expect((await login(request, form.user_email)).success).toBe(true);
  const userId = Number(one(`SELECT user_id FROM users WHERE email = ${q(form.user_email)}`)[0]);
  if (status) runSql(`UPDATE users SET card_status = ${q(status)} WHERE user_id = ${userId}`);
  if (balance !== undefined) runSql(`UPDATE users SET wallet_balance = ${q(balance)} WHERE user_id = ${userId}`);
  return { email: form.user_email, userId };
}

function userRow(userId) {
  const [status, balance] = one(`SELECT card_status, wallet_balance FROM users WHERE user_id = ${userId}`);
  return { status, balance };
}

function transactions(userId) {
  return runSql(`SELECT type, amount, stripe_payment_id FROM transactions WHERE user_id = ${userId} ORDER BY transaction_id`)
    .map(([type, amount, ref]) => ({ type, amount, ref }));
}

function savedCards(userId) {
  return runSql(`SELECT card_id, brand, last4, exp_month, exp_year, provider_payment_method_id
                 FROM saved_cards WHERE user_id = ${userId} ORDER BY card_id`)
    .map(([id, brand, last4, expMonth, expYear, provider]) =>
      ({ id: Number(id), brand, last4, expMonth: Number(expMonth), expYear: Number(expYear), provider }));
}

function addSavedCard(userId, brand = 'Visa', last4 = '4242') {
  runSql(`INSERT INTO saved_cards (user_id, brand, last4, exp_month, exp_year) VALUES (${userId}, ${q(brand)}, ${q(last4)}, 8, 2030)`);
  return Number(one(`SELECT card_id FROM saved_cards WHERE user_id = ${userId} AND last4 = ${q(last4)}`)[0]);
}

// POSTs JSON, like topup.js and card.js do
async function postJson(request, url, data) {
  const res = await request.post(url, { data });
  return { status: res.status(), body: await res.json() };
}

const key = () => 'test-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

module.exports = {
  PASSWORD, uniqueEmail, signupForm, signup, login, newUser,
  userRow, transactions, savedCards, addSavedCard, postJson, key
};
