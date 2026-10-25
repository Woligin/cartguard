'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.STATE_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cg-')), 'state.json');
delete process.env.PAYPAL_CLIENT_ID; delete process.env.PAYPAL_CLIENT_SECRET; delete process.env.LLM_PROVIDER;
const { start } = require('../src/server');

let server, base;
test.before(async () => { server = await start(0); base = 'http://localhost:' + server.address().port; });
test.after(() => server.close());
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
const get = (p) => fetch(base + p).then(r => r.json());

test('starts in mock mode', async () => { assert.equal((await get('/api/state')).paypalMode, 'mock'); });

test('cheap item: agent orders alone, mock payment completes, budget committed', async () => {
  const r = await post('/api/request', { text: 'I need a USB-C hub for my laptop under $20' });
  const p = r.purchase;
  assert.equal(p.decision, 'auto'); assert.equal(p.status, 'awaiting_payment'); assert.ok(p.approveUrl.includes('/mock/approve'));
  const resp = await fetch(base + '/paypal/return?purchase=' + p.id + '&token=' + p.orderId, { redirect: 'manual' });
  assert.equal(resp.status, 302);
  const s = await get('/api/state');
  const done = s.purchases.find(x => x.id === p.id);
  assert.equal(done.status, 'paid'); assert.equal(s.committed, p.total);
});

test('capture with a wrong token is refused', async () => {
  const r = await post('/api/request', { text: 'buy gel pens' });
  const p = r.purchase;
  const resp = await fetch(base + '/paypal/return?purchase=' + p.id + '&token=WRONG', { redirect: 'manual' });
  assert.ok(resp.headers.get('location').includes('error'));
  const s = await get('/api/state');
  assert.equal(s.purchases.find(x => x.id === p.id).status, 'awaiting_payment');
});

test('mid-price item waits for human approval, then orders', async () => {
  const r = await post('/api/request', { text: 'Buy a mechanical keyboard under $70' });
  assert.equal(r.purchase.status, 'pending_approval'); assert.equal(r.purchase.orderId, undefined);
  const a = await post('/api/approve/' + r.purchase.id);
  assert.equal(a.purchase.status, 'awaiting_payment');
});

test('over-limit item is blocked and no order is created', async () => {
  const r = await post('/api/request', { text: 'Get me a game console bundle' });
  assert.equal(r.purchase.status, 'denied'); assert.equal(r.purchase.orderId, undefined);
});

test('rejecting leaves budget untouched', async () => {
  const before = (await get('/api/state')).committed;
  const r = await post('/api/request', { text: 'Buy a monitor stand' });
  assert.equal(r.purchase.status, 'pending_approval');
  const j = await post('/api/reject/' + r.purchase.id);
  assert.equal(j.purchase.status, 'rejected');
  assert.equal((await get('/api/state')).committed, before);
});

test('policy update applies to the next request', async () => {
  await post('/api/policy', { perPurchaseLimit: 10 });
  const r = await post('/api/request', { text: 'wireless mouse silent' });
  assert.equal(r.purchase.status, 'denied');
});

test('empty request is rejected, unknown route 404', async () => {
  const r = await fetch(base + '/api/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 400);
  assert.equal((await fetch(base + '/nope')).status, 404);
});
