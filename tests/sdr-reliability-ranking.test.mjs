import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-sdr-reliability-ranking.js', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

assert.match(worker, /signalScout:sdrHealth:v2/);
assert.match(worker, /freqbeacon:sdrConnectionUsability:v1/);
assert.match(worker, /freqbeacon:snd-attempt-failed/);
assert.match(worker, /recentConnectionFailure/);
assert.match(worker, /proxyEndpoint/);
assert.match(worker, /Math\.abs\(scoreGap\) <= 8/);
assert.match(worker, /sdr-receiver-runtime-v3\.js\?v=9/);
assert.match(worker, /sdr-player\.js\?v=12/);
assert.match(wrangler, /"main": "worker-sdr-reliability-ranking\.js"/);

// Geography remains primary: the reliability/proxy preference only wins inside
// a small score band rather than replacing the RF/path score wholesale.
const direct = { effectiveScore: 82, recentConnectionSuccess: false, recentSuccess: false, recentConnectionFailure: false, proxyEndpoint: false, userDistance: 162 };
const failingProxy = { effectiveScore: 86, recentConnectionSuccess: false, recentSuccess: false, recentConnectionFailure: true, proxyEndpoint: true, userDistance: 154 };
function compare(a, b) {
  const scoreGap = b.effectiveScore - a.effectiveScore;
  if (Math.abs(scoreGap) <= 8) {
    const aWorked = Boolean(a.recentConnectionSuccess || a.recentSuccess);
    const bWorked = Boolean(b.recentConnectionSuccess || b.recentSuccess);
    if (aWorked !== bWorked) return Number(bWorked) - Number(aWorked);
    if (a.recentConnectionFailure !== b.recentConnectionFailure) return Number(a.recentConnectionFailure) - Number(b.recentConnectionFailure);
    if (a.proxyEndpoint !== b.proxyEndpoint) return Number(a.proxyEndpoint) - Number(b.proxyEndpoint);
  }
  return scoreGap || Number(b.recentSuccess) - Number(a.recentSuccess) || (a.userDistance ?? Infinity) - (b.userDistance ?? Infinity);
}
assert.ok(compare(direct, failingProxy) < 0, 'nearby direct receiver should outrank a similarly-scored failing proxy receiver');

console.log('SDR reliability ranking regression guard passed');
