'use strict';
// Deterministic spending policy. The AI never decides whether money may be spent:
// it only proposes; this module (plain code, fully tested) enforces the rules.

const DEFAULT_POLICY = {
  monthlyBudget: 200,        // USD the agent may commit per calendar month
  perPurchaseLimit: 75,      // hard cap for a single purchase (items x quantity)
  autoApproveUnder: 25,      // at or below: agent may create the PayPal order on its own
  allowedCategories: ['electronics', 'office', 'books', 'home'],
  blockedMerchants: [],
};

function money(n) { return Math.round(n * 100) / 100; }

function normalizePolicy(p) {
  const out = { ...DEFAULT_POLICY, ...(p || {}) };
  for (const k of ['monthlyBudget', 'perPurchaseLimit', 'autoApproveUnder']) {
    const v = Number(out[k]);
    out[k] = Number.isFinite(v) && v >= 0 ? money(v) : DEFAULT_POLICY[k];
  }
  out.allowedCategories = (Array.isArray(out.allowedCategories) ? out.allowedCategories : String(out.allowedCategories || '').split(','))
    .map(s => String(s).trim().toLowerCase()).filter(Boolean);
  out.blockedMerchants = (Array.isArray(out.blockedMerchants) ? out.blockedMerchants : String(out.blockedMerchants || '').split(','))
    .map(s => String(s).trim().toLowerCase()).filter(Boolean);
  return out;
}

// committed = money already paid or reserved by orders awaiting payment in the current month
function committedThisMonth(purchases, now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  let sum = 0;
  for (const p of purchases || []) {
    if (!['paid', 'awaiting_payment'].includes(p.status)) continue;
    const d = new Date(p.createdAt);
    if (d.getUTCFullYear() === y && d.getUTCMonth() === m) sum += Number(p.total) || 0;
  }
  return money(sum);
}

// item: {id,title,price,category,merchant}; quantity: integer >= 1
// returns {decision:'auto'|'approval'|'deny', total, reasons:[...], checks:[{rule,ok,detail}]}
function evaluate({ item, quantity = 1, policy, purchases = [], now = new Date() }) {
  const pol = normalizePolicy(policy);
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const total = money(Number(item.price) * qty);
  const committed = committedThisMonth(purchases, now);
  const remaining = money(pol.monthlyBudget - committed);
  const checks = [];
  const add = (rule, ok, detail) => checks.push({ rule, ok, detail });

  add('category allowed', pol.allowedCategories.includes(String(item.category).toLowerCase()),
    `category "${item.category}" vs allowed [${pol.allowedCategories.join(', ')}]`);
  add('merchant not blocked', !pol.blockedMerchants.includes(String(item.merchant).toLowerCase()),
    `merchant "${item.merchant}"`);
  add('within per-purchase limit', total <= pol.perPurchaseLimit,
    `$${total} vs limit $${pol.perPurchaseLimit}`);
  add('within monthly budget', total <= remaining,
    `$${total} vs remaining $${remaining} (budget $${pol.monthlyBudget}, committed $${committed})`);

  const failed = checks.filter(c => !c.ok);
  let decision;
  if (failed.length) decision = 'deny';
  else if (total <= pol.autoApproveUnder) decision = 'auto';
  else decision = 'approval';
  const reasons = failed.length ? failed.map(c => `${c.rule}: ${c.detail}`)
    : [decision === 'auto' ? `total $${total} is at or below the auto-approve threshold $${pol.autoApproveUnder}`
      : `total $${total} is above the auto-approve threshold $${pol.autoApproveUnder}: human approval required`];
  return { decision, total, quantity: qty, remaining, reasons, checks };
}

module.exports = { DEFAULT_POLICY, normalizePolicy, committedThisMonth, evaluate, money };
