'use strict';
// Paso 3 «Viento y altitud»: hora de salida, viento por tramo (en vivo o a mano) y pronóstico de superficie para las pistas.
// El viento de cada tramo se guarda por sus extremos (lat/lon): si agregas un punto, los demás tramos conservan su viento.
(function () {
  const $ = id => document.getElementById(id);
  const APP = () => window.APP, V = window.VIENTO, R = window.RUTA;
  const LS = 'c172smart.viento';
  const mk = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  const nf = (n, d = 0) => n.toLocaleString('es', { maximumFractionDigits: d, minimumFractionDigits: d });
  const pad3 = n => String(Math.round(n) % 360).padStart(3, '0');
  const store = { get() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } }, set(v) { try { localStorage.setItem(LS, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } } };
  let DATA = Object.assign({ byLeg: {}, met: null, tmp: null }, store.get());
  const save = () => {
    const keys = Object.keys(DATA.byLeg);
    if (keys.length > 60) keys.sort((a, b) => DATA.byLeg[a].at - DATA.byLeg[b].at).slice(0, keys.length - 60).forEach(k => delete DATA.byLeg[k]);
    store.set(DATA);
  };
  const route = () => (window.MAPA && window.MAPA.route) ? window.MAPA.route() : [];
  const legKey = (p, q) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}>${q.lat.toFixed(4)},${q.lon.toFixed(4)}`;
  const hhmm = ms => new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const dayhm = ms => new Date(ms).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // ---------- hora de salida ----------
  const toLocalInput = ms => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
  const etdMs = () => { const v = $('vi_etd').value; const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : Date.now(); };
  function initEtd() {
    const v = $('vi_etd').value, t = v ? new Date(v).getTime() : NaN;
    // sin hora guardada, o una que ya pasó hace más de una hora: la próxima hora en punto
    if (!Number.isFinite(t) || t < Date.now() - 3600000) $('vi_etd').value = toLocalInput(Math.ceil(Date.now() / 3600000) * 3600000);
  }

  // ---------- viento por tramo (lo que lee el cálculo) ----------
  // Devuelve { dir, spd, src: 'vivo' | 'mano', stale } o null (= sin dato: el cálculo supone calma)
  function windOf(p, q) {
    const e = DATA.byLeg[legKey(p, q)];
    if (!e) return null;
    const stale = e.src === 'vivo' && (Date.now() - e.at > V.MAX_AGE_H * 3600000 || Math.abs(e.etd - etdMs()) > 1800000 || e.alt !== (APP() ? APP().altitude() : e.alt));
    return { dir: e.dir, spd: e.spd, src: e.src, stale, at: e.at, etd: e.etd, tmp: e.tmp };
  }
  function setManual(p, q, dir, spd) {
    DATA.byLeg[legKey(p, q)] = { dir, spd, src: 'mano', at: Date.now(), etd: etdMs(), alt: APP().altitude() };
    save();
  }

  // ---------- red ----------
  let busy = false;
  const status = (t, cls) => { const s = $('vi_status'); s.textContent = t; s.className = 'hint' + (cls ? ' ' + cls : ''); };
  async function fetchWind() {
    const pts = route(), A = APP();
    if (busy || pts.length < 2) return false;
    const prm = A.params();
    if (prm.err) { status('Revisa la altitud y las RPM de crucero: ' + prm.err, 'bad'); return false; }
    busy = true; $('vi_fetch').disabled = true; status('Consultando el pronóstico…');
    $('vi_msg').replaceChildren();
    try {
      const etd = etdMs(), res = await V.fetchPlan({ pts, tas: prm.tas, etdMs: etd, paFt: prm.alt });
      const now = Date.now(), errs = res.legs.filter(l => l.err).length;
      res.legs.forEach((l, i) => { if (!l.err) DATA.byLeg[legKey(pts[i], pts[i + 1])] = { dir: l.dir, spd: l.spd, tmp: l.tmp, src: 'vivo', at: now, etd, alt: prm.alt, clamp: l.clamp || null }; });
      const ends = legKey(pts[0], pts[pts.length - 1]);
      DATA.met = { at: now, etd, etaMs: res.etaMs, ends, dep: res.dep, arr: res.arr };
      const temps = res.legs.filter(l => !l.err && l.tmp != null).map(l => l.tmp);
      DATA.tmp = temps.length ? { at: now, alt: prm.alt, t: temps.reduce((a, b) => a + b, 0) / temps.length } : null;
      save();
      if (errs) status(`La hora de salida (${dayhm(etd)}) queda fuera del pronóstico disponible (desde ayer hasta 3 días). Elige otra hora o escribe el viento a mano.`, 'bad');
      else status(`Viento en vivo obtenido a las ${hhmm(now)}: pronóstico de modelo para ${dayhm(etd)}, a ${nf(prm.alt)} ft.`, 'ok');
      if (res.legs.some(l => l.clamp === 'low')) $('vi_msg').append(mk('div', 'En parte de la ruta, a esa altitud el relieve del modelo queda sobre el nivel de vuelo: ahí se usó el viento más bajo disponible. Revísalo con criterio.', 'msg warn'));
      A.recalc();
      return !errs;
    } catch (e) {
      status('No se pudo obtener el viento (sin internet o el servicio no responde). Escríbelo a mano en la tabla: la app sigue funcionando.', 'bad');
      return false;
    } finally { busy = false; $('vi_fetch').disabled = false; }
  }

  // ---------- tabla de tramos ----------
  let rowsSig = '';
  const num = s => { const v = parseInt(String(s).replace(/\D/g, ''), 10); return Number.isFinite(v) ? v : null; };
  function srcText(p, q) {
    const w = windOf(p, q);
    if (!w) return 'sin dato: se supone calma';
    if (w.src === 'mano') return 'a mano';
    return w.stale ? 'en vivo, VIEJO: actualízalo' : `en vivo, ${hhmm(w.at)}`;
  }
  function renderWind() {
    const pts = route(), tbl = $('vi_tbl'), A = APP();
    $('vi_none').hidden = pts.length >= 2;
    $('vi_fetch').disabled = pts.length < 2 || busy;
    $('vi_same').disabled = pts.length < 3;
    $('vi_same').hidden = pts.length < 3;
    $('vi_legend').textContent = 'Dirección = de dónde viene el viento, en grados verdaderos (como en un mapa): 270° y 15 kt es viento del oeste de 15 nudos. Si cambias un valor queda «a mano».';
    if (pts.length < 2) { tbl.replaceChildren(); rowsSig = ''; if (!busy) status('', ''); return; }
    const sig = pts.map((p, i) => i ? legKey(pts[i - 1], p) : '').join('|');
    const lab = (p, i) => A.ptLabel(p, i);
    if (sig !== rowsSig || !tbl.firstChild) {
      rowsSig = sig;
      tbl.replaceChildren();
      const th = mk('thead'), hr = mk('tr'); ['Tramo', 'Viento desde (°)', 'Vel. (kt)'].forEach(t => hr.append(mk('th', t))); th.append(hr);
      const tb = mk('tbody');
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], q = pts[i], r = R.inv(p, q), tr = mk('tr'), td = mk('td', `${i}. ${lab(p, i - 1)} → ${lab(q, i)}`);
        td.append(mk('small', `${pad3(r.brg)}° verdadero · ${nf(r.nm, r.nm < 10 ? 1 : 0)} NM`), mk('small', '', 'vi-src'));
        const w = windOf(p, q), mkIn = (cls, val, max, aria) => {
          const c = mk('td'), inp = mk('input'); inp.type = 'text'; inp.inputMode = 'numeric'; inp.autocomplete = 'off'; inp.className = 'vi-in ' + cls;
          inp.dataset.nosave = '1'; inp.maxLength = 3; inp.setAttribute('aria-label', aria + ' del tramo ' + i); inp.value = val == null ? '' : String(val); c.append(inp); return [c, inp];
        };
        const [c1, dIn] = mkIn('d', w ? Math.round(w.dir) % 360 : '', 360, 'Dirección del viento');
        const [c2, sIn] = mkIn('s', w ? Math.round(w.spd) : '', 150, 'Velocidad del viento');
        const onIn = () => {
          let d = num(dIn.value), s = num(sIn.value);
          if (d == null && s == null) return;
          d = Math.min(360, d == null ? 0 : d); s = Math.min(150, s == null ? 0 : s);
          setManual(p, q, d % 360, s); A.recalc();
        };
        dIn.addEventListener('input', onIn); sIn.addEventListener('input', onIn);
        tr.append(td, c1, c2); tb.append(tr);
      }
      tbl.append(th, tb);
    }
    // se actualiza lo que dice cada fila sin tocar los campos (para no perder el foco mientras se escribe)
    [...tbl.querySelectorAll('tbody tr')].forEach((tr, k) => {
      const p = pts[k], q = pts[k + 1], src = tr.querySelector('.vi-src');
      src.textContent = srcText(p, q);
      src.classList.toggle('warn', /VIEJO|sin dato/.test(src.textContent));
      const w = windOf(p, q), act = document.activeElement;
      [['.d', w ? Math.round(w.dir) % 360 : ''], ['.s', w ? Math.round(w.spd) : '']].forEach(([sel, v]) => { const i = tr.querySelector(sel); if (i !== act && i.value !== String(v)) i.value = v; });
    });
    renderInfo();
  }

  // texto de estado + botón de temperatura (ISA)
  function renderInfo() {
    if (busy) return;
    const pts = route(), A = APP();
    const live = pts.slice(1).map((q, i) => windOf(pts[i], q)).filter(w => w && w.src === 'vivo');
    const s = $('vi_status');
    if (pts.length < 2) return;
    if (!live.length) {
      const any = pts.slice(1).some((q, i) => windOf(pts[i], q));
      if (!any) status('Todavía no hay viento: los cálculos suponen aire en calma. Toca «Obtener viento en vivo» o escríbelo a mano.', 'warn');
      else status('Viento escrito a mano.', '');
    } else {
      const last = Math.max(...live.map(w => w.at)), stale = live.some(w => w.stale);
      status(stale ? `El viento en vivo de las ${hhmm(last)} está viejo o es de otra hora o altitud: actualízalo.` : `Viento en vivo de las ${hhmm(last)} (pronóstico de modelo para ${dayhm(live[0].etd)}).`, stale ? 'warn' : 'ok');
    }
    void s;
    const box = $('vi_msg');
    box.querySelectorAll('.vi-isa').forEach(e => e.remove());
    const t = DATA.tmp, alt = A.altitude();
    if (t && t.alt === alt && Date.now() - t.at < V.MAX_AGE_H * 3600000) {
      const dev = Math.round(t.t - V.isaAt(alt)), row = mk('div', null, 'vi-isa');
      row.append(mk('span', `Temperatura pronosticada a ${nf(alt)} ft: ${nf(t.t, 0)} °C (ISA ${dev >= 0 ? '+' : ''}${dev}). `));
      if (A.params().poh) {
        const b = mk('button', `Usar ISA ${dev >= 0 ? '+' : ''}${dev} °C en el crucero`, 'mini'); b.type = 'button';
        b.addEventListener('click', () => { $('r_isa').value = Math.max(-20, Math.min(20, dev)); A.recalc(); });
        row.append(b);
      }
      box.append(row);
    }
  }

  // ---------- pronóstico de superficie para las pistas ----------
  const metOk = () => {
    const m = DATA.met, pts = route();
    return !!m && pts.length >= 2 && m.ends === legKey(pts[0], pts[pts.length - 1]) && Date.now() - m.at < V.MAX_AGE_H * 3600000 && Math.abs(m.etd - etdMs()) < 1800000;
  };
  async function useMet(which) {
    const note = $(which + '_met_note'), btn = $(which + '_met');
    if (route().length < 2) { note.textContent = 'Primero arma la ruta con origen y destino (paso 2).'; return; }
    btn.disabled = true; note.textContent = 'Consultando el pronóstico…';
    if (!metOk()) await fetchWind();
    btn.disabled = false;
    const m = DATA.met && metOk() ? DATA.met[which] : null;
    if (!m || m.dir == null) { note.textContent = 'No se pudo obtener el pronóstico (sin internet o la hora de salida está fuera de su alcance). Escribe las condiciones a mano.'; return; }
    const when = which === 'dep' ? DATA.met.etd : DATA.met.etaMs;
    APP().setMet(which, m, when);
    note.textContent = `Pronóstico de modelo para ${dayhm(when)}: viento ${pad3(m.dir)}° verdadero (${pad3(((m.dir - APP().variation()) % 360 + 360) % 360)}° magnético) ${nf(m.spd)} kt, ${nf(m.tmp, 0)} °C, ${nf(m.qnh, 0)} hPa (presión a nivel del mar del modelo, parecida al QNH). Es referencial: confírmalo con el METAR o el ATIS.`;
  }

  // ---------- eventos ----------
  $('vi_fetch').addEventListener('click', fetchWind);
  $('vi_same').addEventListener('click', () => {
    const pts = route(), w = pts.length > 1 ? windOf(pts[0], pts[1]) : null;
    if (!w) return;
    for (let i = 1; i < pts.length; i++) setManual(pts[i - 1], pts[i], Math.round(w.dir) % 360, Math.round(w.spd));
    APP().recalc();
  });
  $('dep_met').addEventListener('click', () => useMet('dep'));
  $('arr_met').addEventListener('click', () => useMet('arr'));
  document.addEventListener('c172:calc', renderWind);
  document.addEventListener('c172:tab', e => { if (e.detail === 'viento') { initEtd(); APP().recalc(); } });
  initEtd();

  // Para la bitácora: de dónde sale el viento usado
  function provenance() {
    const pts = route(), ws = pts.slice(1).map((q, i) => windOf(pts[i], q));
    const live = ws.filter(w => w && w.src === 'vivo'), man = ws.filter(w => w && w.src === 'mano').length, none = ws.filter(w => !w).length;
    const out = [];
    if (live.length) out.push(`${live.length} tramo${live.length > 1 ? 's' : ''} con pronóstico de modelo de Open-Meteo.com (obtenido ${hhmm(Math.max(...live.map(w => w.at)))}, para ${dayhm(live[0].etd)})${live.some(w => w.stale) ? ', VIEJO' : ''}`);
    const tr = n => `${n} tramo${n > 1 ? 's' : ''}`;
    if (man) out.push(`${tr(man)} con viento a mano`);
    if (none) out.push(`${tr(none)} sin dato (se supuso calma)`);
    return out.join(' · ');
  }
  window.VIAJE = { windOf, etdMs, fetchWind, useMet, provenance, hhmm, dayhm };
  APP().recalc();          // el viento guardado ya está disponible: recalcular con él
})();
