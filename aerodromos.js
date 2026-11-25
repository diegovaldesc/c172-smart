'use strict';
// Buscador de aeródromos de Chile (AIP Vol. I). Carga elevación, pista y largo en la calculadora de performance.
// Los textos vienen del AIP (extracción automática): se insertan siempre con textContent, nunca como HTML.
(function () {
  const M_TO_FT = 3.28084;
  const el = id => document.getElementById(id);
  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nf = (n, d = 0) => n.toLocaleString('es', { maximumFractionDigits: d, minimumFractionDigits: d });
  let DB = [], META = {};
  let current = null;   // aeródromo seleccionado

  const HOURS = { HJ: 'HJ (de la salida a la puesta del sol)', H24: 'H24 (continuo)' };
  // Pavimentada solo si no aparece también tierra, pasto, ripio, etc. (superficie mixta = se trata como sin pavimentar, lado conservador)
  const hasPaved = s => /(ASPH|asfalt|CONC|hormig|pavim)/i.test(s || '') && !/(tierra|pasto|ripio|maicillo|grava|arena|c[eé]sped|compact|natural)/i.test(s || '');

  function make(tag, text, cls) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  // ---------- carga de datos ----------
  async function loadDB() {
    if (window.AD_DATA) return window.AD_DATA;
    const r = await fetch('data/aerodromos.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // ---------- búsqueda ----------
  function search(q) {
    const t = norm(q).trim();
    if (!t) return [];
    const scored = [];
    for (const a of DB) {
      const code = norm(a.i), name = norm(a.n), city = norm(a.c);
      let s = -1;
      if (code === t) s = 0;
      else if (code.startsWith(t)) s = 1;
      else if (name.startsWith(t) || city.startsWith(t)) s = 2;
      else if (name.includes(t) || city.includes(t)) s = 3;
      if (s >= 0) scored.push([s, a]);
    }
    scored.sort((x, y) => x[0] - y[0] || x[1].i.localeCompare(y[1].i));
    return scored.slice(0, 8).map(x => x[1]);
  }

  function renderList(items) {
    const box = el('ad_list');
    box.replaceChildren();
    for (const a of items) {
      const b = make('button');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.append(make('b', a.i), document.createTextNode(a.n), make('span', (a.c || '') + (a.el != null ? ' · ' + nf(a.el) + ' ft' : '')));
      b.addEventListener('click', () => choose(a.i, 0, true));
      box.append(b);
    }
  }

  // ---------- selección y datos ----------
  function runwayOptions(a) {
    const sel = el('ad_rwy');
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

  function choose(icao, rwyIdx, apply) {
    const a = DB.find(x => x.i === icao);
    if (!a) return;
    current = a;
    runwayOptions(a);
    const sel = el('ad_rwy');
    if (typeof rwyIdx === 'string') { if ([...sel.options].some(o => o.value === rwyIdx)) sel.value = rwyIdx; }
    else sel.selectedIndex = Math.min(rwyIdx || 0, Math.max(0, sel.options.length - 1));
    el('ad_q').value = `${a.i} · ${a.n}`;
    el('ad_list').replaceChildren();
    el('ad_info').hidden = false;
    renderData(a);
    if (apply) applyToCalc(); else { el('ad_apply').textContent = 'Selección anterior restaurada. Los valores de abajo no se han vuelto a cargar.'; persist(); }
  }

  function persist() {
    el('ad_sel').value = current ? current.i + '|' + el('ad_rwy').value : '';
    if (typeof recalc === 'function') recalc();
  }

  function renderData(a) {
    const dl = el('ad_data');
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

    const w = el('ad_warn');
    w.replaceChildren();
    const msg = (t, c) => w.append(make('div', t, 'msg ' + c));
    if (!a.q) msg('Registro con campos incompletos o dudosos en la extracción automática. Verifica en el AIP antes de usarlo.', 'warn');
    if (a.src === 'AD 2') msg('Aeropuerto con ficha AD 2: frecuencias, distancias declaradas y pistas múltiples, consúltalas en el AIP.', 'warn');
    msg('El largo cargado es el largo físico de la pista. Para el cálculo usa las distancias declaradas (TORA/LDA) del AIP si son menores.', 'warn');
  }

  // ---------- aplicar a la calculadora ----------
  function applyToCalc() {
    if (!current) return;
    const a = current;
    const [idx, end] = (el('ad_rwy').value || '0:a').split(':');
    const r = a.rw[+idx] || {};
    const des = r[end] || '';
    const done = [];
    if (a.el != null) { el('elev').value = Math.round(a.el); done.push(`elevación ${nf(a.el)} ft`); }
    const num = parseInt(des, 10);
    if (num >= 1 && num <= 36) { el('rwy').value = num; done.push(`pista ${des}`); }
    if (r.l) { const ft = Math.round(r.l * M_TO_FT); el('to_len').value = ft; el('ld_len').value = ft; done.push(`largo ${nf(ft)} ft`); }
    const surfIdx = hasPaved(r.sf || a.sf) ? 0 : (a.sf ? 2 : -1);
    if (surfIdx >= 0) {
      el('to_surf').selectedIndex = surfIdx; el('ld_surf').selectedIndex = surfIdx;
      done.push(surfIdx === 0 ? 'superficie pavimentada' : 'superficie sin pavimentar o mixta (se usa la corrección de pasto seco como aproximación; revisa la superficie)');
    }
    el('ad_apply').textContent = done.length ? 'Cargado en el cálculo: ' + done.join(', ') + '.' : 'No había datos para cargar.';
    persist();
  }

  // ---------- arranque ----------
  async function init() {
    const status = el('ad_status');
    try {
      const data = await loadDB();
      DB = data.ad; META = data;
      status.textContent = `${DB.length} aeródromos · AIP Chile Vol. I (vigencia ${data.vigencia}). Datos extraídos automáticamente: verifica con el AIP vigente.`;
    } catch (e) {
      status.textContent = 'No se pudo cargar la base de aeródromos. Abre la app desde su dirección web o usa la versión de archivo único.';
      el('ad_q').disabled = true;
      return;
    }
    el('ad_q').addEventListener('input', e => renderList(search(e.target.value)));
    el('ad_q').addEventListener('keydown', e => { if (e.key === 'Enter') { const f = el('ad_list').querySelector('button'); if (f) f.click(); e.preventDefault(); } });
    el('ad_rwy').addEventListener('change', applyToCalc);
    // restaurar selección anterior: "ICAO|idx:end"
    const saved = (el('ad_sel').value || '').split('|');
    if (saved[0] && DB.some(x => x.i === saved[0])) choose(saved[0], saved[1] || 0, false);
  }
  init();
})();
