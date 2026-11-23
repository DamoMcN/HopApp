const { test, expect } = require('@playwright/test');
const { newUser, userRow, transactions, savedCards, addSavedCard, postJson, key } = require('./helpers');

// backend/auth/topup.php against the real test database (payments are in mock mode)

const API = 'backend/auth/topup.php';
const topUp = (request, body) => postJson(request, API, { action: 'top_up', amount_cents: 1000, source: 'wallet_demo', idempotency_key: key(), ...body });

test('Not logged in: nothing can be read or topped up', async ({ request }) => {
  const get = await request.get(API);
  expect(get.status()).toBe(401);
  expect(await get.json()).toEqual({ logged_in: false });
  expect((await topUp(request, {})).status).toBe(401);
});

test('The page data comes from the database', async ({ request }) => {
  const { userId } = await newUser(request, { balance: '12.50' });
  const cardId = addSavedCard(userId, 'Mastercard', '4444');
  const body = await (await request.get(API)).json();
  expect(body).toMatchObject({ logged_in: true, mode: 'mock', balance: 12.5, min_cents: 100, max_cents: 50000 });
  expect(body.cards).toEqual([{ id: cardId, brand: 'Mastercard', last4: '4444', exp_month: 8, exp_year: 2030 }]);
});

test('A top up adds to the balance and records one transaction', async ({ request }) => {
  const { userId } = await newUser(request, { balance: '5.00' });
  const k = key();
  const { status, body } = await topUp(request, { amount_cents: 1250, idempotency_key: k });

  expect(status).toBe(200);
  expect(body).toMatchObject({ success: true, replayed: false, balance: 17.5 });
  expect(userRow(userId).balance).toBe('17.50');
  expect(transactions(userId)).toEqual([{ type: 'top up', amount: '12.50', ref: 'mock_' + k }]);
});

test('Sending the same top up twice only adds the money once', async ({ request }) => {
  const { userId } = await newUser(request);
  const k = key();
  await topUp(request, { idempotency_key: k });
  const again = await topUp(request, { idempotency_key: k });

  expect(again.body).toMatchObject({ success: true, replayed: true, balance: 10 });
  expect(userRow(userId).balance).toBe('10.00');
  expect(transactions(userId)).toHaveLength(1);
});

test('Two copies of a top up sent at the same moment only add the money once', async ({ request }) => {
  const { userId } = await newUser(request);
  const k = key();
  const replies = await Promise.all([topUp(request, { idempotency_key: k }), topUp(request, { idempotency_key: k })]);

  expect(replies.every((r) => r.body.success)).toBe(true);
  expect(userRow(userId).balance).toBe('10.00');
  expect(transactions(userId)).toHaveLength(1);
});

test('Different top ups all add up', async ({ request }) => {
  const { userId } = await newUser(request);
  for (const cents of [500, 2000, 100]) await topUp(request, { amount_cents: cents });
  expect(userRow(userId).balance).toBe('26.00');
  expect(transactions(userId).map((t) => t.amount)).toEqual(['5.00', '20.00', '1.00']);
});

const BAD_TOP_UPS = {
  'less than €1':          { amount_cents: 99 },
  'more than €500':        { amount_cents: 50001 },
  'part of a cent':        { amount_cents: 10.5 },
  'amount as text':        { amount_cents: '1000' },
  'no payment key':        { idempotency_key: '' },
  'a payment key with odd characters': { idempotency_key: "abc'; DROP TABLE users; --" },
  'an unknown source':     { source: 'bank_transfer' },
};

for (const [name, body] of Object.entries(BAD_TOP_UPS)) {
  test(`A top up with ${name} is refused and changes nothing`, async ({ request }) => {
    const { userId } = await newUser(request, { balance: '3.00' });
    const res = await topUp(request, body);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(userRow(userId).balance).toBe('3.00');
    expect(transactions(userId)).toHaveLength(0);
  });
}

test('The €1 and €500 limits themselves are allowed', async ({ request }) => {
  const { userId } = await newUser(request);
  expect((await topUp(request, { amount_cents: 100 })).status).toBe(200);
  expect((await topUp(request, { amount_cents: 50000 })).status).toBe(200);
  expect(userRow(userId).balance).toBe('501.00');
});

