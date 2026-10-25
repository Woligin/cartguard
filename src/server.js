'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Minimal .env loader (no dependencies). Real environment variables win.
(function loadEnv() {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    for (const line of t.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) { /* no .env: mock mode */ }
})();

const { evaluate, normalizePolicy, committedThisMonth, money } = require('./policy');
const { plan, aiEnabled } = require('./llm');
const paypal = require('./paypal');
const store = require('./store');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');

function now() { return new Date().toISOString(); }
function origin(req) { return `http://${req.headers.host || 'localhost:' + PORT}`; }

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function html(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > 20000) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

function view(state) {
  const committed = committedThisMonth(state.purchases);
  return {
    policy: state.policy,
    committed, remaining: money(state.policy.monthlyBudget - committed),
    paypalMode: paypal.mode(), ai: aiEnabled() ? (process.env.LLM_PROVIDER || '') : 'rules',
    purchases: state.purchases.slice().reverse(),
  };
}

function log(p, event, detail) { p.history.push({ t: now(), event, detail: detail || '' }); }

async function placeOrder(req, state, p) {
  const o = origin(req);
  const r = await paypal.createOrder({ id: p.id, title: p.item.title, total: p.total, merchant: p.item.merchant },
    { returnUrl: o + '/paypal/return', cancelUrl: o + '/paypal/cancel', mockApproveUrl: o + '/mock/approve' });
  p.orderId = r.orderId; p.approveUrl = r.approveUrl; p.paymentMode = r.mode; p.status = 'awaiting_payment';
  log(p, 'order created', `PayPal order ${r.orderId} (${r.mode}) for $${p.total.toFixed(2)}; buyer must approve it in PayPal`);
}

