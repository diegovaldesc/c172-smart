'use strict';
// Aeródromos de Chile (AIP Vol. I): elección de origen y destino en Inicio y carga de datos de pista en la calculadora.
// Los textos vienen del AIP (extracción automática): se insertan siempre con textContent, nunca como HTML.
(function () {
  const M_TO_FT = 3.28084, R_NM = 3440.065;
  const el = id => document.getElementById(id);
  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nf = (n, d = 0) => n.toLocaleString('es', { maximumFractionDigits: d, minimumFractionDigits: d });
  let DB = [], META = {};

  const HOURS = { HJ: 'HJ (de la salida a la puesta del sol)', H24: 'H24 (continuo)' };
  // Pavimentada solo si no aparece también tierra, pasto, ripio, etc. (superficie mixta = se trata como sin pavimentar, lado conservador)
  const hasPaved = s => /(ASPH|asfalt|CONC|hormig|pavim)/i.test(s || '') && !/(tierra|pasto|ripio|maicillo|grava|arena|c[eé]sped|compact|natural)/i.test(s || '');

  // 'from' = origen -> panel de salida (dep); 'to' = destino -> panel de llegada (arr)
  const PANEL = {
    dep: { pick: 'from', saved: 'dep_rwy_sel', elev: 'elev', rwy: 'rwy', len: 'to_len', surf: 'to_surf' },
    arr: { pick: 'to', saved: 'arr_rwy_sel', elev: 'a_elev', rwy: 'a_rwy', len: 'ld_len', surf: 'ld_surf' }
  };
  const PANEL_OF = { from: 'dep', to: 'arr' };

  function make(tag, text, cls) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  const label = a => `${a.i} · ${a.n}`;
  const get = icao => (icao && DB.find(x => x.i === icao)) || null;
  const recalcNow = () => { if (typeof recalc === 'function') recalc(); };

  // ---------- datos ----------
  async function loadDB() {
    if (window.AD_DATA) return window.AD_DATA;
    const r = await fetch('data/aerodromos.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // Regiones de norte a sur (así las busca un piloto) y su nombre corto para las listas
  const REGION_ORDER = ['Arica y Parinacota', 'Tarapacá', 'Antofagasta', 'Atacama', 'Coquimbo', 'Valparaíso', 'Metropolitana de Santiago',
    'Libertador Gral. Bernardo O´Higgins', 'Maule', 'Ñuble', 'Bío Bío', 'La Araucanía', 'Los Ríos', 'Los Lagos',
    'Aysén del Gral. Carlos Ibañez del Campo', 'Magallanes y de la Antártica Chilena'];
  const REGION_SHORT = { 'Metropolitana de Santiago': 'Metropolitana', 'Libertador Gral. Bernardo O´Higgins': 'O’Higgins',
    'Aysén del Gral. Carlos Ibañez del Campo': 'Aysén', 'Magallanes y de la Antártica Chilena': 'Magallanes' };
  const regionRank = r => { const i = REGION_ORDER.indexOf(r); return i < 0 ? 99 : i; };
  const regionName = r => REGION_SHORT[r] || r || 'Sin región';
  const MAX_RESULTS = 60;
  // Nombres con que los pilotos conocen a algunos aeródromos y que el AIP no usa como nombre oficial
  const ALIAS = { SCTB: 'Tobalaba', SCEL: 'Pudahuel' };

  // Búsqueda por código, nombre, ciudad o región; varias palabras = todas deben aparecer (ej. «lago ranco», «araucania pucon»)
  function search(q, limit = MAX_RESULTS) {
    const t = norm(q).trim();
    if (!t) return { items: [], total: 0 };
    const tokens = t.split(/\s+/);
    const scored = [];
    for (const a of DB) {
      const code = norm(a.i), name = norm(a.n), city = norm(a.c), al = norm(ALIAS[a.i]), reg = norm(a.r) + ' ' + norm(regionName(a.r));
      let s = -1;
      if (code === t) s = 0;
      else if (code.startsWith(t)) s = 1;
      else if (name.startsWith(t) || city.startsWith(t) || al.startsWith(t)) s = 2;
      else if (name.includes(t) || city.includes(t) || al.includes(t)) s = 3;
      else if (tokens.every(k => code.includes(k) || name.includes(k) || city.includes(k) || al.includes(k) || reg.includes(k))) s = 4;
      if (s >= 0) scored.push([s, a]);
    }
    scored.sort((x, y) => x[0] - y[0] || x[1].n.localeCompare(y[1].n, 'es'));
    return { items: scored.slice(0, limit).map(x => x[1]), total: scored.length };
  }

  // Todos los aeródromos ordenados de norte a sur por región y luego por nombre (para explorar sin saber el código)
  function browse() {
    return DB.slice().sort((x, y) => regionRank(x.r) - regionRank(y.r) || x.n.localeCompare(y.n, 'es'));
  }

  // Distancia (círculo máximo, NM) y rumbo verdadero inicial entre dos aeródromos
  function route(a, b) {
    if (!a || !b || a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
    const r = Math.PI / 180, p1 = a.lat * r, p2 = b.lat * r, dl = (b.lon - a.lon) * r;
    const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    const nm = 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return { nm, brg: (Math.atan2(y, x) / r + 360) % 360 };
  }

  // ---------- buscadores de Inicio ----------
  // items: aeródromos a mostrar; opts.group = con encabezados por región (modo explorar); opts.note = texto de cabecera
  function renderList(key, items, opts = {}) {
    const box = el(`fl_${key}_list`);
    box.replaceChildren();
    if (opts.note) box.append(make('div', opts.note, 'adnote'));
    if (!items.length) box.append(make('p', 'Sin coincidencias. Prueba con otra parte del nombre, la ciudad o la región.', 'hint'));
    let reg = null;
    for (const a of items) {
      if (opts.group && a.r !== reg) { reg = a.r; box.append(make('div', regionName(reg), 'adgroup')); }
      const b = make('button');
      b.type = 'button';
      b.setAttribute('role', 'option');
      const txt = make('div', null, 'adn');
      const meta = [a.c, opts.group ? '' : regionName(a.r), a.t === 'AP' ? 'aeropuerto' : '', ALIAS[a.i] ? 'también «' + ALIAS[a.i] + '»' : ''].filter(Boolean).join(' · ');
      txt.append(make('em', a.n), make('small', meta));
      b.append(make('b', a.i), txt, make('span', a.el != null ? nf(a.el) + ' ft' : ''));
      b.addEventListener('click', () => { setAerodrome(key, a.i, false); el(`fl_${key}_q`).blur(); });
      box.append(b);
    }
    box.scrollTop = 0;
  }

  // Lo que muestra la lista según lo escrito: sin texto = todos los aeródromos por región; con texto = coincidencias
  function showList(key, text) {
    if (!norm(text).trim()) {
      renderList(key, browse(), { group: true, note: `${DB.length} aeródromos, de norte a sur. Escribe el nombre, la ciudad, la región o el código para acotar.` });
      return;
    }
    const r = search(text);
    renderList(key, r.items, { note: r.total ? (r.total > r.items.length ? `${r.total} coincidencias, se muestran ${r.items.length}. Sigue escribiendo para acotar.` : `${r.total} ${r.total === 1 ? 'coincidencia' : 'coincidencias'}`) : '' });
  }

  function pickInfo(key, a) {
    const p = el(`fl_${key}_info`);
    if (!a) { p.textContent = ''; return; }
    const rw = a.rw.map(r => r.a + (r.b ? '/' + r.b : '')).filter(Boolean).join(', ');
    p.textContent = [a.el != null ? 'Elev. ' + nf(a.el) + ' ft' : '', rw ? 'Pistas ' + rw : '', a.q ? '' : '⚠ datos incompletos, verifica en el AIP'].filter(Boolean).join(' · ');
  }

  function setAerodrome(key, icao, restore) {
    const a = get(icao);
    el('fl_' + key).value = a ? a.i : '';
    el(`fl_${key}_q`).value = a ? label(a) : '';
    el(`fl_${key}_list`).replaceChildren();
    el(`fl_${key}_clear`).hidden = !a;
    pickInfo(key, a);
    renderPanel(PANEL_OF[key], a, restore);
    if (!restore) {
      // con origen y destino, la distancia de la ruta pasa al planificador de combustible
      const rt = route(get(el('fl_from').value), get(el('fl_to').value));
      if (rt) el('r_dist').value = Math.ceil(rt.nm);
      recalcNow();
    }
  }

  function swap() {
    const f = el('fl_from').value, t = el('fl_to').value;
    setAerodrome('from', t, false);
    setAerodrome('to', f, false);
  }

  function bindPicker(key) {
    const q = el(`fl_${key}_q`), list = el(`fl_${key}_list`);
    const picker = q.closest('.picker');
    const current = () => { const a = get(el('fl_' + key).value); return a ? label(a) : ''; };
    q.addEventListener('focus', () => {
      q.select();
      // con la selección actual (o vacío) se explora toda la lista; si ya hay texto distinto, se busca con él
      showList(key, q.value === current() ? '' : q.value);
      // en el celular, sube el campo para que la lista de resultados no quede tapada por el teclado ni por la barra inferior
      setTimeout(() => picker.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120);
    });
    q.addEventListener('input', () => showList(key, q.value));
    q.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const f = list.querySelector('button'); if (f) f.click(); e.preventDefault(); }
      else if (e.key === 'Escape') q.blur();
      else if (e.key === 'ArrowDown') { const f = list.querySelector('button'); if (f) { f.focus(); e.preventDefault(); } }
    });
    // navegación con flechas dentro de la lista
    list.addEventListener('keydown', e => {
      const btns = [...list.querySelectorAll('button')], i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && i >= 0) { (btns[i + 1] || btns[i]).focus(); e.preventDefault(); }
      else if (e.key === 'ArrowUp' && i >= 0) { (i ? btns[i - 1] : q).focus(); e.preventDefault(); }
      else if (e.key === 'Escape') { q.focus(); q.blur(); }
    });
    // al salir del campo y de la lista sin elegir, vuelve a mostrarse la selección actual
    const leave = () => setTimeout(() => {
      if (picker.contains(document.activeElement)) return;
      list.replaceChildren();
      q.value = current();
    }, 250);
    q.addEventListener('blur', leave);
    list.addEventListener('focusout', leave);
    // mousedown en la lista no debe quitar el foco al campo (permite desplazar la lista con el mouse sin cerrarla)
    list.addEventListener('mousedown', e => { if (!e.target.closest('button')) e.preventDefault(); });
    el(`fl_${key}_clear`).addEventListener('click', () => setAerodrome(key, '', false));
  }

  // ---------- paneles de pista (Performance > Salida / Llegada) ----------
  function runwayOptions(p, a) {
    const sel = el(p + '_rwy');
    sel.replaceChildren();
    a.rw.forEach((r, idx) => {
      ['a', 'b'].forEach(end => {
        const des = r[end];
        if (!des) return;
        const size = r.l ? ` · ${nf(r.l)} × ${r.w || '?'} m` : ' · largo sin dato';
        const o = make('option', `Pista ${des}${size}`);
        o.value = idx + ':' + end;
        sel.append(o);
      });
    });
    if (!sel.options.length) sel.append(make('option', 'Sin pistas en la base'));
  }

  function renderPanel(p, a, restore) {
    const cfg = PANEL[p];
    el(p + '_empty').hidden = !!a;
    el(p + '_info').hidden = !a;
    if (!a) { el(cfg.saved).value = ''; return; }
    el(p + '_code').textContent = a.i;
    el(p + '_name').textContent = a.n + (a.c ? ' · ' + a.c : '');
    runwayOptions(p, a);
    const sel = el(p + '_rwy'), saved = el(cfg.saved).value;
    if (restore && saved && [...sel.options].some(o => o.value === saved)) sel.value = saved; else sel.selectedIndex = 0;
    renderData(p, a);
    if (restore) el(p + '_apply').textContent = 'Los datos del cálculo son los de la última vez. Usa «Cargar en el cálculo» para traerlos de nuevo desde la base.';
    else applyPanel(p);
  }

  function renderData(p, a) {
    const dl = el(p + '_data');
    dl.replaceChildren();
    const row = (k, v) => { if (v == null || v === '') return; dl.append(make('dt', k), make('dd', v)); };
    row('Aeródromo', `${a.i} · ${a.n} (${a.t === 'AP' ? 'aeropuerto' : 'aeródromo'})`);
    row('Ubicación', [a.c, a.r].filter(Boolean).join(', '));
    if (a.lat != null && a.lon != null) row('Coordenadas', `${nf(Math.abs(a.lat), 4)}° ${a.lat < 0 ? 'S' : 'N'}, ${nf(Math.abs(a.lon), 4)}° ${a.lon < 0 ? 'W' : 'E'}`);
    if (a.el != null) row('Elevación', `${nf(a.el)} ft (${nf(a.el * 0.3048)} m)`);
    row('Pistas', a.rw.map(r => `${r.a}${r.b ? '/' + r.b : ''}${r.l ? ' · ' + nf(r.l) + ' × ' + (r.w || '?') + ' m (' + nf(r.l * M_TO_FT) + ' ft)' : ' · largo sin dato'}`).join('\n'));
    row('Superficie', a.sf);
    if (a.pc) row('Resistencia', /kg/i.test(a.pc) ? `Peso máx. de aeronave ${a.pc}` : a.pc);
    if (a.lg) row('Iluminación', a.lg === 'NIL' ? 'Sin iluminación (NIL)' : a.lg);
    row('Servicios', a.sv);
    row('Horario', a.hr ? (HOURS[a.hr] || a.hr) : '');
    row('Fuente', `AIP Chile Vol. I · ${a.src === 'AD 2' ? 'AD 2' : 'AD 3'} · vigencia ${META.vigencia || ''}`);
    dl.querySelectorAll('dd').forEach(d => { d.style.whiteSpace = 'pre-line'; });

    const w = el(p + '_warn');
    w.replaceChildren();
    const msg = (t, c) => w.append(make('div', t, 'msg ' + c));
    if (!a.q) msg('Registro con campos incompletos o dudosos en la extracción automática. Verifica en el AIP antes de usarlo.', 'warn');
    if (a.src === 'AD 2') msg('Aeropuerto con ficha AD 2: frecuencias, distancias declaradas y pistas múltiples, consúltalas en el AIP.', 'warn');
    msg('El largo cargado es el largo físico de la pista. Para el cálculo usa las distancias declaradas (TORA/LDA) del AIP si son menores.', 'warn');
  }

  // Lleva elevación, pista, largo y superficie del aeródromo elegido a los campos de la calculadora
  function applyPanel(p) {
    const cfg = PANEL[p], a = get(el('fl_' + cfg.pick).value);
    if (!a) return;
    const sel = el(p + '_rwy');
    const [idx, end] = (sel.value || '0:a').split(':');
    const r = a.rw[+idx] || {};
    const des = r[end] || '';
    const done = [], missing = [];
    // Lo que el aeródromo no trae se deja en blanco: nunca debe quedar el valor de la pista o aeródromo anterior.
    [cfg.elev, cfg.rwy, cfg.len].forEach(id => { el(id).value = ''; });
    if (a.el != null) { el(cfg.elev).value = Math.round(a.el); done.push(`elevación ${nf(a.el)} ft`); } else missing.push('elevación');
    const num = parseInt(des, 10);
    if (num >= 1 && num <= 36) { el(cfg.rwy).value = num; done.push(`pista ${des}`); } else missing.push('número de pista');
    if (r.l) { el(cfg.len).value = Math.round(r.l * M_TO_FT); done.push(`largo ${nf(Math.round(r.l * M_TO_FT))} ft`); } else missing.push('largo');
    const surface = r.sf || a.sf;
    const surfIdx = hasPaved(surface) ? 0 : (surface ? 2 : -1);
    if (surfIdx >= 0) {
      el(cfg.surf).selectedIndex = surfIdx;
      done.push(surfIdx === 0 ? 'superficie pavimentada' : 'superficie sin pavimentar o mixta (se usa la corrección de pasto seco como aproximación; revisa la superficie)');
    } else {
      el(cfg.surf).selectedIndex = 0;
      missing.push('superficie (revisa la corrección elegida)');
    }
    el(p + '_apply').textContent = (done.length ? 'Cargado en el cálculo: ' + done.join(', ') + '.' : 'No había datos para cargar.')
      + (missing.length ? ' Sin dato: ' + missing.join(', ') + '. Complétalo a mano.' : '');
    el(cfg.saved).value = sel.value;
  }

  // ---------- arranque ----------
  window.AD = { get, route, search: (q, n) => search(q, n).items, searchAll: search, browse };

  async function init() {
    const status = el('ad_status');
    try {
      const data = await loadDB();
      DB = data.ad; META = data;
      status.textContent = `${DB.length} aeródromos · AIP Chile Vol. I (vigencia ${data.vigencia}). Datos extraídos automáticamente: verifica con el AIP vigente.`;
    } catch (e) {
      status.textContent = 'No se pudo cargar la base de aeródromos. Abre la app desde su dirección web o usa la versión de archivo único.';
      el('fl_from_q').disabled = true; el('fl_to_q').disabled = true;
      return;
    }
    ['from', 'to'].forEach(bindPicker);
    el('fl_swap').addEventListener('click', swap);
    ['dep', 'arr'].forEach(p => {
      el(p + '_rwy').addEventListener('change', () => { applyPanel(p); recalcNow(); });
      el(p + '_load').addEventListener('click', () => { applyPanel(p); recalcNow(); });
    });
    // restaurar el vuelo anterior sin pisar los datos que ya estaban en la calculadora
    ['from', 'to'].forEach(key => {
      const v = el('fl_' + key).value;
      if (v && get(v)) setAerodrome(key, v, true); else el('fl_' + key).value = '';
    });
    recalcNow();
  }
  init();
})();
