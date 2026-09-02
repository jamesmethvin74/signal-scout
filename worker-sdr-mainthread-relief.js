import baseWorker from './worker-sdr-ranking-evidence-fix.js';

const MARKER = 'sdr-mainthread-relief-v1';
const AUDIO_ONLY_MARKER = 'sdr-audio-only-ab-v1';

function textResponse(response, source, contentType, headerName, headerValue) {
  const headers = new Headers(response.headers);
  headers.set('content-type', contentType);
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set(headerName, headerValue);
  return new Response(source, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function patchApp(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;
  const source = await response.text();
  let patched = source;

  patched = patched.replace(
    '  let locationRequestInFlight = false;',
    '  let locationRequestInFlight = false;\n  let renderGeneration = 0;\n  const scheduleFormatterCache = new Map();'
  );

  patched = patched.replace(
`      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      const zoneFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'short'
      });`,
`      let formatters = scheduleFormatterCache.get(timeZone);
      if (!formatters) {
        formatters = {
          timeFormatter: new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          }),
          zoneFormatter: new Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'short'
          })
        };
        scheduleFormatterCache.set(timeZone, formatters);
      }
      const { timeFormatter, zoneFormatter } = formatters;`
  );

  patched = patched.replace(
    "    const language = $('#languageFilter').value;",
    "    const language = $('#languageFilter').value;\n    const generation = ++renderGeneration;"
  );

  patched = patched.replace(
`    $('#signalGrid').innerHTML = results.length
      ? results.map(({ station, scored }) => renderCard(station, scored, date)).join('')
      : '<div class="empty-state">Nothing in the starter dataset matches those filters at this time. Try another hour, language, or band.</div>';`,
`    const grid = $('#signalGrid');
    if (!results.length) {
      grid.innerHTML = '<div class="empty-state">Nothing in the starter dataset matches those filters at this time. Try another hour, language, or band.</div>';
      return;
    }

    // Render only a small first batch synchronously, then yield between batches.
    // This keeps WebSocket OPEN/MSG/SND and timer callbacks responsive on mobile
    // even when 1,000+ matching schedule rows are on the air.
    grid.innerHTML = '';
    const batchSize = window.innerWidth <= 700 ? 20 : 60;
    let cursor = 0;

    const appendBatch = () => {
      if (generation !== renderGeneration) return;
      const end = Math.min(results.length, cursor + batchSize);
      const html = results.slice(cursor, end)
        .map(({ station, scored }) => renderCard(station, scored, date))
        .join('');
      grid.insertAdjacentHTML('beforeend', html);
      cursor = end;
      if (cursor < results.length) window.setTimeout(appendBatch, 0);
    };

    appendBatch();`
  );

  const applied = patched !== source
    && patched.includes('let renderGeneration = 0')
    && patched.includes('scheduleFormatterCache')
    && patched.includes('const batchSize = window.innerWidth <= 700 ? 20 : 60')
    && patched.includes('window.setTimeout(appendBatch, 0)');

  return textResponse(
    response,
    patched,
    'application/javascript; charset=utf-8',
    'x-freqbeacon-mainthread-relief',
    applied ? MARKER : 'app-patch-miss'
  );
}

async function patchBandLabels(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;
  const source = await response.text();
  let patched = source;

  patched = patched.replace(
    '    if (count) count.textContent = `${visible} signal${visible === 1 ? \'\' : \'s\'}`;',
    '    if (count && selectedMeterBand !== \'all\') count.textContent = `${visible} signal${visible === 1 ? \'\' : \'s\'}`;'
  );

  patched = patched.replace(
`  const observer = new MutationObserver(decorateCards);
  observer.observe(grid, { childList: true, subtree: true });
  decorateCards();`,
`  const observer = new MutationObserver((mutations) => {
    const cards = new Set();
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches('.signal-card')) cards.add(node);
        node.querySelectorAll?.('.signal-card').forEach((card) => cards.add(card));
      });
    });
    if (!cards.size) return;
    cards.forEach(decorateCard);
    applyBandFilter();
  });
  // Watch only cards added to the grid. Do not observe our own subtree decoration.
  observer.observe(grid, { childList: true });
  decorateCards();`
  );

  const applied = patched !== source
    && patched.includes('Watch only cards added to the grid')
    && !patched.includes('observer.observe(grid, { childList: true, subtree: true })');

  return textResponse(
    response,
    patched,
    'application/javascript; charset=utf-8',
    'x-freqbeacon-mainthread-relief',
    applied ? MARKER : 'band-labels-patch-miss'
  );
}

async function patchCardCollapse(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;
  const source = await response.text();
  let patched = source;

  patched = patched.replace(
`  new MutationObserver(() => window.requestAnimationFrame(decorateCards)).observe(grid, { childList: true, subtree: true });
  decorateCards();`,
`  new MutationObserver((mutations) => {
    const cards = new Set();
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches('.signal-card')) cards.add(node);
        node.querySelectorAll?.('.signal-card').forEach((card) => cards.add(card));
      });
    });
    if (!cards.size) return;
    window.requestAnimationFrame(() => cards.forEach(decorateCard));
  }).observe(grid, { childList: true });
  decorateCards();`
  );

  const applied = patched !== source
    && patched.includes("window.requestAnimationFrame(() => cards.forEach(decorateCard))")
    && !patched.includes('{ childList: true, subtree: true }');

  return textResponse(
    response,
    patched,
    'application/javascript; charset=utf-8',
    'x-freqbeacon-mainthread-relief',
    applied ? MARKER : 'card-collapse-patch-miss'
  );
}

async function patchRoot(response, { audioOnly = false } = {}) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  const source = await response.text();
  let html = source;

  html = html.replace('<script src="app.js"></script>', '<script src="app.js?v=2"></script>');
  html = html.replace(/band-labels\.js\?v=\d+/g, 'band-labels.js?v=3');
  html = html.replace(/card-collapse\.js\?v=\d+/g, 'card-collapse.js?v=2');

  if (audioOnly) {
    // Diagnostic A/B only: suppress the RF/W/F client while preserving the exact
    // normal receiver ranking, SND player, health, reliability and proxy path.
    html = html.replace(/\s*<script[^>]+src=["'](?:\.\/)?sdr-rf-v2\.js(?:\?[^"']*)?["'][^>]*><\/script>\s*/gi, '\n');
  }

  html = html.replace(
`      function decorate() {
        document.querySelectorAll('.signal-card').forEach((card) => {`,
`      function decorate(root = document) {
        const cards = root.matches?.('.signal-card') ? [root] : root.querySelectorAll('.signal-card');
        cards.forEach((card) => {`
  );

  html = html.replace(
`      new MutationObserver(decorate).observe(grid, { childList: true, subtree: true });
      decorate();`,
`      new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) decorate(node);
          });
        });
      }).observe(grid, { childList: true });
      decorate(grid);`
  );

  const applied = html !== source
    && html.includes('app.js?v=2')
    && html.includes('band-labels.js?v=3')
    && html.includes('card-collapse.js?v=2')
    && html.includes('decorate(root = document)')
    && html.includes("}).observe(grid, { childList: true });");

  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-mainthread-relief', applied ? MARKER : 'root-patch-miss');
  if (audioOnly) headers.set('x-freqbeacon-sdr-audio-only', AUDIO_ONLY_MARKER);
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);

    if (request.method === 'GET' && url.pathname === '/app.js') return patchApp(response);
    if (request.method === 'GET' && url.pathname === '/band-labels.js') return patchBandLabels(response);
    if (request.method === 'GET' && url.pathname === '/card-collapse.js') return patchCardCollapse(response);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return patchRoot(response, { audioOnly: url.searchParams.get('sdraudio') === '1' });
    }
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
  }
};
