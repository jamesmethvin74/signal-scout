import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');

const [
  workerV2,
  workerBase,
  zeroWorker,
  topWorker,
  guideWorker,
  fullData,
  pkgText,
  wranglerText,
  fccAsset,
  fccGenerator,
  terrestrialGenerator,
  policy,
  kiwiDirectory
] = await Promise.all([
  read('worker-v2.js'),
  read('worker-base.js'),
  read('freqbeacon-zero-worker.js'),
  read('worker-program-v22.js'),
  read('program-guide-worker.js'),
  read('full-data.js'),
  read('package.json'),
  read('wrangler.jsonc'),
  read('freqbeacon-zero-us-am-fcc.js'),
  read('scripts/generate-fcc-am-catalog.mjs'),
  read('scripts/generate-global-terrestrial-catalog.mjs'),
  read('SOURCE-COMPLIANCE.md'),
  read('kiwi-public-directory.js')
]);

assert.doesNotMatch(workerV2, /receiverbook\.de/i);
assert.doesNotMatch(workerBase, /receiverbook\.de/i);
assert.doesNotMatch(workerV2, /\/ws\/kiwi\/\$\{upstreamTimestamp\}/);
assert.match(workerV2, /external KiwiSDR client/);
assert.match(workerV2, /owner’s ext_api channel/);

assert.doesNotMatch(zeroWorker, /\/ws\/kiwi\//);
assert.match(zeroWorker, /proxySafeTimestamp/);
assert.match(zeroWorker, /external KiwiSDR client/);
assert.match(zeroWorker, /receiver owner's ext_api channel limit/);

assert.match(topWorker, /legacyProgramFirewall/);
assert.match(topWorker, /\/api\/program-guide/);
assert.match(topWorker, /\/api\/ham-activity/);
assert.match(topWorker, /url\.pathname === '\/full-data\.js'/);
assert.match(topWorker, /cron !== RECEIVER_HEALTH_CRON/);
assert.match(topWorker, /compliance firewall blocked scheduled event/);
assert.doesNotMatch(wranglerText, /17 \*\/6 \* \* \*/);
assert.match(wranglerText, /"\* \* \* \* \*"/);

assert.doesNotMatch(guideWorker, /https?:\/\//i);
assert.doesNotMatch(guideWorker, /fetch\s*\(/);
assert.match(guideWorker, /source reuse permissions/);

assert.doesNotMatch(fullData, /raw\.githubusercontent\.com/i);
assert.doesNotMatch(fullData, /fetch\s*\(/);
assert.match(fullData, /complianceMode:\s*true/);

const pkg = JSON.parse(pkgText);
assert.doesNotMatch(pkg.scripts.postinstall, /generate-a26-identification-catalog/);
assert.match(pkg.scripts.postinstall, /generate-fcc-am-catalog/);
assert.match(fccGenerator, /https:\/\/publicfiles\.fcc\.gov\/api\/service\/facility\/search/);
assert.doesNotMatch(fccGenerator, /Roger-Need\/StationFinder|githubusercontent\.com|fccdata\.org/i);
assert.match(fccGenerator, /REFUSING INCOMPLETE FCC AM DATA/);
assert.match(pkg.scripts.test, /test:compliance/);

// A raw checkout contains the safe, disabled placeholder. Cloudflare's
// postinstall replaces it with a validated first-party FCC snapshot.
// GitHub runs npm test without postinstall; both states must be valid.
assert.match(fccAsset, /FREQBEACON_ZERO_US_AM_FCC_CATALOG/);
if (fccAsset.includes('Generated from official FCC Public Inspection Files API')) {
  assert.match(fccAsset, /FCC Public Inspection Files/);
  assert.doesNotMatch(fccAsset, /FREQBEACON_ZERO_US_AM_FCC_CATALOG = Object\.freeze\(\[\]\)/);
} else {
  assert.match(fccAsset, /FREQBEACON_ZERO_US_AM_FCC_CATALOG = Object\.freeze\(\[\]\)/);
  assert.match(pkg.scripts.postinstall, /generate-fcc-am-catalog/);
}
assert.doesNotMatch(terrestrialGenerator, /Roger-Need\/StationFinder/);
assert.match(terrestrialGenerator, /fallbackEntries=\[\]/);

assert.match(policy, /Public reachability is not permission/i);
assert.match(policy, /FCC Public Inspection Files API/);
assert.match(policy, /ReceiverBook receiver directory \| DISABLED/);
assert.match(policy, /KiwiSDR public receivers \| ALLOWED WITH OPERATOR CONTROLS/);
assert.match(policy, /KiwiSDR public directory .* \| ALLOWED/);
assert.match(kiwiDirectory, /http:\/\/kiwisdr\.com\/public\.list\/index\.html\.gz\?freqbeacon\.methvindigitalworks\.com/);
assert.doesNotMatch(kiwiDirectory, /https:\/\/kiwisdr\.com\/public\.list\/index\.html\.gz\?freqbeacon\.methvindigitalworks\.com/);
assert.match(kiwiDirectory, /KIWI_DIRECTORY_MIN_FETCH_MS = 60 \* 60 \* 1000/);
assert.match(kiwiDirectory, /extApi < 1/);
assert.doesNotMatch(kiwiDirectory, /receiverbook\.de/i);

// Temporary read-only first-party FCC API shape verification.
if (process.env.CI === 'true') {
  for(const prefix of ['K','W','KA','WA']) {
    try {
      const r=await fetch('https://publicfiles.fcc.gov/api/service/facility/search/'+prefix+'.json', {
        signal:AbortSignal.timeout(10000),headers:{accept:'application/json'}
      });
      const d=await r.json();
      const g=d?.results?.globalSearchResults;
      console.log('FCC CALLSIGN DIAG',prefix,'HTTP',r.status,'AM-count',g?.amResultsCount,
        'AM-rows',g?.amFacilityList?.length,'sample',JSON.stringify(g?.amFacilityList?.[0]||{}).slice(0,650));
    } catch(e) {console.log('FCC CALLSIGN DIAG',prefix,'ERROR',e.message);}
  }
}
console.log('source compliance guards: ok');
