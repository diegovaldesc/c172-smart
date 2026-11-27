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

  let CAN = { items: [], labels: [] }, RV = { puntos: {}, rutas: [] };
  let map = null, ESP = [], adReady = false, route = [], cfg = store.get(LS_MAP, { layers: {}, base: 'osm' });
  let baseLayer = null, groupLayers = {}, adMarkers = [], routeLine = null, routeHalo = null, ptMarkers = [], legMarkers = [], tapPopup = null, fitted = false;

  // ---------- ruta ----------
  const label = (p, i) => p.i || p.w || ('P' + (i + 1));          // i = aeródromo; w = punto geográfico publicado en el AIP (ENR 7.7)
  const ptOf = a => ({ lat: a.lat, lon: a.lon, i: a.i, n: a.n });
  const A = () => window.AD;
  function fmtLL(p) {
    const f = (v, pos, neg, w) => { const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60; return String(d).padStart(w, '0') + '°' + nf(m, 1).padStart(4, '0') + '′' + (v < 0 ? neg : pos); };
    return f(p.lat, 'N', 'S', 2) + ' ' + f(p.lon, 'E', 'W', 3);
  }
  function loadRoute() {
    const raw = store.get(LS_ROUTE, []);
    route = (Array.isArray(raw) ? raw : []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(p => ({ lat: p.lat, lon: p.lon, ...(p.i ? { i: String(p.i), n: p.n ? String(p.n) : '' } : p.w ? { w: String(p.w) } : {}) }));
  }
  const saveRoute = () => store.set(LS_ROUTE, route);

  // Cada cambio hecho por el usuario: guarda, repinta y recalcula todo (el origen y el destino de la ruta son los de Despegue y aterrizaje)
  function syncEnds() {
    const ad = A();
    if (!ad || !ad.setEnds) return;
    const f = route[0], t = route.length > 1 ? route[route.length - 1] : null;
    ad.setEnds(f && f.i ? f.i : '', t && t.i ? t.i : '');     // '' = ese extremo no es un aeródromo (se limpia el panel)
  }
  function edited() {
    saveRoute();
    syncEnds();
    renderAll();
    if (window.APP) window.APP.recalc();
  }
  function add(p, at) {
    if (at == null || at >= route.length) route.push(p); else route.splice(at, 0, p);
    edited();
  }
  function addAerodrome(a, fly) {
    if (a.lat == null || a.lon == null) return;
    add(ptOf(a));
    if (fly && map) map.panTo([a.lat, a.lon]);
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
    // puntos geográficos publicados en ENR 7.7 (coordenadas del AIP)
    for (const [k, p] of Object.entries(RV.puntos)) {
      const el = h('span', null, 'rt-pp'); el.append(h('i'), document.createTextNode(p.n));
      const m = L.marker([p.lat, p.lon], { pane: 'vrc', keyboard: false, title: p.n, icon: L.divIcon({ className: 'rt-ppw', html: el, iconSize: [0, 0] }) });
      m.bindPopup(() => {
        const d = h('div', null, 'rt-pop');
        d.append(h('b', `${p.n} (punto ${k})`), h('small', p.d), h('small', p.dms), h('small', 'Punto geográfico publicado en AIP Vol. I, ENR 7.7.', 'rt-spn'));
        const b = h('button', '+ Agregar a la ruta', 'rt-pbtn'); b.type = 'button';
        b.addEventListener('click', () => { add({ lat: p.lat, lon: p.lon, w: p.n }); map.closePopup(); });
        d.append(b); return d;
      }, { maxWidth: 280, className: 'rt-popup' });
      g.addLayer(m);
    }
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
    edited(); showRoute();
  }
  // Desde Información: lleva a la pestaña Ruta y encuadra la ruta nueva
  function showRoute() { if (window.APP) window.APP.go('ruta'); fitRoute(); }
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
        if (window.APP) window.APP.go('ruta');                       // el mapa está en la pestaña Ruta
        if (!map) return;
        cfg.layers = { ...(cfg.layers || {}), vrc: true }; store.set(LS_MAP, cfg); applyGroup('vrc');
        const ln = vrcLayers[it.id]; if (ln) { map.fitBounds(ln.getBounds(), { padding: [50, 50], maxZoom: 13 }); ln.openPopup(ln.getBounds().getCenter()); }
      });
      use.addEventListener('click', () => useVrc(it));
      row.append(dot, tx, view, use); box.append(row);
    });
  }

  // ---------- texto de las rutas visuales del AIP (ENR 7.1 a 7.8) ----------
  const inRange = (b, r) => r[0] <= r[1] ? b >= r[0] && b <= r[1] : b >= r[0] || b <= r[1];
  const rvPoint = id => { const p = RV.puntos[id]; return { lat: p.lat, lon: p.lon, w: p.n }; };
  // Los puntos con coordenadas publicadas entran a la ruta: las salidas justo después del origen, las llegadas justo antes del destino
  function useRv(r) {
    const pts = r.pts.map(rvPoint);
    if (r.tp === 'L' && route.length >= 2) route.splice(route.length - 1, 0, ...pts);
    else if (r.tp === 'S' && route.length >= 1) route.splice(1, 0, ...pts);
    else route.push(...pts);
    edited(); showRoute();
  }
  function rvItem(r, sug, to) {
    const d = h('details', null, 'rt-rvi' + (sug ? ' sug' : '')); d.open = !!sug;
    const s = h('summary'); s.append(h('b', r.grupo + (r.titulo ? ' · ' + r.titulo : '')));
    if (sug) s.append(h('em', 'según el rumbo de tu ruta'));
    d.append(s);
    d.append(h('p', r.texto, 'rt-rvt'));
    if (r.com) { const p = h('p', null, 'rt-rvc'); p.append(h('b', 'Comunicaciones: '), document.createTextNode(r.com)); d.append(p); }
    (r.notas || []).forEach(t => d.append(h('p', t, 'rt-rvn')));
    if (r.pts) {
      const p = h('p', null, 'rt-rvp'); p.append(h('b', 'Puntos publicados: '), document.createTextNode(r.pts.map(k => RV.puntos[k].n).join(' → ')));
      d.append(p);
      const b = h('button', to === 'L' ? 'Agregar los puntos antes del destino' : 'Agregar los puntos después del origen', 'rt-pbtn'); b.type = 'button';
      b.addEventListener('click', () => useRv(r)); d.append(b);
      d.append(h('small', 'El tramo hasta el primer punto sigue una ruta descrita por referencias de terreno (sin coordenadas): en el mapa queda en línea recta; ajústalo con puntos propios.', 'rt-rvw'));
    }
    d.append(h('small', `AIP Vol. I, ${r.ref} · edición ${r.fecha}`, 'rt-rvf'));
    return d;
  }
  function renderRv() {
    const box = $('rt_rv'); if (!box) return;
    box.replaceChildren();
    const o = route.length ? route[0].i : null, dst = route.length > 1 ? route[route.length - 1].i : null;
    const seen = r => (r.tp === 'S' && o && r.ads.includes(o)) || (r.tp === 'L' && dst && r.ads.includes(dst)) || ((r.tp === 'X' || r.tp === 'N') && ((o && r.ads.includes(o)) || (dst && r.ads.includes(dst))));
    const list = RV.rutas.filter(seen);
    box.hidden = !list.length; if (!list.length) return;
    const outB = route.length > 1 ? R.inv(route[0], route[1]).brg : null, inB = route.length > 1 ? R.inv(route[route.length - 1], route[route.length - 2]).brg : null;
    box.append(h('h3', 'Rutas visuales publicadas en el AIP (ENR 7)', 'subhead'));
    box.append(h('p', 'Texto del AIP tal como se publica: rutas por referencias de terreno, altitudes y comunicaciones. Si tu ruta sale o llega por un rumbo que coincide con alguna, la abro. El AIP vigente y el NOTAM mandan.', 'hint'));
    const group = (title, items, tp) => {
      if (!items.length) return;
      box.append(h('h4', title, 'rt-rvh'));
      const flag = r => !!(r.rng && (tp === 'S' ? outB : tp === 'L' ? inB : null) != null && inRange(tp === 'S' ? outB : inB, r.rng));
      items.slice().sort((a, b) => flag(b) - flag(a)).forEach(r => box.append(rvItem(r, flag(r), tp)));
    };
    group(`Salidas desde ${o}${outB != null ? ` · tu ruta sale hacia ${pad3(outB)}° verdadero` : ''}`, list.filter(r => r.tp === 'S'), 'S');
    group(`Llegadas a ${dst}${inB != null ? ` · tu ruta llega desde ${pad3(inB)}° verdadero` : ''}`, list.filter(r => r.tp === 'L'), 'L');
    group('Cruce de la ciudad y avisos', list.filter(r => r.tp === 'X' || r.tp === 'N'), 'X');
  }
  async function loadRv() {
    try {
      const d = window.RV_DATA || await (await fetch('data/rutas_visuales.json')).json();
      RV = { puntos: d.puntos || {}, rutas: d.rutas || [] };
      if (map) { drawCanales(); Object.keys(groupLayers).forEach(applyGroup); }
      renderRv();
    } catch (e) { /* sin los textos de ENR 7; el resto sigue funcionando */ }
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
      const fixed = !!(p.i || p.w);                                   // aeródromos y puntos del AIP no se arrastran
      const m = L.marker([p.lat, p.lon], { icon: numIcon(i, label(p, i), !fixed), draggable: !fixed, pane: 'rutaPane', zIndexOffset: 1000, keyboard: false, title: label(p, i) });
      if (!fixed) {
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
      t.append(h('em', p.i ? `${p.i} · ${ad ? ad.n : (p.n || '')}` : p.w ? `${p.w} · punto publicado (AIP ENR 7.7)` : 'Punto en el mapa'),h('small', i === 0 ? 'Origen' + (route.length > 1 ? '' : '') : i === route.length - 1 ? 'Destino' : 'Punto intermedio'));
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
  // ---------- resumen de la ruta y avisos ----------
  // Espacios que cruza la ruta: es un cálculo pesado, así que se guarda mientras no cambien ruta, altitud ni datos
  let airCache = { key: '', val: null };
  function airAnalysis() {
    const alt = window.APP ? window.APP.altitude() : 0;
    const key = JSON.stringify(route) + '|' + alt + '|' + ESP.length;
    if (airCache.key === key) return airCache.val;
    let val = null;
    if (route.length >= 2 && ESP.length) {
      const cx = R.crossings(route, ESP), byId = new Map(ESP.map(e => [e.id, e])), rel = e => R.altRelation(e, alt), crit = [];
      cx.forEach(list => list.forEach(c => { const e = byId.get(c.id); if (['P', 'R', 'D'].includes(e.tp) && rel(e) !== 'below' && rel(e) !== 'above') crit.push(e); }));
      val = { cx, byId, rel, alt, critU: [...new Map(crit.map(e => [e.id, e])).values()] };
    }
    airCache = { key, val };
    return val;
  }
  const critText = a => a.critU.length
    ? `Tu ruta cruza ${a.critU.length === 1 ? 'una zona' : a.critU.length + ' zonas'} prohibida, restringida o peligrosa a tu altitud de crucero (${nf(a.alt)} ft) o con límites que debes revisar: ${a.critU.map(e => e.nm).join('; ')}.`
    : `Sin zonas prohibidas, restringidas ni peligrosas en el trazo a ${nf(a.alt)} ft (comparado con los límites publicados). Revisa igualmente NOTAM y el AIP vigente.`;
  const critCls = a => 'msg ' + (a.critU.some(e => e.tp === 'P') ? 'bad' : a.critU.length ? 'warn' : 'ok');

  function renderSummary() {
    const sum = $('rt_sum'), box = $('rt_alerts');
    box.replaceChildren(); sum.replaceChildren(); sum.hidden = route.length < 2;
    renderAir();
    if (route.length < 2) return;
    const APP = window.APP, nm = R.legsOf(route).reduce((s, l) => s + l.nm, 0), T = APP && APP.trip();
    const item = (v, l) => { const d = h('div'); d.append(h('b', v), h('span', l)); return d; };
    sum.append(item(nf(nm) + ' NM', route.length === 2 ? '1 tramo' : (route.length - 1) + ' tramos'));
    if (T && T.pl) sum.append(item(APP.hm(T.flightMin / 60), 'de vuelo'), item(APP.dF(T.total), 'a cargar, con reserva'));
    if (!ESP.length) { box.append(h('p', 'Cargando espacios aéreos…', 'hint')); return; }
    const a = airAnalysis(); if (!a) return;
    const m = h('div', critText(a) + ' ', critCls(a)), b = h('button', 'Ver el detalle', 'linkbtn'); b.type = 'button';
    b.addEventListener('click', () => { if (APP) APP.go('info', 'air'); });
    m.append(b); box.append(m);
  }

  // Detalle por tramo (Información adicional > Espacios aéreos)
  function renderAir() {
    const box = $('rt_air'); box.replaceChildren();
    if (route.length < 2) { box.append(h('p', 'Arma una ruta con al menos dos puntos para ver los espacios aéreos que cruza.', 'hint')); return; }
    if (!ESP.length) { box.append(h('p', 'Cargando espacios aéreos…', 'hint')); return; }
    const a = airAnalysis(); if (!a) return;
    const { cx, byId, rel } = a;
    box.append(h('div', critText(a), critCls(a)));
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
  }

  function renderAll() {
    renderList(); renderRoute(); renderVrc(); renderRv(); renderSummary();
    $('rv_empty').hidden = !$('rt_vrc').hidden || !$('rt_rv').hidden;
  }

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
    let closing = 0;   // el cierre diferido del blur no debe cerrar una lista que se reabrió al volver a escribir
    q.addEventListener('blur', () => { closing = setTimeout(close, 180); });
    q.addEventListener('focus', () => clearTimeout(closing));
    q.addEventListener('input', () => clearTimeout(closing));
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
  }

  // ---------- arranque ----------
  async function loadEsp() {
    try {
      const d = window.ESP_DATA || await (await fetch('data/espacios.json')).json();
      ESP = d.esp || [];
      if (map) { drawSpaces(); Object.keys(groupLayers).forEach(applyGroup); }
      renderSummary();
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
    document.addEventListener('c172:calc', () => renderSummary());      // cada recálculo (combustible, altitud) actualiza el resumen y los avisos
    renderList(); renderSummary();
    loadEsp(); loadCan(); loadRv();
    if (A()) A().whenReady(() => {
      adReady = true;
      if (map) drawAerodromes();
      syncEnds();                                   // el origen y el destino de la ruta guardada son los de Despegue y aterrizaje
      renderAll();
      if (window.APP) window.APP.recalc();
    });
    if (window.APP) window.APP.recalc();           // la ruta guardada ya está cargada: calcular aunque la base de aeródromos tarde o falle
    if (document.body.dataset.view === 'ruta') window.MAPA.shown();   // la ruta es el primer paso: el mapa ya está a la vista al abrir la app
  }
  window.MAPA = {
    shown() { if (typeof L === 'undefined') return; if (!map) createMap(); else { map.invalidateSize(); if (!fitted) { fitRoute(); fitted = true; } } },
    refresh() { renderSummary(); },
    route: () => route,
    labelOf: label,
    // Para la bitácora: zonas P/R/D a la altitud de crucero y espacios controlados que cruza la ruta
    air() {
      const a = airAnalysis(); if (!a) return null;
      const seen = new Map();
      a.cx.forEach(list => list.forEach(c => { const e = a.byId.get(c.id); if (['C', 'CTR', 'ATZ', 'TMA'].includes(e.tp) && !seen.has(e.id)) seen.set(e.id, { nm: e.nm, tp: e.tp, lim: limTxt(e) }); }));
      return { critU: a.critU, alt: a.alt, ctl: [...seen.values()].sort((x, y) => SEV.indexOf(x.tp) - SEV.indexOf(y.tp)) };
    },
  };
  init();
})();
