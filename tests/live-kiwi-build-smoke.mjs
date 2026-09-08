import WebSocket from 'ws';

const candidates = [
  { name: 'K1VL Vermont', host: 'sdr.k1vl.com:8073', frequency: 6160 },
  { name: 'Sutton Massachusetts', host: 'kiwisdr.njctech.com:8073', frequency: 6160 },
  { name: 'KM3T Amherst New Hampshire', host: 'kiwisdr.km3t.net:8073', frequency: 6160 },
  { name: 'W1NT Newton New Hampshire', host: 'w1nt.onthewifi.com:8073', frequency: 6160 }
];

function kiwiMessageText(data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (bytes.length < 4 || bytes.subarray(0, 3).toString('ascii') !== 'MSG') return '';
  return bytes.subarray(4).toString('utf8');
}

function sndStats(data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (bytes.length < 12 || bytes.subarray(0, 3).toString('ascii') !== 'SND') return null;
  const body = bytes.subarray(3);
  const flags = body[0];
  const smeter = body.readUInt16BE(5);
  const audio = body.subarray(7);
  if (flags & 0x10 || audio.length < 16) return { compressed: true, rssi: smeter * 0.1 - 127, samples: 0, rms: 0 };
  const littleEndian = Boolean(flags & 0x80);
  const count = Math.floor(audio.length / 2);
  let sumSq = 0;
  for (let i = 0; i < count; i += 1) {
    const sample = littleEndian ? audio.readInt16LE(i * 2) : audio.readInt16BE(i * 2);
    const normalized = sample / 32768;
    sumSq += normalized * normalized;
  }
  return {
    compressed: false,
    rssi: smeter * 0.1 - 127,
    samples: count,
    rms: Math.sqrt(sumSq / Math.max(1, count))
  };
}

function smoke(candidate) {
  return new Promise((resolve) => {
    const timestamp = (Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 10000)) >>> 0;
    const url = `ws://${candidate.host}/ws/kiwi/${timestamp}/SND`;
    const result = {
      name: candidate.name,
      host: candidate.host,
      opened: false,
      sampleRate: null,
      audioRate: null,
      sndFrames: 0,
      pcmSamples: 0,
      maxRms: 0,
      bestRssi: -999,
      error: null
    };
    let configured = false;
    let done = false;
    const finish = (ok, error = null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) result.error = error;
      try { ws.close(1000, 'FREQBEACON smoke complete'); } catch {}
      resolve({ ok, result });
    };

    const ws = new WebSocket(url, {
      handshakeTimeout: 6000,
      headers: {
        Origin: `http://${candidate.host}`,
        'User-Agent': 'FREQBEACON/1.0 live build smoke'
      }
    });
    const timer = setTimeout(() => finish(false, 'timeout waiting for uncompressed SND audio'), 12000);

    ws.on('open', () => {
      result.opened = true;
      ws.send('SET auth t=kiwi p=');
    });

    ws.on('message', (data) => {
      const text = kiwiMessageText(data);
      if (text) {
        const sampleRate = text.match(/(?:^|\s)sample_rate=([0-9.]+)/)?.[1];
        const audioRate = text.match(/(?:^|\s)audio_rate=([0-9]+)/)?.[1];
        if (sampleRate) {
          result.sampleRate = Number(sampleRate);
          if (!configured) {
            configured = true;
            ws.send('SET ident_user=FREQBEACON-smoke');
            ws.send(`SET mod=am low_cut=-4900 high_cut=4900 freq=${candidate.frequency.toFixed(3)}`);
            ws.send('SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50');
            ws.send('SET compression=0');
            ws.send('SET squelch=0 max=0');
            ws.send('SET genattn=0');
            ws.send('SET gen=0 mix=-1');
            ws.send('SET de_emp=0');
          }
        }
        if (audioRate) {
          result.audioRate = Number(audioRate);
          ws.send(`SET AR OK in=${result.audioRate} out=48000`);
        }
        if (/(?:^|\s)(?:too_busy|down)=1(?:\s|$)/.test(text)) finish(false, text.trim());
        return;
      }

      const stats = sndStats(data);
      if (!stats) return;
      if (stats.compressed) {
        ws.send('SET compression=0');
        return;
      }
      result.sndFrames += 1;
      result.pcmSamples += stats.samples;
      result.maxRms = Math.max(result.maxRms, stats.rms);
      result.bestRssi = Math.max(result.bestRssi, stats.rssi);
      if (result.sndFrames >= 6 && result.pcmSamples >= 1500) finish(true);
    });

    ws.on('error', (error) => finish(false, error?.message || 'websocket error'));
    ws.on('close', (code) => {
      if (!done) finish(false, `socket closed before audio proof (${code})`);
    });
  });
}

console.log('FREQBEACON live Kiwi build smoke: starting');
let passed = null;
const attempts = [];
for (const candidate of candidates) {
  const attempt = await smoke(candidate);
  attempts.push(attempt.result);
  console.log(JSON.stringify(attempt.result));
  if (attempt.ok) {
    passed = attempt.result;
    break;
  }
}

if (!passed) {
  console.error('FREQBEACON live Kiwi build smoke FAILED');
  console.error(JSON.stringify(attempts, null, 2));
  process.exit(1);
}

console.log(`FREQBEACON LIVE KIWI PASS: ${passed.name} delivered ${passed.sndFrames} uncompressed SND frames / ${passed.pcmSamples} PCM samples, RSSI ${passed.bestRssi.toFixed(1)} dB, max RMS ${passed.maxRms.toFixed(4)}, sample_rate=${passed.sampleRate}, audio_rate=${passed.audioRate}`);
