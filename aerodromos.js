'use strict';
// Aeródromos de Chile (AIP Vol. I): búsqueda, datos de pista para Despegue y aterrizaje, y ficha completa en «Información adicional».
// El origen y el destino los fija la ruta (mapa.js, vía setEnds). Los textos vienen del AIP (extracción automática):
// se insertan siempre con textContent, nunca como HTML.
(function () {
  const M_TO_FT = 3.28084, R_NM = 3440.065;
  const el = id => document.getElementById(id);
  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nf = (n, d = 0) => n.toLocaleString('es', { maximumFractionDigits: d, minimumFractionDigits: d });
  let DB = [], META = {};

  const HOURS = { HJ: 'HJ (de la salida a la puesta del sol)', H24: 'H24 (continuo)' };
  const USO = { PUB: 'Público', PVT: 'Privado (requiere autorización del administrador)', MIL: 'Militar (requiere autorización)', 'PUB/MIL': 'Público y militar' };
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

  // ---------- buscador de aeródromos (alterno e Información) ----------
  // cfg: { q, list, clear?, get: () => icao actual, set: icao => void }
  function renderList(cfg, items, opts = {}) {
    const box = el(cfg.list);
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
      b.addEventListener('click', () => { cfg.set(a.i); el(cfg.q).blur(); });
      box.append(b);
    }
    box.scrollTop = 0;
  }
  // Lo que muestra la lista según lo escrito: sin texto = todos los aeródromos por región; con texto = coincidencias
  function showList(cfg, text) {
    if (!norm(text).trim()) {
      renderList(cfg, browse(), { group: true, note: `${DB.length} aeródromos, de norte a sur. Escribe el nombre, la ciudad, la región o el código para acotar.` });
      return;
    }
    const r = search(text);
    renderList(cfg, r.items, { note: r.total ? (r.total > r.items.length ? `${r.total} coincidencias, se muestran ${r.items.length}. Sigue escribiendo para acotar.` : `${r.total} ${r.total === 1 ? 'coincidencia' : 'coincidencias'}`) : '' });
  }
  function bindPicker(cfg) {
    const q = el(cfg.q), list = el(cfg.list), picker = q.closest('.picker');
    const current = () => { const a = get(cfg.get()); return a ? label(a) : ''; };
    q.addEventListener('focus', () => {
      q.select();
      showList(cfg, q.value === current() ? '' : q.value);
      // en el celular, sube el campo para que la lista de resultados no quede tapada por el teclado ni por la barra inferior
      setTimeout(() => picker.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120);
    });
    q.addEventListener('input', () => showList(cfg, q.value));
    q.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const f = list.querySelector('button'); if (f) f.click(); e.preventDefault(); }
      else if (e.key === 'Escape') q.blur();
      else if (e.key === 'ArrowDown') { const f = list.querySelector('button'); if (f) { f.focus(); e.preventDefault(); } }
    });
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
    list.addEventListener('mousedown', e => { if (!e.target.closest('button')) e.preventDefault(); });
    if (cfg.clear) el(cfg.clear).addEventListener('click', () => cfg.set(''));
  }

  // ---------- origen y destino (los fija la ruta) ----------
  function setAerodrome(key, icao, restore) {
    const a = get(icao);
    el('fl_' + key).value = a ? a.i : '';
    renderPanel(PANEL_OF[key], a, restore);
    if (!restore) recalcNow();
  }
  // Origen y destino desde la ruta. undefined/null = sin cambio; '' = sin aeródromo (se limpia el panel).
  function setEnds(from, to) {
    const apply = (key, v) => { if (v === undefined || v === null) return; const id = v && get(v) ? v : ''; if (el('fl_' + key).value !== id) setAerodrome(key, id, false); };
    apply('from', from); apply('to', to);
  }

  // ---------- alterno ----------
  function setAlternate(icao, restore) {
    const a = get(icao);
    el('alt_icao').value = a ? a.i : '';
    el('alt_q').value = a ? label(a) : '';
    el('alt_list').replaceChildren();
    el('alt_clear').hidden = !a;
    const info = el('alt_info');
    info.textContent = a ? [a.el != null ? 'Elev. ' + nf(a.el) + ' ft' : '', a.rw.map(r => r.a + (r.b ? '/' + r.b : '')).filter(Boolean).join(', '), a.lat == null ? '⚠ sin coordenadas: no se puede calcular' : ''].filter(Boolean).join(' · ') : '';
    if (!restore) recalcNow();
  }

  // ---------- paneles de pista (Despegue y aterrizaje > Salida / Llegada) ----------
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
    renderEssential(p, a);
    if (restore) el(p + '_apply').textContent = 'Los datos de pista son los de la última vez; cámbialos a mano o elige otra pista para traerlos de nuevo del AIP.';
    else applyPanel(p);
  }

  // ENR 4.1: servicios y frecuencias, agrupados por servicio
  const SVN = { TWR: 'Torre (TWR)', GND: 'Control terrestre (GND)', APP: 'Aproximación (APP)', RDR: 'Radar', ACC: 'Control de área (ACC)', AFIS: 'AFIS (información)', ATIS: 'ATIS', FSS: 'FSS', TIBA: 'TIBA (radiodifusión de tránsito)', DLVRY: 'Autorizaciones (DLVRY)', 'G/A/G': 'Aire-tierra (G/A/G)' };
  const FNOTE = { PRI: 'principal', SCDRY: 'secundaria', EMERG: 'emergencia', ALTN: 'alterna' };
  function freqText(a) {
    if (!a.fq || !a.fq.length) return '';
    const g = new Map();
    a.fq.forEach(([s, f, n]) => {
      if (!g.has(s)) g.set(s, []);
      g.get(s).push(f + (n ? ' (' + (FNOTE[n.toUpperCase()] || n) + ')' : ''));
    });
    return [...g].map(([s, fs]) => `${SVN[s] || s}: ${fs.join(' · ')} MHz`).join('\n');
  }
  // Las frecuencias que un piloto usa al salir o llegar, en una línea: «TWR 118,1 · GND 121,9 · ATIS 127,25»
  const FQ_ORDER = ['TWR', 'GND', 'ATIS', 'APP', 'AFIS', 'TIBA', 'DLVRY'];
  function freqShort(a, only) {
    if (!a || !a.fq || !a.fq.length) return '';
    const out = [];
    FQ_ORDER.forEach(s => {
      if (only && !only.includes(s)) return;
      const fs = a.fq.filter(f => f[0] === s && !/EMERG/i.test(f[2] || '')).map(f => f[1]);
      if (fs.length) out.push(`${s} ${fs.slice(0, 2).join(' / ')}`);
    });
    return out.join(' · ');
  }
  function atzText(a) {
    const z = a.atz;
    if (!z) return '';
    const r = nf(z.nm, z.nm % 1 ? 1 : 0);
    const alt = z.top ? ', desde el suelo hasta ' + z.top : '';
    return z.parcial ? `Forma parcial (semicírculo o con corte) de ${r} NM de radio${alt}. Lee la geometría exacta en las notas del AIP.` : `Radio ${r} NM${alt}`;
  }

  const runwaysText = a => a.rw.map(r => `${r.a}${r.b ? '/' + r.b : ''}${r.l ? ' · ' + nf(r.l) + ' × ' + (r.w || '?') + ' m (' + nf(r.l * M_TO_FT) + ' ft)' : ' · largo sin dato'}`).join('\n');
  const fill = (dl, rows) => {
    dl.replaceChildren();
    rows.forEach(([k, v]) => { if (v == null || v === '') return; dl.append(make('dt', k), make('dd', v)); });
    dl.querySelectorAll('dd').forEach(d => { d.style.whiteSpace = 'pre-line'; });
  };
  const warnBox = (box, list) => { box.replaceChildren(); list.forEach(([t, c]) => box.append(make('div', t, 'msg ' + c))); };

  // Lo esencial de un aeródromo para Despegue y aterrizaje: dónde está, pistas, frecuencias y horario
  function renderEssential(p, a) {
    fill(el(p + '_data'), [
      ['Elevación', a.el != null ? `${nf(a.el)} ft` : ''],
      ['Pistas', runwaysText(a)],
      ['Superficie', a.sf],
      ['Frecuencias', freqShort(a)],
      ['Horario', a.hr ? (((HOURS[a.hr] || a.hr).length <= 28) ? (HOURS[a.hr] || a.hr) : 'Con restricciones: míralo en «Ver todos los datos»') : '']
    ]);
    const w = [];
    if (a.uso === 'PVT') w.push(['Aeródromo privado: pide autorización al administrador antes de operar.', 'warn']);
    if (a.uso === 'MIL') w.push(['Aeródromo militar: requiere autorización de la unidad.', 'warn']);
    if (!a.fq) w.push(['Sin torre, AFIS ni frecuencia publicados en ENR 4.1: revisa la frecuencia de la zona antes de operar.', 'warn']);
    if (!a.q) w.push(['Datos incompletos o dudosos en la extracción automática: verifica en el AIP.', 'warn']);
    w.push(['El largo es el físico de la pista. Si el AIP publica TORA/LDA menores, usa esos.', 'warn']);
    warnBox(el(p + '_warn'), w);
  }

  // Ficha completa (Información adicional)
  function renderFull(a) {
    el('info_card').hidden = !a;
    if (!a) return;
    el('info_code').textContent = a.i;
    el('info_name').textContent = a.n + (a.c ? ' · ' + a.c : '');
    fill(el('info_data'), [
      ['Aeródromo', `${a.i} · ${a.n} (${a.t === 'AP' ? 'aeropuerto' : 'aeródromo'})`],
      ['Ubicación', [a.c, a.r].filter(Boolean).join(', ')],
      ['Coordenadas', a.lat != null && a.lon != null ? `${nf(Math.abs(a.lat), 4)}° ${a.lat < 0 ? 'S' : 'N'}, ${nf(Math.abs(a.lon), 4)}° ${a.lon < 0 ? 'W' : 'E'}` : ''],
      ['Elevación', a.el != null ? `${nf(a.el)} ft (${nf(a.el * 0.3048)} m)` : ''],
      ['Pistas', runwaysText(a)],
      ['Superficie', a.sf],
      ['Resistencia', a.pc ? (/kg/i.test(a.pc) ? `Peso máx. de aeronave ${a.pc}` : a.pc) : ''],
      ['Iluminación', a.lg ? (a.lg === 'NIL' ? 'Sin iluminación (NIL)' : a.lg) : ''],
      ['Servicios', a.sv],
      ['Frecuencias', freqText(a)],
      ['Radioayudas', (a.nv || []).map(n => `${n[0]}${n[1] ? ' ' + n[1] : ''} · ${n[2]} MHz`).join('\n')],
      ['Zona de tránsito (ATZ)', atzText(a)],
      ['Horario', a.hr ? (HOURS[a.hr] || a.hr) : ''],
      ['Uso', USO[a.uso] || ''],
      ['Cómo llegar', a.loc],
      ['Observaciones del AIP', a.ob],
      ['Notas ENR 4.1 (horarios, ATZ/CTR)', a.nt],
      ['Fuente', `AIP Chile Vol. I · ${a.src === 'AD 2' ? 'AD 2' : 'AD 3'} · vigencia ${META.vigencia || ''}`]
    ]);
    const w = [];
    (a.fix || []).forEach(t => w.push([t, 'warn']));
    if (a.ap) w.push(['El AIP marca estas coordenadas como aproximadas (*).', 'warn']);
    if (a.uso === 'PVT') w.push(['Aeródromo privado: pide autorización al administrador antes de operar.', 'warn']);
    if (a.uso === 'MIL') w.push(['Aeródromo militar: requiere autorización de la unidad.', 'warn']);
    if (!a.q) w.push(['Registro con campos incompletos o dudosos en la extracción automática. Verifica en el AIP antes de usarlo.', 'warn']);
    if (a.src === 'AD 2') w.push(['Aeropuerto con ficha AD 2: distancias declaradas, ATZ/CTR y procedimientos, consúltalos en el AIP.', 'warn']);
    if (!a.fq) w.push(['No figura en ENR 4.1 (sin torre, AFIS ni frecuencia TIBA publicados). Revisa las observaciones del AIP y la frecuencia de la zona antes de operar.', 'warn']);
    w.push(['El largo cargado es el largo físico de la pista. Para el cálculo usa las distancias declaradas (TORA/LDA) del AIP si son menores.', 'warn']);
    warnBox(el('info_warn'), w);
  }
  // which = 'dep' | 'arr' | código ICAO
  function showInfo(which) {
    const icao = which === 'dep' ? el('fl_from').value : which === 'arr' ? el('fl_to').value : which;
    const a = get(icao);
    el('info_q').value = a ? label(a) : '';
    el('info_list').replaceChildren();
    renderFull(a);
    renderChips(a ? a.i : '');
  }
  // Los aeródromos de la ruta (y el alterno) como atajos
  function renderChips(active) {
    const box = el('info_chips'); box.replaceChildren();
    const pts = (window.MAPA && window.MAPA.route) ? window.MAPA.route() : [];
    const ids = [...new Set([...pts.map(p => p.i).filter(Boolean), el('alt_icao').value].filter(Boolean))];
    if (!ids.length) { box.append(make('p', 'Los aeródromos de tu ruta aparecen aquí como atajos.', 'hint nomargin')); return; }
    ids.forEach(i => { const b = make('button', i, 'chipb' + (i === active ? ' on' : '')); b.type = 'button'; b.addEventListener('click', () => showInfo(i)); box.append(b); });
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
    el(p + '_apply').textContent = (done.length ? 'Cargado desde el AIP: ' + done.join(', ') + '.' : 'No había datos para cargar.')
      + (missing.length ? ' Sin dato: ' + missing.join(', ') + '. Complétalo a mano.' : '');
    el(cfg.saved).value = sel.value;
  }

  // ---------- arranque ----------
  let readyFns = [], isReady = false;
  const whenReady = fn => { if (isReady) fn(); else readyFns.push(fn); };
  window.AD = { get, route, search: (q, n) => search(q, n).items, searchAll: search, browse, all: () => DB, freqText, freqShort, setEnds, setAlternate, showInfo, whenReady, alias: icao => ALIAS[icao] || '' };

  async function init() {
    const status = el('ad_status');
    try {
      const data = await loadDB();
      DB = data.ad; META = data;
      status.textContent = `${DB.length} aeródromos · AIP Chile Vol. I (vigencia ${data.vigencia}). Datos extraídos automáticamente: verifica con el AIP vigente.`;
    } catch (e) {
      status.textContent = 'No se pudo cargar la base de aeródromos. Abre la app desde su dirección web o usa la versión de archivo único.';
      el('alt_q').disabled = true; el('info_q').disabled = true;
      return;
    }
    bindPicker({ q: 'alt_q', list: 'alt_list', clear: 'alt_clear', get: () => el('alt_icao').value, set: i => setAlternate(i, false) });
    bindPicker({ q: 'info_q', list: 'info_list', get: () => '', set: i => showInfo(i) });
    ['dep', 'arr'].forEach(p => el(p + '_rwy').addEventListener('change', () => { applyPanel(p); recalcNow(); }));
    document.addEventListener('c172:tab', e => { if (e.detail === 'info') renderChips(''); });
    // restaurar el vuelo anterior sin pisar los datos que ya estaban en la calculadora
    ['from', 'to'].forEach(key => {
      const v = el('fl_' + key).value;
      if (v && get(v)) setAerodrome(key, v, true); else el('fl_' + key).value = '';
    });
    const alt = el('alt_icao').value;
    if (alt && get(alt)) setAlternate(alt, true); else el('alt_icao').value = '';
    recalcNow();
    isReady = true; readyFns.forEach(fn => fn()); readyFns = [];
  }
  init();
})();
