'use strict';
const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value) || 0;
const fmt = (n, d = 0) => n.toLocaleString('es', { maximumFractionDigits: d, minimumFractionDigits: d });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- Datos del modelo (vienen del POH, ver modelos.js) ----------
const MODELS = window.MODELS || {};
let MODEL = null, LIM = {};

// ---------- Unidades ----------
// Internamente todo se calcula en lb y galones US; los campos y resultados se muestran en la unidad elegida.
const KG_PER_LB = 0.45359237, L_PER_GAL = 3.785411784;
const WIDS = ['w_empty', 'w_front', 'w_rear', 'w_bagA', 'w_bagB', 'to_w', 'ld_w'];
const FIDS = ['f_gal', 'r_burn', 'r_taxi', 'r_climb'];
let wf = 1, ff = 1;                 // display -> canónico (lb, gal)
let curW = 'lb', curF = 'gal';      // unidad en la que están ahora los campos
const uw = () => $('u_w').value, uf = () => $('u_f').value;
const dW = lb => fmt(lb / wf) + ' ' + uw();                 // lb -> texto
const dF = (gal, d = 1) => fmt(gal / ff, d) + ' ' + uf();   // gal -> texto
function readUnits() {
  wf = uw() === 'kg' ? 1 / KG_PER_LB : 1;
  ff = uf() === 'L' ? 1 / L_PER_GAL : 1;
  document.querySelectorAll('.uw').forEach(e => e.textContent = uw());
  document.querySelectorAll('.uf').forEach(e => e.textContent = uf() === 'L' ? 'L' : 'gal');
}
function convertFields(ids, factor, decimals, snap = 0) {
  // snap: al volver a lb/gal, si el resultado queda a menos de "snap" de un entero se deja entero
  // (el kg/L mostrado tiene 1 decimal; sin esto 1663 lb -> kg -> lb termina en 1662,9)
  ids.forEach(id => {
    const v = parseFloat($(id).value);
    if (!isFinite(v)) return;
    const r = v * factor, n = Math.round(r);
    $(id).value = snap && Math.abs(r - n) < snap ? n : +r.toFixed(decimals);
  });
}
function onUnitChange() {
  const newW = uw(), newF = uf();
  if (newW !== curW) convertFields(WIDS, newW === 'kg' ? KG_PER_LB : 1 / KG_PER_LB, 1, newW === 'lb' ? 0.12 : 0);
  if (newF !== curF) convertFields(FIDS, newF === 'L' ? L_PER_GAL : 1 / L_PER_GAL, 1, newF === 'gal' ? 0.02 : 0);
  curW = newW; curF = newF;
  recalc();
}

const tankOf = () => MODEL.tanks.find(t => t.id === $('m_tank').value) || MODEL.tanks[0];
function readModel() {
  readUnits();
  MODEL = MODELS[$('fl_model').value] || MODELS.c172s;
  const m = MODEL, tank = tankOf();
  LIM = {
    mtow: m.w.mtow, ramp: m.w.ramp, mlw: m.w.mlw, fuelMax: tank.usable, lbPerGal: m.lbgal,
    fuelArm: m.arms.fuel, front: m.arms.front, rear: m.arms.rear, bagA: m.arms.bagA, bagB: m.arms.bagB,
    bagAMax: m.bag.A, bagBMax: m.bag.B, bagTotal: m.bag.tot,
    fwdKnee: m.cg.knee, fwdMin: m.cg.fwdMin, fwdMax: m.cg.fwdMax, aft: m.cg.aft,
    taxi: num('r_taxi') * ff, xw: m.v.xw
  };
  $('d_front').textContent = LIM.front; $('d_rear').textContent = LIM.rear;
  $('d_bagA').textContent = LIM.bagA; $('d_bagB').textContent = LIM.bagB; $('d_fuel').textContent = LIM.fuelArm;
  $('m_bagA').textContent = fmt(LIM.bagAMax / wf); $('m_bagB').textContent = fmt(LIM.bagBMax / wf);
  $('m_fuel').textContent = fmt(LIM.fuelMax / ff, 1);
}

// ---------- Tablas del POH: altitud presión × temperatura × peso ----------
// sheet.rows[pa/1000] = [recorrido, total a 50 ft] para 0, 10, 20, 30 y 40 °C; null = "---" (sin dato en el POH)
// Interpolación bilineal dentro de cada hoja y lineal entre hojas de peso. Nunca se extrapola fuera de la tabla.
function pohCell(sheet, pa, t, k) {
  const i = Math.min(Math.floor(pa / 1000), 7), j = Math.min(Math.floor(t / 10), 3);
  const fp = pa / 1000 - i, ft = t / 10 - j;
  let sum = 0;
  for (const [di, dj, wgt] of [[0, 0, (1 - fp) * (1 - ft)], [0, 1, (1 - fp) * ft], [1, 0, fp * (1 - ft)], [1, 1, fp * ft]]) {
    if (wgt < 1e-9) continue;                           // esa celda no pesa: no importa si está vacía
    const v = sheet.rows[i + di][2 * (j + dj) + k];
    if (v == null) return null;
    sum += wgt * v;
  }
  return sum;
}
function pohLookup(kind, pa, oat, w) {
  const T = MODEL.perf[kind], sheets = T.sheets.slice().sort((a, b) => a.w - b.w);
  const maxPA = MODEL.perf.pa[MODEL.perf.pa.length - 1], maxT = MODEL.perf.oat[MODEL.perf.oat.length - 1];
  if (pa > maxPA + 1e-9 || oat > maxT + 1e-9)
    return { out: `Fuera del rango de las tablas del POH (hasta ${fmt(maxPA)} ft de altitud presión y ${maxT} °C).` };
  const notes = [];
  let p = pa, t = oat;
  if (p < 0) { p = 0; notes.push('Altitud presión bajo el nivel del mar: se usa la fila S.L. del POH (conservador).'); }
  if (t < 0) { t = 0; notes.push('Temperatura bajo 0 °C: se usa la columna de 0 °C del POH (conservador).'); }
  const first = sheets[0], last = sheets[sheets.length - 1];
  let lo = first, hi = first, f = 0;
  if (sheets.length === 1) {
    if (w < first.w - 0.5) notes.push(`El POH publica esta tabla solo para ${dW(first.w)}: no hay corrección por peso (resultado conservador).`);
  } else if (w <= first.w) {
    if (w < first.w - 0.5) notes.push(`Peso bajo la hoja más liviana del POH (${dW(first.w)}): se usa esa hoja (conservador).`);
  } else if (w >= last.w) {
    lo = hi = last;
    if (w > last.w + 0.5) notes.push(`Peso sobre el máximo de las tablas del POH (${dW(last.w)}).`);
  } else {
    const i = sheets.findIndex((s, n) => w > s.w && w <= sheets[n + 1].w);
    lo = sheets[i]; hi = sheets[i + 1]; f = (w - lo.w) / (hi.w - lo.w);
  }
  const at = s => [pohCell(s, p, t, 0), pohCell(s, p, t, 1)];
  const a = at(lo), b = f > 0 ? at(hi) : a;
  if (a.includes(null) || b.includes(null))
    return { out: 'Sin dato en el POH para estas condiciones (celda "---"): según el POH, ahí el rendimiento de ascenso es mínimo.' };
  const mix = (x, y) => x + f * (y - x);
  return { gr: mix(a[0], b[0]), d50: mix(a[1], b[1]), vr: lo.vr != null ? mix(lo.vr, hi.vr) : null, v50: mix(lo.v50, hi.v50), notes };
}

// ---------- Crucero y ascenso del POH ----------
// cruise.alts[].rows = [RPM, [%BHP, KTAS, GPH] a ISA−20, ISA, ISA+20]; null = "---" (el POH no da dato).
// climb.rows = [alt ft, °C, KIAS, fpm, min, gal, NM] medidos desde el nivel del mar, a temperatura estándar y aire calmo.
// Se interpola linealmente (altitud, RPM, temperatura). Nunca se extrapola fuera de las tablas.
const mixV = (a, b, f) => a.map((v, i) => v + f * (b[i] - v));

// Una altitud de la tabla: interpola RPM y temperatura. Devuelve {v:[bhp,tas,gph]}, {range:[min,max]} o {nodata:true}
function cruiseRow(alt, rpm, dev) {
  const rows = alt.rows, lo = rows[rows.length - 1][0], hi = rows[0][0];
  if (rpm > hi + 1e-9 || rpm < lo - 1e-9) return { range: [lo, hi] };
  const i = rows.findIndex(r => r[0] <= rpm), A = rows[i], B = A[0] < rpm ? rows[i - 1] : A;
  const fr = B === A ? 0 : (rpm - A[0]) / (B[0] - A[0]);
  const j = dev < 0 ? 1 : 2, f = dev < 0 ? (dev + 20) / 20 : dev / 20;     // entre las columnas j y j+1 (1 = ISA−20, 2 = ISA, 3 = ISA+20)
  const at = row => { const a = row[j], b = f > 1e-9 ? row[j + 1] : a; return a && b ? mixV(a, b, f) : null; };
  const a = at(A), b = B === A ? a : at(B);
  return a && b ? { v: mixV(a, b, fr) } : { nodata: true };
}

