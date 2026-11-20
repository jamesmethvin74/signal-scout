import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { candidateBudget } from '../receiver-health-backfill.js';

const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

// These are production-served client assets, not imported by the Worker build.
// Check their JavaScript syntax explicitly so runtime-only failures cannot hide.
for (const path of [
  'freqbeacon-zero.js',
  'freqbeacon-zero-live-failover.js',
  'explore-page.js'
]) {
  execFileSync(process.execPath, ['--check', fileURLToPath(new URL(`../${path}`, import.meta.url))]);
}

const zero = source('freqbeacon-zero.js');
assert.match(zero, /bootstrapTimeoutMs:\s*6500/);
assert.match(zero, /socketOpenTimeoutMs:\s*8000/);
assert.match(zero, /RECEIVER bootstrap timed out/);
assert.match(zero, /openWatchdog = watchdog/g);
assert.ok((zero.match(/openWatchdog = watchdog/g) || []).length >= 2,
  'both SND and W/F sockets must guard the opening handshake');

const failover = source('freqbeacon-zero-live-failover.js');
assert.match(failover, /const MAX_SWITCHES = 3/);
assert.match(failover, /rememberFailure\(currentId\)/);
assert.match(failover, /restartWithReplacement\(\)/);
assert.match(failover, /recentlyFailed\(receiver.id\)/);
assert.doesNotMatch(failover, /trusted\s*=\s*false/,
  'browser reports must never change authoritative receiver trust');

const globe = source('explore-page.js');
assert.match(globe, /localCooldownUntil/);
assert.match(globe, /els\.listenButton\.disabled = cooling/);

const mature = candidateBudget(200, 10);
assert.equal(mature.trusted, 6);
assert.equal(mature.promotion, 4);
assert.equal(mature.trusted + mature.promotion, mature.limit);

const viewportCss = source('freqbeacon-zero-viewport.css');
const zeroHtml = source('freqbeacon-zero.html');
assert.match(viewportCss, /height:\s*calc\(100%\s*-\s*var\(--fb-nav-reserved-height/);
assert.match(viewportCss, /overflow-y:\s*auto\s*!important/);
assert.doesNotMatch(viewportCss, /overflow-y:\s*hidden/,
  'Zero must not permanently clip controls on short Android screens');
assert.match(viewportCss, /padding-bottom:\s*max\(10px,\s*env\(safe-area-inset-bottom\)\)\s*!important/);
assert.match(zeroHtml, /freqbeacon-zero-viewport\.css\?v=6/);
assert.doesNotMatch(viewportCss, /21dvh|\.zero-scope-shell \.scope\s*\{\s*height:/,
  'Never crop the live waterfall on narrow Android screens');

const controlFit = source('freqbeacon-zero-controls-fit.css');
assert.ok(zeroHtml.includes('freqbeacon-zero-controls-fit.css?v=1'));
assert.ok(controlFit.includes('.tuning-zone'));
assert.ok(controlFit.includes('.band-rail'));
assert.ok(controlFit.includes('.receiver-strip'));
for (const forbidden of ['#rfCanvas', '.zero-scope-shell', 'aspect-ratio', 'object-fit', 'waterfallBins', 'wf_speed']) {
  assert.ok(!controlFit.includes(forbidden), 'Control-fit CSS must not touch RF: ' + forbidden);
}

const navLayout = source('freqbeacon-zero-nav-layout.css');
assert.ok(zeroHtml.includes('freqbeacon-zero-nav-layout.css?v=1'));
assert.ok(navLayout.includes('grid-template-rows: minmax(0, 1fr) auto'));
assert.ok(navLayout.includes('.zero-radio.has-fb-bottom-nav > .fb-bottom-nav'));
assert.ok(navLayout.includes('position: relative !important'));
assert.ok(navLayout.includes('overflow-y: auto !important'));
for (const forbidden of ['#rfCanvas', '.zero-scope-shell', 'aspect-ratio', 'wf_speed', 'waterfallBins']) {
  assert.ok(!navLayout.includes(forbidden), 'Navigation CSS must not touch RF: ' + forbidden);
}
assert.equal((zeroHtml.match(/class="fb-source-link"/g) || []).length, 1);
const sourceLinkAt = zeroHtml.indexOf('class="fb-source-link"');
const navAt = zeroHtml.indexOf('<nav class="fb-bottom-nav"');
assert.ok(sourceLinkAt >= 0 && sourceLinkAt < navAt, 'attribution must remain inside scroll content');

console.log('Zero receiver connection reliability checks passed.');
