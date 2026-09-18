(() => {
  'use strict';

  const RECEIVER_FEED = '/api/explore/receivers';
  const STATUS_FEED = '/api/explore/status';
  const WORLD_FEED = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
  const ADMIN1_FEED = '/explore-admin1-boundaries.geojson?v=1';
  const RESUME_DELAY_MS = 4200;
  const AUTO_DEGREES_PER_MS = 0.0022;
  const MAX_DPR = 2;
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 25;
  const BUTTON_ZOOM_FACTOR = 1.5;
  const DOUBLE_TAP_ZOOM_FACTOR = 1.7;
  const DOUBLE_TAP_MS = 340;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const els = {
    shell: document.getElementById('globeShell'),
    canvas: document.getElementById('receiverGlobe'),
    loading: document.getElementById('globeLoading'),
    affordance: document.getElementById('globeAffordance'),
    zoomIn: document.getElementById('globeZoomIn'),
    zoomOut: document.getElementById('globeZoomOut'),
    receiverCount: document.getElementById('receiverCount'),
    networkState: document.getElementById('networkState'),
    networkProof: document.getElementById('networkProof'),
    filteredCount: document.getElementById('filteredCount'),
    selectedName: document.getElementById('selectedName'),
    selectedLocation: document.getElementById('selectedLocation'),
    selectedType: document.getElementById('selectedType'),
    selectedAntenna: document.getElementById('selectedAntenna'),
    receiverMeta: document.getElementById('receiverMeta'),
    listenButton: document.getElementById('listenButton'),
    filters: document.getElementById('regionFilters'),
    list: document.getElementById('receiverList')
  };

  if (!els.canvas || !els.shell) return;

  const ctx = els.canvas.getContext('2d', { alpha: true, desynchronized: true });
  const state = {
    projection: null,
    path: null,
    graticule: null,
    land: null,
    borders: null,
    admin1: null,
    receivers: [],
    filteredReceivers: [],
    selected: null,
    region: 'all',
    rotation: [95, -32, 0],
    width: 0,
    height: 0,
    dpr: 1,
    baseRadius: 0,
    zoom: 1,
    zoomTween: null,
    hitPoints: [],
    pointers: new Map(),
    dragging: false,
    pinching: false,
    gestureHadPinch: false,
    dragStart: null,
    rotateStart: null,
    pinchStartDistance: 0,
    pinchStartZoom: 1,
    lastTapAt: 0,
    lastTapPoint: null,
    lastFrameAt: performance.now(),
    lastInteractionAt: 0,
    focusTween: null,
    ready: false,
    status: null
  };

  function normalizeLon(lon) {
    let value = Number(lon) || 0;
    while (value > 180) value -= 360;
    while (value < -180) value += 360;
    return value;
  }

  function clampZoom(value) {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value) || MIN_ZOOM));
  }

  function setZoom(value) {
    state.zoom = clampZoom(value);
    state.zoomTween = null;
    updateZoomControls();
  }

  function animateZoomTo(value, duration = 190) {
    const target = clampZoom(value);
    if (Math.abs(target - state.zoom) < 0.001) return;
    state.zoomTween = {
      start: performance.now(),
      duration: reducedMotion.matches ? 1 : duration,
      from: state.zoom,
      target
    };
    state.lastInteractionAt = performance.now();
    els.affordance?.classList.add('is-hidden');
  }

  function updateZoomControls() {
    if (els.zoomOut) els.zoomOut.disabled = state.zoom <= MIN_ZOOM + 0.01;
    if (els.zoomIn) els.zoomIn.disabled = state.zoom >= MAX_ZOOM - 0.01;
    els.shell.style.setProperty('--globe-zoom', state.zoom.toFixed(2));
  }

  function regionFor(lat, lon) {
    const y = Number(lat);
    const x = normalizeLon(lon);
    if (y >= 7 && y <= 85 && x >= -170 && x <= -50) return 'north-america';
    if (y >= -60 && y < 15 && x >= -95 && x <= -30) return 'south-america';
    if (y >= 34 && y <= 72 && x >= -25 && x <= 45) return 'europe';
    if (y >= -38 && y < 38 && x >= -20 && x <= 55) return 'africa';
    if (y >= -12 && x > 45 && x <= 180) return 'asia';
    if (y >= 5 && x < -170) return 'asia';
    return 'oceania';
  }

  const REGION_LABELS = {
    'north-america': 'North America',
    'south-america': 'South America',
    europe: 'Europe',
    africa: 'Africa',
    asia: 'Asia',
    oceania: 'Oceania'
  };

  function receiverFromFeature(feature) {
    const coordinates = feature?.geometry?.coordinates;
    const properties = feature?.properties || {};
    const lon = Number(coordinates?.[0]);
    const lat = Number(coordinates?.[1]);
    if (!properties.id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      id: String(properties.id),
      name: String(properties.name || properties.location || 'KiwiSDR'),
      location: String(properties.location || properties.country || 'Location not published'),
      country: String(properties.country || ''),
      receiverType: String(properties.receiverType || 'KiwiSDR'),
      antenna: String(properties.antenna || ''),
      status: 'Healthy',
      lat,
      lon,
      coord: [lon, lat],
      region: regionFor(lat, lon)
    };
  }

  function selectedCookieId() {
    const match = document.cookie.match(/(?:^|;\s*)fb_explore_receiver=([^;]+)/);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch { return ''; }
  }

  function setSelectionCookie(receiverId) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `fb_explore_receiver=${encodeURIComponent(receiverId)}; Path=/; Max-Age=2592000; SameSite=Lax${secure}`;
  }

  function chooseInitialReceiver(receivers) {
    const prior = selectedCookieId();
    if (prior) {
      const matched = receivers.find((receiver) => receiver.id === prior);
      if (matched) return matched;
    }
    const target = [-96, 38];
    let best = null;
    let bestDistance = Infinity;
    for (const receiver of receivers) {
      const distance = window.d3.geoDistance(receiver.coord, target);
      if (distance < bestDistance) {
        best = receiver;
        bestDistance = distance;
      }
    }
    return best || receivers[0] || null;
  }

  function shortText(text, max = 30) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }

  function resizeCanvas() {
    const rect = els.shell.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
    if (state.width === width && state.height === height && state.dpr === dpr) return;

    state.width = width;
    state.height = height;
    state.dpr = dpr;
    els.canvas.width = Math.round(width * dpr);
    els.canvas.height = Math.round(height * dpr);
    els.canvas.style.width = `${width}px`;
    els.canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    state.baseRadius = Math.max(80, Math.min(width, height) * (width > 620 ? 0.425 : 0.44));
    if (state.projection) {
      state.projection
        .translate([width / 2, height / 2])
        .scale(state.baseRadius * state.zoom)
        .rotate(state.rotation);
    }
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function drawSelectedCallout(point) {
    const receiver = state.selected;
    if (!receiver || !point) return;
    if (point.x < -18 || point.x > state.width + 18 || point.y < -18 || point.y > state.height + 18) return;
    const mobile = state.width < 500;
    const line1 = shortText(receiver.name, mobile ? 24 : 34);
    const line2 = shortText(receiver.location, mobile ? 29 : 42);
    ctx.save();
    ctx.font = `800 ${mobile ? 8 : 9}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    const textWidth = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width);
    const boxWidth = Math.min(state.width - 20, Math.max(142, textWidth + 24));
    const boxHeight = 38;
    let x = point.x + 12;
    let y = point.y - 43;
    if (x + boxWidth > state.width - 8) x = point.x - boxWidth - 12;
    x = Math.max(8, Math.min(state.width - boxWidth - 8, x));
    y = Math.max(8, Math.min(state.height - boxHeight - 8, y));

    ctx.strokeStyle = 'rgba(255,200,100,.62)';
    ctx.fillStyle = 'rgba(9,12,14,.93)';
    ctx.lineWidth = 1;
    roundedRect(ctx, x, y, boxWidth, boxHeight, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffc864';
    ctx.font = `850 ${mobile ? 8 : 9}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.fillText(line1, x + 10, y + 15);
    ctx.fillStyle = '#879398';
    ctx.font = `700 ${mobile ? 7 : 8}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.fillText(line2, x + 10, y + 28);
    ctx.restore();
  }

  function drawGlobe(now) {
    if (!state.projection || !state.path || !state.land) return;
    state.projection.rotate(state.rotation).scale(state.baseRadius * state.zoom);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, state.width, state.height);

    const cx = state.width / 2;
    const cy = state.height / 2;
    const r = state.baseRadius * state.zoom;
    const ocean = ctx.createRadialGradient(cx - r * .28, cy - r * .34, r * .12, cx, cy, r);
    ocean.addColorStop(0, '#173039');
    ocean.addColorStop(.53, '#0c1b21');
    ocean.addColorStop(1, '#050b0e');

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = ocean;
    ctx.shadowColor = 'rgba(34,108,118,.25)';
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#31515b';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    state.path(state.graticule);
    ctx.strokeStyle = 'rgba(61,103,112,.24)';
    ctx.lineWidth = .55;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    state.path(state.land);
    const landGradient = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    landGradient.addColorStop(0, '#356d7b');
    landGradient.addColorStop(.55, '#244f5b');
    landGradient.addColorStop(1, '#183741');
    ctx.fillStyle = landGradient;
    ctx.fill();
    ctx.strokeStyle = 'rgba(93,148,158,.42)';
    ctx.lineWidth = .62;
    ctx.stroke();
    ctx.restore();

    if (state.admin1) {
      const detail = Math.max(0, Math.min(1, Math.log2(Math.max(1, state.zoom)) / 3));
      ctx.save();
      ctx.beginPath();
      state.path(state.admin1);
      ctx.strokeStyle = `rgba(132,176,184,${(.085 + detail * .095).toFixed(3)})`;
      ctx.lineWidth = .29 + detail * .12;
      ctx.stroke();
      ctx.restore();
    }

    if (state.borders) {
      ctx.save();
      ctx.beginPath();
      state.path(state.borders);
      ctx.strokeStyle = 'rgba(111,157,165,.22)';
      ctx.lineWidth = .45;
      ctx.stroke();
      ctx.restore();
    }

    const center = state.projection.invert([cx, cy]);
    const hitPoints = [];
    let selectedPoint = null;
    const selectedId = state.selected?.id;
    const allowed = state.region === 'all' ? null : state.region;
    const pulse = reducedMotion.matches ? 0 : (Math.sin(now / 420) + 1) * .5;

    for (const receiver of state.receivers) {
      if (allowed && receiver.region !== allowed) continue;
      if (window.d3.geoDistance(receiver.coord, center) > Math.PI / 2 - 0.012) continue;
      const projected = state.projection(receiver.coord);
      if (!projected) continue;
      const [x, y] = projected;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < -24 || x > state.width + 24 || y < -24 || y > state.height + 24) continue;
      const selected = receiver.id === selectedId;

      ctx.save();
      if (selected) {
        ctx.beginPath();
        ctx.arc(x, y, 9 + pulse * 2, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,200,100,${.32 + pulse * .18})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 5.3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffc864';
        ctx.shadowColor = 'rgba(255,200,100,.88)';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(x, y, 1.75, 0, Math.PI * 2);
        ctx.fillStyle = '#fff0c7';
        ctx.fill();
        selectedPoint = { x, y, receiver };
      } else {
        ctx.beginPath();
        ctx.arc(x, y, state.width < 500 ? 2.65 : 3.15, 0, Math.PI * 2);
        ctx.fillStyle = '#55d987';
        ctx.shadowColor = 'rgba(85,217,135,.55)';
        ctx.shadowBlur = 5;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(x, y, 1.05, 0, Math.PI * 2);
        ctx.fillStyle = '#d7ffe5';
        ctx.fill();
      }
      ctx.restore();
      hitPoints.push({ x, y, receiver });
    }

    state.hitPoints = hitPoints;
    drawSelectedCallout(selectedPoint);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2.2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(93,164,175,.16)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }

  function shortestAngleDelta(from, to) {
    return ((to - from + 540) % 360) - 180;
  }

  function startFocus(receiver) {
    if (!receiver || !state.projection) return;
    const from = [...state.rotation];
    const target = [-receiver.lon, -receiver.lat, 0];
    target[0] = from[0] + shortestAngleDelta(from[0], target[0]);
    state.focusTween = {
      start: performance.now(),
      duration: reducedMotion.matches ? 1 : 520,
      from,
      target
    };
    state.lastInteractionAt = performance.now();
  }

  function updateAnimation(now) {
    const delta = Math.min(50, Math.max(0, now - state.lastFrameAt));
    state.lastFrameAt = now;

    if (state.zoomTween) {
      const t = Math.min(1, (now - state.zoomTween.start) / state.zoomTween.duration);
      const eased = 1 - Math.pow(1 - t, 3);
      state.zoom = state.zoomTween.from + (state.zoomTween.target - state.zoomTween.from) * eased;
      if (t >= 1) {
        state.zoom = state.zoomTween.target;
        state.zoomTween = null;
      }
      updateZoomControls();
    }

    if (state.focusTween) {
      const t = Math.min(1, (now - state.focusTween.start) / state.focusTween.duration);
      const eased = 1 - Math.pow(1 - t, 3);
      state.rotation = state.focusTween.from.map((value, index) => value + (state.focusTween.target[index] - value) * eased);
      if (t >= 1) state.focusTween = null;
    } else if (
      state.ready &&
      state.zoom <= MIN_ZOOM + 0.01 &&
      state.pointers.size === 0 &&
      !state.dragging &&
      !state.pinching &&
      !reducedMotion.matches &&
      now - state.lastInteractionAt > RESUME_DELAY_MS
    ) {
      state.rotation[0] = normalizeLon(state.rotation[0] + delta * AUTO_DEGREES_PER_MS);
    }

    drawGlobe(now);
    requestAnimationFrame(updateAnimation);
  }

  function renderList() {
    const filtered = state.region === 'all'
      ? state.receivers
      : state.receivers.filter((receiver) => receiver.region === state.region);
    state.filteredReceivers = filtered;
    els.filteredCount.textContent = `${filtered.length} SHOWN`;

    const fragment = document.createDocumentFragment();
    for (const receiver of filtered) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'receiver-row';
      button.dataset.receiverId = receiver.id;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', receiver.id === state.selected?.id ? 'true' : 'false');
      button.innerHTML = `
        <i class="receiver-row-marker" aria-hidden="true"></i>
        <span class="receiver-row-copy"><b></b><span></span></span>
        <small class="receiver-row-region"></small>`;
      button.querySelector('b').textContent = receiver.name;
      button.querySelector('.receiver-row-copy span').textContent = receiver.location;
      button.querySelector('.receiver-row-region').textContent = REGION_LABELS[receiver.region] || receiver.region;
      button.addEventListener('click', () => selectReceiver(receiver, { focus: true, scroll: false }));
      fragment.append(button);
    }
    els.list.replaceChildren(fragment);
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'receiver-empty';
      empty.textContent = 'No currently trusted receivers are in this region.';
      els.list.append(empty);
    }
  }

  function updateSelectedUI() {
    const receiver = state.selected;
    if (!receiver) {
      els.selectedName.textContent = 'Choose a trusted receiver';
      els.selectedLocation.textContent = 'Drag the globe or use the listing below.';
      els.receiverMeta.hidden = true;
      els.listenButton.disabled = true;
      return;
    }
    els.selectedName.textContent = receiver.name;
    els.selectedLocation.textContent = receiver.location;
    els.selectedType.textContent = receiver.receiverType.toUpperCase();
    els.selectedAntenna.textContent = receiver.antenna || 'Not published';
    els.receiverMeta.hidden = false;
    els.listenButton.disabled = false;

    for (const row of els.list.querySelectorAll('.receiver-row')) {
      row.setAttribute('aria-selected', row.dataset.receiverId === receiver.id ? 'true' : 'false');
    }
  }

  function selectReceiver(receiver, options = {}) {
    if (!receiver) return;
    state.selected = receiver;
    updateSelectedUI();
    state.lastInteractionAt = performance.now();
    if (options.focus !== false) startFocus(receiver);
    if (options.scroll !== false) {
      const row = [...els.list.querySelectorAll('.receiver-row')].find((item) => item.dataset.receiverId === receiver.id);
      row?.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  }

  function setRegion(region) {
    state.region = region;
    for (const button of els.filters.querySelectorAll('[data-region]')) {
      const active = button.dataset.region === region;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    renderList();
    if (state.selected && region !== 'all' && state.selected.region !== region) {
      const next = state.filteredReceivers[0] || null;
      state.selected = next;
      updateSelectedUI();
      if (next) startFocus(next);
    } else {
      updateSelectedUI();
    }
    state.lastInteractionAt = performance.now();
  }

  function pickReceiverAt(clientX, clientY) {
    const rect = els.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best = null;
    let bestD2 = 15 * 15;
    for (const point of state.hitPoints) {
      const d2 = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (d2 <= bestD2) {
        best = point.receiver;
        bestD2 = d2;
      }
    }
    return best;
  }

  function pointerDistance() {
    const points = [...state.pointers.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function beginSinglePointerDrag(point) {
    state.dragging = true;
    state.pinching = false;
    state.dragStart = [point.x, point.y];
    state.rotateStart = [...state.rotation];
  }

  function beginPinch() {
    state.dragging = false;
    state.pinching = true;
    state.gestureHadPinch = true;
    state.pinchStartDistance = Math.max(1, pointerDistance());
    state.pinchStartZoom = state.zoom;
    state.zoomTween = null;
  }

  function handleTap(clientX, clientY) {
    const receiver = pickReceiverAt(clientX, clientY);
    if (receiver) {
      state.lastTapAt = 0;
      state.lastTapPoint = null;
      selectReceiver(receiver, { focus: false, scroll: true });
      return;
    }

    const now = performance.now();
    const previous = state.lastTapPoint;
    const isDoubleTap = previous &&
      now - state.lastTapAt <= DOUBLE_TAP_MS &&
      Math.hypot(clientX - previous[0], clientY - previous[1]) <= 38;

    if (isDoubleTap) {
      animateZoomTo(state.zoom * DOUBLE_TAP_ZOOM_FACTOR, 220);
      state.lastTapAt = 0;
      state.lastTapPoint = null;
    } else {
      state.lastTapAt = now;
      state.lastTapPoint = [clientX, clientY];
    }
  }

  function onPointerDown(event) {
    if (!state.ready) return;
    if (state.pointers.size === 0) state.gestureHadPinch = false;
    state.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY
    });
    state.focusTween = null;
    state.zoomTween = null;
    state.lastInteractionAt = performance.now();
    els.canvas.classList.add('is-dragging');
    els.affordance?.classList.add('is-hidden');
    try { els.canvas.setPointerCapture?.(event.pointerId); } catch {}

    if (state.pointers.size === 1) {
      beginSinglePointerDrag(state.pointers.get(event.pointerId));
    } else if (state.pointers.size === 2) {
      beginPinch();
    }
    event.preventDefault();
  }

  function onPointerMove(event) {
    const point = state.pointers.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;

    if (state.pointers.size >= 2) {
      if (!state.pinching) beginPinch();
      const distance = Math.max(1, pointerDistance());
      setZoom(state.pinchStartZoom * (distance / state.pinchStartDistance));
      state.lastInteractionAt = performance.now();
      event.preventDefault();
      return;
    }

    if (!state.dragging || !state.dragStart) return;
    const dx = event.clientX - state.dragStart[0];
    const dy = event.clientY - state.dragStart[1];
    const effectiveRadius = state.baseRadius * state.zoom;
    const degreesPerPixel = 82 / Math.max(120, effectiveRadius);
    state.rotation[0] = normalizeLon(state.rotateStart[0] + dx * degreesPerPixel);
    state.rotation[1] = Math.max(-85, Math.min(85, state.rotateStart[1] - dy * degreesPerPixel));
    state.lastInteractionAt = performance.now();
    event.preventDefault();
  }

  function finishPointer(event) {
    const point = state.pointers.get(event.pointerId);
    if (!point) return;
    const moved = Math.hypot(event.clientX - point.startX, event.clientY - point.startY);
    const wasPinch = state.gestureHadPinch;
    state.pointers.delete(event.pointerId);
    state.lastInteractionAt = performance.now();
    try { els.canvas.releasePointerCapture?.(event.pointerId); } catch {}

    if (state.pointers.size === 1) {
      const remaining = [...state.pointers.values()][0];
      remaining.startX = remaining.x;
      remaining.startY = remaining.y;
      beginSinglePointerDrag(remaining);
    } else if (state.pointers.size === 0) {
      state.dragging = false;
      state.pinching = false;
      state.dragStart = null;
      els.canvas.classList.remove('is-dragging');
      if (!wasPinch && moved < 7) handleTap(event.clientX, event.clientY);
    }
    event.preventDefault();
  }

  function onWheel(event) {
    if (!state.ready) return;
    const direction = Math.exp(-event.deltaY * 0.0014);
    setZoom(state.zoom * direction);
    state.lastInteractionAt = performance.now();
    state.focusTween = null;
    els.affordance?.classList.add('is-hidden');
    event.preventDefault();
  }

  function showLoadError(message) {
    els.loading.classList.remove('is-hidden');
    els.loading.classList.add('is-error');
    els.loading.querySelector('strong').textContent = 'RECEIVER NETWORK UNAVAILABLE';
    els.loading.querySelector('small').textContent = message;
    els.networkState.textContent = 'NETWORK ERROR';
  }

  async function loadStatus() {
    try {
      const response = await fetch(STATUS_FEED, { headers: { accept: 'application/json' } });
      if (!response.ok) return;
      const payload = await response.json();
      state.status = payload;
      if (Number.isFinite(Number(payload.trustedReceivers))) {
        els.receiverCount.textContent = String(payload.trustedReceivers);
      }
      const tested = Number(payload?.bootstrap?.screened || 0);
      const inventory = Number(payload?.inventory || 0);
      if (inventory > 0 && tested > 0) {
        els.networkProof.textContent = `${tested}/${inventory} SCREENED · TRUSTED REQUIRES 2× SND + W/F`;
      }
    } catch {
      // The trusted GeoJSON feed remains the authoritative page payload.
    }
  }

  async function initialize() {
    if (!window.d3 || !window.topojson) {
      showLoadError('The globe renderer could not load. Check your connection and try again.');
      return;
    }

    resizeCanvas();
    state.projection = window.d3.geoOrthographic()
      .precision(.45)
      .clipAngle(90)
      .translate([state.width / 2, state.height / 2])
      .scale(state.baseRadius * state.zoom)
      .rotate(state.rotation);
    state.path = window.d3.geoPath(state.projection, ctx);
    state.graticule = window.d3.geoGraticule10();
    updateZoomControls();

    try {
      const admin1Promise = fetch(ADMIN1_FEED, { cache: 'force-cache' })
        .then((response) => {
          if (!response.ok) throw new Error(`Admin-1 geography returned ${response.status}`);
          return response.json();
        })
        .then((geometry) => {
          if (geometry?.type === 'Feature' || geometry?.type === 'MultiLineString') {
            state.admin1 = geometry;
          }
        })
        .catch(() => {
          // Admin-1 detail is enhancement-only; the trusted receiver globe must still work without it.
        });

      const [receiverResponse, worldResponse] = await Promise.all([
        fetch(RECEIVER_FEED, { headers: { accept: 'application/geo+json,application/json' } }),
        fetch(WORLD_FEED, { mode: 'cors', cache: 'force-cache' })
      ]);
      if (!receiverResponse.ok) throw new Error(`Trusted receiver feed returned ${receiverResponse.status}`);
      if (!worldResponse.ok) throw new Error(`World geography returned ${worldResponse.status}`);

      const [receiverPayload, world] = await Promise.all([receiverResponse.json(), worldResponse.json()]);
      const receivers = (receiverPayload.features || []).map(receiverFromFeature).filter(Boolean);
      if (!receivers.length) throw new Error('No trusted receivers are currently available.');

      const countries = world?.objects?.countries;
      if (!countries) throw new Error('World geography did not contain country geometry.');
      state.land = window.topojson.feature(world, world.objects.land || countries);
      state.borders = window.topojson.mesh(world, countries, (a, b) => a !== b);
      void admin1Promise;
      state.receivers = receivers.sort((a, b) => (a.location || a.name).localeCompare(b.location || b.name));
      state.selected = chooseInitialReceiver(state.receivers);
      state.ready = true;
      state.lastInteractionAt = performance.now();

      els.receiverCount.textContent = String(Number(receiverPayload.count) || receivers.length);
      els.networkState.textContent = 'LIVE NETWORK';
      els.loading.classList.add('is-hidden');
      renderList();
      updateSelectedUI();
      if (state.selected) startFocus(state.selected);
      loadStatus();
    } catch (error) {
      showLoadError(error?.message || 'The trusted receiver network could not be opened.');
    }
  }

  els.filters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-region]');
    if (button) setRegion(button.dataset.region || 'all');
  });

  els.listenButton.addEventListener('click', () => {
    if (!state.selected) return;
    setSelectionCookie(state.selected.id);
    location.assign('/zero?from=explore');
  });

  els.zoomIn?.addEventListener('click', () => animateZoomTo(state.zoom * BUTTON_ZOOM_FACTOR));
  els.zoomOut?.addEventListener('click', () => animateZoomTo(state.zoom / BUTTON_ZOOM_FACTOR));

  els.canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  els.canvas.addEventListener('pointermove', onPointerMove, { passive: false });
  els.canvas.addEventListener('pointerup', finishPointer, { passive: false });
  els.canvas.addEventListener('pointercancel', finishPointer, { passive: false });
  els.canvas.addEventListener('wheel', onWheel, { passive: false });
  els.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  const resizeObserver = new ResizeObserver(() => resizeCanvas());
  resizeObserver.observe(els.shell);
  window.addEventListener('resize', resizeCanvas, { passive: true });
  reducedMotion.addEventListener?.('change', () => { state.lastInteractionAt = performance.now(); });

  requestAnimationFrame(updateAnimation);
  window.addEventListener('load', initialize, { once: true });
})();