// Crucero a una altitud presión, RPM y desviación ISA. Devuelve {bhp, tas, gph} o {out: motivo}
function cruiseAt(pa, rpm, dev) {
  const alts = MODEL.cruise.alts, amin = alts[0].pa, amax = alts[alts.length - 1].pa;
  if (dev < -20 - 1e-9 || dev > 20 + 1e-9) return { out: `El POH publica el crucero de 20 °C bajo a 20 °C sobre la ISA; tú ingresaste ${dev > 0 ? '+' : ''}${fmt(dev)} °C. Para otra temperatura usa el modo manual.` };
  if (pa < amin - 1e-9 || pa > amax + 1e-9) return { out: `El POH publica el crucero entre ${fmt(amin)} y ${fmt(amax)} ft de altitud presión. Para otra altitud usa el modo manual.` };
  const k = alts.findIndex((a, n) => n === alts.length - 1 || pa < alts[n + 1].pa);
  const A = alts[k], fa = k === alts.length - 1 ? 0 : (pa - A.pa) / (alts[k + 1].pa - A.pa), B = fa > 1e-9 ? alts[k + 1] : A;   // exacto en una altitud: no mezcla la vecina
  const ra = cruiseRow(A, rpm, dev), rb = B === A ? ra : cruiseRow(B, rpm, dev);
  for (const [alt, r] of [[A, ra], [B, rb]]) {
    if (r.range) return { out: `A ${fmt(alt.pa)} ft el POH publica de ${fmt(r.range[0])} a ${fmt(r.range[1])} RPM; ${fmt(rpm)} RPM queda fuera de la tabla.` };
  }
  if (ra.nodata || rb.nodata) return { out: 'El POH no publica dato ("---") para esa combinación de altitud, RPM y temperatura. Prueba con menos RPM.' };
  const [bhp, tas, gph] = mixV(ra.v, rb.v, fa);
  return { bhp, tas, gph };
}

// Rango de RPM publicado a una altitud (para guiar al piloto)
function rpmRange(pa) {
  const alts = MODEL.cruise.alts;
  if (pa < alts[0].pa || pa > alts[alts.length - 1].pa) return null;
  const k = alts.findIndex((a, n) => n === alts.length - 1 || pa < alts[n + 1].pa), near = pa - alts[k].pa < 1e-9 ? [alts[k]] : [alts[k], alts[k + 1]];
  return [Math.max(...near.map(a => a.rows[a.rows.length - 1][0])), Math.min(...near.map(a => a.rows[0][0]))];
}

// Ascenso desde el nivel del mar hasta una altitud: {min, gal, nm, kias}. Linealmente entre las filas de la tabla.
function climbFromSL(alt) {
  const rows = MODEL.climb.rows;
  if (alt <= 0) return { min: 0, gal: 0, nm: 0, kias: rows[0][2] };
  const k = rows.findIndex((r, n) => n === rows.length - 1 || alt < rows[n + 1][0]), A = rows[k], B = rows[Math.min(k + 1, rows.length - 1)];
  const f = B === A ? 0 : (alt - A[0]) / (B[0] - A[0]);
  return { min: A[4] + f * (B[4] - A[4]), gal: A[5] + f * (B[5] - A[5]), nm: A[6] + f * (B[6] - A[6]), kias: A[2] + f * (B[2] - A[2]) };
}
// Ascenso entre la altitud de salida y la de crucero; +10 % de tiempo, combustible y distancia por cada 10 °C sobre la estándar (nota del POH)
function climbBetween(fromPA, toPA, dev) {
  const top = MODEL.climb.rows[MODEL.climb.rows.length - 1][0];
  if (toPA > top + 1e-9) return { out: `El POH publica el ascenso hasta ${fmt(top)} ft. Para otra altitud usa el modo manual.` };
  const a = climbFromSL(Math.max(0, fromPA)), b = climbFromSL(toPA), k = 1 + Math.max(0, dev) / 100;
  const pos = x => Math.max(0, x);
  return { min: pos(b.min - a.min) * k, gal: pos(b.gal - a.gal) * k, nm: pos(b.nm - a.nm) * k, kias: b.kias };
}
// RPM de ejemplo para un modelo: la fila de 6000 ft (temperatura estándar) cuya potencia se acerca más al 65 %
function defaultRpm(m) {
  const a = m.cruise.alts.find(x => x.pa === 6000) || m.cruise.alts[0];
  return a.rows.reduce((best, r) => (r[2] && (!best || Math.abs(r[2][0] - 65) < Math.abs(best[2][0] - 65))) ? r : best, null)[0];
}

// ---------- Persistencia ----------
const KEY = 'c172smart.v2';
// data-nosave: campos de apoyo (buscadores, listas de pistas) que no se guardan
const FIELDS = 'input[id]:not([data-nosave]),select[id]:not([data-nosave]),textarea[id]';
// Resumen que se muestra en Inicio (lo llenan los cálculos)
const SUM = { wb: null, to: null, ld: null, fuel: null };
function save() {
  const o = {};
  document.querySelectorAll(FIELDS).forEach(e => o[e.id] = e.value);
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* sin almacenamiento */ }
}
function load() {
  let o = {};
  try {
    o = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    for (const [k, v] of Object.entries(o)) if (document.getElementById(k) && k !== 'm_tank') $(k).value = v;   // m_tank se restaura al armar sus opciones
  } catch (e) { /* ignorar */ }
  return o;
}

// ---------- Peso y balance ----------
function fwdLimit(w) {
  if (w <= LIM.fwdKnee) return LIM.fwdMin;
  return LIM.fwdMin + (w - LIM.fwdKnee) / (LIM.mtow - LIM.fwdKnee) * (LIM.fwdMax - LIM.fwdMin);
}
function inEnvelope(w, cg) { return w <= LIM.mtow && cg >= fwdLimit(w) && cg <= LIM.aft; }

function wbState(fuelGal) {
  const items = [
    [num('w_empty') * wf, num('a_empty')],
    [num('w_front') * wf, LIM.front],
    [num('w_rear') * wf, LIM.rear],
    [num('w_bagA') * wf, LIM.bagA],
    [num('w_bagB') * wf, LIM.bagB],
  ];
  const fuelW = Math.max(0, fuelGal) * LIM.lbPerGal;
  const w = items.reduce((s, i) => s + i[0], 0) + fuelW;
  const m = items.reduce((s, i) => s + i[0] * i[1], 0) + fuelW * LIM.fuelArm;
  return { w, cg: w ? m / w : 0 };
}

let TOW = 0;
function calcWB() {
  const gal = num('f_gal') * ff;
  const ramp = wbState(gal), toff = wbState(gal - LIM.taxi), zfw = wbState(0);
  const rows = [['Rampa', ramp], ['Despegue', toff], ['Sin combustible', zfw]];
  $('wb_res').innerHTML = rows.map(([n, s]) => {
    const ok = inEnvelope(s.w, s.cg) && (n !== 'Rampa' || s.w <= LIM.ramp);
    return `<tr><td>${n}</td><td>${fmt(s.w / wf)}</td><td>${fmt(s.cg, 2)}</td><td class="${ok ? 'tag-ok' : 'tag-bad'}">${ok ? '✔ Dentro' : '✖ Fuera'}</td></tr>`;
  }).join('');
  TOW = toff.w;

  const msgs = [], issues = [];
  const add = (t, c) => { msgs.push(`<div class="msg ${c}">${t}</div>`); if (c === 'bad') issues.push(t); };
  if (ramp.w > LIM.ramp) add(`Peso en rampa ${dW(ramp.w)} supera el máx. (${dW(LIM.ramp)}).`, 'bad');
  if (toff.w > LIM.mtow) add(`Peso de despegue ${dW(toff.w)} supera el MTOW (${dW(LIM.mtow)}) en ${dW(toff.w - LIM.mtow)}.`, 'bad');
  if (toff.cg > LIM.aft) add(`CG trasero fuera de límites (${fmt(toff.cg, 2)} > ${LIM.aft} in).`, 'bad');
  else if (toff.cg < fwdLimit(toff.w)) add(`CG delantero fuera de límites (${fmt(toff.cg, 2)} < ${fmt(fwdLimit(toff.w), 2)} in).`, 'bad');
  const bA = num('w_bagA') * wf, bB = num('w_bagB') * wf;
  if (bA > LIM.bagAMax) add(`Equipaje A supera ${dW(LIM.bagAMax)}.`, 'bad');
  if (bB > LIM.bagBMax) add(`Equipaje B supera ${dW(LIM.bagBMax)}.`, 'bad');
  if (bA + bB > LIM.bagTotal) add(`Equipaje total supera ${dW(LIM.bagTotal)}.`, 'bad');
  if (gal > LIM.fuelMax) add(`Combustible supera los ${dF(LIM.fuelMax, 0)} utilizables.`, 'bad');
  if (gal < LIM.taxi) add('El combustible cargado no alcanza para el rodaje indicado.', 'bad');
  if (!inEnvelope(zfw.w, zfw.cg)) add('El CG queda fuera de la envolvente al consumir el combustible.', 'bad');
  if (!msgs.length) add(`Dentro de límites. Margen de peso al MTOW: ${dW(LIM.mtow - toff.w)}.`, 'ok');
  if (toff.w <= LIM.mtow && gal < LIM.fuelMax) {
    const extra = Math.min(LIM.fuelMax - gal, Math.floor((LIM.mtow - toff.w) / LIM.lbPerGal));
    if (extra > 0) add(`Podrías cargar hasta ${dF(extra, 0)} más sin pasar el MTOW.`, 'warn');
  }
  $('wb_msgs').innerHTML = msgs.join('');
  SUM.wb = { ok: issues.length === 0, tow: toff.w, margin: LIM.mtow - toff.w, issues };
  drawChart([['Rampa', ramp, '#c4561b'], ['Despegue', toff, '#c4561b'], ['Sin combustible', zfw, '#2f5d8a']]);
}

