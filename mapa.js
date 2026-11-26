'use strict';
// Pestaña «Ruta»: mapa (Leaflet) con aeródromos y espacios aéreos del AIP, ruta por tramos con rumbo, tiempo y combustible.
// Los textos del AIP (nombres, notas) se insertan siempre con textContent, nunca como HTML.
(function () {
  const $ = id => document.getElementById(id);
  const R = window.RUTA;
  const LS_ROUTE = 'c172smart.ruta', LS_MAP = 'c172smart.mapa';
  const h = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  const nf = (n, d = 0) => n.toLocaleString('es', { maximumFractionDigits: d, minimumFractionDigits: d });
  const num = id => parseFloat($(id).value) || 0;
  const pad3 = n => String(Math.round(n) % 360 || (n > 0 ? 360 : 0)).padStart(3, '0');
  const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } } };

  // Tipos de espacio aéreo: color, grupo de capas y prioridad (los P/R/D van encima)
  const TYPES = {
    TMA: { name: 'TMA', color: '#6b7280', w: 1.4, fill: 0, dash: '8 7', group: 'tma', z: 0, label: 'TMA' },
    REC: { name: 'Parapente / ala delta / láser', color: '#0891b2', w: 1.6, fill: 0.14, group: 'rec', z: 1, label: 'ACT' },
    ATZ: { name: 'ATZ', color: '#0f8a5f', w: 1.6, fill: 0.07, group: 'ctl', z: 2, label: 'ATZ' },
    CTR: { name: 'CTR (clase D)', color: '#1d4ed8', w: 2, fill: 0.05, group: 'ctl', z: 3, label: 'CTR' },
    C: { name: 'Espacio aéreo clase C', color: '#d6006e', w: 2, fill: 0.04, group: 'ctl', z: 4, label: 'C' },
    D: { name: 'Zona peligrosa (D)', color: '#9333ea', w: 2, fill: 0.12, group: 'zon', z: 5, label: '' },
    R: { name: 'Zona restringida (R)', color: '#e8590c', w: 2, fill: 0.13, group: 'zon', z: 6, label: '' },
    P: { name: 'Zona prohibida (P)', color: '#c81e1e', w: 2.2, fill: 0.2, group: 'zon', z: 7, label: '' },
  };
  const SEV = ['P', 'R', 'D', 'C', 'CTR', 'ATZ', 'REC', 'TMA'];                      // orden de importancia en los avisos
  const GROUPS = [
    { id: 'ad', label: 'Aeródromos', sw: ['#16222e'] },
    { id: 'ctl', label: 'Clase C, CTR y ATZ', sw: ['#d6006e', '#1d4ed8', '#0f8a5f'] },
    { id: 'zon', label: 'Zonas prohibidas, restringidas y peligrosas', sw: ['#c81e1e', '#e8590c', '#9333ea'] },
    { id: 'rec', label: 'Parapente, ala delta y láser', sw: ['#0891b2'] },
    { id: 'tma', label: 'TMA', sw: ['#6b7280'] },
    { id: 'vrc', label: 'Rutas visuales de Santiago (salida / llegada)', sw: ['#00a73c', '#f42f3a'] },
  ];
  const VRC_COL = { S: '#0a9a3a', L: '#e0222d' };            // verde = salida, rojo = llegada, como en las cartas ENR 7.9 / 7.10
  const BASES = {
    osm: () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }),
    topo: () => L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA) · © OpenStreetMap' }),
  };

  let CAN = { items: [], labels: [] };
  let map = null, ESP = [], adReady = false, route = [], cfg = store.get(LS_MAP, { layers: {}, base: 'osm' });
  let baseLayer = null, groupLayers = {}, adMarkers = [], routeLine = null, routeHalo = null, ptMarkers = [], legMarkers = [], tapPopup = null, fitted = false;
  let lastPlan = null, syncing = false;

  // ---------- ruta ----------
  const label = (p, i) => p.i || ('P' + (i + 1));
  const ptOf = a => ({ lat: a.lat, lon: a.lon, i: a.i, n: a.n });
  const A = () => window.AD;
  function fmtLL(p) {
    const f = (v, pos, neg, w) => { const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60; return String(d).padStart(w, '0') + '°' + nf(m, 1).padStart(4, '0') + '′' + (v < 0 ? neg : pos); };
    return f(p.lat, 'N', 'S', 2) + ' ' + f(p.lon, 'E', 'W', 3);
  }
  function loadRoute() {
    const raw = store.get(LS_ROUTE, []);
    route = (Array.isArray(raw) ? raw : []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(p => ({ lat: p.lat, lon: p.lon, ...(p.i ? { i: String(p.i), n: p.n ? String(p.n) : '' } : {}) }));
  }
  const saveRoute = () => store.set(LS_ROUTE, route);

  // Cada cambio hecho por el usuario: guarda, repinta, y deja origen/destino de Inicio y la distancia de Combustible acordes a la ruta
  function edited() {
    saveRoute();
    const ad = A();
    if (ad && ad.setEnds && route.length) {
      const f = route[0], t = route.length > 1 ? route[route.length - 1] : null;
      syncing = true;
      try { ad.setEnds(f.i || null, t && t.i ? t.i : null); } finally { syncing = false; }
    }
    renderAll();
    if (window.APP && route.length >= 2) {
      const dec = decide(); if (dec) window.APP.legacy(dec.nm, dec.head);
    }
  }
  function decide() { return lastPlan && lastPlan.nm > 0 ? { nm: lastPlan.nm, head: lastPlan.nm ? lastPlan.legs.reduce((s, l) => s + (l.head || 0) * l.nm, 0) / lastPlan.nm : 0 } : null; }
  function add(p, at) {
    if (at == null || at >= route.length) route.push(p); else route.splice(at, 0, p);
    edited();
  }
  function addAerodrome(a, fly) {
    if (a.lat == null || a.lon == null) return;
    add(ptOf(a));
    if (fly && map) map.panTo([a.lat, a.lon]);
  }
  // Inicio cambió origen/destino: la ruta del mapa los toma (primer y último punto)
  function homeChanged(key, a) {
    if (syncing || !a || a.lat == null) return;
    const p = ptOf(a);
    if (key === 'from') { if (!route.length) route = [p]; else route[0] = p; }
    else { if (route.length < 2) route.push(p); else route[route.length - 1] = p; }
    saveRoute(); renderAll();
    if (window.APP && route.length >= 2) { const dec = decide(); if (dec) window.APP.legacy(dec.nm, dec.head); }
  }

  // ---------- mapa ----------
  function popupAD(a) {
    const d = h('div', null, 'rt-pop');
    d.append(h('b', `${a.i} · ${a.n}`));
    const rw = (a.rw || []).map(r => r.a + (r.b ? '/' + r.b : '') + (r.l ? ' ' + nf(r.l) + ' m' : '')).join(' · ');
    const meta = [a.c, a.el != null ? 'Elev. ' + nf(a.el) + ' ft' : '', a.uso === 'PVT' ? 'Privado' : a.uso === 'MIL' ? 'Militar' : a.uso === 'PUB' ? 'Público' : ''].filter(Boolean).join(' · ');
    if (meta) d.append(h('small', meta));
    if (rw) d.append(h('small', 'Pistas: ' + rw));
    const fq = A() && A().freqText ? A().freqText(a) : '';
    if (fq) d.append(h('small', fq, 'rt-fq'));
    const b = h('button', '+ Agregar a la ruta', 'rt-pbtn'); b.type = 'button';
    b.addEventListener('click', () => { addAerodrome(a, false); map.closePopup(); });
    d.append(b);
    return d;
  }
  function spans(lat, lon) {   // espacios que contienen el punto, de mayor a menor importancia
    return ESP.filter(e => R.inside(e.g, lat, lon)).sort((x, y) => SEV.indexOf(x.tp) - SEV.indexOf(y.tp));
  }
  const limTxt = e => [e.inf, e.sup].filter(Boolean).join(' – ');
  function spaceLine(e) {
    const t = TYPES[e.tp], r = h('div', null, 'rt-sp'), dot = h('i'); dot.style.background = t.color;
    const txt = h('span'); txt.append(h('b', e.nm), h('small', [limTxt(e), e.cl ? 'clase ' + e.cl : '', e.ap ? 'trazo aproximado' : ''].filter(Boolean).join(' · ')));
    r.append(dot, txt);
    if (e.nt) r.append(h('small', e.nt, 'rt-spn'));
    return r;
  }
  function popupTap(ll) {
    const d = h('div', null, 'rt-pop');
    d.append(h('b', 'Punto del mapa'), h('small', fmtLL({ lat: ll.lat, lon: ll.lng })));
    const here = spans(ll.lat, ll.lng);
    if (here.length) { d.append(h('small', 'Espacios aéreos aquí:', 'rt-sh')); here.forEach(e => d.append(spaceLine(e))); }
    else d.append(h('small', 'Sin espacios aéreos publicados en este punto.'));
    const b = h('button', '+ Agregar punto a la ruta', 'rt-pbtn'); b.type = 'button';
    b.addEventListener('click', () => { add({ lat: +ll.lat.toFixed(5), lon: +ll.lng.toFixed(5) }); map.closePopup(); });
    d.append(b);
    return d;
  }

  function createMap() {
    map = L.map('rt_map', { center: [-33.45, -70.65], zoom: 10, zoomControl: true, preferCanvas: true, worldCopyJump: false });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a> · Espacios aéreos: AIP Chile (DGAC)');
    map.createPane('esp').style.zIndex = 380;
    map.createPane('vrc').style.zIndex = 420;
    map.createPane('rutaPane').style.zIndex = 450;
    map.on('click', e => {
      const lp = $('rt_layers');
      if (!lp.hidden) { lp.hidden = true; $('rt_layers_btn').setAttribute('aria-expanded', 'false'); return; }   // el primer toque solo cierra el panel de capas
      tapPopup =L.popup({ maxWidth: 280, className: 'rt-popup' }).setLatLng(e.latlng).setContent(popupTap(e.latlng)).openOn(map); });
    const lbl = () => { const c = map.getContainer(); c.classList.toggle('rt-z-low', map.getZoom() < 10); c.classList.toggle('rt-z-vrc', map.getZoom() >= 11); };   // las altitudes de las rutas visuales solo se rotulan con zoom cercano
    map.on('zoomend', lbl); lbl();
    setBase(cfg.base || 'osm');
    drawSpaces(); drawAerodromes(); drawCanales();
    Object.keys(groupLayers).forEach(g => applyGroup(g));
    renderRoute();
    if (route.length) { fitRoute(); } fitted = true;
  }
  function setBase(id) {
    cfg.base = id; store.set(LS_MAP, cfg);
    if (baseLayer) { map.removeLayer(baseLayer); baseLayer = null; }
    if (BASES[id]) { baseLayer = BASES[id](); baseLayer.addTo(map); }
    map.getContainer().classList.toggle('rt-nobase', !BASES[id]);
  }
  const groupOn = g => (cfg.layers && g in cfg.layers) ? !!cfg.layers[g] : true;
  function applyGroup(g) {
    const lg = groupLayers[g]; if (!lg) return;
    if (groupOn(g)) { if (!map.hasLayer(lg)) lg.addTo(map); } else if (map.hasLayer(lg)) map.removeLayer(lg);
  }
  function centroid(g) {
    if (g.c) return g.c;
    const n = g.r.length; return [g.r.reduce((s, p) => s + p[0], 0) / n, g.r.reduce((s, p) => s + p[1], 0) / n];
  }
  function shortLabel(e) {
    const t = TYPES[e.tp];
    return t.label || e.id.replace(/^SC-/, '');
  }
  function drawSpaces() {
    ['tma', 'rec', 'ctl', 'zon'].forEach(g => { if (groupLayers[g]) groupLayers[g].clearLayers(); else groupLayers[g] = L.layerGroup(); });
    const sorted = ESP.slice().sort((a, b) => TYPES[a.tp].z - TYPES[b.tp].z);
    for (const e of sorted) {
      const t = TYPES[e.tp]; if (!t) continue;
      const st = { pane: 'esp', interactive: false, color: t.color, weight: t.w, fillColor: t.color, fillOpacity: t.fill, opacity: 0.9, dashArray: (e.ap ? '4 4' : t.dash) || null };
      const lyr = e.g.r ? L.polygon(e.g.r, st) : L.circle(e.g.c, { ...st, radius: e.g.nm * 1852 });
      groupLayers[t.group].addLayer(lyr);
      if (e.tp !== 'TMA' && e.tp !== 'ATZ') {
        const c = centroid(e.g), ic = L.divIcon({ className: 'rt-sl', html: h('span', shortLabel(e)), iconSize: [0, 0] });
        ic.options.html.style.color = t.color;
        groupLayers[t.group].addLayer(L.marker(c, { icon: ic, interactive: false, keyboard: false, pane: 'esp' }));
      }
    }
  }
  function drawAerodromes() {
    if (!A() || !map) return;
    if (!groupLayers.ad) groupLayers.ad = L.layerGroup();
    groupLayers.ad.clearLayers(); adMarkers = [];
    for (const a of A().all()) {
      if (a.lat == null || a.lon == null) continue;
      const el = h('div', null, 'rt-ad t-' + (a.t || 'AD') + ' u-' + String(a.uso || 'PUB').replace('/', '-'));
      el.append(h('i'), h('span', a.i, 'rt-lbl'));
      const m = L.marker([a.lat, a.lon], { icon: L.divIcon({ className: 'rt-adw', html: el, iconSize: [0, 0] }), keyboard: true, title: a.i + ' ' + a.n, riseOnHover: true });
      m.bindPopup(() => popupAD(a), { maxWidth: 280, className: 'rt-popup' });
      groupLayers.ad.addLayer(m); adMarkers.push(m);
    }
    applyGroup('ad');
  }

  // ---------- rutas visuales (trazado de las cartas VRC ENR 7.9 / 7.10) ----------
  let vrcLayers = {};
  const llo = q => ({ lat: q[0], lon: q[1] });
  const pathNm = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += R.inv(llo(pts[i - 1]), llo(pts[i])).nm; return s; };
  function vrcInfo(it) {
    const r = R.inv(llo(it.p[0]), llo(it.p[it.p.length - 1]));
    return { len: pathNm(it.p), brg: r.brg, chord: r.nm, mag: R.mod360(r.brg - num('ru_var')) };
  }
  const vrcName = it => `${it.t === 'S' ? 'Salida' : 'Llegada'} visual · carta VRC-${it.ch}`;
  const vrcEnds = it => it.desde && it.hasta && it.desde.i === it.hasta.i ? `vuelta junto a ${it.desde.i}` : `${it.desde ? it.desde.i : 'punto en el mapa'} → ${it.hasta ? it.hasta.i : 'punto en el mapa'}`;
  // Douglas-Peucker (plano local, en NM): deja pocos puntos de giro para volarlos y que el planificador dé rumbo por tramo
  function simplify(pts, tolNm, maxN) {
    const k = Math.cos(pts[0][0] * Math.PI / 180), P = pts.map(q => [q[1] * k * 60, q[0] * 60]);
    const dist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
    let tol = tolNm, keep = new Set([0, P.length - 1]);
    for (let g = 0; g < 14; g++) {
      keep = new Set([0, P.length - 1]);
      const rec = (i, j) => { let m = -1, mi = -1; for (let q = i + 1; q < j; q++) { const d = dist(P[q], P[i], P[j]); if (d > m) { m = d; mi = q; } } if (m > tol) { keep.add(mi); rec(i, mi); rec(mi, j); } };
      rec(0, P.length - 1);
      if (keep.size <= maxN) break;
      tol *= 1.6;
    }
    return [...keep].sort((a, b) => a - b).map(i => pts[i]);
  }
  function popupVrc(it) {
    const d = h('div', null, 'rt-pop'), i = vrcInfo(it);
    d.append(h('b', vrcName(it)), h('small', vrcEnds(it)));
    d.append(h('small', `Trazo de ${nf(i.len, 1)} NM. Del inicio al final: rumbo ${pad3(i.brg)}° verdadero (${pad3(i.mag)}° magnético), ${nf(i.chord, 1)} NM en línea recta.`));
    d.append(h('small', 'Dibujo de la carta, referencial: confirma altitudes, comunicaciones y puntos en AIP ENR 7.1 a 7.8.', 'rt-spn'));
    const b = h('button', 'Usar este trazado en mi ruta', 'rt-pbtn'); b.type = 'button';
    b.addEventListener('click', () => { useVrc(it); map.closePopup(); });
    d.append(b);
    return d;
  }
  function drawCanales() {
    if (!map) return;
    if (groupLayers.vrc) groupLayers.vrc.clearLayers(); else groupLayers.vrc = L.layerGroup();
    vrcLayers = {};
    const g = groupLayers.vrc;
    for (const it of CAN.items) {
      const col = VRC_COL[it.t];
      if (it.k === 'canal') g.addLayer(L.polyline(it.p, { pane: 'vrc', interactive: false, color: col, weight: 1.6, opacity: 0.6, dashArray: '6 5' }));
      else if (it.k === 'punta') g.addLayer(L.polygon(it.p, { pane: 'vrc', interactive: false, color: col, weight: 1, fillColor: col, fillOpacity: 0.95 }));
      else {
        const ln = L.polyline(it.p, { pane: 'vrc', color: col, weight: it.k === 'ruta' ? 4 : 3, opacity: 0.85, lineCap: 'round', interactive: it.k === 'ruta', bubblingMouseEvents: false });
        if (it.k === 'ruta') { ln.bindPopup(() => popupVrc(it), { maxWidth: 280, className: 'rt-popup' }); vrcLayers[it.id] = ln; }
        g.addLayer(ln);
      }
    }
    for (const l of CAN.labels) g.addLayer(L.marker(l.p, { pane: 'vrc', interactive: false, keyboard: false, icon: L.divIcon({ className: 'rt-vlw', html: h('span', l.t, 'rt-vl'), iconSize: [0, 0] }) }));
    applyGroup('vrc');
  }
  // Pone el trazado como puntos de giro de la ruta (el primero/último, si caen junto a un aeródromo, pasan a ser ese aeródromo)
  function useVrc(it) {
    const pts = simplify(it.p, 0.12, 12).map(q => ({ lat: +q[0].toFixed(5), lon: +q[1].toFixed(5) }));
    const a = A(), f = it.desde && a && a.get(it.desde.i), t = it.hasta && a && a.get(it.hasta.i);
    if (f && f.lat != null) pts[0] = ptOf(f);
    if (t && t.lat != null) pts[pts.length - 1] = ptOf(t);
    if (route.length && route[route.length - 1].i && pts[0].i === route[route.length - 1].i) pts.shift();
    route.push(...pts);
    edited(); fitRoute();
  }
  function vrcCands() {
    if (!CAN.items.length || !route.length) return [];
    const o = route[0].i, d = route.length > 1 ? route[route.length - 1].i : null;
    return CAN.items.filter(it => it.k === 'ruta' && ((o && it.desde && it.desde.i === o) || (d && it.hasta && it.hasta.i === d)));
  }
  function renderVrc() {
    const box = $('rt_vrc'); if (!box) return;
    box.replaceChildren();
    const c = vrcCands();
    box.hidden = !c.length;
    if (!c.length) return;
    box.append(h('h3', 'Rutas visuales desde tu origen', 'subhead'));
    box.append(h('p', 'Trazados de las cartas VRC (AIP ENR 7.9 y 7.10) que parten de tu origen o llegan a tu destino. Son dibujos de la carta, referenciales: confirma altitudes, comunicaciones y puntos en AIP ENR 7.1 a 7.8.', 'hint'));
    c.forEach(it => {
      const i = vrcInfo(it), row = h('div', null, 'rt-vr'), dot = h('i'); dot.style.background = VRC_COL[it.t];
      const tx = h('span'); tx.append(h('b', `${vrcName(it)} · ${vrcEnds(it)}`), h('small', `${nf(i.len, 1)} NM · rumbo ${pad3(i.mag)}° mag. de inicio a fin (${nf(i.chord, 1)} NM en línea recta)`));
      const view = h('button', 'Ver', 'rt-ib'), use = h('button', 'Usar', 'rt-ib rt-use');
      view.type = use.type = 'button';
      view.addEventListener('click', () => {
        if (!map) return;
        cfg.layers = { ...(cfg.layers || {}), vrc: true }; store.set(LS_MAP, cfg); applyGroup('vrc');
        const ln = vrcLayers[it.id]; if (ln) { map.fitBounds(ln.getBounds(), { padding: [50, 50], maxZoom: 13 }); ln.openPopup(ln.getBounds().getCenter()); }
        $('rt_map').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
      use.addEventListener('click', () => useVrc(it));
      row.append(dot, tx, view, use); box.append(row);
    });
  }

  // ---------- ruta en el mapa ----------
  function numIcon(i, text, drag) {
    const el = h('div', null, 'rt-wp' + (drag ? ' drag' : ''));
    el.append(h('b', String(i + 1)), h('span', text));
    return L.divIcon({ className: 'rt-wpw', html: el, iconSize: [0, 0] });
  }
  function renderRoute() {
    if (!map) return;
    ptMarkers.forEach(m => map.removeLayer(m)); ptMarkers = [];
    legMarkers.forEach(m => map.removeLayer(m)); legMarkers = [];
    const ll = route.map(p => [p.lat, p.lon]);
    if (!routeLine) {
      routeHalo = L.polyline(ll, { pane: 'rutaPane', color: '#16222e', weight: 8, opacity: 0.55, interactive: false }).addTo(map);
      routeLine = L.polyline(ll, { pane: 'rutaPane', color: '#f0a868', weight: 4, opacity: 1, interactive: false }).addTo(map);
    } else { routeHalo.setLatLngs(ll); routeLine.setLatLngs(ll); }
    route.forEach((p, i) => {
      const m = L.marker([p.lat, p.lon], { icon: numIcon(i, label(p, i), !p.i), draggable: !p.i, pane: 'rutaPane', zIndexOffset: 1000, keyboard: false, title: label(p, i) });
      if (!p.i) {
        m.on('drag', ev => { const q = ev.target.getLatLng(); route[i] = { lat: q.lat, lon: q.lng }; const l2 = route.map(x => [x.lat, x.lon]); routeLine.setLatLngs(l2); routeHalo.setLatLngs(l2); });
        m.on('dragend', ev => { const q = ev.target.getLatLng(); route[i] = { lat: +q.lat.toFixed(5), lon: +q.lng.toFixed(5) }; edited(); });
      }
      m.addTo(map); ptMarkers.push(m);
    });
    for (let i = 1; i < route.length; i++) {
      const r = R.inv(route[i - 1], route[i]);
      const mid = R.between(route[i - 1], route[i], 0.5);
      const el = h('div', `${pad3(r.brg)}° · ${nf(r.nm, r.nm < 10 ? 1 : 0)} NM`, 'rt-leg');
      legMarkers.push(L.marker([mid.lat, mid.lon], { icon: L.divIcon({ className: 'rt-legw', html: el, iconSize: [0, 0] }), interactive: false, keyboard: false, pane: 'rutaPane' }).addTo(map));
    }
  }
  function fitRoute() {
    if (!map || !route.length) return;
    if (route.length === 1) { map.setView([route[0].lat, route[0].lon], Math.max(map.getZoom(), 10)); return; }
    map.fitBounds(L.latLngBounds(route.map(p => [p.lat, p.lon])), { padding: [40, 40], maxZoom: 12 });
  }

  // ---------- panel: lista de puntos, tramos, combustible, espacios aéreos ----------
  function renderList() {
    const ol = $('rt_pts'); ol.replaceChildren();
    route.forEach((p, i) => {
      const li = h('li');
      li.append(h('b', String(i + 1), 'rt-n'));
      const t = h('span', null, 'rt-nm');
      const ad = p.i && A() ? A().get(p.i) : null;
      t.append(h('em', p.i ? `${p.i} · ${ad ? ad.n : (p.n || '')}` : 'Punto en el mapa'), h('small', i === 0 ? 'Origen' + (route.length > 1 ? '' : '') : i === route.length - 1 ? 'Destino' : 'Punto intermedio'));
      if (!p.i) t.append(h('small', fmtLL(p)));
      li.append(t);
      const btn = (txt, lbl, fn, dis) => { const b = h('button', txt, 'rt-ib'); b.type = 'button'; b.setAttribute('aria-label', lbl); b.disabled = !!dis; b.addEventListener('click', fn); return b; };
      const acts = h('span', null, 'rt-ia');
      acts.append(btn('▲', `Subir ${label(p, i)}`, () => { [route[i - 1], route[i]] = [route[i], route[i - 1]]; edited(); }, i === 0),
        btn('▼', `Bajar ${label(p, i)}`, () => { [route[i + 1], route[i]] = [route[i], route[i + 1]]; edited(); }, i === route.length - 1),
        btn('✕', `Quitar ${label(p, i)}`, () => { route.splice(i, 1); edited(); }));
      li.append(acts);
      $('rt_pts').append(li);
    });
    $('rt_empty').hidden = route.length > 0;
  }
  const kpi = (lab, val, cls) => { const d = h('div', null, 'kpi ' + (cls || '')); d.append(h('b', val), h('span', lab)); return d; };
  function row(cells, tag) {
    const tr = h('tr');
    cells.forEach(c => { const td = h(tag || 'td'); if (Array.isArray(c)) { td.append(h('span', c[0])); td.append(h('small', c[1])); } else td.textContent = c; tr.append(td); });
    return tr;
  }

  function renderPlan() {
    const ok2 = route.length >= 2;
    $('rt_plan').hidden = !ok2;
    if (!ok2) { lastPlan = null; return; }
    const APP = window.APP, prm = APP.params();
    const msg = $('rt_msg'); msg.replaceChildren();
    $('rt_tbl').replaceChildren(); $('rt_kpis').replaceChildren(); $('rt_air').replaceChildren();
    $('rt_to_wb').disabled = true; $('rt_to_fuel').disabled = true;
    if (prm.err) {
      lastPlan = null;
      const m = h('div', prm.err, 'msg bad'); msg.append(m);
      $('rt_cruise').textContent = 'Revisa los datos de crucero en la pestaña Combustible.';
      return;
    }
    $('rt_cruise').textContent = prm.info + ' (se cambia en Combustible).';
    const pl = R.plan(route, { tas: prm.tas, gph: prm.gph, climb: prm.climb, taxi: prm.taxi, resMin: prm.resMin, wdir: num('ru_wdir'), wspd: num('ru_wspd'), vari: num('ru_var') });
    lastPlan = pl;
    if (!pl.ok) { msg.append(h('div', 'El viento de costado iguala o supera la velocidad verdadera en algún tramo: no hay avance. Revisa el viento.', 'msg bad')); return; }
    pl.warns.forEach(w => msg.append(h('div', w, 'msg warn')));
    const have = APP.have(), cap = APP.tankCap(), tot = pl.galTotal;
    const over = tot > cap, short = have + 1e-9 < tot;
    msg.prepend(h('div', over ? `No llegas sin escala: la ruta pide ${APP.dF(tot)} y los tanques rinden ${APP.dF(cap, 0)}. Divide la ruta o baja la reserva.`
      : short ? `El combustible cargado (${APP.dF(have)}) no alcanza: necesitas ${APP.dF(tot)} con reserva. Usa el botón de abajo para cargarlo.`
        : `Alcanza: con ${APP.dF(have)} cargados te sobran ${APP.dF(have - tot)} sobre la reserva de ${nf(prm.resMin)} min.`, 'msg ' + (over || short ? 'bad' : 'ok')));

    const tbl = $('rt_tbl');
    const th = h('thead'); th.append(row(['Tramo', 'Rumbo mag.', 'Dist.', 'Tiempo', 'Comb.'], 'th')); tbl.append(th);
    const tb = h('tbody');
    pl.legs.forEach((l, i) => {
      const a = label(route[i], i), b = label(route[i + 1], i + 1);
      tb.append(row([[`${i + 1}. ${a} → ${b}`, `Ruta ${pad3(l.tc)}° V · suelo ${nf(l.gs)} kt${l.wca && Math.abs(l.wca) >= 0.5 ? ' · corrección ' + nf(l.wca, 0) + '°' : ''}`], pad3(l.mh) + '°', nf(l.nm, l.nm < 10 ? 1 : 0) + ' NM', APP.mm(l.min), APP.dF(l.gal)]));
    });
    tbl.append(tb);
    const tf = h('tfoot');
    tf.append(row(['Ruta', '', nf(pl.nm) + ' NM', APP.hm(pl.min / 60), APP.dF(pl.galEnroute)]));
    tf.append(row([['Rodaje + reserva', `${nf(prm.resMin)} min de reserva a consumo de crucero`], '', '', '', APP.dF(pl.galTaxi + pl.galReserve)]));
    tf.append(row(['Total', '', nf(pl.nm) + ' NM', APP.hm(pl.min / 60), APP.dF(tot)]));
    tbl.append(tf);
    const k = $('rt_kpis');
    // alcance con lo cargado: ascenso primero, luego crucero a la velocidad suelo media de la ruta, siempre con reserva
    const cNm = pl.legs.reduce((s, l) => s + (l.climbNm || 0), 0), cMin = pl.legs.reduce((s, l) => s + (l.climbMin || 0), 0);
    const gsAvg = pl.nm - cNm > 0 && pl.min - cMin > 0 ? (pl.nm - cNm) / ((pl.min - cMin) / 60) : prm.tas;
    const avail = have - pl.galTaxi - pl.galReserve, reach = avail <= pl.galClimb ? 0 : cNm + (avail - pl.galClimb) / prm.gph * gsAvg;
    k.append(kpi('Distancia', nf(pl.nm) + ' NM'), kpi('Tiempo de vuelo', APP.hm(pl.min / 60)), kpi('Combustible total', APP.dF(tot), over || short ? 'bad' : 'ok'), kpi(`Alcance con ${APP.dF(have, 0)} y reserva`, nf(reach) + ' NM'));
    $('rt_to_wb').disabled = over; $('rt_to_fuel').disabled = false;
    $('rt_note').textContent = 'Ascenso y crucero del POH (o tus valores) con la altitud de la pestaña Combustible, a una sola altitud y viento para toda la ruta. No incluye descenso (se calcula crucero hasta el destino, del lado conservador). La declinación y el viento los pones tú.';
    renderAir(pl);
  }

  function renderAir(pl) {
    const box = $('rt_air'); box.replaceChildren();
    if (!ESP.length) { box.append(h('p', 'Cargando espacios aéreos…', 'hint')); return; }
    const alt = window.APP.altitude();
    const cx = R.crossings(route, ESP);
    const byId = new Map(ESP.map(e => [e.id, e]));
    const rel = e => R.altRelation(e, alt);
    const crit = [];
    cx.forEach((list, i) => list.forEach(c => { const e = byId.get(c.id); if (['P', 'R', 'D'].includes(e.tp) && rel(e) !== 'below' && rel(e) !== 'above') crit.push(e); }));
    const critU = [...new Map(crit.map(e => [e.id, e])).values()];
    const sum = h('div', null, 'msg ' + (critU.some(e => e.tp === 'P') ? 'bad' : critU.length ? 'warn' : 'ok'));
    sum.textContent = critU.length
      ? `Tu ruta cruza ${critU.length === 1 ? 'una zona' : critU.length + ' zonas'} P/R/D a tu altitud de crucero (${nf(alt)} ft) o con límites que debes revisar: ${critU.map(e => e.nm).join('; ')}.`
      : `Sin zonas prohibidas, restringidas ni peligrosas en el trazo a ${nf(alt)} ft (comparado con los límites publicados). Revisa igualmente NOTAM y el AIP vigente.`;
    box.append(sum);
    cx.forEach((list, i) => {
      const items = list.map(c => ({ c, e: byId.get(c.id) })).sort((x, y) => SEV.indexOf(x.e.tp) - SEV.indexOf(y.e.tp) || x.c.from - y.c.from);
      const sec = h('div', null, 'rt-air-leg');
      sec.append(h('h4', `Tramo ${i + 1}: ${label(route[i], i)} → ${label(route[i + 1], i + 1)}`));
      if (!items.length) sec.append(h('small', 'Sin espacios aéreos publicados.', 'rt-none'));
      items.forEach(({ c, e }) => {
        const r = rel(e), line = spaceLine(e); line.classList.add('r-' + r);
        const extra = e.tp === 'TMA' ? 'dentro de la TMA' : r === 'in' ? 'a tu altitud' : r === 'below' ? 'bajo el límite inferior' : r === 'above' ? 'sobre el límite superior' : 'revisa los límites (AGL o compuestos)';
        line.querySelector('span').append(h('small', `NM ${nf(c.from, 1)}–${nf(c.to, 1)} del tramo · ${extra}`, 'rt-rel'));
        sec.append(line);
      });
      box.append(sec);
    });
    void pl;
  }

  function renderAll() { renderList(); renderRoute(); renderVrc(); renderPlan(); }

  // ---------- búsqueda ----------
  function bindSearch() {
    const q = $('rt_q'), list = $('rt_list');
    const close = () => { list.hidden = true; list.replaceChildren(); };
    const show = () => {
      const ad = A(); if (!ad || !q.value.trim()) { close(); return; }
      const items = ad.search(q.value, 8).filter(a => a.lat != null);
      list.replaceChildren();
      items.forEach(a => {
        const b = h('button'); b.type = 'button'; b.setAttribute('role', 'option');
        const t = h('div', null, 'adn'); t.append(h('em', a.n), h('small', [a.c, a.t === 'AP' ? 'aeropuerto' : '', ad.alias(a.i) ? 'también «' + ad.alias(a.i) + '»' : ''].filter(Boolean).join(' · ')));
        b.append(h('b', a.i), t, h('span', a.el != null ? nf(a.el) + ' ft' : ''));
        b.addEventListener('click', () => { addAerodrome(a, true); q.value = ''; close(); });
        list.append(b);
      });
      if (!items.length) list.append(h('p', 'Sin coincidencias.', 'hint'));
      list.hidden = false;
    };
    q.addEventListener('input', show);
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { const f = list.querySelector('button'); if (f) f.click(); } else if (e.key === 'Escape') close(); });
    q.addEventListener('blur', () => setTimeout(close, 180));
  }

  function bindUI() {
    bindSearch();
    $('rt_rev').addEventListener('click', () => { route.reverse(); edited(); });
    $('rt_clear').addEventListener('click', () => { if (route.length >= 3 && !confirm('¿Borrar los ' + route.length + ' puntos de la ruta?')) return; route = []; edited(); });
    $('rt_fit').addEventListener('click', () => { if (route.length) fitRoute(); else if (map) map.setView([-33.45, -70.65], 10); });
    $('rt_layers_btn').addEventListener('click', () => { const p = $('rt_layers'); p.hidden = !p.hidden; $('rt_layers_btn').setAttribute('aria-expanded', String(!p.hidden)); });
    const box = $('rt_layer_list');
    GROUPS.forEach(g => {
      const lb = h('label'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.nosave = '1'; cb.checked = groupOn(g.id);
      cb.addEventListener('change', () => { cfg.layers = { ...(cfg.layers || {}), [g.id]: cb.checked }; store.set(LS_MAP, cfg); if (map) applyGroup(g.id); });
      const sw = h('span', null, 'rt-sw'); g.sw.forEach(c => { const i = h('i'); i.style.background = c; sw.append(i); });
      lb.append(cb, sw, document.createTextNode(' ' + g.label)); box.append(lb);
    });
    document.querySelectorAll('input[name="rt_base"]').forEach(r => { r.checked = r.value === (cfg.base || 'osm'); r.addEventListener('change', () => { if (r.checked && map) setBase(r.value); else if (r.checked) { cfg.base = r.value; store.set(LS_MAP, cfg); } }); });
    $('rt_to_wb').addEventListener('click', () => { if (lastPlan) window.APP.applyFuel(lastPlan.galTotal); });
    $('rt_to_fuel').addEventListener('click', () => { const d = decide(); if (d) { window.APP.legacy(d.nm, d.head); window.APP.go('fuel'); } });
    ['ru_wdir', 'ru_wspd', 'ru_var'].forEach(id => $(id).addEventListener('input', () => { if (route.length >= 2) renderPlan(); }));
  }

  // ---------- arranque ----------
  async function loadEsp() {
    try {
      const d = window.ESP_DATA || await (await fetch('data/espacios.json')).json();
      ESP = d.esp || [];
      if (map) { drawSpaces(); Object.keys(groupLayers).forEach(applyGroup); }
      if (route.length >= 2) renderPlan();
    } catch (e) {
      $('rt_hint').textContent = 'No se pudieron cargar los espacios aéreos. Abre la app desde su dirección web o usa la versión de archivo único.';
    }
  }
  async function loadCan() {
    try {
      const d = window.CAN_DATA || await (await fetch('data/canales.json')).json();
      CAN = { items: d.items || [], labels: d.labels || [] };
      if (map) { drawCanales(); Object.keys(groupLayers).forEach(applyGroup); }
      renderVrc();
    } catch (e) { /* sin la capa de rutas visuales; el resto del mapa sigue funcionando */ }
  }
  function init() {
    if (typeof L === 'undefined') { $('rt_hint').textContent = 'No se pudo cargar el mapa (Leaflet).'; return; }
    loadRoute(); bindUI();
    renderList(); renderPlan();
    loadEsp(); loadCan();
    if (A()) A().whenReady(() => {
      adReady = true;
      // sin ruta guardada, parte con el origen y destino que ya elegiste en Inicio
      if (!route.length) {
        const f = A().get($('fl_from').value), t = A().get($('fl_to').value);
        route = [f, t].filter(a => a && a.lat != null).map(ptOf);
        if (route.length) saveRoute();
      }
      if (map) drawAerodromes();
      renderAll();
    });
  }
  window.MAPA = {
    shown() { if (typeof L === 'undefined') return; if (!map) createMap(); else { map.invalidateSize(); if (!fitted) { fitRoute(); fitted = true; } } },
    refresh() { renderPlan(); },
    homeChanged,
  };
  init();
})();
