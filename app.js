/* Talisman — Paris beta */
(() => {
  'use strict';

  // ---------- storage (safe) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('talisman:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('talisman:' + k, JSON.stringify(v)); } catch {} }
  };

  const state = {
    data: null, places: [], byId: new Map(),
    cat: 'All', tab: 'all', selected: null,
    me: null, watchId: null, followMe: false,
    saved: new Set(store.get('saved', [])),
    visited: new Set(store.get('visited', [])),
    notes: store.get('notes', {}),
    markers: new Map(), meMarker: null
  };

  const $ = s => document.querySelector(s);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const wide = () => window.matchMedia('(min-width:900px)').matches;

  function toast(msg, ms = 2200) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------- geo ----------
  function haversine(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtDist(m) {
    if (m < 1000) return Math.round(m / 10) * 10 + ' m · ' + Math.max(1, Math.round(m / 80)) + ' min';
    if (m < 5000) return (m / 1000).toFixed(1) + ' km · ' + Math.round(m / 80) + ' min';
    if (m < 100000) return (m / 1000).toFixed(m < 20000 ? 1 : 0) + ' km';
    return Math.round(m / 1000).toLocaleString() + ' km';
  }

  // ---------- map ----------
  const TILE_STYLE = 'light_all';
  const TILE_URL = `https://{s}.basemaps.cartocdn.com/${TILE_STYLE}/{z}/{x}/{y}{r}.png`;
  const map = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 10, maxZoom: 19, tap: false })
    .setView([48.8566, 2.34], 13);
  L.tileLayer(TILE_URL, {
    subdomains: 'abcd', maxZoom: 20, detectRetina: false, crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(map);
  map.attributionControl.setPrefix(false);

  // single-stroke category glyphs inside the seal
  const GLYPH = {
    Architecture: '<path d="M2 11V6.5a4 4 0 0 1 8 0V11M1 11h10" />',
    Art: '<circle cx="6" cy="6" r="3.2" />',
    Garden: '<path d="M6 11V5M6 5c0-2.5 2-4 4-4 0 2.5-2 4-4 4zM6 7C6 5 4.5 4 2.5 4c0 2 1.5 3 3.5 3z" />',
    Books: '<path d="M2 2.5h3.5a1 1 0 0 1 1 1V10M10 2.5H6.5M2 2.5V9.5h4.5M10 2.5V9.5H6.5" />',
    Café: '<path d="M2 4.5h6.5v3a3 3 0 0 1-3 3h-.5a3 3 0 0 1-3-3zM8.5 5.5h1a1.3 1.3 0 0 1 0 2.6h-1" />',
    Food: '<path d="M3.5 1v10M2 1v3a1.5 1.5 0 0 0 3 0V1M8.5 11V1c1.5 1 2 3 2 5h-2" />',
    Shop: '<path d="M2 4h8l-.7 7H2.7zM4 4a2 2 0 0 1 4 0" />',
    Bar: '<path d="M1.5 1.5h9L6 6.5zM6 6.5V10.5M3.5 10.5h5" />',
    Hotel: '<path d="M1.5 10.5V3M1.5 7.5h9v3M4.5 7.5V5.5h6v2" />'
  };
  const glyph = c => `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${GLYPH[c] || '<circle cx="6" cy="6" r="1.4" fill="currentColor" />'}</svg>`;
  const SEAL = '<svg class="sealmark" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>';

  function pinIcon(p) {
    const cls = ['seal'];
    if (state.visited.has(p.id)) cls.push('visited');
    else if (state.saved.has(p.id)) cls.push('saved');
    if (state.selected === p.id) cls.push('active');
    return L.divIcon({ className: '', html: `<div class="${cls.join(' ')}">${glyph(p.category)}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
  }
  function refreshMarkers() {
    const visible = new Set(filtered().map(p => p.id));
    for (const p of state.places) {
      let m = state.markers.get(p.id);
      if (!m) {
        m = L.marker([p.lat, p.lng], { icon: pinIcon(p), title: p.name, keyboard: true, riseOnHover: true });
        m.on('click', () => openPlace(p.id));
        state.markers.set(p.id, m);
      }
      m.setIcon(pinIcon(p));
      m.setZIndexOffset(state.selected === p.id ? 1000 : 0);
      const show = visible.has(p.id) || state.selected === p.id;
      if (show && !map.hasLayer(m)) m.addTo(map);
      if (!show && map.hasLayer(m)) map.removeLayer(m);
    }
  }

  // Centre a point in the part of the map the sheet doesn't cover
  function focusOn(latlng, zoom) {
    zoom = zoom ?? Math.max(map.getZoom(), 15);
    const pt = map.project(latlng, zoom);
    let off;
    if (wide()) off = L.point(-210, 0);
    else {
      const top = $('#sheet').getBoundingClientRect().top;
      const covered = Math.max(0, window.innerHeight - top);
      off = L.point(0, covered / 2 - 20);
    }
    map.flyTo(map.unproject(pt.add(off), zoom), zoom, { duration: 0.6 });
  }
  function fitAll() {
    const list = filtered();
    if (!list.length) return;
    const b = L.latLngBounds(list.map(p => [p.lat, p.lng]));
    const sheetH = wide() ? 0 : Math.max(0, window.innerHeight - $('#sheet').getBoundingClientRect().top);
    map.flyToBounds(b, {
      paddingTopLeft: [wide() ? 440 : 30, 80],
      paddingBottomRight: [30, sheetH + 30], maxZoom: 15, duration: 0.6
    });
  }

  // ---------- sheet ----------
  const sheet = $('#sheet');
  function setSheet(s) {
    if (wide()) s = 'full';
    sheet.dataset.state = s;
    document.body.classList.toggle('sheet-half', s === 'half');
    document.body.classList.toggle('sheet-full', s === 'full');
  }
  (function dragSheet() {
    const handle = $('#handle');
    let y0 = 0, t0 = 0, base = 0, dragging = false, moved = false;
    const order = ['peek', 'half', 'full'];
    const posOf = () => sheet.getBoundingClientRect().top;
    handle.addEventListener('pointerdown', e => {
      dragging = true; moved = false; y0 = e.clientY; t0 = performance.now(); base = posOf();
      sheet.classList.add('dragging'); handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dy = e.clientY - y0; if (Math.abs(dy) > 4) moved = true;
      const top = Math.max(window.innerHeight * 0.08, base + dy);
      sheet.style.transform = `translateY(${top - (window.innerHeight - sheet.offsetHeight)}px)`;
    });
    const end = e => {
      if (!dragging) return; dragging = false;
      sheet.classList.remove('dragging'); sheet.style.transform = '';
      const i = order.indexOf(sheet.dataset.state);
      if (!moved) { setSheet(order[(i + 1) % 3]); return; }
      const dy = e.clientY - y0, v = dy / Math.max(1, performance.now() - t0);
      if (v < -0.4 || dy < -80) setSheet(order[Math.min(2, i + 1)]);
      else if (v > 0.4 || dy > 80) setSheet(order[Math.max(0, i - 1)]);
      else setSheet(order[i]);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  })();
  // scrolling the list up from the peek state opens the sheet
  $('#listView').addEventListener('touchmove', () => { if (sheet.dataset.state === 'peek') setSheet('half'); }, { passive: true });

  // ---------- list ----------
  function filtered() {
    let list = state.places;
    if (state.tab === 'saved') list = list.filter(p => state.saved.has(p.id));
    if (state.cat !== 'All') list = list.filter(p => p.category === state.cat);
    if (state.me) list = [...list].sort((a, b) => a._d - b._d);
    return list;
  }
  function renderChips() {
    const cats = ['All', ...new Set(state.places.map(p => p.category))];
    const c = $('#chips'); c.innerHTML = '';
    for (const cat of cats) {
      const b = el('button', 'chip' + (cat === state.cat ? ' active' : ''), esc(cat));
      b.setAttribute('aria-pressed', cat === state.cat);
      b.onclick = () => { state.cat = cat; renderAll(); fitAll(); };
      c.appendChild(b);
    }
  }
  function renderList() {
    const list = filtered(), ul = $('#list');
    ul.innerHTML = '';
    $('#savedCount').textContent = state.saved.size ? `(${state.saved.size})` : '';
    if (!list.length) {
      ul.appendChild(el('li', 'empty', state.tab === 'saved'
        ? 'Nothing saved yet. Open a place and tap Save to keep it here.'
        : 'No places in this category.'));
    }
    for (const p of list) {
      const li = el('li', 'item' + (state.visited.has(p.id) ? ' visited' : ''));
      li.tabIndex = 0;
      li.innerHTML = `<span class="n">${String(p._n).padStart(2, '0')}</span>
        <div><h3>${esc(p.name)}</h3>
        <div class="meta">${esc(p.category)} · ${esc(p.arrondissement)}${state.visited.has(p.id) ? ' · visited' : state.saved.has(p.id) ? ' · <span class="saved-tag">saved</span>' : ''}</div></div>
        <span class="dist">${state.me ? fmtDist(p._d) : ''}</span>`;
      li.onclick = () => openPlace(p.id);
      li.onkeydown = e => { if (e.key === 'Enter') openPlace(p.id); };
      ul.appendChild(li);
    }
    const s = $('#status');
    if (state.me) {
      const far = haversine(state.me, state.data.center) > 30000;
      s.textContent = far ? `You're ${fmtDist(haversine(state.me, state.data.center))} from ${state.data.city}. Distances are from where you are.` : 'Nearest first';
    } else s.textContent = `${list.length} places`;
  }
  function renderAll() { renderChips(); renderList(); refreshMarkers(); }

  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    state.tab = t.dataset.tab;
    document.querySelectorAll('.tab').forEach(x => { x.classList.toggle('active', x === t); x.setAttribute('aria-selected', x === t); });
    renderAll(); fitAll();
  });

  // ---------- detail ----------
  function directionsUrl(p) {
    return isIOS
      ? `https://maps.apple.com/?daddr=${p.lat},${p.lng}&q=${encodeURIComponent(p.name)}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking`;
  }
  function openPlace(id, { fromHash = false } = {}) {
    const p = state.byId.get(id); if (!p) return;
    state.selected = id;
    if (!fromHash && location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    $('#listView').classList.add('hidden'); $('#detailView').classList.remove('hidden');
    const d = $('#detail');
    d.innerHTML = `${SEAL}
      <div class="kicker">${String(p._n).padStart(2, '0')} · ${esc(p.category)} · ${esc(p.arrondissement)}</div>
      <h2>${esc(p.name)}</h2>
      <p class="addr">${esc(p.address || '')}${state.me ? ' · ' + fmtDist(p._d) : ''}</p>
      <p class="note">${esc(p.note || '')}</p>
      ${p.draft ? '<p class="draft">Placeholder copy, to be replaced with Talisman text</p>' : ''}
      <div class="actions">
        <a class="act primary" href="${directionsUrl(p)}" target="_blank" rel="noopener">Walk there</a>
        <button class="act${state.saved.has(id) ? ' on' : ''}" id="saveBtn">${state.saved.has(id) ? 'Saved' : 'Save'}</button>
        <button class="act${state.visited.has(id) ? ' on' : ''}" id="visitBtn">${state.visited.has(id) ? 'Visited' : 'Been here'}</button>
      </div>
      <div class="notes">
        <label for="noteInput">Beta note</label>
        <textarea id="noteInput" placeholder="What worked, what didn't, what's missing…">${esc(state.notes[id] || '')}</textarea>
        <div class="saved-hint" id="noteHint"></div>
      </div>`;
    $('#saveBtn').onclick = () => toggle('saved', id);
    $('#visitBtn').onclick = () => toggle('visited', id);
    let t;
    $('#noteInput').oninput = e => {
      clearTimeout(t);
      t = setTimeout(() => {
        const v = e.target.value.trim();
        if (v) state.notes[id] = v; else delete state.notes[id];
        store.set('notes', state.notes); $('#noteHint').textContent = 'Saved on this phone';
      }, 400);
    };
    $('#detailView').scrollTop = 0;
    if (sheet.dataset.state === 'peek') setSheet('half');
    refreshMarkers();
    requestAnimationFrame(() => focusOn([p.lat, p.lng]));
  }
  function closePlace() {
    state.selected = null;
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    $('#detailView').classList.add('hidden'); $('#listView').classList.remove('hidden');
    renderAll();
  }
  function toggle(kind, id) {
    const set = state[kind];
    set.has(id) ? set.delete(id) : set.add(id);
    store.set(kind, [...set]);
    if (kind === 'visited' && set.has(id)) toast('Marked as visited');
    if (kind === 'saved' && set.has(id)) toast('Saved');
    openPlace(id, { fromHash: true });
    renderList();
  }
  $('#backBtn').onclick = closePlace;
  $('#homeBtn').onclick = () => { closePlace(); state.cat = 'All'; renderAll(); setSheet('peek'); setTimeout(fitAll, 300); };
  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && state.byId.has(id)) openPlace(id, { fromHash: true }); else if (!id && state.selected) closePlace();
  });

  // ---------- location ----------
  function updateDistances() {
    for (const p of state.places) p._d = state.me ? haversine(state.me, [p.lat, p.lng]) : null;
  }
  function onPos(pos) {
    const first = !state.me;
    state.me = [pos.coords.latitude, pos.coords.longitude];
    updateDistances();
    if (!state.meMarker) state.meMarker = L.marker(state.me, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, zIndexOffset: 2000 }).addTo(map);
    else state.meMarker.setLatLng(state.me);
    $('#locateBtn').classList.add('on');
    if (!state.data) return;
    if (state.selected) {
      const addr = document.querySelector('#detail .addr'); const p = state.byId.get(state.selected);
      if (addr && p) addr.textContent = `${p.address || ''} · ${fmtDist(p._d)}`;
    } else renderList();
    if (first && state.followMe) {
      const far = haversine(state.me, state.data.center) > 30000;
      if (far) toast(`You're outside ${state.data.city}, so the map stays on the city`, 3200);
      else focusOn(state.me, 15);
    }
  }
  function onPosErr(err) {
    $('#locateBtn').classList.remove('on');
    const msg = err.code === 1
      ? (isIOS ? 'Location is off for this app. Settings › Privacy › Location Services › Safari Websites' : 'Location permission was denied')
      : 'Couldn’t get your location';
    toast(msg, 4200);
  }
  function startLocation(follow) {
    state.followMe = follow;
    if (!('geolocation' in navigator)) { toast('Location isn’t available on this device'); return; }
    if (state.watchId != null) { if (state.me && follow) focusOn(state.me, 15); return; }
    state.watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
  }
  $('#locateBtn').onclick = () => startLocation(true);
  // resume location silently if already permitted
  if (navigator.permissions?.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(r => { if (r.state === 'granted') startLocation(false); }).catch(() => {});
  }

  // ---------- menu ----------
  const menu = $('#menu');
  $('#menuBtn').onclick = () => menu.classList.remove('hidden');
  $('#closeMenu').onclick = () => menu.classList.add('hidden');
  menu.addEventListener('click', e => { if (e.target === menu) menu.classList.add('hidden'); });
  $('#installBtn').onclick = () => {
    if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; return; }
    $('#installHelp').classList.toggle('hidden');
  };
  $('#notesBtn').onclick = async () => {
    const lines = [`Talisman beta notes — ${new Date().toLocaleString()}`, ''];
    for (const p of state.places) {
      const tags = [state.saved.has(p.id) && 'saved', state.visited.has(p.id) && 'visited'].filter(Boolean);
      if (!state.notes[p.id] && !tags.length) continue;
      lines.push(`${String(p._n).padStart(2, '0')} ${p.name}${tags.length ? ' [' + tags.join(', ') + ']' : ''}`);
      if (state.notes[p.id]) lines.push('   ' + state.notes[p.id].replace(/\n/g, '\n   '));
    }
    if (lines.length === 2) { $('#notesStatus').textContent = 'No notes yet. Open a place and write in “Beta note”.'; return; }
    const text = lines.join('\n');
    try { await navigator.clipboard.writeText(text); $('#notesStatus').textContent = 'Copied. Paste it into a message or into Claude.'; }
    catch {
      const ta = el('textarea'); ta.value = text; ta.style.cssText = 'width:100%;height:160px;margin:6px 0 10px;font-size:13px';
      $('#notesStatus').replaceChildren('Copy this:', ta); ta.select();
    }
  };

  // Offline tile pre-cache for central Paris (zoom 12–15)
  function tileList() {
    const r = window.devicePixelRatio > 1 ? '@2x' : '';
    const bb = { s: 48.815, n: 48.905, w: 2.225, e: 2.42 };
    const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
    const lat2y = (lat, z) => { const rad = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * 2 ** z); };
    const urls = [];
    for (let z = 12; z <= 15; z++) {
      for (let x = lon2x(bb.w, z); x <= lon2x(bb.e, z); x++)
        for (let y = lat2y(bb.n, z); y <= lat2y(bb.s, z); y++)
          urls.push(`https://${'abcd'[(x + y) % 4]}.basemaps.cartocdn.com/${TILE_STYLE}/${z}/${x}/${y}${r}.png`);
    }
    return urls;
  }
  $('#offlineBtn').onclick = async () => {
    const out = $('#offlineStatus');
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) { out.textContent = 'Offline saving needs the installed app. Reload once, then try again.'; return; }
    const urls = tileList();
    out.textContent = `Saving ${urls.length} map tiles…`;
    navigator.serviceWorker.controller.postMessage({ type: 'precache-tiles', urls });
  };
  navigator.serviceWorker?.addEventListener('message', e => {
    const m = e.data || {};
    if (m.type === 'precache-progress') $('#offlineStatus').textContent = `Saving map… ${m.done}/${m.total}`;
    if (m.type === 'precache-done') $('#offlineStatus').textContent = `Central Paris saved for offline use (${m.ok} tiles${m.failed ? `, ${m.failed} failed` : ''}).`;
  });

  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });

  // ---------- opening ----------
  const opening = $('#opening');
  function enter(near) {
    opening.classList.add('gone');
    setTimeout(() => opening.classList.add('hidden'), 400);
    store.set('entered', Date.now());
    map.invalidateSize();
    if (near) startLocation(true); else fitAll();
  }
  $('#nearBtn').onclick = () => enter(true);
  $('#cityCard').onclick = () => enter(false);

  // ---------- boot ----------
  async function loadData() {
    const res = await fetch('data/places.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('data ' + res.status);
    return res.json();
  }
  loadData().then(data => {
    state.data = data;
    if (data.city) $('#cityLabel').textContent = data.city;
    state.places = (data.places || []).filter(p => isFinite(p.lat) && isFinite(p.lng)).map((p, i) => ({ ...p, _n: i + 1, _d: null }));
    state.places.forEach(p => state.byId.set(p.id, p));
    updateDistances();
    $('#openCity').textContent = data.city || 'Paris';
    $('#openCount').textContent = `${state.places.length} places curated`;
    if (location.hash.length > 1) { opening.classList.add('hidden'); }
    $('#dataNote').textContent = `Dataset: ${data.version || 'unversioned'} · ${state.places.length} places`;
    setSheet('peek');
    renderAll();
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && state.byId.has(id)) openPlace(id, { fromHash: true }); else fitAll();
    if (isIOS && !standalone && !store.get('installHinted', false)) {
      store.set('installHinted', true);
      setTimeout(() => toast('Install: tap Share, then “Add to Home Screen”', 4500), 1500);
    }
  }).catch(err => {
    console.error(err);
    $('#status').textContent = 'Couldn’t load places. Check your connection and reopen.';
  });

  window.addEventListener('resize', () => { if (wide()) setSheet('full'); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e)));
  }
})();
