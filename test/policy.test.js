'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { evaluate, normalizePolicy, committedThisMonth } = require('../src/policy');

const pol = { monthlyBudget: 100, perPurchaseLimit: 60, autoApproveUnder: 25, allowedCategories: ['electronics', 'office'], blockedMerchants: ['badshop'] };
const item = (o) => ({ id: 'x', title: 't', price: 10, category: 'electronics', merchant: 'ok', ...o });

test('auto approve under threshold', () => {
  const r = evaluate({ item: item({ price: 20 }), policy: pol });
  assert.equal(r.decision, 'auto'); assert.equal(r.total, 20);
});
test('needs approval between threshold and limit', () => {
  assert.equal(evaluate({ item: item({ price: 40 }), policy: pol }).decision, 'approval');
});
test('deny above per-purchase limit', () => {
  const r = evaluate({ item: item({ price: 61 }), policy: pol });
  assert.equal(r.decision, 'deny'); assert.ok(r.reasons.join().includes('per-purchase'));
});
test('quantity multiplies the total', () => {
  const r = evaluate({ item: item({ price: 20 }), quantity: 4, policy: pol });
  assert.equal(r.total, 80); assert.equal(r.decision, 'deny');
});
test('deny category and merchant', () => {
  assert.equal(evaluate({ item: item({ category: 'gaming' }), policy: pol }).decision, 'deny');
  assert.equal(evaluate({ item: item({ merchant: 'BadShop' }), policy: pol }).decision, 'deny');
});
test('monthly budget counts paid and awaiting only, current month only', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const purchases = [
    { status: 'paid', total: 50, createdAt: '2026-10-02T00:00:00Z' },
    { status: 'awaiting_payment', total: 30, createdAt: '2026-10-10T00:00:00Z' },
    { status: 'denied', total: 500, createdAt: '2026-10-11T00:00:00Z' },
    { status: 'paid', total: 70, createdAt: '2026-09-28T00:00:00Z' },
  ];
  assert.equal(committedThisMonth(purchases, now), 80);
  const r = evaluate({ item: item({ price: 30 }), policy: pol, purchases, now });
  assert.equal(r.decision, 'deny'); assert.ok(r.reasons.join().includes('monthly budget'));
});
test('bad policy values fall back to defaults', () => {
  const p = normalizePolicy({ monthlyBudget: 'abc', allowedCategories: 'Books, Home ' });
  assert.equal(p.monthlyBudget, 200); assert.deepEqual(p.allowedCategories, ['books', 'home']);
});
test('floating point totals are rounded to cents', () => {
  const r = evaluate({ item: item({ price: 0.1 }), quantity: 3, policy: pol });
  assert.equal(r.total, 0.3);
});