function drawChart(points) {
  // La envolvente va sola en el gráfico; los tres puntos se identifican por forma y color y se explican en la leyenda de abajo
  // (rotularlos junto al punto los hacía chocar entre sí y con las etiquetas de límites: Rampa y Despegue casi coinciden).
  const W = 420, H = 396, L = 46, R = 14, T = 28, B = 112;
  const x0 = Math.floor(LIM.fwdMin) - 3, x1 = Math.ceil(LIM.aft) + 3;
  const y0 = Math.floor(LIM.fwdKnee * 0.7 / 100) * 100, y1 = Math.ceil(LIM.mtow / 100) * 100 + 100;
  const X = v => L + (v - x0) / (x1 - x0) * (W - L - R);
  const Y = v => H - B - (v - y0) / (y1 - y0) * (H - T - B);
  const pts = p => p.map(q => X(q[0]).toFixed(1) + ',' + Y(q[1]).toFixed(1)).join(' ');
  const yb = H - B, mid = (X(LIM.fwdMin) + X(LIM.aft)) / 2;
  let s = '';
  // zona fuera de límites (rojo suave) y envolvente operacional (verde)
  s += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${yb - T}" fill="#f1d9d4"/>`;
  const env = [[LIM.fwdMin, y0], [LIM.fwdMin, LIM.fwdKnee], [LIM.fwdMax, LIM.mtow], [LIM.aft, LIM.mtow], [LIM.aft, y0]];
  s += `<polygon points="${pts(env)}" fill="#d9e6db" stroke="#3d6b4f" stroke-width="2.5"/>`;
  // rejilla
  for (let x = Math.ceil(x0 / 2) * 2; x <= x1; x += 2) s += `<line x1="${X(x)}" y1="${T}" x2="${X(x)}" y2="${yb}" stroke="#fffdf8" stroke-opacity=".7"/><text x="${X(x)}" y="${yb + 13}" fill="#6f6a5e" font-size="10" text-anchor="middle">${x}</text>`;
  const step = uw() === 'kg' ? 100 : 250;
  for (let d = Math.ceil(y0 / wf / step) * step; d * wf <= y1; d += step) { const y = d * wf; s += `<line x1="${L}" y1="${Y(y)}" x2="${W - R}" y2="${Y(y)}" stroke="#fffdf8" stroke-opacity=".7"/><text x="${L - 4}" y="${Y(y) + 3}" fill="#6f6a5e" font-size="10" text-anchor="end">${fmt(d)}</text>`; }
  s += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${yb - T}" fill="none" stroke="#bdb39f"/>`;
  // límites: MTOW sobre su línea (fuera de la envolvente, para no tapar los puntos); CG delantero y trasero rotados en los bordes
  s += `<text x="${mid}" y="${Y(LIM.mtow) - 5}" fill="#6e1f18" font-size="11" font-weight="700" text-anchor="middle">MTOW ${dW(LIM.mtow)}</text>`;
  s += `<text x="${X(LIM.aft) + 10}" y="${(yb + Y(LIM.mtow)) / 2}" fill="#6e1f18" font-size="10" transform="rotate(90 ${X(LIM.aft) + 10} ${(yb + Y(LIM.mtow)) / 2})" text-anchor="middle">Límite trasero ${fmt(LIM.aft, 1)} in</text>`;
  s += `<text x="${X(LIM.fwdMin) - 7}" y="${(yb + Y(LIM.fwdKnee)) / 2}" fill="#6e1f18" font-size="10" transform="rotate(-90 ${X(LIM.fwdMin) - 7} ${(yb + Y(LIM.fwdKnee)) / 2})" text-anchor="middle">Límite delantero ${fmt(LIM.fwdMin, 1)} in</text>`;
  s += `<text x="${(L + W - R) / 2}" y="${yb + 28}" fill="#6f6a5e" font-size="11" text-anchor="middle">Posición del CG (in desde la referencia)</text>`;
  s += `<text x="12" y="${(T + yb) / 2}" fill="#6f6a5e" font-size="11" transform="rotate(-90 12 ${(T + yb) / 2})" text-anchor="middle">Peso (${uw()})</text>`;
  // desplazamiento del CG al consumir combustible: rampa -> despegue -> sin combustible
  const [ramp, toff, zfw] = points.map(p => p[1]);
  const cl = v => [clamp(v.cg, x0, x1), clamp(v.w, y0, y1)];
  s += `<polyline points="${pts([cl(ramp), cl(toff), cl(zfw)])}" fill="none" stroke="#26292c" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  // marcadores: Rampa = anillo grande, Despegue = punto lleno (dentro del anillo si casi coinciden), Sin combustible = cuadrado azul
  const marker = (i, cx, cy, ok, color) => {
    const c = ok ? color : '#a8342a';
    if (i === 0) return `<circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="${c}" stroke-width="2.5"/>`;
    if (i === 1) return `<circle cx="${cx}" cy="${cy}" r="5" fill="${c}" stroke="#fff" stroke-width="1.5"/>`;
    return `<rect x="${cx - 5.5}" y="${cy - 5.5}" width="11" height="11" fill="${c}" stroke="#fff" stroke-width="1.5"/>`;
  };
  const rows = [];
  points.forEach(([name, p, color], i) => {
    const ok = inEnvelope(p.w, p.cg);
    s += marker(i, X(clamp(p.cg, x0, x1)), Y(clamp(p.w, y0, y1)), ok, color);
    rows.push([i, name, p, ok, color]);
  });
  // leyenda con los valores (una fila por punto)
  const ly = yb + 52;
  s += `<line x1="${L}" y1="${ly - 14}" x2="${W - R}" y2="${ly - 14}" stroke="#ddd3bf"/>`;
  rows.forEach(([i, name, p, ok, color], n) => {
    const y = ly + n * 22;
    s += marker(i, L + 10, y - 4, ok, color);
    s += `<text x="${L + 28}" y="${y}" fill="#26292c" font-size="12" font-weight="700">${name}</text>`;
    s += `<text x="${L + 128}" y="${y}" fill="#26292c" font-size="12">${dW(p.w)} · CG ${fmt(p.cg, 2)} in</text>`;
    s += `<text x="${W - R}" y="${y}" fill="${ok ? '#2d7a4f' : '#a8342a'}" font-size="12" font-weight="700" text-anchor="end">${ok ? '✔ dentro' : '✖ fuera'}</text>`;
  });
  s += `<text x="${L}" y="16" fill="#26292c" font-size="12" font-weight="700">Envolvente de CG · categoría normal</text>`;
  s += `<text x="${W - R}" y="16" fill="#6f6a5e" font-size="10" text-anchor="end">verde = dentro · rojo = fuera</text>`;
  $('chart').innerHTML = s;
}

// ---------- Dibujo de pista ----------
const PLANE = (x, y, fill) => `<g transform="translate(${x},${y})" fill="${fill}" stroke="#fff" stroke-width="1">
  <path d="M-16 -2.5 L12 -2.5 L18 0 L12 2.5 L-16 2.5Z"/><path d="M-3 -17 L4 -17 L2.5 0 L4 17 L-3 17 L-1 0Z"/><path d="M-16 -7 L-12 -7 L-10 0 L-12 7 L-16 7 L-13 0Z"/></g>`;

function drawRunway(svgId, cfg) {
  // cfg: len, kind ('to'|'ld'), a (ft: liftoff/touchdown), b (ft: 50ft/stop), need (ft con margen), ok
  const X0 = 16, X1 = 464, Y0 = 62, Y1 = 112, YC = 87;
  // pista mucho más larga de lo necesario: se dibuja solo el primer tramo, con marca de corte
  const reach = Math.max(cfg.need, cfg.b), cut = cfg.len > reach * 2.2;
  const span = Math.max(1, cut ? reach * 1.9 : cfg.len, cfg.need, cfg.b) * 1.04;
  const sx = ft => X0 + ft / span * (X1 - X0);
  const rEnd = cut ? X1 : sx(cfg.len);
  let s = '';
  // terreno
  s += `<rect x="0" y="40" width="480" height="95" fill="#e4dfd0"/>`;
  // zona más allá del final de pista
  if (rEnd < X1) s += `<rect x="${rEnd}" y="${Y0}" width="${X1 - rEnd}" height="${Y1 - Y0}" fill="#cdbf9e"/>`;
  // pista
  s += `<rect x="${X0}" y="${Y0}" width="${rEnd - X0}" height="${Y1 - Y0}" fill="#4a4e53"/>`;
  // umbral (rayas) y numeración
  for (let i = 0; i < 6; i++) s += `<rect x="${X0 + 4}" y="${Y0 + 5 + i * 7.5}" width="12" height="4" fill="#f4efe3"/>`;
  if (!cut) s += `<rect x="${rEnd - 5}" y="${Y0}" width="3" height="${Y1 - Y0}" fill="#f4efe3"/>`;
  for (let x = X0 + 40; x < rEnd - 30; x += 28) s += `<rect x="${x}" y="${YC - 1}" width="14" height="2" fill="#d8d2c2"/>`;
  s += `<text x="${X0 + 22}" y="${YC + 4}" fill="#f4efe3" font-size="13" font-weight="700" text-anchor="start">${cfg.rwy > 0 ? String(Math.round(cfg.rwy)).padStart(2, '0') : ''}</text>`;

  const roll = cfg.kind === 'to'
    ? `<rect x="${X0}" y="${YC - 5}" width="${sx(cfg.a) - X0}" height="10" fill="#c4561b" opacity=".9"/>`
    : `<rect x="${sx(cfg.a)}" y="${YC - 5}" width="${sx(cfg.b) - sx(cfg.a)}" height="10" fill="#d9b43a" opacity=".95"/>`;
  s += roll;
  // tramo en el aire (línea punteada con altura)
  if (cfg.kind === 'to') {
    s += `<path d="M${sx(cfg.a)} ${YC} Q${(sx(cfg.a) + sx(cfg.b)) / 2} ${YC - 30} ${sx(cfg.b)} ${YC - 34}" fill="none" stroke="#f4efe3" stroke-width="2" stroke-dasharray="5 4"/>`;
  } else {
    s += `<path d="M${X0} ${YC - 34} Q${(X0 + sx(cfg.a)) / 2} ${YC - 30} ${sx(cfg.a)} ${YC}" fill="none" stroke="#f4efe3" stroke-width="2" stroke-dasharray="5 4"/>`;
  }
  // margen de seguridad
  const col = cfg.ok === 'ok' ? '#3d6b4f' : cfg.ok === 'warn' ? '#a87414' : '#a8342a';
  s += `<line x1="${sx(cfg.need)}" y1="${Y0 - 26}" x2="${sx(cfg.need)}" y2="${Y1 + 6}" stroke="${col}" stroke-width="2" stroke-dasharray="4 3"/>`;
  s += `<text x="${sx(cfg.need)}" y="${Y0 - 30}" fill="${col}" font-size="12" font-weight="700" text-anchor="${sx(cfg.need) > 380 ? 'end' : 'start'}">${cfg.mp > 0 ? '+' + fmt(cfg.mp) + ' %: ' : 'Necesario: '}${fmt(cfg.need)} ft</text>`;

  // marcadores y aviones
  if (cfg.kind === 'to') {
    s += PLANE(sx(cfg.a), YC, '#fffdf8');
    s += `<text x="${sx(cfg.a)}" y="${Y1 + 20}" fill="#9c4214" font-size="12" font-weight="700" text-anchor="middle">Despegue ${fmt(cfg.a)} ft</text>`;
    s += `<circle cx="${sx(cfg.b)}" cy="${YC - 34}" r="4" fill="#26292c"/>`;
    s += `<text x="${sx(cfg.b)}" y="${YC - 42}" fill="#26292c" font-size="12" text-anchor="middle">50 ft · ${fmt(cfg.b)} ft</text>`;
    s += `<text x="${X0}" y="${Y1 + 36}" fill="#6f6a5e" font-size="12">Inicio de carrera</text>`;
  } else {
    s += PLANE(sx(cfg.a), YC, '#fffdf8') ;
    s += PLANE(sx(cfg.b), YC, '#d9b43a');
    s += `<circle cx="${X0}" cy="${YC - 34}" r="4" fill="#26292c"/>`;
    s += `<text x="${X0 + 8}" y="${YC - 42}" fill="#26292c" font-size="12">Umbral a 50 ft</text>`;
    s += `<text x="${sx(cfg.a)}" y="${Y1 + 20}" fill="#6f6a5e" font-size="12" font-weight="700" text-anchor="middle">Toma ${fmt(cfg.a)} ft</text>`;
    s += `<text x="${sx(cfg.b)}" y="${Y1 + 34}" fill="#8a6a10" font-size="12" font-weight="700" text-anchor="middle">Parada ${fmt(cfg.b)} ft</text>`;
  }
  // final de pista
  if (cut) {
    s += `<path d="M${X1 - 22} ${Y1 + 3} L${X1 - 10} ${Y0 - 3}" stroke="#e4dfd0" stroke-width="8"/>`;
    s += `<text x="${X1}" y="${Y1 + 50}" fill="#26292c" font-size="12" text-anchor="end">Pista de ${fmt(cfg.len)} ft (se muestra el primer tramo)</text>`;
  } else {
    s += `<text x="${rEnd}" y="${Y1 + 50}" fill="#26292c" font-size="12" text-anchor="${rEnd > 400 ? 'end' : 'middle'}">Fin de pista: ${fmt(cfg.len)} ft</text>`;
  }
  if (cfg.b > cfg.len) s += `<text x="${(rEnd + X1) / 2}" y="${YC + 4}" fill="#a8342a" font-size="12" font-weight="700" text-anchor="middle">¡FUERA!</text>`;
  $(svgId).innerHTML = s;
}

// ---------- Performance ----------
// p = '' (condiciones de salida) o 'a_' (condiciones de llegada)
function atmosphere(p = '') {
  const n = id => num(p + id);
  const pa = n('elev') + (1013.25 - n('qnh')) * 27;
  const isa = 15 - 1.98 * pa / 1000;
  const da = pa + 120 * (n('oat') - isa);
  const rwy = n('rwy') * 10, ang = (n('wdir') - rwy) * Math.PI / 180, ws = n('wspd');
  return { pa, da, isaDev: n('oat') - isa, head: ws * Math.cos(ang), cross: ws * Math.sin(ang) };
}
function windFactor(head) {
  return head >= 0 ? Math.max(0.5, 1 - 0.10 * head / 9) : 1 + 0.10 * (-head) / 2;
}
// Margen de seguridad sobre la distancia hasta/desde 50 ft (práctica recomendada, no un valor del POH)
const marginPct = () => Math.max(0, parseFloat($('p_margin').value) || 0);
const marginLbl = p => p > 0 ? `Con margen ${fmt(p)} %` : 'Sin margen (POH)';
const kpi = (label, value, cls = '') => `<div class="kpi ${cls}"><b>${value}</b><span>${label}</span></div>`;

// KPI de atmósfera, viento y pista de un aeródromo
function atmKpis(a) {
  const xw = Math.abs(a.cross);
  return kpi('Altitud presión', fmt(a.pa) + ' ft') +
    kpi('Altitud densidad', fmt(a.da) + ' ft', a.da > 5000 ? 'warn' : '') +
    kpi('Desviación ISA', (a.isaDev >= 0 ? '+' : '') + fmt(a.isaDev) + ' °C') +
    kpi(a.head >= 0 ? 'Viento de frente' : 'Viento de cola', fmt(Math.abs(a.head)) + ' kt', a.head < 0 ? 'warn' : '') +
    kpi('Viento cruzado', fmt(xw) + ' kt', xw > LIM.xw ? 'bad' : xw > LIM.xw * 0.7 ? 'warn' : 'ok');
}

function calcPerf() {
  const aD = atmosphere(), aA = atmosphere('a_');
  $('atm_out').innerHTML = atmKpis(aD);
  $('a_atm_out').innerHTML = atmKpis(aA);

  const notesHtml = (r, a) => [...(r.notes || []), ...(a.head < -10 ? ['Viento de cola de más de 10 kt: el POH solo cubre hasta 10 kt de cola; el resultado no es confiable.'] : [])]
    .map(t => `<div class="msg warn">${t}</div>`).join('');

  // Despegue: condiciones del aeródromo de salida. Tablas del POH (altitud presión × temperatura × peso)
  // corregidas por viento y superficie según las notas del propio POH.
  const mp = marginPct(), mk = 1 + mp / 100;
  const wT = num('to_w') * wf, sf = num('to_surf'), lenT = num('to_len');
  $('to_cond').textContent = `${MODEL.perf.to.flaps}, gas a fondo antes de soltar frenos`;
  const rT = pohLookup('to', aD.pa, num('oat'), wT);
  if (rT.out) {
    $('to_out').innerHTML = kpi('Sin dato del POH', 'No disponible', 'bad');
    $('to_notes').innerHTML = `<div class="msg bad">${rT.out}</div>`;
    $('to_fig').innerHTML = '';
    SUM.to = { ok: 'bad', out: rT.out };
  } else {
    const wfT = windFactor(aD.head);
    const gr = rT.gr * wfT * sf;
    const d50 = rT.d50 * wfT + (sf - 1) * rT.gr * wfT;
    const need = d50 * mk;
    const okT = need <= lenT ? 'ok' : (d50 <= lenT ? 'warn' : 'bad');
    $('to_out').innerHTML =
      kpi('Recorrido de despegue', fmt(gr) + ' ft') +
      kpi('Hasta 50 ft', fmt(d50) + ' ft', okT) +
      kpi(marginLbl(mp), fmt(need) + ' ft', okT) +
      kpi('Pista restante', fmt(lenT - need) + ' ft', okT) +
      kpi('Rotación / a 50 ft', `${fmt(rT.vr)} / ${fmt(rT.v50)} KIAS`) +
      (wT > LIM.mtow ? kpi('¡Sobrepeso!', dW(wT - LIM.mtow), 'bad') : '');
    $('to_notes').innerHTML = notesHtml(rT, aD);
    drawRunway('to_fig', { kind: 'to', len: lenT, a: gr, b: d50, need, ok: okT, rwy: num('rwy'), mp });
    SUM.to = { need, len: lenT, ok: okT, mp };
  }

  // Aterrizaje: condiciones del aeródromo de llegada
  const wL = num('ld_w') * wf, sl = num('ld_surf'), lenL = num('ld_len');
  $('ld_cond').textContent = `${MODEL.perf.ld.flaps}, motor al ralentí, frenado máx.`;
  const rL = pohLookup('ld', aA.pa, num('a_oat'), wL);
  if (rL.out) {
    $('ld_out').innerHTML = kpi('Sin dato del POH', 'No disponible', 'bad');
    $('ld_notes').innerHTML = `<div class="msg bad">${rL.out}</div>`;
    $('ld_fig').innerHTML = '';
    SUM.ld = { ok: 'bad', out: rL.out };
  } else {
    const wfL = windFactor(aA.head);
    const lgr = rL.gr * wfL * sl;
    const l50 = rL.d50 * wfL + (sl - 1) * rL.gr * wfL;
    const needL = l50 * mk;
    const okL = needL <= lenL ? 'ok' : (l50 <= lenL ? 'warn' : 'bad');
    $('ld_out').innerHTML =
      kpi('Recorrido de aterrizaje', fmt(lgr) + ' ft') +
      kpi('Desde 50 ft', fmt(l50) + ' ft', okL) +
      kpi(marginLbl(mp), fmt(needL) + ' ft', okL) +
      kpi('Pista restante', fmt(lenL - needL) + ' ft', okL) +
      kpi('Velocidad a 50 ft', fmt(rL.v50) + ' KIAS') +
      (wL > LIM.mlw ? kpi('¡Sobre peso máx. de aterrizaje!', dW(wL - LIM.mlw), 'bad') : '');
    $('ld_notes').innerHTML = notesHtml(rL, aA);
    drawRunway('ld_fig', { kind: 'ld', len: lenL, a: Math.max(0, l50 - lgr), b: l50, need: needL, ok: okL, rwy: num('a_rwy'), mp });
    SUM.ld = { need: needL, len: lenL, ok: okL, mp };
  }
}

// ---------- Combustible ----------
// Plan de vuelo: rodaje/despegue + ascenso + crucero + reserva. Con las tablas del POH (modo "poh") o con valores propios (modo "man").
let fuelNeeded = 0, enrouteFuel = 0, PLAN = null;
const hm = hrs => { const t = Math.round(hrs * 60); return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, '0')} min`; };
const mm = min => min < 1 ? '< 1 min' : `${fmt(Math.round(min))} min`;

