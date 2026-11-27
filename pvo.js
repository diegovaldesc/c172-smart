'use strict';
// Paso 6 «PVO»: bitácora de navegación de la ruta cargada, con el viento de cada tramo, para imprimir (A4 horizontal) o llevar en el celular.
// Todo sale de los mismos cálculos de la app (ruta, viento, combustible, peso y balance, pista). Los textos del AIP se insertan con textContent.
(function () {
  const $ = id => document.getElementById(id);
  const APP = () => window.APP;
  const mk = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  const nf = (n, d = 0) => n.toLocaleString('es', { maximumFractionDigits: d, minimumFractionDigits: d });
  const pad3 = n => String(Math.round(n) % 360 || (n > 0.5 ? 360 : 0)).padStart(3, '0');
  const clock = ms => new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateTxt = ms => new Date(ms).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // ---------- revisión previa: qué está confirmado y qué falta ----------
  // st: 'ok' | 'warn' (falta confirmar: el resultado es provisorio) | 'bad' (no se puede dar por bueno) | 'info' (recordatorio)
  function review() {
    const A = APP(), T = A.trip(), V = window.VIAJE, M = A.model(), SUM = A.sum();
    const pts = (window.MAPA && window.MAPA.route) ? window.MAPA.route() : [];
    const items = [], add = (k, st, txt, go) => items.push({ k, st, txt, go });
    if (pts.length < 2) add('Ruta', 'bad', 'Falta armar la ruta con origen y destino.', 'ruta');
    else add('Ruta', 'ok', pts.map((p, i) => A.ptLabel(p, i)).join(' → ') + (T && T.pl ? ` · ${nf(T.pl.nm)} NM` : ''), 'ruta');
    const ex = A.emptyIsExample();
    add('Avión', ex ? 'warn' : 'ok', ex ? `${M.nombre}: el peso vacío y el brazo son el ejemplo del POH, no los de tu matrícula.` : `${M.nombre}, con el peso vacío que ingresaste.`, 'plane');
    const wb = SUM.wb;
    add('Peso y balance', !wb ? 'bad' : wb.ok ? 'ok' : 'bad', !wb ? 'Hay datos incompletos o fuera de rango.' : wb.ok ? `Dentro de límites, ${A.dW(wb.margin)} bajo el MTOW.` : 'Fuera de límites: revísalo.', 'carga');
    if (!T || T.none) add('Combustible', 'bad', 'Sin ruta no hay cálculo.', 'ruta');
    else if (T.err) add('Combustible', 'bad', 'No se puede calcular: ' + T.err, 'carga');
    else if (T.over) add('Combustible', 'bad', 'No llegas sin escala con los tanques llenos.', 'carga');
    else if (T.short) add('Combustible', 'bad', `No alcanza: faltan ${A.dF(T.total - T.have)}.`, 'carga');
    else add('Combustible', T.wind === 'ok' ? 'ok' : 'warn', `Alcanza: aterrizas con ${A.dF(Math.max(0, T.landGal))}${T.wind === 'ok' ? '' : ' (provisorio: el viento no está definido)'}.`, 'carga');
    if (T && T.wind) add('Viento en la ruta', T.wind === 'ok' ? 'ok' : 'warn',
      T.wind === 'ok' ? V.provenance() : { none: 'Sin viento definido: se supuso aire en calma.', partial: 'Falta el viento de algún tramo: ahí se supuso calma.', stale: 'El viento está desactualizado.' }[T.wind], 'viento');
    else add('Viento en la ruta', 'warn', 'Sin viento definido: se supondría aire en calma.', 'viento');
    [['dep', 'salida'], ['arr', 'llegada']].forEach(([w, name]) => {
      const c = A.cond(w);
      add(`Condiciones de pista (${name})`, c.pending.length ? 'warn' : 'ok', c.pending.length ? `Sin confirmar: ${c.pending.join(', ')}.` : c.src === 'forecast' ? `Pronóstico de modelo${c.edited ? ' (editado a mano)' : ''}.` : 'Escritas por ti.', 'pista');
    });
    add('Meteorología oficial', 'info', 'METAR, TAF y NOTAM: revísalos tú antes de salir; la app no los consulta.');
    return { items, pending: items.filter(i => i.st === 'warn' || i.st === 'bad') };
  }
  const ICON = { ok: '✔', warn: '⚠', bad: '✖', info: 'ⓘ' };
  function paintReview() {
    const box = $('pvo_review'), R = review(), n = R.pending.length, bad = R.items.some(i => i.st === 'bad');
    box.replaceChildren();
    box.append(mk('h2', 'Revisión antes de generar el PVO'));
    box.append(mk('p', n ? `${n} punto${n > 1 ? 's' : ''} por revisar: el PVO saldrá marcado como BORRADOR.` : 'Todo revisado: el PVO saldrá sin marca de borrador.', 'rv-sum ' + (bad ? 'bad' : n ? 'warn' : 'ok')));
    const ul = mk('ul', null, 'rv-list');
    R.items.forEach(i => {
      const li = mk('li', null, 'rv-' + i.st), t = mk('div', null, 'rv-t');
      t.append(mk('b', i.k), mk('span', i.txt));
      li.append(mk('i', ICON[i.st], 'rv-ic'), t);
      if ((i.st === 'warn' || i.st === 'bad') && i.go) { const b = mk('button', 'Revisar', 'mini'); b.type = 'button'; b.dataset.go = i.go; li.append(b); }
      ul.append(li);
    });
    box.append(ul);
  }

  // La hoja se arma una vez como datos (head, rows, boxes, notes) y se pinta en pantalla y como texto copiable
  function build() {
    const A = APP(), T = A.trip();
    if (!T || T.none || T.err || !T.pl) return null;
    const { pl, prm, pts } = T, AD = window.AD, V = window.VIAJE, etd = V.etdMs(), M = A.model();
    const fm = g => A.dF(g), hm = mins => A.hm(mins / 60);
    const reg = ($('pl_reg').value || '').trim().toUpperCase(), pilot = ($('pl_pilot').value || '').trim();
    const o = pts[0], d = pts[pts.length - 1];
    const head = [
      ['Fecha', dateTxt(etd)], ['Salida (despegue)', clock(etd) + ' hora local'],
      ['Matrícula', reg || '________'], ['Avión', M.nombre.replace('Cessna ', 'Cessna ')],
      ['Piloto al mando', pilot || '________________'], ['Ruta', pts.map((p, i) => A.ptLabel(p, i)).join(' → ')],
      ['Altitud de crucero', `${nf(prm.alt)} ft (altitud presión)`],
      ['Crucero', prm.poh ? `${nf(prm.rpm)} RPM · ${nf(prm.bhp)} % · TAS ${nf(prm.tas)} kt · ${nf(prm.gph / A.ff(), 1)} ${A.uf()}/h${prm.extra ? ` (con +${nf(prm.extra)} % sobre el POH)` : ''}` : `TAS ${nf(prm.tas)} kt · ${nf(prm.gph / A.ff(), 1)} ${A.uf()}/h (valores propios)`],
      ['Declinación magnética', `${nf(Math.abs(A.variation()), 1)}° ${A.variation() >= 0 ? 'E' : 'W'}`],
      ['Viento', V.provenance() || 'sin dato (calma)'],
    ];

    // tabla de navegación
    const cols = ['Tramo', 'Ruta verd.', 'Viento', 'Corr.', 'Rumbo verd.', 'Rumbo mag.', 'Dist.', 'TAS', 'Suelo', 'ETE', 'ETA', 'Comb.', 'Queda', 'ATA', 'Comb. real'];
    const rows = [];
    let left = T.have - prm.taxi;
    rows.push({ cls: 'pv-sub', cells: [`Rodaje y despegue · ${A.ptLabel(o, 0)}`, '', '', '', '', '', '', '', '', '', clock(etd), fm(prm.taxi), fm(left), '', ''] });
    pl.legs.forEach((l, i) => {
      left = T.have - prm.taxi - l.galCum;
      rows.push({ cells: [
        `${i + 1}. ${A.ptLabel(pts[i], i)} → ${A.ptLabel(pts[i + 1], i + 1)}`, pad3(l.tc) + '°',
        l.wspd > 0 ? `${pad3(l.wdir)}°/${nf(l.wspd)}` : 'calma', (Math.abs(l.wca) >= 0.5 ? (l.wca > 0 ? '+' : '−') + nf(Math.abs(l.wca), 0) + '°' : '0°'),
        pad3(l.th) + '°', pad3(l.mh) + '°', nf(l.nm, l.nm < 10 ? 1 : 0), nf(prm.tas), nf(l.gs), A.mm(l.min), clock(etd + l.minCum * 60000), fm(l.gal), (left < 0 ? '−' : '') + fm(Math.abs(left)), '', ''] });
    });
    if (T.alt) rows.push({ cls: 'pv-sub', cells: [`Alterno ${T.alt.ad.i} (desde el destino)`, pad3(T.alt.leg.tc) + '°', T.alt.leg.wspd > 0 ? `${pad3(T.alt.leg.wdir)}°/${nf(T.alt.leg.wspd)}` : 'calma', '', pad3(T.alt.leg.th) + '°', pad3(T.alt.leg.mh) + '°', nf(T.alt.nm), nf(prm.tas), nf(T.alt.leg.gs), A.mm(T.alt.min), clock(etd + (pl.min + T.alt.min) * 60000), fm(T.alt.gal), '', '', ''] });
    const foot = ['Total', '', '', '', '', '', nf(pl.nm), '', '', hm(pl.min), clock(etd + pl.min * 60000), fm(pl.galEnroute), '', '', ''];

    // cajas de resumen
    const boxes = [];
    const landFuel = Math.max(0, T.landGal);
    boxes.push(['Combustible', [
      ['Cargado', fm(T.have)], ['Rodaje + despegue', fm(prm.taxi)], ['Ruta (ascenso + crucero)', fm(pl.galEnroute)],
      ...(T.alt ? [['Alterno ' + T.alt.ad.i, fm(T.alt.gal)]] : []), [`Reserva ${nf(prm.resMin)} min`, fm(pl.galReserve)],
      ['Necesario total', fm(T.total) + (T.over || T.short ? '  ⚠ NO ALCANZA' : '  ✔ alcanza')],
      ['Aterrizas con', `${fm(landFuel)} (${hm(T.landMin)} de vuelo)`],
      ['Autonomía hasta la reserva', (() => { const m = Math.max(0, (T.have - prm.taxi - pl.galReserve) / prm.gph * 60); return `${hm(m)} · hasta las ${clock(etd + m * 60000)}`; })()],
    ]]);
    const WB = A.wb();
    if (WB) {
      const lf = A.wbState(Math.max(0, T.landGal)), ok = w => (A.inEnvelope(w.w, w.cg) ? '✔ dentro' : '⚠ FUERA');
      boxes.push(['Peso y balance', [
        ['Rampa', `${A.dW(WB.ramp.w)} · CG ${nf(WB.ramp.cg, 2)} in · ${ok(WB.ramp)}`],
        ['Despegue', `${A.dW(WB.toff.w)} · CG ${nf(WB.toff.cg, 2)} in · ${ok(WB.toff)}`],
        ['Aterrizaje', `${A.dW(lf.w)} · CG ${nf(lf.cg, 2)} in · ${ok(lf)}`],
        ['Límite de despegue', `${A.dW(M.w.mtow)} (MTOW)`],
      ]]);
    }
    const S = A.sum(), perf = (s, ap, rw, wd, ws, tmp, qnh, len, prov) => !ap ? null : [`${ap.i} · pista ${rw || '—'}`, s ? (s.out ? s.out : `${s.ok === 'ok' ? '✔' : s.ok === 'warn' ? '⚠' : '⚠ NO CABE'} pide ${nf(s.need)} ft${s.mp > 0 ? ` (con +${nf(s.mp)} %)` : ''} de ${nf(len)} ft · viento ${wd || '—'}°/${nf(ws)} kt mag. · ${nf(tmp)} °C · QNH ${nf(qnh)}${prov.length ? ` · ⚠ PROVISORIO: sin confirmar ${prov.join(', ')} (se usaron valores por defecto)` : ''}`) : 'sin cálculo'];
    const g = id => $(id).value, apO = AD ? AD.get(g('fl_from')) : null, apD = AD ? AD.get(g('fl_to')) : null;
    const pr = [];
    const a1 = perf(S.to, apO, g('rwy'), g('wdir'), +g('wspd') || 0, +g('oat') || 0, +g('qnh') || 0, +g('to_len') || 0, A.cond('dep').pending); if (a1) pr.push(['Despegue ' + a1[0], a1[1]]);
    const a2 = perf(S.ld, apD, g('a_rwy'), g('a_wdir'), +g('a_wspd') || 0, +g('a_oat') || 0, +g('a_qnh') || 0, +g('ld_len') || 0, A.cond('arr').pending); if (a2) pr.push(['Aterrizaje ' + a2[0], a2[1]]);
    if (pr.length) boxes.push(['Pista', pr]);

    // frecuencias de los aeródromos de la ruta (y el alterno)
    const ids = [...new Set([...pts.map(p => p.i).filter(Boolean), T.alt ? T.alt.ad.i : null].filter(Boolean))];
    const fq = ids.map(i => { const a = AD && AD.get(i); if (!a) return [i, '']; const f = AD.freqShort(a); return [`${a.i} · ${a.n}`, [a.el != null ? `Elev. ${nf(a.el)} ft` : '', a.rw.map(r => r.a + (r.b ? '/' + r.b : '')).filter(Boolean).join(', '), f || 'sin frecuencias publicadas en ENR 4.1'].filter(Boolean).join(' · ')]; });
    if (fq.length) boxes.push(['Aeródromos y frecuencias (MHz)', fq]);

    // espacios aéreos
    const air = window.MAPA && window.MAPA.air ? window.MAPA.air() : null;
    if (air) {
      const lines = [];
      lines.push(['Zonas P/R/D', air.critU.length ? air.critU.map(e => e.nm).join('; ') : 'ninguna a tu altitud (según los límites publicados)']);
      if (air.ctl.length) lines.push(['Espacios controlados', air.ctl.map(e => `${e.nm}${e.lim ? ' (' + e.lim + ')' : ''}`).join('; ')]);
      boxes.push(['Espacios aéreos en la ruta', lines]);
    }

    const notes = [...T.notes];
    notes.push('Hoja de apoyo a la planificación: no sustituye al POH/AFM, al AIP, al NOTAM ni a la información meteorológica oficial (METAR/TAF/DMC). El piloto al mando decide.');
    if (/Open-Meteo/.test(V.provenance())) notes.push('Datos de viento: Open-Meteo.com (CC BY 4.0), pronóstico de modelo numérico, referencial.');
    // marca de borrador: lo pendiente queda a la vista en la hoja (y en lo que se imprime)
    const R = review(), stamp = R.pending.length ? { bad: R.items.some(i => i.st === 'bad'), text: 'BORRADOR · pendiente: ' + R.pending.map(i => i.k).join('; ') } : null;
    if (stamp) notes.unshift('Supuestos de esta hoja: ' + R.pending.map(i => `${i.k} (${i.txt.replace(/\.$/, '')})`).join(' · ') + '.');
    return { head, cols, rows, foot, boxes, notes, stamp, made: Date.now() };
  }

  // ---------- pantalla ----------
  function paint(S) {
    const sheet = $('pvo_sheet'); sheet.replaceChildren();
    const top = mk('div', null, 'pv-top'); top.append(mk('h2', 'PVO · Bitácora de navegación'), mk('small', 'C172 Smart'));
    sheet.append(top);
    if (S.stamp) sheet.append(mk('div', S.stamp.text, 'pv-stamp' + (S.stamp.bad ? ' bad' : '')));
    const hd = mk('div', null, 'pv-head');
    S.head.forEach(([k, v]) => { const c = mk('div'); c.append(mk('span', k), mk('b', v)); hd.append(c); });
    sheet.append(hd);
    const wrap = mk('div', null, 'phwrap pv-wrap'), tb = mk('table', null, 'pv-tbl');
    const th = mk('thead'), hr = mk('tr'); S.cols.forEach(c => hr.append(mk('th', c))); th.append(hr); tb.append(th);
    const bd = mk('tbody');
    S.rows.forEach(r => { const tr = mk('tr', null, r.cls || ''); r.cells.forEach((c, i) => tr.append(mk('td', c, i === 0 ? 'l' : ''))); bd.append(tr); });
    tb.append(bd);
    const tf = mk('tfoot'), fr = mk('tr'); S.foot.forEach((c, i) => fr.append(mk('td', c, i === 0 ? 'l' : ''))); tf.append(fr); tb.append(tf);
    wrap.append(tb); sheet.append(wrap);
    sheet.append(mk('p', 'Ruta verd. = rumbo sobre el terreno en grados verdaderos · Viento = de dónde viene (° verdaderos)/kt · Corr. = ángulo de corrección por viento (+ a la derecha) · Rumbo mag. = rumbo verdadero a volar menos la declinación · Suelo = velocidad suelo · ETA = hora estimada al final del tramo · Queda = combustible restante al final del tramo.', 'pv-leg'));
    const bx = mk('div', null, 'pv-boxes');
    S.boxes.forEach(([title, lines]) => {
      const b = mk('section', null, 'pv-box'); b.append(mk('h3', title));
      lines.forEach(([k, v]) => { const l = mk('div', null, 'pv-line' + (String(v).length > 70 ? ' long' : '')); l.append(mk('span', k), mk('b', v)); b.append(l); });
      bx.append(b);
    });
    sheet.append(bx);
    const nt = mk('div', null, 'pv-notes'); S.notes.forEach(n => nt.append(mk('p', n)));
    nt.append(mk('p', 'Hoja generada el ' + new Date(S.made).toLocaleString('es') + '.'));
    sheet.append(nt);
  }
  function asText(S) {
    const t = ['PVO · BITÁCORA DE NAVEGACIÓN (C172 Smart)', ...(S.stamp ? [S.stamp.text] : []), ''];
    S.head.forEach(([k, v]) => t.push(`${k}: ${v}`));
    t.push('', 'TRAMOS  [ruta verd. · viento · rumbo mag. · dist · suelo · ETE · ETA · comb. · queda]');
    S.rows.forEach(r => { const c = r.cells; t.push(`${c[0]}  |  ${[c[1] && 'RV ' + c[1], c[2] && 'viento ' + c[2], c[5] && 'RM ' + c[5], c[6] && c[6] + ' NM', c[8] && 'GS ' + c[8], c[9], c[10] && 'ETA ' + c[10], c[11], c[12] && 'queda ' + c[12]].filter(Boolean).join(' · ')}`); });
    t.push(`Total: ${S.foot[6]} NM · ${S.foot[9]} · ${S.foot[11]}`);
    S.boxes.forEach(([title, lines]) => { t.push('', title.toUpperCase()); lines.forEach(([k, v]) => t.push(`${k}: ${v}`)); });
    t.push('', ...S.notes);
    return t.join('\n');
  }

  let lastText = '';
  function render() {
    if (document.body.dataset.view !== 'pvo') return;              // solo se arma cuando se mira
    paintReview();
    const S = build(), none = !S;
    $('pvo_none').hidden = !none; $('pvo_body').hidden = none;
    if (none) { const T = APP().trip(); $('pvo_none').textContent = T && T.err ? 'No se puede armar la bitácora: ' + T.err : 'Arma una ruta con al menos dos puntos (paso 2) y revisa que los datos estén completos para generar la bitácora.'; lastText = ''; return; }
    paint(S); lastText = asText(S);
  }
  document.addEventListener('c172:calc', render);
  document.addEventListener('c172:tab', e => { if (e.detail === 'pvo') APP().recalc(); });
  ['pl_reg', 'pl_pilot'].forEach(id => $(id).addEventListener('input', render));
  $('pvo_print').addEventListener('click', () => { render(); window.print(); });
  $('pvo_copy').addEventListener('click', async () => {
    const st = $('pvo_status');
    try { await navigator.clipboard.writeText(lastText); st.textContent = 'Copiado. Puedes pegarlo en un mensaje o un documento.'; }
    catch (e) { st.textContent = 'No se pudo copiar automáticamente. Usa «Imprimir o guardar como PDF».'; }
  });
  window.PVO = { build, asText, render, review };
})();
