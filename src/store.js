'use strict';
// Tiny JSON-file store (state survives restarts). Path can be overridden with STATE_FILE (used by tests).
const fs = require('fs');
const path = require('path');
const { normalizePolicy, DEFAULT_POLICY } = require('./policy');

function file() { return process.env.STATE_FILE || path.join(__dirname, '..', 'data', 'state.json'); }

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return { policy: normalizePolicy(s.policy), purchases: Array.isArray(s.purchases) ? s.purchases : [] };
  } catch (_) {
    return { policy: { ...DEFAULT_POLICY }, purchases: [] };
  }
}

function save(state) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(state, null, 2));
}

module.exports = { load, save };