function syncMode() {
  const poh = $('r_mode').value !== 'man';
  $('r_poh_f').hidden = !poh; $('r_poh_info').hidden = !poh; $('r_man_f').hidden = poh;
}

function failFuel(msg) {
  PLAN = null; fuelNeeded = enrouteFuel = 0;
  $('fuel_msg').innerHTML = `<div class="msg bad">${msg}</div>`;
  $('fuel_tbl').replaceChildren(); $('fuel_out').replaceChildren(); $('fuel_note').textContent = '';
  $('fuel_apply').disabled = true;
  SUM.fuel = { err: msg };
}

function calcFuel() {
  const poh = $('r_mode').value !== 'man';
  const d = num('r_dist'), wind = num('r_wind'), resMin = num('r_res'), taxi = LIM.taxi, have = num('f_gal') * ff;
  const warns = [];
  let tas, burn, bhp = null, climb = { min: 0, gal: 0, nm: 0 }, cruiseTxt, climbTxt, cruiseSub = '', climbSub = '', note;

  if (poh) {
    const aD = atmosphere(), dev = num('r_isa'), alt = num('r_alt'), rpm = num('r_rpm');
    const rr = rpmRange(alt);
    $('r_poh_info').textContent = rr ? `El POH publica de ${fmt(rr[0])} a ${fmt(rr[1])} RPM a ${fmt(alt)} ft.` : '';
    const cr = cruiseAt(alt, rpm, dev);
    if (cr.out) return failFuel(cr.out);
    const c = climbBetween(aD.pa, alt, dev);
    if (c.out) return failFuel(c.out);
    tas = cr.tas; burn = cr.gph; bhp = cr.bhp; climb = c;
    $('r_poh_info').textContent += ` A ${fmt(rpm)} RPM: ${fmt(bhp)} % de potencia, ${fmt(tas)} kt TAS, ${fmt(burn, 1)} gal/h.`;
    climbTxt = 'Ascenso'; climbSub = `a ${fmt(alt)} ft${aD.pa > 100 ? ', desde ' + fmt(aD.pa) + ' ft' : ''} · ${fmt(c.kias)} KIAS aprox.`;
    cruiseTxt = 'Crucero'; cruiseSub = `${fmt(alt)} ft · ${fmt(rpm)} RPM · ${fmt(bhp)} %`;
    if (bhp > 75) warns.push(`Potencia de ${fmt(bhp)} %: sobre el 75 % el consumo sube y el motor trabaja más fuerte. Revisa la sección 4 del POH (crucero).`);
    note = `Ascenso (Fig. 5-7) y crucero (Fig. 5-8) del POH, mezcla pobre, a ${dW(MODEL.cruise.w)} (el POH no corrige por peso: con menos peso rendirá algo mejor). ` +
      `Ascenso con gas a fondo en aire calmo${dev > 0 ? `, con +${fmt(dev * 10)} % por ${fmt(dev)} °C sobre la ISA (nota del POH)` : ''}. Valores de avión nuevo: uno con horas consume algo más, para eso está la reserva.`;
  } else {
    tas = num('r_tas'); burn = num('r_burn') * ff; climb.gal = num('r_climb') * ff;
    climbTxt = 'Ascenso (extra)'; cruiseTxt = 'Crucero'; cruiseSub = 'valores manuales';
    note = 'Modo manual: TAS, consumo y combustible de ascenso son los que ingresaste, no del POH. El ascenso extra se suma al crucero de toda la distancia.';
  }

  const gs = tas - wind;
  if (!(gs > 0)) return failFuel('El viento de frente iguala o supera la velocidad verdadera: no hay avance. Revisa viento y crucero.');
  if (d < climb.nm) warns.push(`La ruta (${fmt(d)} NM) es más corta que el ascenso hasta esa altitud (${fmt(climb.nm)} NM): el cálculo sobreestima; baja la altitud de crucero.`);
  const cruiseNm = Math.max(0, d - climb.nm), hrsC = cruiseNm / gs, cruiseGal = hrsC * burn, res = resMin / 60 * burn;
  const total = taxi + climb.gal + cruiseGal + res, flightHrs = climb.min / 60 + hrsC;
  const over = total > LIM.fuelMax, short = have + 1e-9 < total;
  const rangeWith = gal => { const av = gal - taxi - climb.gal - res; return av > 0 ? climb.nm + av / burn * gs : 0; };
  const rangeLoaded = rangeWith(have), rangeFull = rangeWith(LIM.fuelMax);

  fuelNeeded = total; enrouteFuel = climb.gal + cruiseGal;
  PLAN = { gs, tas, burn, total, hours: flightHrs, ete: nm => climb.min / 60 + Math.max(0, nm - climb.nm) / gs };
  $('fuel_apply').disabled = over;   // no se puede cargar lo que no cabe en los tanques

  let msg;
  if (over) msg = ['bad', `<b>No llegas sin escala.</b> La ruta pide ${dF(total)} y los tanques rinden ${dF(LIM.fuelMax, 0)}. Con tanques llenos y ${fmt(resMin)} min de reserva alcanzas unas ${fmt(rangeFull)} NM a ${fmt(gs)} kt de velocidad suelo. Opciones: hacer escala, bajar RPM o aceptar menos reserva.`];
  else if (short) msg = ['bad', `<b>El combustible cargado no alcanza.</b> Tienes ${dF(have)} y necesitas ${dF(total)}: faltan ${(total - have) / ff < 0.05 ? 'menos de 0,1 ' + (uf() === 'L' ? 'L' : 'gal') : dF(total - have)}. Con lo cargado llegas hasta unas ${fmt(rangeLoaded)} NM con reserva. Usa el botón de abajo para cargar lo necesario.`];
  else msg = ['ok', `<b>Alcanza.</b> Con ${dF(have)} llegas con ${dF(have - total)} sobre la reserva de ${fmt(resMin)} min.`];
  $('fuel_msg').innerHTML = `<div class="msg ${msg[0]}">${msg[1]}</div>` + warns.map(w => `<div class="msg warn">${w}</div>`).join('');

  const row = (a, t, nm, g, sub) => `<tr><td>${a}${sub ? `<small>${sub}</small>` : ''}</td><td>${t}</td><td>${nm}</td><td>${g}</td></tr>`;
  $('fuel_tbl').innerHTML = '<thead><tr><th>Fase</th><th>Tiempo</th><th>Dist.</th><th>Comb.</th></tr></thead><tbody>' +
    row('Rodaje + despegue', '—', '—', dF(taxi)) +
    row(climbTxt, poh ? mm(climb.min) : '—', poh ? fmt(climb.nm) + ' NM' : '—', dF(climb.gal), climbSub) +
    row(cruiseTxt, hm(hrsC), fmt(cruiseNm) + ' NM', dF(cruiseGal), `${cruiseSub ? cruiseSub + ' · ' : ''}TAS ${fmt(tas)} kt, suelo ${fmt(gs)} kt · ${fmt(burn / ff, 1)} ${uf() === 'L' ? 'L' : 'gal'}/h`) +
    row('Reserva', mm(resMin), '—', dF(res), `${fmt(resMin)} min a consumo de crucero`) +
    `</tbody><tfoot><tr><td>Total</td><td>${hm(flightHrs)}</td><td>${fmt(d)} NM</td><td>${dF(total)}</td></tr></tfoot>`;

  $('fuel_out').innerHTML =
    kpi('Total necesario', dF(total), over || short ? 'bad' : 'ok') +
    kpi('Tiempo de vuelo', hm(flightHrs)) +
    kpi('Total en peso', dW(total * LIM.lbPerGal)) +
    kpi(`Alcance con ${dF(have, 0)} cargados`, fmt(rangeLoaded) + ' NM', short ? 'bad' : '') +
    kpi(`Alcance con ${dF(LIM.fuelMax, 0)} (llenos)`, fmt(rangeFull) + ' NM');
  $('fuel_note').textContent = note + ' La distancia es en línea recta entre aeródromos: la ruta real suele ser algo más larga.';
  SUM.fuel = { need: total, have, max: LIM.fuelMax };
}

