import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KIWI_DIRECTORY_MIN_FETCH_MS,
  KIWI_PUBLIC_DIRECTORY_URL,
  parseKiwiPublicListHtml
} from '../kiwi-public-directory.js';

test('authorized Kiwi public list parser keeps only active external-app receivers', () => {
  const html = `
<div class='cl-info'>
<!-- status=active -->
<!-- offline=no -->
<!-- name=Conway Test Kiwi -->
<!-- sdr_hw=KiwiSDR 2 v1.900 -->
<!-- users=1 -->
<!-- users_max=8 -->
<!-- ext_api=2 -->
<!-- gps=(35.0887,-92.4421) -->
<!-- loc=Conway, Arkansas, USA -->
<!-- sw_version=KiwiSDR_v1.900 -->
<!-- antenna=Loop -->
<a href='http://example.proxy.kiwisdr.com/'>http://example.proxy.kiwisdr.com/</a>
<div class='cl-info'>
<!-- status=active -->
<!-- offline=no -->
<!-- name=External disabled -->
<!-- ext_api=0 -->
<!-- gps=(40.0,-90.0) -->
<!-- loc=Somewhere, USA -->
<a href='http://disabled.example.com:8073/'>http://disabled.example.com:8073/</a>
`;

  const receivers = parseKiwiPublicListHtml(html);
  assert.equal(receivers.length, 1);
  assert.equal(receivers[0].name, 'Conway Test Kiwi');
  assert.equal(receivers[0].id, 'example.proxy.kiwisdr.com:80');
  assert.equal(receivers[0].extApi, 2);
  assert.equal(receivers[0].lat, 35.0887);
  assert.equal(receivers[0].lon, -92.4421);
});

test('directory source is the owner-authorized gzip endpoint and never faster than hourly', () => {
  assert.equal(
    KIWI_PUBLIC_DIRECTORY_URL,
    'https://kiwisdr.com/public.list/index.html.gz/?freqbeacon.methvindigitalworks.com'
  );
  assert.equal(KIWI_DIRECTORY_MIN_FETCH_MS, 60 * 60 * 1000);
});