async function handle(req, res) {
  const url = new URL(req.url, origin(req));
  const method = req.method;
  try {
    if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), 'text/html');
    }
    if (method === 'GET' && url.pathname === '/api/state') return send(res, 200, view(store.load()));

    if (method === 'POST' && url.pathname === '/api/policy') {
      const state = store.load(); const body = await readBody(req);
      state.policy = normalizePolicy({ ...state.policy, ...body }); store.save(state);
      return send(res, 200, view(state));
    }

    if (method === 'POST' && url.pathname === '/api/request') {
      const body = await readBody(req); const text = String(body.text || '').trim().slice(0, 500);
      if (!text) return send(res, 400, { error: 'empty request' });
      const state = store.load();
      const pl = await plan(text);
      const p = { id: 'p_' + crypto.randomBytes(4).toString('hex'), createdAt: now(), text, aiSource: pl.choice ? pl.choice.source : pl.request.source,
        parsed: { query: pl.request.query, maxPrice: pl.request.maxPrice, quantity: pl.request.quantity }, options: pl.options.map(o => ({ id: o.id, title: o.title, price: o.price })), history: [] };
      log(p, 'request received', text);
      log(p, 'agent parsed request', `source=${pl.request.source}; query="${pl.request.query.trim().slice(0, 80)}"; maxPrice=${pl.request.maxPrice}; qty=${pl.request.quantity}`);
      if (!pl.item) {
        p.status = 'no_match'; p.total = 0; p.item = null; p.decision = 'none'; p.reasons = ['no catalog item matches the request'];
        log(p, 'no match', 'nothing in the catalog fits');
      } else {
        p.item = { id: pl.item.id, title: pl.item.title, price: pl.item.price, category: pl.item.category, merchant: pl.item.merchant };
        p.quantity = pl.request.quantity; p.choiceReason = pl.choice.reason;
        log(p, 'agent chose item', `${pl.item.title} ($${pl.item.price}) via ${pl.choice.source}: ${pl.choice.reason}`);
        const ev = evaluate({ item: pl.item, quantity: p.quantity, policy: state.policy, purchases: state.purchases });
        p.total = ev.total; p.decision = ev.decision; p.reasons = ev.reasons; p.checks = ev.checks;
        log(p, 'policy engine', `${ev.decision.toUpperCase()}: ${ev.reasons.join(' | ')}`);
        if (ev.decision === 'deny') p.status = 'denied';
        else if (ev.decision === 'approval') p.status = 'pending_approval';
        else await placeOrder(req, state, p);
      }
      state.purchases.push(p); store.save(state);
      return send(res, 200, { purchase: p, state: view(state) });
    }

    const act = url.pathname.match(/^\/api\/(approve|reject)\/(p_[a-f0-9]+)$/);
    if (method === 'POST' && act) {
      const state = store.load(); const p = state.purchases.find(x => x.id === act[2]);
      if (!p || p.status !== 'pending_approval') return send(res, 409, { error: 'not pending approval' });
      if (act[1] === 'reject') { p.status = 'rejected'; log(p, 'human rejected', 'purchase cancelled by the user'); }
      else {
        // budget may have changed since the proposal: re-check before creating the order
        const others = state.purchases.filter(x => x.id !== p.id);
        const ev = evaluate({ item: p.item, quantity: p.quantity, policy: state.policy, purchases: others });
        if (ev.decision === 'deny') { p.status = 'denied'; p.reasons = ev.reasons; log(p, 'policy re-check failed', ev.reasons.join(' | ')); }
        else { log(p, 'human approved', 'the user approved this purchase'); await placeOrder(req, state, p); }
      }
      store.save(state); return send(res, 200, { purchase: p, state: view(state) });
    }

    if (method === 'GET' && url.pathname === '/mock/approve') {
      const order = url.searchParams.get('order') || '', purchase = url.searchParams.get('purchase') || '';
      const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock PayPal</title>
<body style="font-family:system-ui;max-width:420px;margin:60px auto;padding:0 16px"><h2>Mock PayPal checkout</h2>
<p>No real PayPal call is made in mock mode. Order <b>${html(order)}</b>.</p>
<p><a href="/paypal/return?purchase=${encodeURIComponent(purchase)}&token=${encodeURIComponent(order)}" style="display:inline-block;background:#0070ba;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Pay now (mock)</a>
&nbsp; <a href="/paypal/cancel?purchase=${encodeURIComponent(purchase)}">Cancel</a></p></body>`;
      return send(res, 200, page, 'text/html');
    }

    if (method === 'GET' && url.pathname === '/paypal/return') {
      const state = store.load(); const id = url.searchParams.get('purchase'); const token = url.searchParams.get('token');
      const p = state.purchases.find(x => x.id === id);
      if (!p || p.status !== 'awaiting_payment' || p.orderId !== token) { res.writeHead(302, { Location: '/?error=unknown_order' }); return res.end(); }
      const c = await paypal.captureOrder(p.orderId);
      if (c.status === 'COMPLETED') { p.status = 'paid'; p.captureId = c.captureId; log(p, 'payment captured', `${c.mode}: capture ${c.captureId}`); }
      else { log(p, 'capture not completed', String(c.status)); }
      store.save(state); res.writeHead(302, { Location: '/?paid=' + encodeURIComponent(p.id) }); return res.end();
    }
    if (method === 'GET' && url.pathname === '/paypal/cancel') {
      const state = store.load(); const p = state.purchases.find(x => x.id === url.searchParams.get('purchase'));
      if (p && p.status === 'awaiting_payment') { p.status = 'cancelled'; log(p, 'buyer cancelled at PayPal', 'budget released'); store.save(state); }
      res.writeHead(302, { Location: '/?cancelled=1' }); return res.end();
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
}

function start(port = PORT) {
  const server = http.createServer(handle);
  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

if (require.main === module) {
  start().then(s => {
    console.log(`CartGuard running at http://localhost:${s.address().port}`);
    console.log(`PayPal mode: ${paypal.mode()} | AI: ${aiEnabled() ? process.env.LLM_PROVIDER : 'rule-based (no AI key set)'}`);
  });
}

module.exports = { start, handle };