// ---------- Puente para el mapa de rutas (mapa.js) ----------
// Usa los mismos datos de crucero y ascenso que la pestaña Combustible (tablas del POH o valores manuales).
function routeParams() {
  const poh = $('r_mode').value !== 'man', resMin = num('r_res'), taxi = LIM.taxi;
  if (!poh) return { tas: num('r_tas'), gph: num('r_burn') * ff, climb: { min: 0, gal: num('r_climb') * ff, nm: 0 }, taxi, resMin, alt: num('r_alt'), poh, info: `Valores manuales: ${fmt(num('r_tas'))} kt, ${fmt(num('r_burn'), 1)} ${uf() === 'L' ? 'L' : 'gal'}/h` };
  const aD = atmosphere(), dev = num('r_isa'), alt = num('r_alt'), rpm = num('r_rpm');
  const cr = cruiseAt(alt, rpm, dev);
  if (cr.out) return { err: cr.out };
  const c = climbBetween(aD.pa, alt, dev);
  if (c.out) return { err: c.out };
  return { tas: cr.tas, gph: cr.gph, climb: { min: c.min, gal: c.gal, nm: c.nm }, taxi, resMin, alt, poh, info: `Tablas del POH: ${fmt(alt)} ft, ${fmt(rpm)} RPM, ${fmt(cr.tas)} kt TAS, ${fmt(cr.gph / ff, 1)} ${uf() === 'L' ? 'L' : 'gal'}/h` };
}
window.APP = {
  go: t => go(t), recalc: () => recalc(), params: routeParams,
  fmt, hm, mm, dF, uf: () => (uf() === 'L' ? 'L' : 'gal'),
  // combustible de la ruta (con reserva y rodaje) a Peso y balance: se redondea hacia arriba, sin pasar del tanque
  applyFuel(gal) {
    const cap = Math.floor(LIM.fuelMax / ff * 10 + 1e-9) / 10;
    $('f_gal').value = Math.min(cap, +(Math.ceil(gal / ff * 10 - 1e-9) / 10).toFixed(1));
    recalc(); go('wb');
  },
  tankCap: () => LIM.fuelMax,
  have: () => num('f_gal') * ff,
  // distancia y viento de frente medio de la ruta al planificador de un solo tramo de Combustible
  legacy(nm, head) { $('r_dist').value = Math.ceil(nm); $('r_wind').value = Math.round(head); recalc(); },
  altitude: () => num('r_alt'),
};

