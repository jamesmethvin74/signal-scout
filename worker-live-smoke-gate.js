import worker from './worker-program-v15.js';
import { LIVE_KIWI_BUILD_SMOKE } from './.live-kiwi-build-smoke-proof.js';

if (!LIVE_KIWI_BUILD_SMOKE?.sndFrames || LIVE_KIWI_BUILD_SMOKE.sndFrames < 6) {
  throw new Error('FREQBEACON live Kiwi build smoke proof missing');
}

export default worker;
