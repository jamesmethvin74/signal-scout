(() => {
  'use strict';

  const base = window.FREQBEACON_LOOKUP_CATEGORIES;
  const engine = window.FREQBEACON_IDENTIFICATION_ENGINE;
  const stage = document.getElementById('lookupResults');
  const count = document.getElementById('lookupResultCount');
  const status = document.getElementById('lookupStatus');
  const title = document.getElementById('lookupResultsTitle');
  if (!base || !engine || !stage || !count) return;

  const BROADCAST = new Set(['news', 'sports', 'religious', 'propaganda', 'international']);
  const NEWS = /\bbbc\b|bbc world service|british broadcasting corporation|voice of america|\bvoa\b|usagm|united states agency for global media|radio free asia|radio free europe|radio liberty|radio exterior de españa|radio romania international|deutsche welle|radio france internationale|nhk world|kbs world|china radio international|rnz pacific|world service|\bnews\b|current affairs/i;
  const INTERNATIONAL = /\bbbc\b|bbc world service|british broadcasting corporation|voice of america|\bvoa\b|usagm|radio free asia|radio free europe|radio liberty|radio exterior de españa|radio romania international|deutsche welle|radio france internationale|nhk world|kbs world|china radio international|rnz pacific|voice of turkey|international|world service/i;
  const STATE = /china radio international|voice of korea|radio pyongyang|radio havana|voice of america|\bvoa\b|radio romania international|radio exterior de españa|\bbbc\b|rnz pacific|radio france internationale|deutsche welle|voice of turkey|kbs world|nhk world|usagm|radio free/i;
  const RELIGIOUS = /relig|gospel|bible|catholic|christian|adventist|ministry|ministries|evangel|vatican|overcomer/i;
  const MAJOR = /\bbbc\b|voice of america|\bvoa\b|usagm|kbs world|china radio international|radio exterior de españa|radio romania international|deutsche welle|radio france internationale|nhk world|rnz pacific|voice of turkey/i;

  const REGION_PATTERNS = [
    ['europe', /united kingdom|\buk\b|great britain|britain|england|scotland|wales|woofferton|skelton|germany|france|spain|portugal|romania|bulgaria|netherlands|holland|italy|vatican|austria|czech|slovak|poland|hungary|sweden|norway|finland|denmark|greece|serbia|croatia|slovenia|switzerland|belgium|albania|turkey|emirler/i],
    ['north-america', /united states|\busa\b|canada|mexico|cuba|greenville|okeechobee|monticello|nashville/i],
    ['south-america', /brazil|argentina|chile|peru|ecuador|colombia|venezuela|bolivia|paraguay|uruguay|guyana/i],
    ['africa', /ascension|bamako|mali|madagascar|botswana|south africa|eswatini|swaziland|lesotho|rwanda|sao tome|uganda|tanzania|kenya|ethiopia|eritrea|morocco|algeria|tunisia|egypt|senegal|ghana|nigeria|zambia|zimbabwe/i],
    ['asia', /kuwait|philippines|singapore|taiwan|japan|korea|china|india|iran|oman|united arab emirates|\buae\b|thailand|uzbekistan|tajikistan|sri lanka|indonesia|malaysia|pakistan|bangladesh|myanmar|vietnam|saudi|qatar|bahrain/i],
    ['oceania', /australia|new zealand|\bnz\b|guam|papua new guinea|fiji|samoa/i]
  ];

  const TARGET_PATTERNS = [
    ['europe', /\b(eur|europe|weu|eeu|ceu|gbr|britain|united kingdom|uk)\b/i],
    ['north-america', /\b(nam|north america|usa|united states|canada|can|mexico|mex)\b/i],
    ['south-america', /\b(sam|south america|latin america|latam|brazil|bra|argentina|arg)\b/i],
    ['africa', /\b(afr|africa|naf|waf|eaf|saf)\b/i],
    ['asia', /\b(asia|east asia|south asia|southeast asia|eas|sas|sea|korea|japan|china|india|pakistan|iran)\b/i],
    ['oceania', /\b(oceania|oce|australia|aus|pacific|pac|new zealand|nzl)\b/i]
  ];

  let fullLoad = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[ch]));
  const normalized = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const text = (entry) => [entry?.name, entry?.format, entry?.description, entry?.country, entry?.language, entry?.target, entry?.transmitter, entry?.origin].filter(Boolean).join(' ').toLowerCase();
  const frequency = (entry) => Number(entry?.frequencyKHz ?? entry?.frequency);

  function receiverRegion(receiver) {
    const lat = Number(receiver?.lat);
    const lon = Number(receiver?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
    if (lat >= 34 && lat <= 72 && lon >= -25 && lon <= 45) return 'europe';
    if (lat >= 15 && lat <= 75 && lon >= -170 && lon <= -50) return 'north-america';
    if (lat >= -58 && lat < 15 && lon >= -85 && lon <= -30) return 'south-america';
    if (lat >= -38 && lat <= 38 && lon >= -20 && lon <= 55) return 'africa';
    if (lat >= 5 && lat <= 80 && lon > 45 && lon <= 180) return 'asia';
    if (lat >= -50 && lat < 10 && lon >= 105 && lon <= 180) return 'oceania';
    return '';
  }

  function textRegion(value) {
    const raw = String(value || '');
    return REGION_PATTERNS.find(([, re]) => re.test(raw))?.[0] || '';
  }

  function targetRegion(value) {
    const raw = String(value || '');
    return TARGET_PATTERNS.find(([, re]) => re.test(raw))?.[0] || '';
  }

  function exactMiles(entry, receiver) {
    if (entry?.locationApproximate === true) return Infinity;
    const coords = [Number(entry?.lat), Number(entry?.lon), Number(receiver?.lat), Number(receiver?.lon)];
    if (!coords.every(Number.isFinite)) return Infinity;
    try {
      return engine.milesBetween?.(
        { lat: coords[2], lon: coords[3] },
        { lat: coords[0], lon: coords[1] }
      ) ?? Infinity;
    } catch {
      return Infinity;
    }
  }

  function exactPathScore(entry, distance, receiver, now) {
    if (!Number.isFinite(distance)) return { score: 0, tier: 'unknown' };
    const kHz = frequency(entry);
    const hour = (now.getUTCHours() + now.getUTCMinutes() / 60 + Number(receiver.lon) / 15 + 24) % 24;
    const night = hour < 6 || hour >= 18;
    let soft = 1800;
    let hard = 3000;
    if (kHz < 5000) [soft, hard] = night ? [1800, 3000] : [900, 1900];
    else if (kHz < 8000) [soft, hard] = night ? [2400, 3600] : [1500, 2700];
    else if (kHz < 12000) [soft, hard] = night ? [2800, 4200] : [2200, 3600];
    else if (kHz < 18000) [soft, hard] = night ? [1800, 3000] : [2500, 4000];
    else if (kHz < 22000) [soft, hard] = night ? [1400, 2500] : [2200, 3600];
    else [soft, hard] = night ? [900, 1800] : [1800, 3000];

    if (distance <= 500) return { score: 460, tier: 'regional' };
    if (distance <= 1000) return { score: 390, tier: 'regional' };
    if (distance <= soft) return { score: 250, tier: 'good' };
    if (distance <= hard) return { score: 70, tier: 'dx' };
    return { score: -480, tier: 'long' };
  }

  function matches(entry, key) {
    const haystack = text(entry);
    if (key === 'news') return NEWS.test(haystack);
    if (key === 'sports') return /\bsports?\b/i.test(haystack);
    if (key === 'religious') return RELIGIOUS.test(haystack);
    if (key === 'propaganda') return STATE.test(haystack);
    if (key === 'international') return INTERNATIONAL.test(haystack);
    return false;
  }

  function friendlyName(name) {
    const value = String(name || 'Shortwave broadcaster').trim();
    if (/^bbc$/i.test(value) || /^british broadcasting corporation$/i.test(value)) return 'BBC World Service';
    return value;
  }

  function candidate(entry, receiver, key, now) {
    const schedule = engine.scheduleState?.(entry, now) || null;
    if (schedule?.active === false) return null;

    const area = receiverRegion(receiver);
    const distance = exactMiles(entry, receiver);
    const exact = Number.isFinite(distance);
    const path = exactPathScore(entry, distance, receiver, now);
    const txRegion = textRegion([entry.transmitter, entry.country, entry.origin].filter(Boolean).join(' '));
    const aimed = targetRegion(entry.target);
    const relayHint = /relay|woofferton|skelton/i.test(String(entry.transmitter || ''));
    const haystack = text(entry);

    let score = 120 + (schedule?.active === true ? 520 : 100);
    if (exact) {
      score += path.score;
      if (aimed && aimed === area) score += 220;
      else if (aimed && area && aimed !== area) score += distance <= 700 ? -50 : -260;
    } else {
      if (txRegion && txRegion === area) score += 390;
      else if (txRegion && area && txRegion !== area) score -= 90;
      else score -= 40;

      if (relayHint && txRegion === area) score += 120;
      if (aimed && aimed === area) score += 280;
      else if (aimed && area && aimed !== area) score -= 260;
    }

    if (MAJOR.test(haystack)) score += 80;
    if (key === 'news' && NEWS.test(haystack)) score += 70;

    let label = 'POSSIBLE';
    if (exact) {
      if (path.tier === 'regional') label = 'BEST BET';
      else if (path.tier === 'good') label = 'GOOD PATH';
      else if (path.tier === 'dx') label = 'DX TRY';
    } else if (txRegion === area && (aimed === area || !aimed)) {
      label = relayHint ? 'REGIONAL RELAY' : 'BEST BET';
    } else if (txRegion === area) {
      label = 'RELAY TRY';
    } else if (aimed === area) {
      label = 'TARGETED HERE';
    } else if (score >= 700) {
      label = 'GOOD PATH';
    } else if (score >= 480) {
      label = 'DX TRY';
    }

    return { entry, schedule, distance, exact, path, txRegion, aimed, area, score, label };
  }

  async function ensureFullData() {
    if (Array.isArray(window.SIGNAL_SCOUT_FULL_SW) && window.SIGNAL_SCOUT_FULL_SW.length) {
      if (window.SIGNAL_SCOUT_DATA_READY?.then) await window.SIGNAL_SCOUT_DATA_READY;
      return window.SIGNAL_SCOUT_FULL_SW;
    }
    if (!fullLoad) {
      fullLoad = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/full-data.js?v=2';
        script.async = true;
        script.onload = async () => {
          try {
            if (window.SIGNAL_SCOUT_DATA_READY?.then) await window.SIGNAL_SCOUT_DATA_READY;
            resolve(window.SIGNAL_SCOUT_FULL_SW || []);
          } catch (error) {
            reject(error);
          }
        };
        script.onerror = () => reject(new Error('full schedule loader failed'));
        document.head.appendChild(script);
      }).finally(() => { fullLoad = null; });
    }
    return fullLoad;
  }

  function tuneHref(entry) {
    const raw = String(entry.mode || 'AM').toLowerCase();
    const mode = raw.includes('usb') ? 'usb' : raw.includes('lsb') ? 'lsb' : 'am';
    return `/zero?frequency=${encodeURIComponent(frequency(entry).toFixed(3))}&mode=${mode}&from=lookup-category`;
  }

  function card(item) {
    const entry = item.entry;
    const displayName = friendlyName(entry.name);
    const detail = [
      item.schedule?.active === true ? 'Scheduled now' : '',
      entry.language,
      entry.mode,
      entry.transmitter || entry.country,
      item.exact ? `${Math.round(item.distance).toLocaleString()} mi from receiver` : ''
    ].filter(Boolean).join(' · ');

    return `<article class="lookup-category-result">
      <div class="lookup-category-copy">
        <div class="lookup-category-result-top">
          <strong>${esc(displayName)}</strong>
          <span class="lookup-status-pill is-now"><i aria-hidden="true"></i>${esc(item.label)}</span>
        </div>
        <span class="lookup-category-frequency">${esc(engine.formatFrequency(frequency(entry)))}</span>
        <small>${esc(detail)}</small>
      </div>
      <a class="lookup-tune" href="${esc(tuneHref(entry))}">TUNE ON RADIO</a>
    </article>`;
  }

  async function browseBroadcast(receiver, key) {
    if (title) title.textContent = `${key.toUpperCase()} ON THIS RECEIVER`;
    stage.innerHTML = '<div class="lookup-loading">RANKING CURRENT A26 TRANSMISSIONS…</div>';
    if (status) {
      status.className = 'lookup-status is-working';
      status.textContent = `Ranking scheduled ${key} transmissions for ${receiver.location || receiver.name || 'this receiver'}…`;
    }

    let entries;
    try {
      entries = await Promise.race([
        ensureFullData(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('full schedule timeout')), 10000))
      ]);
    } catch (error) {
      console.warn('FREQBEACON ranking v2 schedule load failed', error);
      return base.browse(receiver, { source: 'ranking-v2-fallback' });
    }

    const now = new Date();
    let ranked = entries
      .filter((entry) => matches(entry, key))
      .map((entry) => candidate(entry, receiver, key, now))
      .filter(Boolean)
      .filter((item) => item.score >= 260)
      .sort((a, b) => b.score - a.score || (a.exact ? a.distance : Infinity) - (b.exact ? b.distance : Infinity));

    const unique = [];
    const repeats = [];
    const seen = new Set();
    for (const item of ranked) {
      const stationKey = normalized(friendlyName(item.entry.name));
      if (seen.has(stationKey)) repeats.push(item);
      else {
        seen.add(stationKey);
        unique.push(item);
      }
    }
    ranked = [...unique, ...repeats];

    const shown = ranked.slice(0, 12);
    count.textContent = `${ranked.length.toLocaleString()} ${key} candidate${ranked.length === 1 ? '' : 's'}`;
    stage.innerHTML = shown.length
      ? shown.map(card).join('')
      : `<div class="lookup-empty"><strong>No strong ${esc(key)} candidates right now.</strong><p>The current A26 schedule does not show a receiver-relevant transmission worth recommending at this moment.</p></div>`;

    if (status) {
      status.className = 'lookup-status';
      status.textContent = `${key} · current A26 schedule · exact-site distance when known · relay/target-region evidence otherwise · not live signal proof`;
    }
    return true;
  }

  async function browse(receiver, context = {}) {
    const key = base.selected?.() || window.FREQBEACON_LOOKUP_SELECTED_CATEGORY || '';
    if (!receiver || !BROADCAST.has(key)) return base.browse(receiver, context);
    return browseBroadcast(receiver, key);
  }

  window.FREQBEACON_LOOKUP_CATEGORIES = Object.freeze({ ...base, browse });
})();
