import baseWorker from './worker-program-v19.js';

const EXPLORE_HTML_ROUTES = new Set(['/', '/index.html', '/explore', '/explore/']);
const HOME_ROUTES = new Set(['/', '/index.html']);
const EXPLORE_SCRIPT_PATH = '/explore-page.js';
const RECOMMENDATION_PATH = '/api/explore/recommendation';

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      ...headers
    }
  });
}

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function milesBetween(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const radiusMiles = 3958.8;
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusMiles * Math.asin(Math.sqrt(a));
}

function receiverFromFeature(feature) {
  const properties = feature?.properties || {};
  const coordinates = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!properties.id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    id: String(properties.id),
    name: String(properties.name || properties.location || 'Trusted KiwiSDR'),
    location: String(properties.location || properties.country || 'Location not published'),
    country: String(properties.country || ''),
    receiverType: String(properties.receiverType || 'KiwiSDR'),
    antenna: String(properties.antenna || ''),
    status: 'Healthy',
    trusted: true,
    lat,
    lon
  };
}

async function trustedReceiverFeed(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/explore/receivers';
  url.search = '';
  return baseWorker.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/geo+json,application/json' }
  }), env, ctx);
}

async function trustedHealthEvidence(env) {
  if (!env?.RECEIVER_HEALTH_DB) return new Map();
  try {
    const result = await env.RECEIVER_HEALTH_DB.prepare(`
      SELECT id,last_success_at AS lastSuccessAt,health_score AS healthScore,observations
      FROM receivers
      WHERE trusted=1
    `).all();
    return new Map((result?.results || []).map((row) => [String(row.id), row]));
  } catch (error) {
    console.warn('FREQBEACON recommendation health evidence read failed', error?.message || error);
    return new Map();
  }
}

async function receiverRecord(env, receiverId) {
  if (!env?.RECEIVER_HEALTH_DB || !receiverId) return null;
  try {
    const row = await env.RECEIVER_HEALTH_DB.prepare(`
      SELECT id,name,location,country,lat,lon,receiver_type AS receiverType,antenna
      FROM receivers
      WHERE id=?
      LIMIT 1
    `).bind(receiverId).first();
    if (!row) return null;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    return {
      id: String(row.id),
      name: String(row.name || row.location || row.id),
      location: String(row.location || row.country || 'Location not published'),
      country: String(row.country || ''),
      receiverType: String(row.receiverType || 'KiwiSDR'),
      antenna: String(row.antenna || ''),
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null
    };
  } catch (error) {
    console.warn('FREQBEACON previous receiver record read failed', error?.message || error);
    return null;
  }
}

function confidenceScore(evidence) {
  if (!evidence) return 45;
  const health = Math.max(0, Math.min(100, Number(evidence.healthScore) || 0));
  const observations = Math.max(0, Number(evidence.observations) || 0);
  const observationBonus = Math.min(14, Math.log2(observations + 1) * 2.6);
  const successAt = Number(evidence.lastSuccessAt) || 0;
  const ageHours = successAt > 0 ? Math.max(0, (Date.now() - successAt) / 3600000) : 168;
  const recencyBonus = Math.max(0, 10 - ageHours / 12);
  return health * 0.76 + observationBonus + recencyBonus;
}

function chooseRecommendation(receivers, evidenceById, anchor, excludedId = '') {
  let best = null;
  let bestScore = -Infinity;

  for (const receiver of receivers) {
    if (!receiver || receiver.id === excludedId) continue;
    const evidence = evidenceById.get(receiver.id);
    const confidence = confidenceScore(evidence);
    const distanceMiles = anchor
      ? milesBetween(anchor.lat, anchor.lon, receiver.lat, receiver.lon)
      : null;

    // Geography dominates when we have a meaningful anchor. Health evidence is
    // still required indirectly because candidates come only from the strict
    // trusted feed, and it breaks ties among geographically useful receivers.
    const geographic = Number.isFinite(distanceMiles)
      ? 100 / (1 + distanceMiles / 450)
      : 0;
    const score = Number.isFinite(distanceMiles)
      ? geographic * 0.68 + confidence * 0.32
      : confidence;

    if (
      score > bestScore
      || (score === bestScore && String(receiver.id).localeCompare(String(best?.id || '')) < 0)
    ) {
      best = { ...receiver, distanceMiles: Number.isFinite(distanceMiles) ? Math.round(distanceMiles) : null };
      bestScore = score;
    }
  }
  return best;
}

