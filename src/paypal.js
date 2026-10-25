'use strict';
// PayPal Orders v2 client (sandbox by default). Without credentials it runs in MOCK mode,
// so the whole flow can be tried offline. Credentials come only from environment variables.

const crypto = require('crypto');

function base() { return (process.env.PAYPAL_BASE || 'https://api-m.sandbox.paypal.com').replace(/\/$/, ''); }
function live() { return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET); }
function mode() { return live() ? 'paypal-sandbox' : 'mock'; }

let tokenCache = { value: null, exp: 0 };
async function accessToken() {
  if (tokenCache.value && Date.now() < tokenCache.exp - 30000) return tokenCache.value;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(base() + '/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error('PayPal auth failed: HTTP ' + r.status);
  const j = await r.json();
  tokenCache = { value: j.access_token, exp: Date.now() + (j.expires_in || 300) * 1000 };
  return tokenCache.value;
}

// purchase: {id, title, total, merchant}; urls: {returnUrl, cancelUrl}
async function createOrder(purchase, urls) {
  const amount = purchase.total.toFixed(2);
  if (!live()) {
    const orderId = 'MOCK-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    return { orderId, approveUrl: `${urls.mockApproveUrl}?order=${orderId}&purchase=${encodeURIComponent(purchase.id)}`, mode: 'mock' };
  }
  const token = await accessToken();
  const r = await fetch(base() + '/v2/checkout/orders', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'PayPal-Request-Id': purchase.id },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: purchase.id,
        description: String(purchase.title).slice(0, 127),
        amount: { currency_code: 'USD', value: amount },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'CartGuard',
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
            return_url: `${urls.returnUrl}?purchase=${encodeURIComponent(purchase.id)}`,
            cancel_url: `${urls.cancelUrl}?purchase=${encodeURIComponent(purchase.id)}`,
          },
        },
      },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('PayPal create order failed: HTTP ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
  const link = (j.links || []).find(l => l.rel === 'payer-action') || (j.links || []).find(l => l.rel === 'approve');
  if (!link) throw new Error('PayPal order has no approval link');
  return { orderId: j.id, approveUrl: link.href, mode: 'paypal-sandbox' };
}

async function captureOrder(orderId) {
  if (!live() || String(orderId).startsWith('MOCK-')) {
    return { status: 'COMPLETED', captureId: 'MOCKCAP-' + crypto.randomBytes(5).toString('hex').toUpperCase(), mode: 'mock' };
  }
  const token = await accessToken();
  const r = await fetch(`${base()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('PayPal capture failed: HTTP ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
  const cap = j.purchase_units && j.purchase_units[0] && j.purchase_units[0].payments && j.purchase_units[0].payments.captures && j.purchase_units[0].payments.captures[0];
  return { status: j.status, captureId: cap ? cap.id : null, mode: 'paypal-sandbox' };
}

module.exports = { createOrder, captureOrder, mode, live };
