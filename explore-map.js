import * as maplibregl from 'https://unpkg.com/maplibre-gl@6.9.0/dist/maplibre-gl.mjs';

const mapEl = document.getElementById('receiverMap');
const messageEl = document.getElementById('exploreMessage');
const trustedCountEl = document.getElementById('trustedCount');
const sheet = document.getElementById('receiverSheet');
const sheetName = document.getElementById('sheetName');
const sheetLocation = document.getElementById('sheetLocation');
const sheetType = document.getElementById('sheetType');
const sheetAntenna = document.getElementById('sheetAntenna');
const sheetClose = document.getElementById('sheetClose');
const listenHere = document.getElementById('listenHere');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let selectedReceiver = null;

function showMessage(title, detail) {
  messageEl.hidden = false;
  messageEl.querySelector('strong').textContent = title;
  messageEl.querySelector('span').textContent = detail;
}

function hideMessage() {
  messageEl.hidden = true;
}

function closeSheet() {
  selectedReceiver = null;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
}

function openSheet(properties) {
  selectedReceiver = properties;
  sheetName.textContent = properties.name || 'Public KiwiSDR';
  sheetLocation.textContent = properties.location || properties.country || 'Public receiver';
  sheetType.textContent = properties.receiverType || 'KiwiSDR';
  const antenna = String(properties.antenna || '').trim();
  sheetAntenna.hidden = !antenna;
  sheetAntenna.textContent = antenna;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
}

sheetClose.addEventListener('click', closeSheet);
listenHere.addEventListener('click', () => {
  const id = String(selectedReceiver?.id || '');
  if (!id) return;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `fb_explore_receiver=${encodeURIComponent(id)}; Path=/; Max-Age=86400; SameSite=Lax${secure}`;
  location.href = `/zero?from=explore&receiver=${encodeURIComponent(id)}`;
});

const map = new maplibregl.Map({
  container: mapEl,
  style: 'https://tiles.openfreemap.org/styles/dark',
  center: [-20, 24],
  zoom: 1.25,
  minZoom: 0.7,
  maxZoom: 15,
  pitch: 0,
  bearing: 0,
  attributionControl: false,
  fadeDuration: reduceMotion ? 0 : 180,
  cooperativeGestures: false
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
map.on('style.load', () => {
  try { map.setProjection({ type: 'globe' }); } catch {}
});

async function loadReceivers() {
  const response = await fetch('/api/explore/receivers', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Trusted receiver API returned ${response.status}`);
  const collection = await response.json();
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('Trusted receiver API returned invalid data');
  }
  return collection;
}

function installReceiverLayers(collection) {
  trustedCountEl.textContent = `${collection.features.length.toLocaleString()} trusted receiver${collection.features.length === 1 ? '' : 's'} online`;

  if (!collection.features.length) {
    showMessage(
      'TRUSTED NETWORK IS BUILDING',
      'New receivers stay hidden until repeated background tests prove both live audio and real RF waterfall data.'
    );
  } else {
    hideMessage();
  }

  map.addSource('trusted-receivers', {
    type: 'geojson',
    data: collection,
    cluster: true,
    clusterMaxZoom: 10,
    clusterRadius: 52
  });

  map.addLayer({
    id: 'receiver-clusters',
    type: 'circle',
    source: 'trusted-receivers',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#d2a65f',
      'circle-radius': ['step', ['get', 'point_count'], 19, 10, 23, 30, 27, 80, 31],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#352918',
      'circle-opacity': 0.96
    }
  });

  map.addLayer({
    id: 'receiver-cluster-count',
    type: 'symbol',
    source: 'trusted-receivers',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 12,
      'text-allow-overlap': true
    },
    paint: { 'text-color': '#17130d' }
  });

  map.addLayer({
    id: 'trusted-receiver-points',
    type: 'circle',
    source: 'trusted-receivers',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#6fd39a',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 8, 7, 13, 9],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#14231a',
      'circle-opacity': 0.98
    }
  });

  map.on('click', 'receiver-clusters', async (event) => {
    closeSheet();
    const feature = map.queryRenderedFeatures(event.point, { layers: ['receiver-clusters'] })[0];
    if (!feature) return;
    const source = map.getSource('trusted-receivers');
    try {
      const zoom = await source.getClusterExpansionZoom(feature.properties.cluster_id);
      map.easeTo({
        center: feature.geometry.coordinates,
        zoom: Math.min(zoom, 12),
        duration: reduceMotion ? 0 : 420
      });
    } catch {}
  });

  map.on('click', 'trusted-receiver-points', (event) => {
    const feature = event.features?.[0];
    if (feature) openSheet(feature.properties || {});
  });

  for (const layer of ['receiver-clusters', 'trusted-receiver-points']) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  }

  map.on('click', (event) => {
    const hits = map.queryRenderedFeatures(event.point, {
      layers: ['receiver-clusters', 'trusted-receiver-points']
    });
    if (!hits.length) closeSheet();
  });
}

Promise.all([
  new Promise((resolve) => map.on('load', resolve)),
  loadReceivers()
]).then(([, collection]) => {
  installReceiverLayers(collection);
}).catch((error) => {
  trustedCountEl.textContent = 'Trusted receiver network unavailable';
  showMessage('EXPLORE UNAVAILABLE', error?.message || 'Could not load the trusted receiver network.');
});