// ---------- Inicio: vuelo y resumen ----------
function setRow(id, cls, title, text) {
  const r = $(id);
  r.querySelector('.dot').className = 'dot ' + cls;
  r.querySelector('b').textContent = title;
  r.querySelector('small').textContent = text;
}
const fitText = o => o.out ? o.out : o.ok === 'ok' ? (o.mp > 0 ? `Con margen del ${fmt(o.mp)} %: ${fmt(o.need)} ft de ${fmt(o.len)} ft disponibles` : `Cabe según el POH: ${fmt(o.need)} ft de ${fmt(o.len)} ft disponibles`)
  : o.ok === 'warn' ? `Sin el margen del ${fmt(o.mp)} %: pide ${fmt(o.need)} ft, hay ${fmt(o.len)} ft`
  : `No cabe: pide ${fmt(o.need)} ft, hay ${fmt(o.len)} ft`;

// valid = false: el boleto de vuelo se sigue actualizando, pero el resumen avisa que faltan datos
function renderHome(valid = true) {
  const A = window.AD;
  const f = A ? A.get($('fl_from').value) : null, t = A ? A.get($('fl_to').value) : null;
  $('tk_from').textContent = f ? f.i : '----';
  $('tk_from_n').textContent = f ? f.n : 'Sin elegir';
  $('tk_to').textContent = t ? t.i : '----';
  $('tk_to_n').textContent = t ? t.n : 'Sin elegir';
  $('seg_dep').textContent = f ? f.i : '';
  $('seg_arr').textContent = t ? t.i : '';
  $('chip').textContent = f || t ? `${f ? f.i : '····'} → ${t ? t.i : '····'}` : 'Sin vuelo';

  const rt = f && t ? A.route(f, t) : null;
  $('tk_dist').textContent = rt ? fmt(rt.nm) + ' NM' : '';
  const noPos = f && t ? [f, t].filter(a => a.lat == null || a.lon == null).map(a => a.i).join(' y ') : '';
  $('tk_meta').textContent = rt
    ? `En línea recta · rumbo verdadero ${String(Math.round(rt.brg) % 360).padStart(3, '0')}°` + (PLAN ? ` · ETE ${hm(PLAN.ete(rt.nm))} a ${fmt(PLAN.gs)} kt de velocidad suelo` : '')
    : (f && t ? `⚠ Falta la posición de ${noPos}: no se puede calcular la distancia.` : 'Elige origen y destino para ver distancia, rumbo y tiempo.');
  // Caja de ruta en Combustible: avisa si la distancia usada no es la de la ruta, o si no hay coordenadas (nunca usar una distancia antigua en silencio)
  const box = $('fuel_route');
  box.hidden = !(f && t);
  box.classList.toggle('warnbox', !!(f && t) && (!rt || Math.ceil(rt.nm) !== num('r_dist')));
  if (f && t) {
    const used = num('r_dist'), same = rt && Math.ceil(rt.nm) === used;
    $('fuel_route_txt').textContent = !rt ? `⚠ Falta la posición de ${noPos}: no se pudo calcular la distancia ${f.i} → ${t.i}. Ingrésala a mano.`
      : same ? `✔ ${f.i} → ${t.i}: ${fmt(rt.nm)} NM en línea recta (la que usa el planificador)`
      : `${f.i} → ${t.i}: ${fmt(rt.nm)} NM en línea recta. ⚠ El planificador usa ${fmt(used)} NM.`;
    $('fuel_route_apply').hidden = !rt || same;
  }

  $('model_specs').textContent = `MTOW ${dW(LIM.mtow)} · ${dF(LIM.fuelMax, 0)} utilizables · Fuente: ${MODEL.poh}`;

  if (!valid) {
    setRow('sum_wb', 'warn', 'Peso y balance', invalidMsg);
    [['sum_to', 'Despegue'], ['sum_ld', 'Aterrizaje'], ['sum_fuel', 'Combustible']]
      .forEach(([id, title]) => setRow(id, 'warn', title, 'Resultado suspendido hasta corregir los datos.'));
    return;
  }
  const w = SUM.wb;
  if (w) setRow('sum_wb', w.ok ? 'ok' : 'bad', 'Peso y balance',
    w.ok ? `Dentro de límites · despegue ${dW(w.tow)} · margen ${dW(w.margin)}`
      : w.issues[0] + (w.issues.length > 1 ? ` (y ${w.issues.length - 1} más)` : ''));
  if (SUM.to) setRow('sum_to', SUM.to.ok, 'Despegue' + (f ? ' · ' + f.i : ''), fitText(SUM.to));
  if (SUM.ld) setRow('sum_ld', SUM.ld.ok, 'Aterrizaje' + (t ? ' · ' + t.i : ''), fitText(SUM.ld));
  const fu = SUM.fuel;
  if (fu && fu.err) setRow('sum_fuel', 'bad', 'Combustible', fu.err);
  else if (fu) {
    // 1e-9: tolerancia de coma flotante (p. ej. litros convertidos de ida y vuelta)
    const short = fu.have + 1e-9 < fu.need;
    const cls = fu.need > fu.max || short ? 'bad' : 'ok';
    setRow('sum_fuel', cls, 'Combustible',
      fu.need > fu.max ? `La ruta pide ${dF(fu.need)} y el tanque rinde ${dF(fu.max, 0)}`
        : short ? `Cargado ${dF(fu.have)}, necesitas ${dF(fu.need)}`
        : `Cargado ${dF(fu.have)} · necesitas ${dF(fu.need)} con reserva`);
  }
}

// ---------- Modelo: selector y vistas de solo lectura ----------
// Todo sale de MODELS (modelos.js), transcrito del POH de cada modelo. No hay datos inventados en la app.
const MODEL_ORDER = ['c172s', 'c172r', 'c172p', 'c172n', 'c172m'];
const lbkg = lb => `${fmt(lb)} lb (${fmt(lb * KG_PER_LB)} kg)`;
const tbl = rows => `<table class="grid ro"><tbody>${rows.filter(r => r[1] != null && r[1] !== '')
  .map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</tbody></table>`;

// Cambia de modelo. reset = true precarga los ejemplos del POH (peso vacío, brazo y cargas típicas).
function setModel(id, reset, tankId) {
  if (!MODELS[id]) id = MODEL_ORDER.find(k => MODELS[k]);
  $('fl_model').value = id;
  MODEL = MODELS[id];
  const sel = $('m_tank');
  sel.innerHTML = MODEL.tanks.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
  sel.value = MODEL.tanks.some(t => t.id === tankId) ? tankId : MODEL.tanks[0].id;
  $('tank_row').hidden = MODEL.tanks.length < 2;
  readModel();
  if (reset) {
    const w = lb => +(lb / wf).toFixed(wf === 1 ? 0 : 1), g = gal => +(gal / ff).toFixed(ff === 1 ? 0 : 1);
    $('w_empty').value = w(MODEL.empty.w);
    $('a_empty').value = MODEL.empty.arm;
    $('to_w').value = w(Math.round(MODEL.w.mtow * 0.94 / 10) * 10);
    $('ld_w').value = w(Math.round(MODEL.w.mtow * 0.86 / 10) * 10);
    $('f_gal').value = g(Math.round(LIM.fuelMax * 0.75));
    $('r_taxi').value = +(MODEL.climb.allow / ff).toFixed(1);   // rodaje y despegue: el valor del POH del modelo
    $('r_rpm').value = defaultRpm(MODEL);
  }
  renderModelUI();
  renderModelViews();
}

