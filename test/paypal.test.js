'use strict';
// Verifies the PayPal client against a local fake of the Orders v2 API (request shapes, headers, links).
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const calls = [];
let fake;
test.before(async () => {
  fake = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, reqId: req.headers['paypal-request-id'], body });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/oauth2/token') return res.end(JSON.stringify({ access_token: 'TOKEN123', expires_in: 3600 }));
      if (req.url === '/v2/checkout/orders') return res.end(JSON.stringify({ id: 'ORDER9', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'self', href: 'x' }, { rel: 'payer-action', href: 'https://sandbox.paypal.test/checkout?token=ORDER9' }] }));
      if (req.url === '/v2/checkout/orders/ORDER9/capture') return res.end(JSON.stringify({ status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP77' }] } }] }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => fake.listen(0, r));
  process.env.PAYPAL_BASE = 'http://localhost:' + fake.address().port;
  process.env.PAYPAL_CLIENT_ID = 'cid'; process.env.PAYPAL_CLIENT_SECRET = 'sec';
});
test.after(() => { fake.close(); delete process.env.PAYPAL_CLIENT_ID; delete process.env.PAYPAL_CLIENT_SECRET; delete process.env.PAYPAL_BASE; });

test('creates an order with correct auth, amount and return urls, then captures', async () => {
  const paypal = require('../src/paypal');
  assert.equal(paypal.mode(), 'paypal-sandbox');
  const o = await paypal.createOrder({ id: 'p_abc', title: 'USB-C Hub', total: 18.49, merchant: 'PortPal' },
    { returnUrl: 'http://localhost:3000/paypal/return', cancelUrl: 'http://localhost:3000/paypal/cancel', mockApproveUrl: 'x' });
  assert.equal(o.orderId, 'ORDER9'); assert.ok(o.approveUrl.includes('token=ORDER9'));
  const tokenCall = calls.find(c => c.url === '/v1/oauth2/token');
  assert.equal(tokenCall.auth, 'Basic ' + Buffer.from('cid:sec').toString('base64'));
  assert.equal(tokenCall.body, 'grant_type=client_credentials');
  const orderCall = calls.find(c => c.url === '/v2/checkout/orders');
  assert.equal(orderCall.auth, 'Bearer TOKEN123'); assert.equal(orderCall.reqId, 'p_abc');
  const b = JSON.parse(orderCall.body);
  assert.equal(b.intent, 'CAPTURE'); assert.equal(b.purchase_units[0].amount.value, '18.49'); assert.equal(b.purchase_units[0].amount.currency_code, 'USD');
  assert.ok(b.payment_source.paypal.experience_context.return_url.includes('purchase=p_abc'));
  const c = await paypal.captureOrder('ORDER9');
  assert.equal(c.status, 'COMPLETED'); assert.equal(c.captureId, 'CAP77');
});