async function recommendationResponse(request, env, ctx) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405);

  const url = new URL(request.url);
  const previousId = String(url.searchParams.get('previousId') || '').slice(0, 180);
  const userLat = finiteCoordinate(url.searchParams.get('lat'), -90, 90);
  const userLon = finiteCoordinate(url.searchParams.get('lon'), -180, 180);
  const userAnchor = Number.isFinite(userLat) && Number.isFinite(userLon)
    ? { lat: userLat, lon: userLon }
    : null;

  const feedResponse = await trustedReceiverFeed(request, env, ctx);
  if (!feedResponse?.ok) {
    return json({ error: 'Trusted receiver network is unavailable', state: 'unavailable', current: null, previous: null, recommended: null }, 503);
  }

  let feed;
  try {
    feed = await feedResponse.json();
  } catch {
    return json({ error: 'Trusted receiver network returned invalid data', state: 'unavailable', current: null, previous: null, recommended: null }, 503);
  }

  const receivers = (feed?.features || []).map(receiverFromFeature).filter(Boolean);
  const current = previousId ? receivers.find((receiver) => receiver.id === previousId) || null : null;
  const previous = previousId && !current ? await receiverRecord(env, previousId) : null;
  const evidenceById = await trustedHealthEvidence(env);

  let state = 'start';
  let anchor = userAnchor;
  let basis = userAnchor ? 'near-listening-location' : 'strongest-current-trust-evidence';
  let recommended = null;

  if (current) {
    state = 'ready';
    basis = 'previous-receiver-still-trusted';
  } else if (previousId) {
    state = 'unavailable';
    if (Number.isFinite(previous?.lat) && Number.isFinite(previous?.lon)) {
      anchor = { lat: previous.lat, lon: previous.lon };
      basis = 'near-previous-receiver';
    } else if (userAnchor) {
      basis = 'near-listening-location';
    }
    recommended = chooseRecommendation(receivers, evidenceById, anchor, previousId);
  } else {
    recommended = chooseRecommendation(receivers, evidenceById, anchor);
  }

  const payload = {
    state,
    current,
    previous,
    recommended,
    basis,
    trustedReceiverCount: receivers.length,
    generatedAt: new Date().toISOString(),
    policy: 'recommend only from the current strict trusted Explore feed; never weaken receiver trust'
  };

  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'cache-control': 'no-store, max-age=0' } });
  return json(payload);
}

function launchpadMarkup() {
  return `
      <section class="receiver-launchpad" id="receiverLaunchpad" aria-labelledby="receiverLaunchTitle">
        <div class="launchpad-heading">
          <div>
            <p class="launchpad-kicker">RECEIVER LAUNCHPAD</p>
            <h2 id="receiverLaunchTitle">START LISTENING</h2>
          </div>
          <span class="launchpad-network"><i aria-hidden="true"></i><b id="launchNetworkState">CHECKING NETWORK</b></span>
        </div>
        <p class="launchpad-status" id="receiverLaunchStatus">Finding your best way into the airwaves…</p>

        <div class="launchpad-previous" id="launchPrevious" hidden>
          <span>LAST RECEIVER</span>
          <strong id="launchPreviousName">Previous receiver</strong>
          <small id="launchPreviousLocation"></small>
        </div>

        <div class="launchpad-choice" id="launchChoice">
          <div class="launchpad-choice-copy">
            <span id="launchChoiceLabel">TRUSTED NETWORK</span>
            <strong id="launchReceiverName">Checking trusted receivers…</strong>
            <small id="launchReceiverLocation">Verified SND + paired W/F only</small>
          </div>
          <div class="launchpad-health" id="launchReceiverHealth" hidden><i aria-hidden="true"></i><span>HEALTHY</span></div>
        </div>

        <div class="launchpad-actions">
          <button class="launchpad-primary" id="launchPrimary" type="button" disabled>CHECKING RECEIVERS</button>
          <button class="launchpad-secondary" id="launchChange" type="button" hidden>CHANGE RECEIVER</button>
        </div>
        <p class="launchpad-helper" id="launchHelper">No SDR session starts until you choose to listen.</p>
      </section>`;
}

