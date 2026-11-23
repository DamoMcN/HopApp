const { test, expect } = require('@playwright/test');
const { newUser, userRow, postJson } = require('./helpers');

// backend/auth/card_status.php against the real test database

const API = 'backend/auth/card_status.php';
const act = (request, action) => postJson(request, API, { action });

test('Freeze and unfreeze change the card status in the database', async ({ request }) => {
  const { userId } = await newUser(request);

  expect((await act(request, 'freeze')).body).toEqual({ success: true, card_status: 'frozen' });
  expect(userRow(userId).status).toBe('frozen');

  expect((await act(request, 'unfreeze')).body).toEqual({ success: true, card_status: 'active' });
  expect(userRow(userId).status).toBe('active');
});

test('Freezing twice is harmless', async ({ request }) => {
  const { userId } = await newUser(request);
  await act(request, 'freeze');
  expect((await act(request, 'freeze')).body).toEqual({ success: true, card_status: 'frozen' });
  expect(userRow(userId).status).toBe('frozen');
});

test('Unfreezing a card that is already active is harmless', async ({ request }) => {
  const { userId } = await newUser(request);
  const res = await act(request, 'unfreeze');   // card_status.php: "already in the requested state" counts as success
  expect(res.body).toEqual({ success: true, card_status: 'active' });
  expect(userRow(userId).status).toBe('active');
});

for (const [action, status] of [['report_lost', 'reported_lost'], ['report_stolen', 'reported_stolen']]) {
  for (const start of ['active', 'frozen']) {
    test(`An ${start} card can be reported ${status.slice(9)}`, async ({ request }) => {
      const { userId } = await newUser(request, { status: start });
      expect((await act(request, action)).body).toEqual({ success: true, card_status: status });
      expect(userRow(userId).status).toBe(status);
    });
  }
}

test('A reported card stays reported: no unfreeze, freeze or other report', async ({ request }) => {
  const { userId } = await newUser(request);
  await act(request, 'report_lost');

  for (const action of ['unfreeze', 'freeze', 'report_stolen']) {
    const res = await act(request, action);
    expect(res.status, action).toBe(403);
    expect(res.body.error).toBe('This card was already reported lost. Contact Help & Support for a replacement.');
  }
  expect(userRow(userId).status).toBe('reported_lost');
});

test('Reporting the same way twice is harmless', async ({ request }) => {
  const { userId } = await newUser(request);
  await act(request, 'report_stolen');
  expect((await act(request, 'report_stolen')).body).toEqual({ success: true, card_status: 'reported_stolen' });
  expect(userRow(userId).status).toBe('reported_stolen');
});

test("Changing your card never changes someone else's", async ({ request, playwright, baseURL }) => {
  const other = await playwright.request.newContext({ baseURL });
  try {
    const them = await newUser(other);
    const me = await newUser(request);
    await act(request, 'report_stolen');
    expect(userRow(me.userId).status).toBe('reported_stolen');
    expect(userRow(them.userId).status).toBe('active');
  } finally {
    await other.dispose();
  }
});

test('Requests that are not allowed change nothing', async ({ request }) => {
  const { userId } = await newUser(request);

  expect((await act(request, 'delete_card')).status).toBe(400);
  expect((await postJson(request, API, { action: ['freeze'] })).status).toBe(400);
  expect((await request.get(API)).status()).toBe(405);
  expect((await request.post(API, { form: { action: 'freeze' } })).status()).toBe(415);   // JSON only

  expect(userRow(userId).status).toBe('active');
});

test('Not logged in: nothing changes', async ({ request }) => {
  const res = await act(request, 'freeze');
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ logged_in: false });
});