function renderModelUI() {
  $('model_list').innerHTML = MODEL_ORDER.filter(k => MODELS[k]).map(k => {
    const m = MODELS[k], on = m === MODEL;
    return `<button type="button" class="model${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-model="${k}">
      <span class="mico"><svg class="ic" aria-hidden="true"><use href="#i-plane"/></svg></span>
      <span class="mtxt"><b>${m.nombre}</b><small>${m.sub}</small></span>
      <span class="check" aria-hidden="true">✔</span></button>`;
  }).join('') + '<div class="model soon"><span>Más modelos (K, L, Q…) próximamente, a medida que se carguen sus POH</span></div>';
  $('taxi_poh').textContent = `El POH del ${MODEL.nombre.replace('Cessna ', '').replace(' Skyhawk', '')} indica ${fmt(MODEL.climb.allow, 1)} gal (${fmt(MODEL.climb.allow * L_PER_GAL, 1)} L) para arranque, rodaje y despegue. Súmale rodaje largo o espera en cabecera.`;
  $('empty_note').textContent = `Peso vacío y brazo precargados con el ejemplo del POH (${MODEL.empty.nota.replace(/^Ejemplo del POH: /, '')}). Reemplázalos por los de la hoja de peso y balance de tu matrícula.`;
}

function sheetTable(sh, m) {
  const head = `<tr><th rowspan="2">Alt. presión (ft)</th>${m.perf.oat.map(t => `<th colspan="2">${t} °C</th>`).join('')}</tr>` +
    `<tr>${m.perf.oat.map(() => '<th>Suelo</th><th>50 ft</th>').join('')}</tr>`;
  const body = m.perf.pa.map((pa, i) => `<tr><th>${pa === 0 ? 'S.L.' : fmt(pa)}</th>${sh.rows[i].map(x => `<td>${x == null ? '—' : fmt(x)}</td>`).join('')}</tr>`).join('');
  return `<div class="tscroll"><table class="ptab"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function cruiseTable(a) {
  const head = '<tr><th rowspan="2">RPM</th>' + ['ISA −20 °C', 'ISA', 'ISA +20 °C'].map(t => `<th colspan="3">${t}</th>`).join('') + '</tr><tr>' + '<th>%</th><th>KTAS</th><th>GPH</th>'.repeat(3) + '</tr>';
  const body = a.rows.map(r => `<tr><th>${r[0]}</th>${r.slice(1).map(c => c ? `<td>${c[0]}</td><td>${c[1]}</td><td>${fmt(c[2], 1)}</td>` : '<td>—</td><td>—</td><td>—</td>').join('')}</tr>`).join('');
  return `<p class="sub">${fmt(a.pa)} ft de altitud presión</p><div class="tscroll"><table class="ptab"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}
