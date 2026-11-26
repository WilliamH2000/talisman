/* Talisman — Editorial Atlas (beta) */
(() => {
  'use strict';

  // ---------- storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('talisman:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('talisman:' + k, JSON.stringify(v)); } catch {} }
  };
  // keys are "city:id"; migrate first-beta keys (Paris only)
  const migrate = arr => arr.map(k => k.includes(':') ? k : 'paris:' + k);
  const oldNotes = store.get('notes', {});
  const notes = {}; for (const [k, v] of Object.entries(oldNotes)) notes[k.includes(':') ? k : 'paris:' + k] = v;

  const state = {
    index: null, cities: new Map(), slug: store.get('city', 'paris'),
    places: [], byId: new Map(), cat: 'All', q: '', tab: 'all', selected: null,
    me: null, watchId: null, followMe: false,
    saved: new Set(migrate(store.get('saved', []))),
    visited: new Set(migrate(store.get('visited', []))),
    notes, markers: new Map(), meMarker: null
  };
  store.set('saved', [...state.saved]); store.set('visited', [...state.visited]); store.set('notes', state.notes);
  const key = id => state.slug + ':' + id;

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

  // ---------- glyphs ----------
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
  const SEAL = '<svg class="sealmark" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1"/><path d="M12 3.5l1.2 7.3L12 12l-1.2-1.2z" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg>';
  const ICON = {
    walk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5l6.5 17-6.5-3.6-6.5 3.6z"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    saved: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    been: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.8-5"/></svg>'
  };

  // ---------- map (vector, crisp at any zoom) ----------
  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [2.34, 48.8566], zoom: 12.5, minZoom: 3, maxZoom: 19,
    attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false,
    fadeDuration: 150
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  // keep the credit folded into its (i) button so it never covers the map
  const foldAttrib = () => document.querySelectorAll('.maplibregl-ctrl-attrib').forEach(a => a.classList.remove('maplibregl-compact-show'));
  map.on('load', foldAttrib); map.once('idle', foldAttrib);

  // Recolour the base style to the Talisman palette
  function restyle() {
    const C = { bg: '#F4EFE6', water: '#D6DBD8', waterLine: '#C3CCCA', park: '#E4E3D1', wood: '#DFDFCB', building: '#E8E0D0',
      road: '#FFFDF8', roadCase: '#E0D7C6', rail: '#D3CAB8', boundary: '#C9BFA9', text: '#6B665C', label: '#1B2A41', halo: '#F4EFE6' };
    const set = (id, prop, v) => { try { map.setPaintProperty(id, prop, v); } catch {} };
    for (const l of map.getStyle().layers) {
      const id = l.id.toLowerCase(), src = (l['source-layer'] || '').toLowerCase();
      if (l.type === 'background') set(l.id, 'background-color', C.bg);
      else if (l.type === 'fill') {
        if (src === 'water' || id.includes('water')) set(l.id, 'fill-color', C.water);
        else if (/park|grass|garden|cemetery|pitch/.test(id) || src === 'park') set(l.id, 'fill-color', C.park);
        else if (/wood|forest|landcover/.test(id)) set(l.id, 'fill-color', C.wood);
        else if (src === 'building' || id.includes('building')) { set(l.id, 'fill-color', C.building); set(l.id, 'fill-outline-color', '#DDD3C0'); }
        else if (src === 'landuse' || id.includes('landuse') || id.includes('residential')) set(l.id, 'fill-color', C.bg);
      } else if (l.type === 'line') {
        if (src === 'waterway' || id.includes('water')) set(l.id, 'line-color', C.waterLine);
        else if (/rail|transit/.test(id)) set(l.id, 'line-color', C.rail);
        else if (id.includes('boundary') || src === 'boundary') set(l.id, 'line-color', C.boundary);
        else if (/casing|outline/.test(id)) set(l.id, 'line-color', C.roadCase);
        else if (/road|highway|street|bridge|tunnel|path|motorway|primary|secondary|minor|service/.test(id) || src === 'transportation') set(l.id, 'line-color', C.road);
      } else if (l.type === 'symbol') {
        if (/poi|airport|aerodrome/.test(id)) { try { map.setLayoutProperty(l.id, 'visibility', 'none'); } catch {} continue; }
        const isPlace = src === 'place' || /place|city|town|country|state/.test(id);
        set(l.id, 'text-color', isPlace ? C.label : C.text);
        set(l.id, 'text-halo-color', C.halo);
        set(l.id, 'text-halo-width', 1.4);
      }
    }
  }
  map.on('style.load', restyle);
  map.on('error', e => console.warn('map', e && e.error && e.error.message));

  function sealEl(p) {
    const d = el('div', 'seal'); d.innerHTML = glyph(p.category);
    d.setAttribute('role', 'button'); d.setAttribute('aria-label', p.name); d.tabIndex = 0;
    d.addEventListener('click', e => { e.stopPropagation(); openPlace(p.id); });
    d.addEventListener('keydown', e => { if (e.key === 'Enter') openPlace(p.id); });
    return d;
  }
  function clearMarkers() { for (const m of state.markers.values()) m.remove(); state.markers.clear(); }
  function refreshMarkers() {
    const visible = new Set(filtered().map(p => p.id));
    for (const p of state.places) {
      let m = state.markers.get(p.id);
      if (!m) { m = new maplibregl.Marker({ element: sealEl(p), anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(map); state.markers.set(p.id, m); }
      const e = m.getElement().firstElementChild ? m.getElement() : m.getElement();
      const k = key(p.id);
      e.classList.toggle('saved', state.saved.has(k));
      e.classList.toggle('visited', state.visited.has(k));
      e.classList.toggle('active', state.selected === p.id);
      e.classList.toggle('dim', !visible.has(p.id) && state.selected !== p.id);
      e.style.zIndex = state.selected === p.id ? 3 : visible.has(p.id) ? 2 : 1;
    }
  }

  function sheetCover() {
    if (wide()) return 0;
    return Math.max(0, window.innerHeight - $('#sheet').getBoundingClientRect().top);
  }
  function padding(extra = 0) {
    return wide() ? { top: 90, bottom: 40, left: 440, right: 40 } : { top: 90 + extra, bottom: sheetCover() + 24, left: 30, right: 30 };
  }
  function focusOn(lnglat, zoom) {
    map.easeTo({ center: lnglat, zoom: zoom ?? Math.max(map.getZoom(), 15), padding: padding(), duration: 650 });
  }
  function fitAll(animate = true) {
    const list = filtered().length ? filtered() : state.places;
    if (!list.length) return;
    const b = new maplibregl.LngLatBounds();
    list.forEach(p => b.extend([p.lng, p.lat]));
    map.fitBounds(b, { padding: padding(), maxZoom: 15, duration: animate ? 700 : 0 });
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
    handle.addEventListener('pointerdown', e => {
      dragging = true; moved = false; y0 = e.clientY; t0 = performance.now(); base = sheet.getBoundingClientRect().top;
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
  $('#listView').addEventListener('touchmove', () => { if (sheet.dataset.state === 'peek') setSheet('half'); }, { passive: true });
  $('#searchInput').addEventListener('focus', () => setSheet('full'));
  map.on('click', () => { if (state.selected) closePlace(); else if (sheet.dataset.state !== 'peek') setSheet('peek'); });

  // ---------- list ----------
  function matches(p, q) {
    return [p.name, p.area, p.category, p.note, p.address].join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .includes(q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  }
  function filtered() {
    let list = state.places;
    if (state.tab === 'saved') list = list.filter(p => state.saved.has(key(p.id)));
    if (state.cat !== 'All') list = list.filter(p => p.category === state.cat);
    if (state.q) list = list.filter(p => matches(p, state.q));
    if (state.me) list = [...list].sort((a, b) => a._d - b._d);
    return list;
  }
  function renderChips() {
    const counts = {}; state.places.forEach(p => counts[p.category] = (counts[p.category] || 0) + 1);
    const cats = ['All', ...Object.keys(counts).sort()];
    const c = $('#chips'); c.innerHTML = '';
    for (const cat of cats) {
      const b = el('button', 'chip' + (cat === state.cat ? ' active' : ''),
        (cat === 'All' ? '' : glyph(cat)) + esc(cat) + (cat === 'All' ? '' : ` <span class="c">${counts[cat]}</span>`));
      b.setAttribute('aria-pressed', cat === state.cat);
      b.onclick = () => { state.cat = cat; renderAll(); fitAll(); };
      c.appendChild(b);
    }
  }
  function renderList() {
    const list = filtered(), ul = $('#list');
    ul.innerHTML = '';
    const savedHere = state.places.filter(p => state.saved.has(key(p.id))).length;
    $('#savedCount').textContent = savedHere ? `(${savedHere})` : '';
    if (!list.length) {
      ul.appendChild(el('li', 'empty', state.q ? `Nothing matches “${esc(state.q)}”.`
        : state.tab === 'saved' ? 'Nothing saved in this city yet. Open a place and tap Save to keep it here.'
        : 'No places in this category.'));
    }
    for (const p of list) {
      const k = key(p.id);
      const li = el('li', 'item' + (state.visited.has(k) ? ' visited' : '') + (state.saved.has(k) ? ' saved' : ''));
      li.tabIndex = 0;
      li.innerHTML = `<span class="glyph">${glyph(p.category)}</span>
        <div><h3>${esc(p.name)}</h3>
        <div class="meta">${esc(p.category)} · ${esc(p.area)}${state.visited.has(k) ? ' · visited' : state.saved.has(k) ? ' · <span class="saved-tag">saved</span>' : ''}</div></div>
        <span class="dist">${state.me && p._d != null && p._d < 100000 ? fmtDist(p._d).replace(' · ', '<br>') : ''}</span>`;
      li.onclick = () => openPlace(p.id);
      li.onkeydown = e => { if (e.key === 'Enter') openPlace(p.id); };
      ul.appendChild(li);
    }
    const city = state.cities.get(state.slug);
    const s = $('#status');
    if (state.me && city) {
      const far = haversine(state.me, [city.center[0], city.center[1]]) > 30000;
      s.textContent = far ? `${list.length} places · you're ${fmtDist(haversine(state.me, city.center))} away` : `${list.length} places · nearest first`;
    } else s.textContent = `${list.length} ${list.length === 1 ? 'place' : 'places'}`;
  }
  function renderAll() { renderChips(); renderList(); refreshMarkers(); }

  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    state.tab = t.dataset.tab;
    document.querySelectorAll('.tab').forEach(x => { x.classList.toggle('active', x === t); x.setAttribute('aria-selected', x === t); });
    renderAll(); fitAll();
  });
  let qT;
  $('#searchInput').addEventListener('input', e => {
    clearTimeout(qT);
    qT = setTimeout(() => { state.q = e.target.value.trim(); renderList(); refreshMarkers(); }, 120);
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
    const k = key(id);
    if (!fromHash) history.replaceState(null, '', '#' + state.slug + '-' + id);
    $('#listView').classList.add('hidden'); $('#detailView').classList.remove('hidden');
    $('#backLabel').textContent = state.cities.get(state.slug)?.city || 'All places';
    const isSaved = state.saved.has(k), isVisited = state.visited.has(k);
    $('#detail').innerHTML = `${SEAL}
      <div class="kicker">${esc(p.category)} · ${esc(p.area)}</div>
      <h2>${esc(p.name)}</h2>
      <p class="addr">${esc(p.address || '')}${state.me && p._d < 100000 ? '<br>' + fmtDist(p._d) + ' walk' : ''}</p>
      <p class="note">${esc(p.note || '')}</p>
      ${p.draft ? '<p class="draft">Placeholder copy, to be replaced with Talisman text</p>' : ''}
      <div class="actions">
        <a class="act primary" href="${directionsUrl(p)}" target="_blank" rel="noopener">${ICON.walk}Walk there</a>
        <button class="act${isSaved ? ' on' : ''}" id="saveBtn">${isSaved ? ICON.saved + 'Saved' : ICON.save + 'Save'}</button>
        <button class="act${isVisited ? ' on' : ''}" id="visitBtn">${ICON.been}${isVisited ? 'Visited' : 'Been'}</button>
      </div>
      <div class="notes">
        <label for="noteInput">Beta note</label>
        <textarea id="noteInput" placeholder="What worked, what didn't, what's missing…">${esc(state.notes[k] || '')}</textarea>
        <div class="saved-hint" id="noteHint"></div>
      </div>`;
    $('#saveBtn').onclick = () => toggle('saved', id);
    $('#visitBtn').onclick = () => toggle('visited', id);
    let t;
    $('#noteInput').oninput = e => {
      clearTimeout(t);
      t = setTimeout(() => {
        const v = e.target.value.trim();
        if (v) state.notes[k] = v; else delete state.notes[k];
        store.set('notes', state.notes); $('#noteHint').textContent = 'Saved on this phone';
      }, 400);
    };
    // three nearest neighbours — for wandering on foot
    const near = state.places.filter(x => x.id !== id)
      .map(x => ({ x, d: haversine([p.lat, p.lng], [x.lat, x.lng]) })).sort((a, b) => a.d - b.d).slice(0, 3);
    const nb = $('#nearby'); nb.innerHTML = '<div class="nearby"><h4>Nearby, on foot</h4></div>';
    const ol = el('ol', 'list');
    for (const { x, d } of near) {
      const li = el('li', 'item' + (state.saved.has(key(x.id)) ? ' saved' : ''));
      li.tabIndex = 0;
      li.innerHTML = `<span class="glyph">${glyph(x.category)}</span><div><h3>${esc(x.name)}</h3><div class="meta">${esc(x.category)} · ${esc(x.area)}</div></div><span class="dist">${fmtDist(d).replace(' · ', '<br>')}</span>`;
      li.onclick = () => openPlace(x.id);
      ol.appendChild(li);
    }
    nb.firstChild.appendChild(ol);
    $('#detailView').scrollTop = 0;
    if (sheet.dataset.state === 'peek') setSheet('half');
    refreshMarkers();
    setTimeout(() => focusOn([p.lng, p.lat]), 340);
  }
  function closePlace() {
    state.selected = null;
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    $('#detailView').classList.add('hidden'); $('#listView').classList.remove('hidden');
    renderAll();
  }
  function toggle(kind, id) {
    const set = state[kind], k = key(id);
    set.has(k) ? set.delete(k) : set.add(k);
    store.set(kind, [...set]);
    if (set.has(k)) toast(kind === 'saved' ? 'Saved' : 'Marked as visited');
    openPlace(id, { fromHash: true });
    renderList();
  }
  $('#backBtn').onclick = closePlace;

  // ---------- cities ----------
  const cache = {};
  async function loadCity(slug) {
    if (cache[slug]) return cache[slug];
    const res = await fetch(`data/${slug}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error('city ' + res.status);
    return (cache[slug] = await res.json());
  }
  async function setCity(slug, { fit = true, keepSelection = false } = {}) {
    if (!state.cities.has(slug)) slug = state.index.cities[0].slug;
    const data = await loadCity(slug);
    state.slug = slug; store.set('city', slug);
    state.places = (data.places || []).filter(p => isFinite(p.lat) && isFinite(p.lng)).map(p => ({ ...p, _d: null }));
    state.byId = new Map(state.places.map(p => [p.id, p]));
    state.cat = 'All'; state.q = ''; $('#searchInput').value = '';
    if (!keepSelection) { state.selected = null; $('#detailView').classList.add('hidden'); $('#listView').classList.remove('hidden'); }
    updateDistances();
    $('#cityLabel').textContent = data.city;
    $('#searchInput').placeholder = `Search ${data.city}`;
    $('#dataNote').textContent = `${data.city}: ${data.version || 'unversioned'} · ${state.places.length} places`;
    clearMarkers();
    renderAll();
    if (fit) fitAll(false);
  }
  function renderCityPickers() {
    const rail = $('#cityRail'); rail.innerHTML = '';
    const list = $('#cityList'); list.innerHTML = '';
    for (const c of state.index.cities) {
      const card = el('button', 'city-card');
      card.setAttribute('role', 'listitem');
      card.innerHTML = `${SEAL}<div class="ctry">${esc(c.country)}</div><h2>${esc(c.city)}</h2><div class="cnt">${c.count} places</div>
        <div class="open"><span>Open the guide</span><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M14 6l6 6-6 6" stroke="currentColor" stroke-width="1.3" fill="none"/></svg></div>`;
      card.onclick = async () => { await setCity(c.slug, { fit: false }); enter(false); };
      rail.appendChild(card);
      const li = el('li');
      const b = el('button', c.slug === state.slug ? 'current' : '', `<span class="n">${esc(c.city)}</span><span class="m">${esc(c.country)} · ${c.count}</span>`);
      b.onclick = async () => { $('#cityDialog').classList.add('hidden'); await setCity(c.slug); setSheet('peek'); };
      li.appendChild(b); list.appendChild(li);
    }
  }
  $('#cityBtn').onclick = () => { renderCityPickers(); $('#cityDialog').classList.remove('hidden'); };
  $('#cityDialog').addEventListener('click', e => { if (e.target.id === 'cityDialog') e.currentTarget.classList.add('hidden'); });

  // ---------- location ----------
  function updateDistances() {
    for (const p of state.places) p._d = state.me ? haversine(state.me, [p.lat, p.lng]) : null;
  }
  function nearestCity(pos) {
    let best = null, bd = Infinity;
    for (const c of state.index.cities) { const d = haversine(pos, c.center); if (d < bd) { bd = d; best = c; } }
    return { city: best, d: bd };
  }
  async function onPos(pos) {
    const first = !state.me;
    state.me = [pos.coords.latitude, pos.coords.longitude];
    if (!state.meMarker) {
      const d = el('div', 'me');
      state.meMarker = new maplibregl.Marker({ element: d }).setLngLat([state.me[1], state.me[0]]).addTo(map);
    } else state.meMarker.setLngLat([state.me[1], state.me[0]]);
    $('#locateBtn').classList.add('on');
    if (!state.index) return;
    if (first && state.followMe) { state.followMe = false; if (await followMe()) return; }
    updateDistances();
    if (state.selected) {
      const addr = document.querySelector('#detail .addr'); const p = state.byId.get(state.selected);
      if (addr && p && p._d < 100000) addr.innerHTML = `${esc(p.address || '')}<br>${fmtDist(p._d)} walk`;
    } else renderList();
  }
  // jump to the nearest Talisman city and centre on the person
  async function followMe() {
    const { city, d } = nearestCity(state.me);
    if (d < 40000 && city.slug !== state.slug) await setCity(city.slug, { fit: false });
    updateDistances(); renderList();
    if (d < 40000) { focusOn([state.me[1], state.me[0]], 15); return true; }
    toast(`No Talisman city near you yet. Nearest: ${city.city}, ${fmtDist(d)}`, 3600);
    fitAll();
    return true;
  }
  function onPosErr(err) {
    $('#locateBtn').classList.remove('on');
    toast(err.code === 1
      ? (isIOS ? 'Location is off. Settings › Privacy › Location Services › Safari Websites' : 'Location permission was denied')
      : 'Couldn’t get your location', 4200);
  }
  function startLocation(follow) {
    state.followMe = follow;
    if (!('geolocation' in navigator)) { toast('Location isn’t available on this device'); return; }
    if (state.watchId != null) { if (follow) { if (state.me && state.index) followMe(); else state.followMe = true; } return; }
    state.watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
  }
  $('#locateBtn').onclick = () => startLocation(true);
  if (navigator.permissions?.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(r => { if (r.state === 'granted') startLocation(false); }).catch(() => {});
  }

  // ---------- menu ----------
  const menu = $('#menu');
  $('#menuBtn').onclick = () => menu.classList.remove('hidden');
  $('#closeMenu').onclick = () => menu.classList.add('hidden');
  menu.addEventListener('click', e => { if (e.target === menu) menu.classList.add('hidden'); });
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
  $('#installBtn').onclick = () => {
    if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; return; }
    $('#installHelp').classList.toggle('hidden');
  };
  $('#notesBtn').onclick = async () => {
    const lines = [`Talisman beta notes — ${new Date().toLocaleString()}`, ''];
    for (const c of state.index.cities) {
      let data; try { data = await loadCity(c.slug); } catch { continue; }
      const block = [];
      for (const p of data.places) {
        const k = c.slug + ':' + p.id;
        const tags = [state.saved.has(k) && 'saved', state.visited.has(k) && 'visited'].filter(Boolean);
        if (!state.notes[k] && !tags.length) continue;
        block.push(`• ${p.name}${tags.length ? ' [' + tags.join(', ') + ']' : ''}`);
        if (state.notes[k]) block.push('   ' + state.notes[k].replace(/\n/g, '\n   '));
      }
      if (block.length) lines.push(c.city.toUpperCase(), ...block, '');
    }
    if (lines.length === 2) { $('#notesStatus').textContent = 'No notes yet. Open a place and write in “Beta note”.'; return; }
    const text = lines.join('\n');
    try { await navigator.clipboard.writeText(text); $('#notesStatus').textContent = 'Copied. Paste it into a message or into Claude.'; }
    catch {
      const ta = el('textarea'); ta.value = text; ta.style.cssText = 'width:100%;height:160px;margin:6px 0 10px;font-size:13px';
      $('#notesStatus').replaceChildren('Copy this:', ta); ta.select();
    }
  };

  // ---------- opening ----------
  const opening = $('#opening');
  function enter(near) {
    opening.classList.add('gone');
    setTimeout(() => opening.classList.add('hidden'), 420);
    map.resize();
    setSheet('peek');
    if (near) startLocation(true); else setTimeout(() => fitAll(), 60);
  }
  $('#nearBtn').onclick = () => enter(true);

  window.addEventListener('hashchange', async () => {
    const h = decodeURIComponent(location.hash.slice(1));
    const [slug, ...rest] = h.split('-'); const id = rest.join('-');
    if (slug && state.cities.has(slug)) { if (slug !== state.slug) await setCity(slug, { fit: false }); if (state.byId.has(id)) openPlace(id, { fromHash: true }); }
    else if (!h && state.selected) closePlace();
  });

  // ---------- boot ----------
  (async () => {
    try {
      const res = await fetch('data/cities.json', { cache: 'no-cache' });
      state.index = await res.json();
      state.index.cities.forEach(c => state.cities.set(c.slug, c));
      $('#sourcesNote').textContent = 'Places researched with ' + state.index.sources.join(', ') + '. All notes written by Talisman.';
      const h = decodeURIComponent(location.hash.slice(1));
      const [hs, ...rest] = h.split('-'); const hid = rest.join('-');
      const start = state.cities.has(hs) ? hs : state.slug;
      await setCity(start, { fit: true });
      renderCityPickers();
      if (state.me) { updateDistances(); renderList(); }
      if (hid && state.byId.has(hid)) { opening.classList.add('hidden'); openPlace(hid, { fromHash: true }); }
      if (isIOS && !standalone && !store.get('installHinted2', false)) {
        store.set('installHinted2', true);
        setTimeout(() => toast('Install: tap Share, then “Add to Home Screen”', 4500), 1800);
      }
    } catch (err) {
      console.error(err);
      $('#status').textContent = 'Couldn’t load places. Check your connection and reopen.';
    }
  })();

  window.addEventListener('resize', () => { if (wide()) setSheet('full'); });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e)));
  }
})();