function decorateExploreHtml(html) {
  let output = html;
  if (!output.includes('/explore-launchpad.css')) {
    output = output.replace(
      '<link rel="stylesheet" href="/freqbeacon-app-nav.css?v=3">',
      '<link rel="stylesheet" href="/freqbeacon-app-nav.css?v=3">\n  <link rel="stylesheet" href="/explore-launchpad.css?v=1">'
    );
  }
  if (!output.includes('id="receiverLaunchpad"')) {
    output = output.replace('</header>', `</header>${launchpadMarkup()}`);
  }
  if (!output.includes('/explore-launchpad.js')) {
    output = output.replace(
      /(<script src="\/explore-page\.js\?v=\d+" defer><\/script>)/,
      '$1\n  <script src="/explore-launchpad.js?v=1" defer></script>'
    );
  }
  output = output.replace('<title>Explore — FREQBEACON Zero</title>', '<title>FREQBEACON — Explore the airwaves.</title>');
  return output;
}

async function exploreAssetResponse(request, env) {
  if (!env?.ASSETS) return null;
  const url = new URL(request.url);
  url.pathname = '/explore.html';
  url.search = '';
  return env.ASSETS.fetch(new Request(url.toString(), {
    method: request.method,
    headers: request.headers
  }));
}

async function decorateExploreResponse(response, isHome) {
  if (!response) return response;
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-explore-launchpad', 'v1');
  if (isHome) headers.set('x-freqbeacon-home', 'explore-v1');
  if (!response.ok || !String(response.headers.get('content-type') || '').includes('text/html')) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  if (!response.body || response.status === 204) return new Response(null, { status: response.status, headers });
  const html = decorateExploreHtml(await response.text());
  headers.delete('content-length');
  headers.delete('etag');
  headers.set('content-type', 'text/html; charset=utf-8');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

async function patchExploreScriptResponse(response) {
  if (!response?.ok || !/javascript|text\/plain/.test(String(response.headers.get('content-type') || ''))) return response;
  let source = await response.text();
  source = source.replace(
    '      state.selected = chooseInitialReceiver(state.receivers);',
    `      const persistedReceiverId = selectedCookieId();
      state.selected = persistedReceiverId
        ? state.receivers.find((receiver) => receiver.id === persistedReceiverId) || null
        : null;`
  );
  source = source.replace('Max-Age=2592000', 'Max-Age=31536000');

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('etag');
  headers.set('content-type', 'application/javascript; charset=utf-8');
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  headers.set('x-freqbeacon-explore-selection', 'persisted-only-v1');
  return new Response(source, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === RECOMMENDATION_PATH) {
      return recommendationResponse(request, env, ctx);
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && HOME_ROUTES.has(url.pathname)) {
      const response = await exploreAssetResponse(request, env);
      return decorateExploreResponse(response, true);
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && (url.pathname === '/explore' || url.pathname === '/explore/')) {
      return decorateExploreResponse(await baseWorker.fetch(request, env, ctx), false);
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === EXPLORE_SCRIPT_PATH) {
      return patchExploreScriptResponse(await baseWorker.fetch(request, env, ctx));
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
    return undefined;
  }
};