function climbTable(m) {
  const head = '<tr><th>Alt. (ft)</th><th>°C</th><th>KIAS</th><th>fpm</th><th>min</th><th>gal</th><th>NM</th></tr>';
  const body = m.climb.rows.map(r => `<tr><th>${r[0] === 0 ? 'S.L.' : fmt(r[0])}</th><td>${r[1]}</td><td>${r[2]}</td><td>${fmt(r[3])}</td><td>${r[4]}</td><td>${fmt(r[5], 1)}</td><td>${r[6]}</td></tr>`).join('');
  return `<div class="tscroll"><table class="ptab"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function renderModelViews() {
  const m = MODEL, v = m.v, w = m.w;
  const kias = x => `${x} KIAS`, byW = (a, b) => b.w - a.w;
  const speeds = [
    ...m.perf.to.sheets.slice().sort(byW).map(s => [`Despegue a ${lbkg(s.w)}`, s.vr != null ? `Rotación ${kias(s.vr)} · a 50 ft ${kias(s.v50)}` : `a 50 ft ${kias(s.v50)}`]),
    ['V<sub>X</sub> mejor ángulo de ascenso', `${kias(v.vx[0])} a nivel del mar · ${kias(v.vx[1])} a 10 000 ft`],
    ['V<sub>Y</sub> mejor régimen de ascenso', `${kias(v.vy[0])} a nivel del mar · ${kias(v.vy[1])} a 10 000 ft`],
    ['Ascenso normal', kias(v.climbOut)],
    ['Aproximación normal, flaps arriba', kias(v.appUp)],
    [`Aproximación normal, flaps ${v.flapsLD}°`, kias(v.appFlaps)],
    ['Aproximación de pista corta', kias(v.appShort)],
    ['Aproximación frustrada (ascenso)', kias(v.balked)],
    ...m.perf.ld.sheets.slice().sort(byW).map(s => [`Aterrizaje a ${lbkg(s.w)}`, `a 50 ft ${kias(s.v50)}`]),
    ['V<sub>FE</sub> máx. con flaps', v.vfe.map(([l, k]) => l ? `${kias(k)} (flaps ${l})` : kias(k)).join(' · ')],
    ['V<sub>A</sub> maniobra', v.va.map(([lb, k]) => `${kias(k)} a ${fmt(lb)} lb`).join(' · ')],
    ['V<sub>NO</sub> crucero estructural máx.', kias(v.vno)],
    ['V<sub>NE</sub> nunca exceder', kias(v.vne)],
    ['V<sub>S1</sub> pérdida, flaps arriba (inicio del arco verde)', kias(v.vs1)],
    ['V<sub>S0</sub> pérdida, flaps abajo (inicio del arco blanco)', kias(v.vs0)],
    ['Viento cruzado demostrado', `${v.xw} kt`]
  ];
  $('spd_view').innerHTML = `<div class="card"><h2>Velocidades <small>${m.nombre}</small></h2>${tbl(speeds)}
    <p class="hint">KIAS, tal como las publica el POH (${m.poh}). Solo lectura.</p></div>`;

  const lim = [
    ['Peso máx. de despegue (MTOW)', lbkg(w.mtow)], ['Peso máx. en rampa', lbkg(w.ramp)], ['Peso máx. de aterrizaje', lbkg(w.mlw)],
    ['Equipaje zona A', `${lbkg(m.bag.A)} · brazo ${m.arms.bagA} in`], ['Equipaje zona B', `${lbkg(m.bag.B)} · brazo ${m.arms.bagB} in`],
    ['Equipaje total máx.', lbkg(m.bag.tot)],
    ['Asientos delanteros', `brazo ${m.arms.front} in`], ['Asientos traseros', `brazo ${m.arms.rear} in`],
    ['Combustible', `${m.lbgal} lb/gal · brazo ${m.arms.fuel} in`],
    ...m.tanks.map(t => [t.label.split(' · ')[0], `${t.usable} gal US utilizables (${fmt(t.usable * L_PER_GAL)} L) · ${t.total} gal totales`]),
    ['CG límite delantero', `${fmt(m.cg.fwdMin, 1)} in hasta ${fmt(m.cg.knee)} lb; sube en línea recta hasta ${fmt(m.cg.fwdMax, 1)} in a ${fmt(w.mtow)} lb`],
    ['CG límite trasero', `${fmt(m.cg.aft, 1)} in a cualquier peso`],
    ['Peso vacío de ejemplo', `${lbkg(m.empty.w)} · brazo ${fmt(m.empty.arm, 2)} in`]
  ];
  $('lim_view').innerHTML = `<div class="card"><h2>Pesos, brazos y CG <small>${m.nombre}</small></h2>${tbl(lim)}
    <p class="hint">${m.empty.nota}. El peso vacío de <b>tu matrícula</b> está en su hoja de peso y balance: ingrésalo en la pestaña Peso. Fuente: ${m.poh}. Solo lectura.</p></div>`;

  const part = (titulo, T, extra) => `<div class="card"><h2>${titulo} <small>${T.flaps} · ${T.fuente}</small></h2>` +
    T.sheets.slice().sort(byW).map(s => `<p class="sub">${lbkg(s.w)}${s.vr != null ? ` · rotación ${kias(s.vr)}` : ''} · a 50 ft ${kias(s.v50)}</p>${sheetTable(s, m)}`).join('') +
    `<p class="hint">${extra}</p></div>`;
  $('tab_view').innerHTML =
    `<p class="hint nomargin">Tablas del POH (${m.poh}), en pies. <b>Suelo</b> = recorrido en tierra; <b>50 ft</b> = distancia total hasta/desde 50 ft de altura. "—" = el POH no da dato. Compáralas con tu ejemplar del POH.</p>` +
    part('Despegue', m.perf.to, 'Pista pavimentada, nivelada, seca, viento calmo. La app corrige por viento según el POH (−10 % por cada 9 kt de frente; +10 % por cada 2 kt de cola, hasta 10 kt) y por hierba seca (+' + fmt(m.perf.grass.to * 100) + ' % del recorrido en tierra).') +
    part('Aterrizaje', m.perf.ld, 'Pista pavimentada, nivelada, seca, viento calmo, frenado máximo. La app corrige por viento según el POH y por hierba seca (+' + fmt(m.perf.grass.ld * 100) + ' % del recorrido en tierra).') +
    `<div class="card"><h2>Crucero <small>${m.cruise.cond} · Fig. 5-8</small></h2>` + m.cruise.alts.map(cruiseTable).join('') +
    '<p class="hint">%: potencia (% BHP) · KTAS: velocidad verdadera · GPH: galones por hora. "—" = el POH no da dato. Tal como las publica el POH, a ' + lbkg(m.cruise.w) + '; la app interpola entre filas, altitudes y temperaturas.</p></div>' +
    `<div class="card"><h2>Ascenso <small>${m.climb.cond} · Fig. 5-7 · a ${lbkg(m.climb.w)}</small></h2>` + climbTable(m) +
    '<p class="hint">Tiempo, combustible y distancia medidos desde el nivel del mar. El POH agrega ' + fmt(m.climb.allow, 1) + ' gal para arranque, rodaje y despegue, y +10 % de tiempo, combustible y distancia por cada 10 °C sobre la temperatura estándar.</p></div>';
}

// ---------- Navegación ----------
function showSub(panelId) {
  const p = $(panelId);
  if (!p || !p.dataset.seg) return;
  const seg = $(p.dataset.seg);
  seg.querySelectorAll('button').forEach(b => {
    const on = b.dataset.sub === panelId;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll(`[data-seg="${seg.id}"]`).forEach(x => x.classList.toggle('on', x === p));
}
function go(tab, open) {
  if (!$(tab)) return;
  document.querySelectorAll('#tabs button').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === tab));
  document.body.dataset.view = tab;
  if (open) showSub(tab + '_' + open);
  window.scrollTo(0, 0);
  if (tab === 'ruta' && window.MAPA) window.MAPA.shown();   // Leaflet necesita medir el mapa ya visible
}

// ---------- Eventos ----------
// ---------- Validación ----------
// Si falta un dato o es imposible, se suspenden los resultados: es mejor no mostrar nada que un número falso.
const SIGNED = ['elev', 'a_elev', 'oat', 'a_oat', 'r_wind', 'r_isa', 'ru_var'];             // pueden ser negativos
const POSITIVE = ['w_empty', 'to_w', 'ld_w', 'qnh', 'a_qnh', 'r_tas', 'r_burn', 'to_len', 'ld_len', 'r_alt', 'r_rpm'];
// En blanco valen 0 (p. ej. "sin pasajeros atrás"); la pista y la dirección del viento solo importan si hay viento
const BLANK_OK = ['w_front', 'w_rear', 'w_bagA', 'w_bagB', 'f_gal', 'wspd', 'a_wspd', 'r_dist', 'r_taxi', 'r_climb', 'ru_wdir', 'ru_wspd', 'ru_var'];
const NEEDS_WIND = { rwy: 'wspd', wdir: 'wspd', a_rwy: 'a_wspd', a_wdir: 'a_wspd' };
// Rangos físicamente razonables: atrapan errores de tipeo (p. ej. QNH 10013)
const RANGE = { elev: [-1500, 20000], a_elev: [-1500, 20000], qnh: [850, 1100], a_qnh: [850, 1100], oat: [-60, 60], a_oat: [-60, 60], wspd: [0, 150], a_wspd: [0, 150], r_tas: [30, 300], r_wind: [-150, 150], r_alt: [0, 30000], r_rpm: [500, 3500], r_isa: [-60, 60], ru_wdir: [0, 360], ru_wspd: [0, 150], ru_var: [-30, 30] };
const DEP_IDS = ['elev', 'qnh', 'oat', 'rwy', 'wdir', 'wspd', 'to_w', 'to_len'], ARR_IDS = ['a_elev', 'a_qnh', 'a_oat', 'a_rwy', 'a_wdir', 'a_wspd', 'ld_w', 'ld_len'];
let invalidMsg = '';

function fieldName(e) {
  let t = e.getAttribute && e.getAttribute('aria-label');
  const l = e.closest && e.closest('label'), r = e.closest && e.closest('tr');
  if (!t && l) t = [...l.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ');
  if (!t && r && r.cells) t = r.cells[0].textContent;
  t = (t || e.id).replace(/\([^)]*\)/g, ' ').replace(/·.*$/, '').replace(/\s+/g, ' ').trim();
  return t + (DEP_IDS.includes(e.id) ? ' (salida)' : ARR_IDS.includes(e.id) ? ' (llegada)' : '');
}

function validateInputs() {
  const invalid = [];
  document.querySelectorAll('input[type="number"]').forEach(e => {
    if (e.closest('[hidden]')) { e.removeAttribute('aria-invalid'); return; }   // campos de un modo que no está en uso
    const blank = e.value.trim() === '', v = Number(e.value);
    const windFld = NEEDS_WIND[e.id];
    const mayBeBlank = BLANK_OK.includes(e.id) || (windFld && !(num(windFld) > 0));
    const [lo, hi] = RANGE[e.id] || [-Infinity, Infinity];
    let bad = e.validity && e.validity.badInput;                    // texto que el navegador no puede leer como número
    if (blank) bad = bad || !mayBeBlank;
    else bad = bad || !Number.isFinite(v) || v < lo || v > hi
      || (!SIGNED.includes(e.id) && v < 0) || (POSITIVE.includes(e.id) && v <= 0)
      || (e.min !== '' && v < Number(e.min)) || (e.max !== '' && v > Number(e.max));
    e.setAttribute('aria-invalid', String(!!bad));
    if (bad) invalid.push(e);
  });
  const routeOK = $('r_mode').value === 'poh' || num('r_tas') > num('r_wind');
  const ok = !invalid.length && !!MODEL && routeOK;
  if (invalid.length) {
    const n = [...new Set(invalid.map(fieldName))];
    invalidMsg = `Revisa ${n.slice(0, 3).join(', ')}${n.length > 3 ? ` y ${n.length - 3} más` : ''}: falta el valor o está fuera de rango.`;
  } else if (!routeOK) invalidMsg = 'La velocidad suelo debe ser mayor que cero. Revisa TAS y viento en Combustible.';
  else invalidMsg = '';
  $('validation').hidden = ok;
  $('validation').textContent = ok ? '' : invalidMsg + ' Los resultados están suspendidos.';
  return ok;
}

const OUTPUT_IDS = ['wb_res', 'wb_msgs', 'chart', 'atm_out', 'a_atm_out', 'to_out', 'ld_out', 'to_fig', 'ld_fig', 'to_notes', 'ld_notes', 'fuel_out', 'fuel_msg', 'fuel_tbl'];
function recalc() {
  save();
  syncMode();
  readModel();
  const ok = validateInputs();
  document.querySelectorAll('[data-copy]').forEach(b => { b.disabled = !ok; });
  if (!ok) {
    OUTPUT_IDS.forEach(id => $(id).replaceChildren());
    $('fuel_apply').disabled = true;
    Object.keys(SUM).forEach(k => { SUM[k] = null; });
    $('fuel_note').textContent = '';
    TOW = fuelNeeded = enrouteFuel = 0; PLAN = null;
    renderHome(false);
    return;
  }
  calcWB(); calcPerf(); calcFuel(); renderHome();
  if (window.MAPA && window.MAPA.refresh) window.MAPA.refresh();
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-go],[data-tab]');
  if (b) go(b.dataset.go || b.dataset.tab, b.dataset.open);
});
document.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
  const b = e.target.closest('button[data-sub]');
  if (b) showSub(b.dataset.sub);
}));
document.querySelectorAll(FIELDS).forEach(e => { if (e.id !== 'u_w' && e.id !== 'u_f') e.addEventListener('input', recalc); });
$('u_w').addEventListener('change', onUnitChange);
$('u_f').addEventListener('change', onUnitChange);
$('model_list').addEventListener('click', e => {
  const b = e.target.closest('[data-model]');
  if (!b || b.dataset.model === MODEL.id) return;
  setModel(b.dataset.model, true);
  recalc();
});
$('m_tank').addEventListener('change', () => {
  readModel();
  // si cambió a un tanque más chico, el combustible cargado no puede quedar sobre su capacidad
  if (num('f_gal') * ff > LIM.fuelMax) $('f_gal').value = +(LIM.fuelMax / ff).toFixed(1);
  recalc();
});
document.querySelector('[data-copy="to"]').addEventListener('click', () => { $('to_w').value = Math.round(TOW / wf); recalc(); });
// Peso de aterrizaje = peso de despegue menos el combustible de la ruta (ruta + ascenso extra)
document.querySelector('[data-copy="ld"]').addEventListener('click', () => {
  $('ld_w').value = Math.round(Math.max(0, TOW - enrouteFuel * LIM.lbPerGal) / wf);
  recalc();
});
$('fuel_apply').addEventListener('click', () => {
  // fuelNeeded ya incluye el rodaje; se redondea hacia arriba al 0,1 de la unidad elegida, sin pasar del tanque
  const cap = Math.floor(LIM.fuelMax / ff * 10 + 1e-9) / 10;
  $('f_gal').value = Math.min(cap, +(Math.ceil(fuelNeeded / ff * 10 - 1e-9) / 10).toFixed(1));
  recalc();
  go('wb');
});
$('fuel_route_apply').addEventListener('click', () => {
  const A = window.AD, rt = A && A.route(A.get($('fl_from').value), A.get($('fl_to').value));
  if (rt) { $('r_dist').value = Math.ceil(rt.nm); recalc(); }
});
$('go_plan').addEventListener('click', () => go('wb'));

// Accesibilidad: cada campo de las tablas toma el nombre de su fila; los segmentos indican cuál está activo
document.querySelectorAll('.grid input').forEach(e => {
  const row = e.closest('tr');
  if (row && row.cells[0]) e.setAttribute('aria-label', row.cells[0].textContent.replace(/\s+/g, ' ').trim() + (e.id === 'a_empty' ? ' · brazo (in)' : ''));
});
document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-selected', String(b.classList.contains('on'))));

const saved = load();
curW = uw(); curF = uf();
readUnits();
// Primera vez (o si no había modelo guardado): se precargan los ejemplos del POH. Si no, se respetan los datos guardados.
setModel($('fl_model').value || 'c172s', !saved.fl_model, saved.m_tank);
recalc();
