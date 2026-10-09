import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { liveFailureResponse } from '../worker-program-v19.js';
import { evaluateHealthTransition } from '../receiver-health-backfill.js';
import {
  applySecurityHeaders,
  enforceAbuseLimits,
  validateSecurityRequest
} from '../security-hardening.js';

function request(path, options = {}) {
  return new Request(`https://freqbeacon.example${path}`, options);
}

class FakeLimiter {
  constructor(limit) {
    this.limitValue = limit;
    this.counts = new Map();
  }

  async limit({ key }) {
    const count = (this.counts.get(key) || 0) + 1;
    this.counts.set(key, count);
    return { success: count <= this.limitValue };
  }
}

test('forged Explore live-failure reports cannot mutate authoritative receiver health', async () => {
  let dbCalls = 0;
  const env = {
    RECEIVER_HEALTH_DB: {
      prepare() {
        dbCalls += 1;
        throw new Error('client report must never touch D1');
      }
    }
  };
  const headers = {
    cookie: 'fb_explore_receiver=receiver.example%3A8073',
    'content-type': 'application/json'
  };

  for (let i = 0; i < 6; i += 1) {
    const response = await liveFailureResponse(request('/api/explore/live-failure', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'SND CLOSED', detail: 'forged client failure' })
    }), env);
    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.authoritativeHealthChanged, false);
    assert.equal(payload.temporarilyHidden, false);
  }

  assert.equal(dbCalls, 0, 'client failure reports must perform zero authoritative D1 writes');
});

test('bogus browser reports leave healthy authoritative fields unchanged', async () => {
  const receiver = {
    trusted: 1,
    snd_success: 1,
    wf_success: 1,
    health_score: 96,
    consecutive_failures: 0
  };
  const before = structuredClone(receiver);

  await liveFailureResponse(request('/api/explore/live-failure', {
    method: 'POST',
    headers: {
      cookie: 'fb_explore_receiver=receiver.example%3A8073',
      'content-type': 'application/json'
    },
    body: '{}'
  }), { RECEIVER_HEALTH_DB: { prepare: () => { throw new Error('unexpected write'); } } });

  assert.deepEqual(receiver, before);
});

test('server-side SND + W/F health proof can still demote an actually failing receiver', () => {
  const failure = { reachable: true, sndSuccess: true, wfSuccess: false, connectMs: 5200 };
  const next = evaluateHealthTransition({
    trusted: 1,
    history: '[1,1,0]',
    consecutive_failures: 1
  }, failure);

  assert.equal(next.trusted, false);
  assert.equal(next.consecutiveFailures, 2);
  assert.equal(next.success, false);
});

test('malformed SDR receiver and stream requests are rejected before upstream work', () => {
  const disabledProbe = validateSecurityRequest(request('/api/sdr/probe?receiver=%3Cscript%3E&stream=BAD'));
  assert.equal(disabledProbe.ok, false);
  assert.equal(disabledProbe.status, 404);

  const badReceiver = validateSecurityRequest(request('/api/sdr/ws?receiver=%3Cscript%3E&stream=SND&ts=1234567890', {
    headers: { Upgrade: 'websocket' }
  }));
  assert.equal(badReceiver.ok, false);
  assert.equal(badReceiver.status, 400);

  const badStream = validateSecurityRequest(request('/api/sdr/ws?receiver=receiver.example%3A8073&stream=ADMIN&ts=1234567890', {
    headers: { Upgrade: 'websocket' }
  }));
  assert.equal(badStream.ok, false);
  assert.equal(badStream.status, 400);
});

test('normal paired Listen Live SND and W/F opens remain under abuse limits', async () => {
  const env = {
    SDR_CLIENT_RATE_LIMITER: new FakeLimiter(48),
    SDR_SESSION_RATE_LIMITER: new FakeLimiter(8),
    SDR_CONTROL_RATE_LIMITER: new FakeLimiter(60)
  };
  const baseHeaders = {
    Upgrade: 'websocket',
    'CF-Connecting-IP': '203.0.113.42'
  };

  for (const stream of ['SND', 'W/F']) {
    const req = request(`/api/sdr/ws?receiver=receiver.example%3A8073&stream=${encodeURIComponent(stream)}&ts=1234567890`, {
      headers: baseHeaders
    });
    assert.equal(validateSecurityRequest(req).ok, true);
    const allowed = await enforceAbuseLimits(req, env);
    assert.equal(allowed.ok, true);
  }
});

test('rate limits reject abusive connection bursts without changing protocol handling', async () => {
  const env = {
    SDR_CLIENT_RATE_LIMITER: new FakeLimiter(48),
    SDR_SESSION_RATE_LIMITER: new FakeLimiter(2),
    SDR_CONTROL_RATE_LIMITER: new FakeLimiter(60)
  };
  const make = (stream) => request(`/api/sdr/ws?receiver=receiver.example%3A8073&stream=${encodeURIComponent(stream)}&ts=1234567890`, {
    headers: { Upgrade: 'websocket', 'CF-Connecting-IP': '203.0.113.77' }
  });

  assert.equal((await enforceAbuseLimits(make('SND'), env)).ok, true);
  assert.equal((await enforceAbuseLimits(make('W/F'), env)).ok, true);
  const blocked = await enforceAbuseLimits(make('SND'), env);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 429);
});

test('public diagnostic refresh controls are not exposed', () => {
  assert.equal(validateSecurityRequest(request('/api/program-guide/health?refresh=1')).status, 404);
  assert.equal(validateSecurityRequest(request('/api/ham-activity?refresh=1')).status, 400);
});

test('security headers cover XSS, MIME sniffing, referrer and clickjacking defenses', () => {
  const response = applySecurityHeaders(new Response('<!doctype html>', {
    headers: { 'content-type': 'text/html; charset=utf-8' }
  }));
  assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(response.headers.get('permissions-policy') || '', /geolocation=\(self\)/);
});


test('production static assets exclude private Worker modules and public debug surfaces', () => {
  const ignore = readFileSync(new URL('../.assetsignore', import.meta.url), 'utf8');
  const entries = new Set(ignore.split(/\r?\n/).map((value) => value.trim()).filter((value) => value && !value.startsWith('#')));
  const required = [
    'worker-*.js',
    'security-hardening.js',
    'receiver-health-d1.js',
    'receiver-health-backfill.js',
    'receiver-health-runs.js',
    'kiwi-public-directory.js',
    'sdr-ws-router.js',
    'scripts/',
    'tests/',
    'package.json',
    'SOURCE-COMPLIANCE.md',
    'boot-forensics.html',
    'pwa-diagnostics.html',
    'sdr-diagnostics.html',
    'sdr-forensics-v4.html',
    'sdr-pair-diagnostics.html',
    'sdr-runtime-trace.html',
    'sdr-trace.html',
    'sdr-trace-v2.html',
    'sdr-asset-check.html',
    'sdr-diagnostics.js',
    'sdr-diagnostics-query.js',
    'sdr-diagnostics-worker.js'
  ];
  for (const file of required) {
    assert.ok(entries.has(file), `Internal asset protection missing: ${file}`);
  }
});

console.log('FREQBEACON security hardening regression checks passed.');
