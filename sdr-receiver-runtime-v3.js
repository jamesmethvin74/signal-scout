(() => {
  if (window.__freqbeaconReceiverRuntimeV3) return;
  window.__freqbeaconReceiverRuntimeV3 = true;

  const VERSION = 'receiver-runtime-v3-live-cache-health';
  const LOCATION_STORAGE_KEY = 'signalScout:location:v1';
  const HEALTH_KEY = 'signalScout:sdrHealth:v1';
  const LIVE_POOL_KEY = 'freqbeacon:sdrLivePool:v2';
  const LIVE_POOL_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const LIVE_REFRESH_MIN_MS = 10 * 60 * 1000;
  const LIVE_REFRESH_TIMEOUT_MS = 8000;
  const RECENT_SUCCESS_MS = 45 * 60 * 1000;
  const upstreamFetch = window.fetch.bind(window);

  const SEED = [
    { id:'22661.proxy.kiwisdr.com:8073', name:'N0DSS | St. Louis, Missouri', location:'St. Louis, Missouri', lat:38.6270, lon:-90.1994, minKHz:10, maxKHz:30000 },
    { id:'km4rt.ddns.net:8073', name:'KM4RT 0-30 MHz SDR', location:'Tipton County, Tennessee', lat:35.5600, lon:-89.6500, minKHz:10, maxKHz:30000 },
    { id:'21118.proxy.kiwisdr.com:8073', name:'Shortwave Central', location:'Mandeville, Louisiana', lat:30.3583, lon:-90.0656, minKHz:10, maxKHz:30000 },
    { id:'21305.proxy.kiwisdr.com:8073', name:'KJ5CHW 0-30 MHz SDR', location:'San Antonio, Texas', lat:29.4241, lon:-98.4936, minKHz:10, maxKHz:30000 },
    { id:'22204.proxy.kiwisdr.com:8073', name:'K4MIE 0-30 MHz SDR', location:'Huntsville, Alabama', lat:34.7304, lon:-86.5861, minKHz:10, maxKHz:30000 },
    { id:'22581.proxy.kiwisdr.com:8073', name:'KiwiSDR V2 Hartwell GA', location:'Hartwell, Georgia', lat:34.3529, lon:-82.9321, minKHz:10, maxKHz:30000 },
    { id:'p3hosting.dscloud.biz:8073', name:'0-30 MHz SDR | Boone NC', location:'Boone, North Carolina', lat:36.2168, lon:-81.6746, minKHz:10, maxKHz:30000 },
    { id:'22551.proxy.kiwisdr.com:8073', name:'KZ4MR 0-30 MHz SDR', location:'Leesburg, Virginia', lat:39.1157, lon:-77.5636, minKHz:10, maxKHz:30000 },
    { id:'22338.proxy.kiwisdr.com:8073', name:"WF7I's SDR", location:'Natural Bridge, Virginia', lat:37.6285, lon:-79.5439, minKHz:10, maxKHz:30000 },
    { id:'21690.proxy.kiwisdr.com:8073', name:'0-30 MHz SDR | Hilliard Ohio', location:'Hilliard, Ohio', lat:40.0334, lon:-83.1582, minKHz:10, maxKHz:30000 },
    { id:'rgv.twrmon.net:8075', name:'0-30 MHz SDR | Brownsville Texas', location:'Brownsville, Texas', lat:25.9017, lon:-97.4975, minKHz:10, maxKHz:30000 },
    { id:'kiwisdr1.sdrutah.org:8073', name:'Northern Utah KiwiSDR #1', location:'Northern Utah', lat:40.7608, lon:-111.8910, minKHz:10, maxKHz:30000 },
    { id:'kiwisdr2.sdrutah.org:8074', name:'Northern Utah KiwiSDR #2', location:'Northern Utah', lat:40.7608, lon:-111.8910, minKHz:10, maxKHz:30000 },
    { id:'km6cq.hopto.org:8073', name:'KM6CQ Ponderosa SDR', location:'Washoe Valley, Nevada', lat:39.2830, lon:-119.8280, minKHz:100, maxKHz:30000 },
    { id:'22148.proxy.kiwisdr.com:8073', name:'0-30 MHz SDR | Bend Oregon', location:'Bend, Oregon', lat:44.0582, lon:-121.3153, minKHz:10, maxKHz:30000 },
    { id:'mtkiwi.proxy.kiwisdr.com:8073', name:'0-30 MHz SDR | Stevensville MT', location:'Stevensville, Montana', lat:46.5099, lon:-114.0932, minKHz:10, maxKHz:30000 },
    { id:'k7len.proxy.kiwisdr.com:8073', name:'K7LEN 0-30 MHz SDR', location:'Worley, Idaho', lat:47.4007, lon:-116.9207, minKHz:10, maxKHz:30000 },
    { id:'n7drd.proxy.kiwisdr.com:8073', name:'0-30 MHz SDR | Ocean Park WA', location:'Ocean Park, Washington', lat:46.4918, lon:-124.0526, minKHz:10, maxKHz:30000 },
    { id:'palomar-1.proxy.kiwisdr.com:8073', name:'K6VZK KiwiSDR #1', location:'Palomar Mountain, California', lat:33.3220, lon:-116.8640, minKHz:10, maxKHz:30000 }
  ];

  let activeContext = null;
  let livePool = loadLivePool();
  let liveRefreshPromise = null;
  let lastLiveRefreshAttempt = 0;

  function finite(value) {
    if (value == null || String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function loadStoredLocation() {
    try {
      const payload = JSON.parse(window.localStorage?.getItem(LOCATION_STORAGE_KEY) || 'null');
      const lat = Number(payload?.lat), lon = Number(payload?.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    } catch { return null; }
  }

  function loadHealth() {
    try {
      const parsed = JSON.parse(window.localStorage?.getItem(HEALTH_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  function normalizeReceiver(receiver, liveEvidence = false) {
    if (!receiver?.id) return null;
    return {
      ...receiver,
      id: String(receiver.id),
      name: String(receiver.name || 'Public KiwiSDR'),
      location: String(receiver.location || 'Location not listed'),
      lat: finite(receiver.lat), lon: finite(receiver.lon),
      minKHz: finite(receiver.minKHz) ?? 10,
      maxKHz: finite(receiver.maxKHz) ?? 30000,
      liveEvidence: Boolean(receiver.liveEvidence || liveEvidence)
    };
  }

  function loadLivePool() {
    try {
      const payload = JSON.parse(window.localStorage?.getItem(LIVE_POOL_KEY) || 'null');
      if (!payload || !Array.isArray(payload.receivers)) return { updatedAt: 0, receivers: [] };
      return {
        updatedAt: Number(payload.updatedAt || 0),
        receivers: payload.receivers.map((receiver) => normalizeReceiver(receiver, true)).filter(Boolean)
      };
    } catch { return { updatedAt: 0, receivers: [] }; }
  }

  function mergeReceivers(primary, secondary) {
    const byId = new Map();
    for (const receiver of [...(primary || []), ...(secondary || [])]) {
      const normalized = normalizeReceiver(receiver, receiver?.liveEvidence);
      if (normalized && !byId.has(normalized.id)) byId.set(normalized.id, normalized);
    }
    return [...byId.values()];
  }

  function saveLivePool(receivers) {
    livePool = { updatedAt: Date.now(), receivers: mergeReceivers(receivers, []) };
    try { window.localStorage?.setItem(LIVE_POOL_KEY, JSON.stringify(livePool)); } catch {}
  }

  function currentPool() {
    const fresh = livePool.receivers.length >= 4 && Date.now() - livePool.updatedAt < LIVE_POOL_MAX_AGE_MS;
    if (!fresh) return SEED.map((receiver) => normalizeReceiver(receiver, false));
    return mergeReceivers(livePool.receivers, SEED);
  }

  function milesBetween(lat1, lon1, lat2, lon2) {
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
    const r = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * r / 2) ** 2
      + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
    return 2 * 3958.8 * Math.asin(Math.sqrt(a));
  }

  function solarSimilarity(userLon, receiverLon, frequencyKHz) {
    if (!Number.isFinite(userLon) || !Number.isFinite(receiverLon)) return 50;
    const hour = (lon) => (new Date().getUTCHours() + new Date().getUTCMinutes() / 60 + lon / 15 + 24) % 24;
    const userNight = hour(userLon) >= 19 || hour(userLon) < 6;
    const receiverNight = hour(receiverLon) >= 19 || hour(receiverLon) < 6;
    let score = userNight === receiverNight ? 92 : 48;
    const mhz = frequencyKHz / 1000;
    if (mhz < 8 && userNight && receiverNight) score += 8;
    if (mhz > 16 && !userNight && !receiverNight) score += 6;
    return clamp(score, 0, 100);
  }

  function proximityScore(distance) {
    if (!Number.isFinite(distance)) return 28;
    if (distance <= 50) return 100;
    if (distance <= 150) return 96 - (distance - 50) * 0.08;
    if (distance <= 400) return 88 - (distance - 150) * 0.12;
    if (distance <= 900) return 58 - (distance - 400) * 0.07;
    return Math.max(4, 23 - (distance - 900) * 0.012);
  }

  const hamViewActive = () => document.getElementById('signalGrid')?.dataset.hamView === 'true';
  const hamBucket = (distance) => distance <= 400 ? 0 : distance <= 900 ? 1 : distance <= 1800 ? 2 : distance <= 3000 ? 3 : 4;

  function scorePool(pool, context) {
    const { frequency, userLat, userLon, txLat, txLon } = context;
    const hasUser = Number.isFinite(userLat) && Number.isFinite(userLon);
    const hasTx = Number.isFinite(txLat) && Number.isFinite(txLon);
    const direct = hasUser && hasTx ? milesBetween(userLat, userLon, txLat, txLon) : null;
    const health = loadHealth(), now = Date.now(), local = frequency < 2000;

    let eligible = pool.filter((r) => frequency >= r.minKHz && frequency <= r.maxKHz).map((receiver) => {
      const userDistance = hasUser ? milesBetween(userLat, userLon, receiver.lat, receiver.lon) : null;
      const txDistance = hasTx ? milesBetween(txLat, txLon, receiver.lat, receiver.lon) : null;
      const proximity = proximityScore(userDistance);
      let pathSimilarity = 50;
      if (Number.isFinite(direct) && Number.isFinite(userDistance) && Number.isFinite(txDistance)) {
        pathSimilarity = clamp(100 - Math.abs(txDistance - direct) / Math.max(12, direct * 0.012), 0, 100);
        const detour = Math.max(0, userDistance + txDistance - direct);
        pathSimilarity = clamp(pathSimilarity - detour / Math.max(20, direct * 0.025), 0, 100);
      }
      const solar = solarSimilarity(userLon, receiver.lon, frequency);
      let score = local ? (hasUser ? proximity * 0.92 + 8 : 45)
        : hasUser && hasTx ? proximity * 0.50 + pathSimilarity * 0.38 + solar * 0.12
        : hasUser ? proximity * 0.82 + solar * 0.18
        : hasTx && Number.isFinite(txDistance) ? clamp(100 - txDistance / 30, 5, 95) : 50;
      if (receiver.liveEvidence) score += 4;
      const entry = health[receiver.id] || {};
      const cooling = Number(entry.cooldownUntil || 0) > now;
      const recentSuccess = Number(entry.lastSuccess || 0) > now - RECENT_SUCCESS_MS;
      return { ...receiver, userDistance, txDistance, pathSimilarity, solar, score, cooling, recentSuccess, failures: Number(entry.failures || 0) };
    });

    if (hamViewActive()) {
      eligible.sort((a, b) => {
        const ad = a.userDistance ?? Infinity, bd = b.userDistance ?? Infinity;
        return hamBucket(ad) - hamBucket(bd)
          || (ad + (a.cooling ? 450 + a.failures * 120 : 0) - (a.recentSuccess ? 90 : 0))
             - (bd + (b.cooling ? 450 + b.failures * 120 : 0) - (b.recentSuccess ? 90 : 0))
          || b.score - a.score;
      });
    } else {
      const healthy = eligible.filter((receiver) => !receiver.cooling);
      if (healthy.length) eligible = healthy;
      eligible.sort((a, b) => b.score - a.score || Number(b.recentSuccess) - Number(a.recentSuccess) || (a.userDistance ?? Infinity) - (b.userDistance ?? Infinity));
    }
    return eligible;
  }

  function rankReceivers(context) {
    const eligible = scorePool(currentPool(), context);
    if (!eligible.length) return [];
    const local = context.frequency < 2000;
    const hasUser = Number.isFinite(context.userLat) && Number.isFinite(context.userLon);
    const hasTx = Number.isFinite(context.txLat) && Number.isFinite(context.txLon);
    const picks = [], picked = new Set();
    const add = (receiver, role, reason) => {
      if (!receiver || picked.has(receiver.id) || picks.length >= 7) return;
      picked.add(receiver.id); picks.push({ ...receiver, role, reason });
    };
    const best = eligible[0];
    if (hamViewActive()) add(best, 'NEAR YOU', Number.isFinite(best.userDistance) ? `Best nearby observation point for amateur activity · ${Math.round(best.userDistance)} mi from you.` : 'Best nearby observation point for amateur activity.');
    else if (local) add(best, 'NEAR YOU', Number.isFinite(best.userDistance) ? `Closest useful currently available receiver · ${Math.round(best.userDistance)} mi from you.` : 'Closest useful currently available receiver.');
    else add(best, Number.isFinite(best.userDistance) && best.userDistance <= 250 ? 'NEAR YOU' : 'BEST MATCH', best.recentSuccess ? 'Best RF match among currently available receivers; this SDR also connected successfully recently.' : 'Best currently available balance of your location, transmitter path, frequency, and day/night conditions.');
    if (hasUser) add([...eligible].sort((a,b)=>(a.userDistance??Infinity)-(b.userDistance??Infinity))[0], 'NEAR YOU', 'Useful comparison point because its RF environment is geographically closest to yours.');
    if (!local && hasTx && !hamViewActive()) add([...eligible].sort((a,b)=>(a.txDistance??Infinity)-(b.txDistance??Infinity))[0], 'STATION CHECK', 'Closer to the transmitter; useful for checking whether the broadcast appears active.');
    if (!local && hasUser && hasTx && !hamViewActive()) add([...eligible].filter((r)=>r.id!==best.id).sort((a,b)=>(b.pathSimilarity*.72+b.solar*.28)-(a.pathSimilarity*.72+a.solar*.28))[0], 'PROPAGATION ALT', 'Alternate receiver with a similar transmitter path and useful HF propagation geometry.');
    for (const receiver of eligible) add(receiver, 'ALTERNATE', 'Another currently available public KiwiSDR covering this frequency.');
    return picks.map((r, i) => ({ id:r.id, name:r.name, location:r.location, lat:r.lat, lon:r.lon, minKHz:r.minKHz, maxKHz:r.maxKHz, coverageKnown:true, version:r.version||'', distanceMiles:Number.isFinite(r.userDistance)?Math.round(r.userDistance):null, transmitterDistanceMiles:Number.isFinite(r.txDistance)?Math.round(r.txDistance):null, role:r.role, reason:r.reason, recommended:i===0, connectionHealth:r.recentSuccess?'recent-success':(r.cooling?'cooldown':'unknown'), liveEvidence:r.liveEvidence }));
  }

  function requestUrl(input) {
    try {
      if (typeof input === 'string') return new URL(input, window.location.href);
      if (input instanceof URL) return new URL(input.toString(), window.location.href);
      if (input?.url) return new URL(input.url, window.location.href);
    } catch {}
    return null;
  }

  function contextFromUrl(url) {
    const stored = loadStoredLocation();
    const frequency = finite(url.searchParams.get('frequency'));
    let txLat = finite(url.searchParams.get('txLat')), txLon = finite(url.searchParams.get('txLon'));
    if ((!Number.isFinite(txLat)||!Number.isFinite(txLon)) && activeContext && Math.abs(activeContext.frequency-frequency)<0.11) { txLat=activeContext.txLat; txLon=activeContext.txLon; }
    return { frequency, userLat:finite(url.searchParams.get('lat'))??stored?.lat??null, userLon:finite(url.searchParams.get('lon'))??stored?.lon??null, txLat, txLon };
  }

  window.fetch = (input, init) => {
    const url = requestUrl(input);
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!url || method !== 'GET' || url.origin !== window.location.origin || url.pathname !== '/api/sdr/receivers') return upstreamFetch(input, init);
    if (init?.signal?.aborted) return Promise.reject(new DOMException('The user aborted a request.', 'AbortError'));
    const context = contextFromUrl(url);
    const receivers = Number.isFinite(context.frequency) ? rankReceivers(context) : [];
    return Promise.resolve(new Response(JSON.stringify({ receivers, source:livePool.receivers.length>=4?'receiver-runtime-live-cache':'receiver-runtime-seed', generatedAt:new Date().toISOString() }), { status:receivers.length?200:503, headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, max-age=0, no-store','x-freqbeacon-sdr-directory':VERSION} }));
  };

  function frequencyFromCard(card) {
    const el=card?.querySelector('.frequency'); if(!el)return null;
    const unit=el.querySelector('span')?.textContent?.trim().toLowerCase()||'';
    const clone=el.cloneNode(true); clone.querySelector('span')?.remove();
    const value=Number(clone.textContent.replace(/,/g,'').trim());
    return Number.isFinite(value)&&value>0 ? (unit.includes('mhz')?value*1000:value) : null;
  }

  function stationCoordinates(frequency, stationName) {
    const stations=window.SIGNAL_SCOUT_STATIONS||[], normalized=String(stationName||'').trim().toLowerCase();
    const matches=stations.filter((s)=>Math.abs(Number(s.frequency)-frequency)<0.11);
    const station=matches.find((s)=>String(s.name||'').trim().toLowerCase()===normalized)||matches[0];
    const lat=finite(station?.lat), lon=finite(station?.lon);
    return Number.isFinite(lat)&&Number.isFinite(lon)&&!(lat===0&&lon===0)?{lat,lon}:null;
  }

  function buildLiveUrl(context) {
    const url=new URL('/api/sdr/receivers/live',window.location.origin); url.searchParams.set('frequency',Number(context.frequency).toFixed(1));
    if(Number.isFinite(context.userLat)&&Number.isFinite(context.userLon)){url.searchParams.set('lat',context.userLat.toFixed(5));url.searchParams.set('lon',context.userLon.toFixed(5));}
    if(Number.isFinite(context.txLat)&&Number.isFinite(context.txLon)){url.searchParams.set('txLat',context.txLat.toFixed(5));url.searchParams.set('txLon',context.txLon.toFixed(5));}
    return url;
  }

  function refreshLive(context, force=false) {
    if(!Number.isFinite(context?.frequency))return Promise.resolve(false);
    const now=Date.now(); if(!force&&now-lastLiveRefreshAttempt<LIVE_REFRESH_MIN_MS)return liveRefreshPromise||Promise.resolve(false); if(liveRefreshPromise)return liveRefreshPromise;
    lastLiveRefreshAttempt=now; const controller=new AbortController(); const timer=window.setTimeout(()=>controller.abort(),LIVE_REFRESH_TIMEOUT_MS);
    liveRefreshPromise=upstreamFetch(buildLiveUrl(context),{headers:{Accept:'application/json'},signal:controller.signal}).then(async(response)=>{
      if(!response.ok)return false; const payload=await response.json();
      if(payload?.source!=='receiverbook'||!Array.isArray(payload.receivers)||payload.receivers.length<4)return false;
      saveLivePool(mergeReceivers(payload.receivers.map((r)=>normalizeReceiver(r,true)).filter(Boolean),livePool.receivers)); return true;
    }).catch(()=>false).finally(()=>{window.clearTimeout(timer);liveRefreshPromise=null;});
    return liveRefreshPromise;
  }

  function normalizeLookupButton() {
    const button=document.getElementById('lookupReceiverButton'); if(!button)return;
    if(!button.querySelector('.lookup-receiver-smart-main')){
      const meta=button.querySelector('span')?.textContent?.trim()||'FreqBeacon ranks public SDRs for this frequency'; const badge=button.querySelector('b')?.textContent?.trim()||'SMART';
      button.innerHTML=`<div class="lookup-receiver-smart-main"><strong>Automatic receiver selection</strong><span>${meta}</span></div><b>${badge}</b>`;
    }
    if(!document.getElementById('freqbeacon-receiver-runtime-v3-styles')){const style=document.createElement('style');style.id='freqbeacon-receiver-runtime-v3-styles';style.textContent='.lookup-receiver-smart-main{min-width:0}.lookup-receiver-smart-main strong,.lookup-receiver-smart-main span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}';document.head.appendChild(style);}
  }

  function openCardReceiverOptions(card) {
    const frequency=frequencyFromCard(card); if(!Number.isFinite(frequency))return;
    const stationName=card.querySelector('.station-name')?.textContent?.trim()||''; const tx=stationCoordinates(frequency,stationName); const stored=loadStoredLocation();
    activeContext={frequency,userLat:stored?.lat??null,userLon:stored?.lon??null,txLat:tx?.lat??null,txLon:tx?.lon??null};
    const input=document.getElementById('lookupFrequency'); if(input){input.value=Number.isInteger(frequency)?String(frequency):frequency.toFixed(1);input.dispatchEvent(new Event('input',{bubbles:false}));}
    const openPlayer=document.querySelector('#sdrPlayer:not([hidden])'); if(openPlayer)openPlayer.querySelector('[data-sdr-close]')?.click();
    normalizeLookupButton(); document.getElementById('lookupReceiverButton')?.click(); refreshLive(activeContext).catch(()=>{});
  }

  window.addEventListener('click',(event)=>{const button=event.target.closest('.card-receiver-options');if(!button)return;const card=button.closest('.signal-card');if(!card)return;event.preventDefault();event.stopImmediatePropagation();openCardReceiverOptions(card);},true);

  normalizeLookupButton();
  const stored=loadStoredLocation();
  window.setTimeout(()=>refreshLive({frequency:5990,userLat:stored?.lat??null,userLon:stored?.lon??null,txLat:null,txLon:null}).catch(()=>{}),0);
  window.__freqbeaconReceiverRuntime={version:VERSION,get livePoolCount(){return livePool.receivers.length;},get livePoolUpdatedAt(){return livePool.updatedAt;}};
})();