test('Only JSON requests are accepted (blocks other websites posting forms)', async ({ request }) => {
  const { userId } = await newUser(request);
  const res = await request.post(API, { form: { action: 'top_up', amount_cents: '1000', source: 'wallet_demo', idempotency_key: key() } });
  expect(res.status()).toBe(415);
  expect(userRow(userId).balance).toBe('0.00');
});

for (const status of ['frozen', 'reported_lost', 'reported_stolen']) {
  test(`A ${status.replace('_', ' ')} card can't be topped up`, async ({ request }) => {
    const { userId } = await newUser(request, { status });
    const res = await topUp(request, {});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This card is not active, so it cannot be topped up');
    expect(userRow(userId).balance).toBe('0.00');
    expect(transactions(userId)).toHaveLength(0);
  });
}

test('Paying with a new card and ticking "Save" stores only brand, last 4 and expiry', async ({ request }) => {
  const { userId } = await newUser(request);
  const res = await topUp(request, {
    source: 'new_card', save: true,
    card: { brand: 'Visa', last4: '4242', exp_month: 12, exp_year: 2030, number: '4242424242424242', cvc: '123' }
  });
  expect(res.body).toMatchObject({ success: true, card_saved: true });
  expect(savedCards(userId)).toEqual([
    { id: expect.any(Number), brand: 'Visa', last4: '4242', expMonth: 12, expYear: 2030, provider: null }
  ]);
  expect(userRow(userId).balance).toBe('10.00');
});

test('Saving the same card again updates its expiry instead of adding a copy', async ({ request }) => {
  const { userId } = await newUser(request);
  const card = { brand: 'Visa', last4: '4242', exp_month: 12, exp_year: 2030 };
  await topUp(request, { source: 'new_card', save: true, card });
  await topUp(request, { source: 'new_card', save: true, card: { ...card, exp_month: 3, exp_year: 2032 } });
  const cards = savedCards(userId);
  expect(cards).toHaveLength(1);
  expect(cards[0]).toMatchObject({ expMonth: 3, expYear: 2032 });
});

test('Paying with a new card without "Save" stores no card', async ({ request }) => {
  const { userId } = await newUser(request);
  await topUp(request, { source: 'new_card', save: false, card: { brand: 'Mastercard', last4: '4444', exp_month: 1, exp_year: 2031 } });
  expect(savedCards(userId)).toHaveLength(0);
  expect(userRow(userId).balance).toBe('10.00');
});

test('An expired or unknown card is refused', async ({ request }) => {
  const { userId } = await newUser(request);
  const expired = await topUp(request, { source: 'new_card', card: { brand: 'Visa', last4: '4242', exp_month: 1, exp_year: 2020 } });
  const unknownBrand = await topUp(request, { source: 'new_card', card: { brand: 'Diners', last4: '4242', exp_month: 1, exp_year: 2031 } });
  expect(expired.status).toBe(400);
  expect(unknownBrand.status).toBe(400);
  expect(userRow(userId).balance).toBe('0.00');
});

test('Paying with your own saved card works', async ({ request }) => {
  const { userId } = await newUser(request);
  const cardId = addSavedCard(userId);
  const res = await topUp(request, { source: 'saved_card', card_id: cardId });
  expect(res.body.success).toBe(true);
  expect(userRow(userId).balance).toBe('10.00');
});

test("Someone else's saved card can't be used or removed", async ({ request, playwright, baseURL }) => {
  const other = await playwright.request.newContext({ baseURL });
  try {
    const owner = await newUser(other);
    const theirCard = addSavedCard(owner.userId, 'Visa', '1111');
    const me = await newUser(request);

    const pay = await topUp(request, { source: 'saved_card', card_id: theirCard });
    expect(pay.status).toBe(404);
    expect(userRow(me.userId).balance).toBe('0.00');

    const remove = await postJson(request, API, { action: 'remove_card', card_id: theirCard });
    expect(remove.status).toBe(404);
    expect(savedCards(owner.userId)).toHaveLength(1);   // still there
  } finally {
    await other.dispose();
  }
});

test('Removing your own saved card deletes it', async ({ request }) => {
  const { userId } = await newUser(request);
  const keep = addSavedCard(userId, 'Visa', '4242');
  const remove = addSavedCard(userId, 'Mastercard', '4444');
  const res = await postJson(request, API, { action: 'remove_card', card_id: remove });
  expect(res.body.success).toBe(true);
  expect(res.body.cards.map((c) => c.id)).toEqual([keep]);
  expect(savedCards(userId).map((c) => c.id)).toEqual([keep]);
});
