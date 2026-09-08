import worker from './worker-program-v15.js';
import { LIVE_KIWI_BUILD_SMOKE } from './.live-kiwi-build-smoke-proof.js';

const direct = LIVE_KIWI_BUILD_SMOKE?.direct;
const proxied = LIVE_KIWI_BUILD_SMOKE?.proxied;

if (!direct?.sndFrames || direct.sndFrames < 8 || !direct?.pcmSamples || direct.pcmSamples < 2000) {
  throw new Error('FREQBEACON direct Kiwi live-audio smoke proof missing');
}

if (!proxied?.sndFrames || proxied.sndFrames < 8 || !proxied?.pcmSamples || proxied.pcmSamples < 2000 || !(proxied.maxRms > 0.0005)) {
  throw new Error('FREQBEACON proxied Kiwi live-audio smoke proof missing');
}

export default worker;
