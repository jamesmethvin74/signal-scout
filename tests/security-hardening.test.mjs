import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SECURITY_HEADERS,
  createWindowLimiter,
  validReceiverId,
  validateProgramGuideUrl,
  validateSdrSocketUrl,
  validateZeroSocketUrl
} from '../security-policy.js';
import {
  handleExploreClientFailureReport,
  selectedExploreReceiverId
} from '../explore-client-failure.js';
import { evaluateHealthTransition } from '../receiver-health-backfill.js';

function failureRequest(receiverId = 'example.kiwisdr.com:8073') {
  return new Request('https://freqbeacon.example/api/explore/live-failure', {
    method: 'POST',
    headers: {
      cookie: `fb_explore_receiver=${encodeURIComponent(receiverId)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ title: 'SND FAILED', detail: 'client disconnect' })
  });
}

// Client-selected receiver IDs remain an untrusted UI preference only.
assert.equal(selectedExploreReceiverId(failureRequest()), 'example.kiwisdr.com:8073');
assert.equal(selectedExploreReceiverId(failureRequest('../../169.254.169.254')), '');

for (let i = 0; i < 8; i += 1) {
  const response = await handleExploreClientFailureReport(failureRequest());
  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.equal(payload.authoritativeHealthChanged, false);
  assert.equal(payload.evidence, 'client-advisory');
}

// Bogus client reports do not touch the authoritative health state at all.
const healthy = {
  trusted: 1,
  snd_success: 1,
  wf_success: 1,
  health_score: 96,
  consecutive_failures: 0
};
const before = structuredClone(healthy);
await handleExploreClientFailureReport(failureRequest());
assert.deepEqual(healthy, before);

// The existing server-side real SND + paired W/F authority still demotes failure.
const realFailure = { reachable: true, sndSuccess: true, wfSuccess: false, connectMs: 5200 };
let state = evaluateHealthTransition(
  { trusted: 1, history: JSON.stringify([1, 1]), consecutive_failures: 0 },
  realFailure
);
assert.equal(state.trusted, true);
state = evaluateHealthTransition(
  { trusted: 1, history: JSON.stringify(state.history), consecutive_failures: 1 },
  realFailure
);
assert.equal(state.trusted, false);
assert.equal(state.consecutiveFailures, 2);

// SDR/Zero inputs reject malformed upstream-selection and stream data.
assert.equal(validReceiverId('example.kiwisdr.com:8073'), true);
assert.equal(validReceiverId('../169.254.169.254'), false);
assert.equal(validateSdrSocketUrl(new URL('https://x/api/sdr/ws?receiver=example.kiwisdr.com:8073&stream=SND&ts=1234567890')).ok, true);
assert.equal(validateSdrSocketUrl(new URL('https://x/api/sdr/ws?receiver=../../internal&stream=SND&ts=123')).ok, false);
assert.equal(validateSdrSocketUrl(new URL('https://x/api/sdr/ws?receiver=example.kiwisdr.com:8073&stream=BAD&ts=123')).ok, false);
assert.equal(validateZeroSocketUrl(new URL('https://x/api/zero/ws?stream=W/F&ts=12345678')).ok, true);
assert.equal(validateZeroSocketUrl(new URL('https://x/api/zero/ws?stream=BAD&ts=12345678')).ok, false);

// Normal paired Listen Live opens fit comfortably inside the abuse budget.
const limiter = createWindowLimiter();
const now = 1_000_000;
for (let i = 0; i < 6; i += 1) {
  assert.equal(limiter.allow('client|session-1', 6, 30_000, now).allowed, true);
}
assert.equal(limiter.allow('client|session-1', 6, 30_000, now).allowed, false);
assert.equal(limiter.allow('client|session-2', 6, 30_000, now).allowed, true);

// Program-guide parameters are bounded before any upstream work.
assert.equal(validateProgramGuideUrl(new URL('https://x/api/program-guide?station=WRMI&frequency=9955&tz=America%2FChicago')), true);
assert.equal(validateProgramGuideUrl(new URL('https://x/api/program-guide?station=WRMI&frequency=999999')), false);
assert.equal(validateProgramGuideUrl(new URL('https://x/api/program-guide?station=WRMI&at=not-a-date')), false);

// Browser hardening keeps required radio networking/geolocation while blocking framing.
assert.match(SECURITY_HEADERS['Content-Security-Policy'], /connect-src 'self' https: wss:/);
assert.match(SECURITY_HEADERS['Content-Security-Policy'], /frame-ancestors 'none'/);
assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
assert.match(SECURITY_HEADERS['Permissions-Policy'], /geolocation=\(self\)/);

const v19 = readFileSync(new URL('../worker-program-v19.js', import.meta.url), 'utf8');
const v22 = readFileSync(new URL('../worker-program-v22.js', import.meta.url), 'utf8');
assert.match(v19, /handleExploreClientFailureReport/);
assert.doesNotMatch(v19, /health_score=MAX\(0, health_score - 25\)/);
assert.match(v22, /path === '\/api\/sdr\/probe'/);
assert.match(v22, /return json\(\{ error: 'Not found' \}, 404\)/);
assert.match(v22, /sdr-ws-open/);
assert.match(v22, /zero-ws-open/);

// Upstream-controlled UI text uses textContent or escaping at innerHTML boundaries.
const explorePage = readFileSync(new URL('../explore-page.js', import.meta.url), 'utf8');
const sdrPlayer = readFileSync(new URL('../sdr-player.js', import.meta.url), 'utf8');
const programGuide = readFileSync(new URL('../program-guide.js', import.meta.url), 'utf8');
assert.match(explorePage, /textContent = receiver\.name/);
assert.match(explorePage, /textContent = receiver\.location/);
assert.match(sdrPlayer, /escapeHtml\(receiver\.name/);
assert.match(sdrPlayer, /escapeHtml\(receiver\.location/);
assert.match(programGuide, /esc\(data\.program\)/);

// Preference cookie gets browser transport hardening but is never authorization.
assert.match(explorePage, /SameSite=Lax/);
assert.match(explorePage, /; Secure/);

// No dependency graph is currently shipped through package.json.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(Object.keys(pkg.dependencies || {}).length, 0);
assert.equal(Object.keys(pkg.devDependencies || {}).length, 0);

// Catch obvious accidentally committed credential files and high-confidence secret forms.
const root = fileURLToPath(new URL('../', import.meta.url));
const suspiciousNames = [];
const secretFindings = [];
const secretNameRe = /(^|\/)(?:\.env(?:\.|$)|\.dev\.vars$|credentials?(?:\.|$)|secrets?(?:\.|$)|id_rsa$|.*\.(?:pem|p12|pfx)$)/i;
const textExtRe = /\.(?:js|mjs|json|jsonc|md|html|css|txt)$/i;
const highConfidenceSecrets = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/
];

function walk(dir, relative = '') {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const full = `${dir}/${name}`;
    const rel = relative ? `${relative}/${name}` : name;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, rel);
      continue;
    }
    if (secretNameRe.test(rel)) suspiciousNames.push(rel);
    if (!textExtRe.test(rel) || rel === 'tests/security-hardening.test.mjs') continue;
    const text = readFileSync(full, 'utf8');
    if (highConfidenceSecrets.some((pattern) => pattern.test(text))) secretFindings.push(rel);
  }
}
walk(root);
assert.deepEqual(suspiciousNames, []);
assert.deepEqual(secretFindings, []);

console.log('FREQBEACON security hardening regression checks passed.');
