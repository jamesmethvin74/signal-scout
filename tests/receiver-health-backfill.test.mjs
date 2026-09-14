import assert from 'node:assert/strict';
import {
  candidateBudget,
  evaluateHealthTransition,
  proxySafeTimestamp
} from '../receiver-health-backfill.js';

const success = { reachable: true, sndSuccess: true, wfSuccess: true, connectMs: 1800 };
const failure = { reachable: true, sndSuccess: true, wfSuccess: false, connectMs: 5200 };

let state = evaluateHealthTransition({ trusted: 0, history: '[]', consecutive_failures: 0 }, success);
assert.equal(state.trusted, false, 'one success must not publish a new receiver');
assert.deepEqual(state.history, [1]);

state = evaluateHealthTransition({ trusted: 0, history: JSON.stringify(state.history), consecutive_failures: 0 }, success);
assert.equal(state.trusted, true, 'two real successes must promote a receiver');
assert.equal(state.successRate, 1);

state = evaluateHealthTransition({ trusted: 1, history: JSON.stringify(state.history), consecutive_failures: 0 }, failure);
assert.equal(state.trusted, true, 'one transient failure must not immediately remove a trusted receiver');
assert.equal(state.consecutiveFailures, 1);

state = evaluateHealthTransition({ trusted: 1, history: JSON.stringify(state.history), consecutive_failures: 1 }, failure);
assert.equal(state.trusted, false, 'two consecutive failures must remove trust');
assert.equal(state.consecutiveFailures, 2);

const warmupBudget = candidateBudget(0, 10);
assert.equal(warmupBudget.promotion, 5);
assert.equal(warmupBudget.trusted, 1);
assert.equal(warmupBudget.limit, 10);

const matureBudget = candidateBudget(200, 10);
assert.equal(matureBudget.trusted, 2);
assert.equal(matureBudget.limit, 10);

const ts = BigInt(proxySafeTimestamp('1700000000'));
assert.ok((ts & (1n << 62n)) !== 0n, 'Cloudflare-safe session timestamp must use the Kiwi high-bit namespace');

console.log('Receiver health backfill policy checks passed.');
