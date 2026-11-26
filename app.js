'use strict';
const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value) || 0;
const fmt = (n, d = 0) => n.toLocaleString('es', { maximumFractionDigits: d, minimumFractionDigits: d });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- Datos del modelo (se leen de la pestaña "Avión") ----------
let LIM = {}, TAKEOFF = [], LANDING = [];

function parseTable(id) {
  const rows = $(id).value.trim().split('\n')
    .map(l => l.trim().split(/[,;\s]+/).map(Number))
    .sort((a, b) => a[0] - b[0]);
  return rows.length >= 2 && rows.every((r, i) => r.length === 3 && r.every(Number.isFinite) && r[1] > 0 && r[2] >= r[1] && (!i || r[0] > rows[i - 1][0])) ? rows : null;
}
// ---------- Unidades ----------
// Internamente todo se calcula en lb y galones US; los campos y resultados se muestran en la unidad elegida.
const KG_PER_LB = 0.45359237, L_PER_GAL = 3.785411784;
const WIDS = ['w_empty', 'w_front', 'w_rear', 'w_bagA', 'w_bagB', 'to_w', 'ld_w', 'm_mtow', 'm_ramp', 'm_bagAmax', 'm_bagBmax', 'm_bagTot', 'm_refw', 'm_fwdKnee'];
const FIDS = ['f_gal', 'm_fuelmax', 'r_burn', 'r_taxi', 'r_climb'];
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

function readModel() {
  readUnits();
  LIM = {
    mtow: num('m_mtow') * wf, ramp: num('m_ramp') * wf, fuelMax: num('m_fuelmax') * ff, lbPerGal: num('m_lbgal') || 6,
    fuelArm: num('m_arm_fuel'), front: num('m_arm_front'), rear: num('m_arm_rear'),
    bagA: num('m_arm_bagA'), bagB: num('m_arm_bagB'),
    bagAMax: num('m_bagAmax') * wf, bagBMax: num('m_bagBmax') * wf, bagTotal: num('m_bagTot') * wf,
    fwdKnee: num('m_fwdKnee') * wf, fwdMin: num('m_fwdMin'), fwdMax: num('m_fwdMax'), aft: num('m_aft'),
    refW: (num('m_refw') || num('m_mtow')) * wf, taxi: num('r_taxi') * ff, xw: num('m_xw')
  };
  TAKEOFF = parseTable('m_totab');
  LANDING = parseTable('m_ldtab');
  $('model_title').textContent = $('m_name').value;
  $('d_front').textContent = LIM.front; $('d_rear').textContent = LIM.rear;
  $('d_bagA').textContent = LIM.bagA; $('d_bagB').textContent = LIM.bagB; $('d_fuel').textContent = LIM.fuelArm;
  $('m_bagA').textContent = num('m_bagAmax'); $('m_bagB').textContent = num('m_bagBmax'); $('m_fuel').textContent = num('m_fuelmax');
}

function interp(table, x, col) {
  if (x <= table[0][0]) return table[0][col];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, x1] = [table[i - 1][0], table[i][0]];
      const t = (x - x0) / (x1 - x0);
      return table[i - 1][col] + t * (table[i][col] - table[i - 1][col]);
    }
  }
  const n = table.length, [a, b] = [table[n - 2], table[n - 1]];
  return b[col] + (x - b[0]) * (b[col] - a[col]) / (b[0] - a[0]);
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
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const [k, v] of Object.entries(o)) if ($(k)) $(k).value = v;
  } catch (e) { /* ignorar */ }
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
  if (gal < LIM.taxi) add('El combustible cargado no alcanza para el rodaje indicado.', 'bad');
  if (!inEnvelope(zfw.w, zfw.cg)) add('El CG queda fuera de la envolvente al consumir el combustible.', 'bad');
  if (gal > LIM.fuelMax) add(`Combustible supera los ${dF(LIM.fuelMax, 0)} utilizables.`, 'bad');
  if (!msgs.length) add(`Dentro de límites. Margen de peso al MTOW: ${dW(LIM.mtow - toff.w)}.`, 'ok');
  if (toff.w <= LIM.mtow && gal < LIM.fuelMax) {
    const extra = Math.min(LIM.fuelMax - gal, Math.floor((LIM.mtow - toff.w) / LIM.lbPerGal));
    if (extra > 0) add(`Podrías cargar hasta ${dF(extra, 0)} más sin pasar el MTOW.`, 'warn');
  }
  $('wb_msgs').innerHTML = msgs.join('');
  SUM.wb = { ok: issues.length === 0, tow: toff.w, margin: LIM.mtow - toff.w, issues };
  drawChart([['Rampa', ramp, '#c4561b'], ['Despegue', toff, '#c4561b'], ['Sin comb.', zfw, '#2f5d8a']]);
}

function drawChart(points) {
  const W = 420, H = 340, L = 46, R = 12, T = 28, B = 56;
  const x0 = Math.floor(LIM.fwdMin) - 3, x1 = Math.ceil(LIM.aft) + 3;
  const y0 = 1400, y1 = Math.ceil(LIM.mtow / 100) * 100 + 100;
  const X = v => L + (v - x0) / (x1 - x0) * (W - L - R);
  const Y = v => H - B - (v - y0) / (y1 - y0) * (H - T - B);
  const pts = p => p.map(q => X(q[0]).toFixed(1) + ',' + Y(q[1]).toFixed(1)).join(' ');
  const wBot = y0;
  let s = '';
  // zona fuera de límites (rojo suave) y envolvente operacional (verde)
  s += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="#f1d9d4"/>`;
  const env = [[LIM.fwdMin, wBot], [LIM.fwdMin, LIM.fwdKnee], [LIM.fwdMax, LIM.mtow], [LIM.aft, LIM.mtow], [LIM.aft, wBot]];
  s += `<polygon points="${pts(env)}" fill="#d9e6db" stroke="#3d6b4f" stroke-width="2.5"/>`;
  // rejilla
  for (let x = Math.ceil(x0 / 2) * 2; x <= x1; x += 2) s += `<line x1="${X(x)}" y1="${T}" x2="${X(x)}" y2="${H - B}" stroke="#fffdf8" stroke-opacity=".7"/><text x="${X(x)}" y="${H - B + 13}" fill="#6f6a5e" font-size="10" text-anchor="middle">${x}</text>`;
  const step = uw() === 'kg' ? 100 : 250;
  for (let d = Math.ceil(y0 / wf / step) * step; d * wf <= y1; d += step) { const y = d * wf; s += `<line x1="${L}" y1="${Y(y)}" x2="${W - R}" y2="${Y(y)}" stroke="#fffdf8" stroke-opacity=".7"/><text x="${L - 4}" y="${Y(y) + 3}" fill="#6f6a5e" font-size="10" text-anchor="end">${d}</text>`; }
  s += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="none" stroke="#bdb39f"/>`;
  // etiquetas de límites
  s += `<text x="${(X(LIM.fwdMin) + X(LIM.aft)) / 2}" y="${Y(LIM.mtow) + 13}" fill="#244632" font-size="11" font-weight="700" text-anchor="middle">MTOW ${dW(LIM.mtow)}</text>`;
  s += `<text x="${(X(LIM.fwdMin) + X(LIM.aft)) / 2}" y="${Y(LIM.fwdKnee * 0.8 + wBot * 0.2)}" fill="#3d6b4f" font-size="9" font-weight="700" text-anchor="middle" opacity=".55">ENVOLVENTE OPERACIONAL</text>`;
  s += `<text x="${X(LIM.aft) + 9}" y="${(Y(wBot) + Y(LIM.mtow)) / 2}" fill="#6e1f18" font-size="10" transform="rotate(90 ${X(LIM.aft) + 9} ${(Y(wBot) + Y(LIM.mtow)) / 2})" text-anchor="middle">Límite trasero ${fmt(LIM.aft, 1)} in</text>`;
  s += `<text x="${X(LIM.fwdMin) - 6}" y="${(Y(wBot) + Y(LIM.fwdKnee)) / 2}" fill="#6e1f18" font-size="10" transform="rotate(-90 ${X(LIM.fwdMin) - 6} ${(Y(wBot) + Y(LIM.fwdKnee)) / 2})" text-anchor="middle">Límite delantero ${fmt(LIM.fwdMin, 1)} in</text>`;
  s += `<text x="${(L + W - R) / 2}" y="${H - B + 28}" fill="#6f6a5e" font-size="11" text-anchor="middle">Brazo / posición del CG (in desde la referencia)</text>`;
  s += `<text x="12" y="${(T + H - B) / 2}" fill="#6f6a5e" font-size="11" transform="rotate(-90 12 ${(T + H - B) / 2})" text-anchor="middle">Peso (${uw()})</text>`;
  // desplazamiento del CG al consumir combustible: rampa -> despegue -> sin combustible
  const [ramp, toff, zfw] = points.map(p => p[1]);
  const cl = v => [clamp(v.cg, x0, x1), clamp(v.w, y0, y1)];
  s += `<polyline points="${pts([cl(ramp), cl(toff), cl(zfw)])}" fill="none" stroke="#26292c" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  points.forEach(([name, p, color], i) => {
    const ok = inEnvelope(p.w, p.cg), px = X(clamp(p.cg, x0, x1)), py = Y(clamp(p.w, y0, y1));
    const fill = ok ? color : '#a8342a';
    s += `<circle cx="${px}" cy="${py}" r="6" fill="${i === 0 ? '#fffdf8' : fill}" stroke="${i === 0 ? fill : '#fff'}" stroke-width="${i === 0 ? 2.5 : 1.5}"/>`;
    const left = px > (X(LIM.fwdMin) + X(LIM.aft)) / 2;
    s += `<text x="${left ? px - 10 : px + 10}" y="${i === 0 ? py - 13 : py + 16}" fill="#26292c" font-size="11" font-weight="700" text-anchor="${left ? 'end' : 'start'}">${name}</text>`;
  });
  // leyenda
  s += `<text x="${L}" y="16" fill="#26292c" font-size="12" font-weight="700">Envolvente de CG · categoría normal</text>`;
  s += `<text x="${W - R}" y="330" fill="#6f6a5e" font-size="10" text-anchor="end">verde = dentro · rojo = fuera</text>`;
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
  const span = Math.max(1, cut ? reach * 1.9 : cfg.len, cfg.need, cfg.b) * 1.08;
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
  s += `<text x="${X0 + 22}" y="${YC + 4}" fill="#f4efe3" font-size="13" font-weight="700" text-anchor="start">${String(Math.round(cfg.rwy || 0)).padStart(2, '0')}</text>`;

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
  // margen 25 %
  const col = cfg.ok === 'ok' ? '#3d6b4f' : cfg.ok === 'warn' ? '#a87414' : '#a8342a';
  s += `<line x1="${sx(cfg.need)}" y1="${Y0 - 26}" x2="${sx(cfg.need)}" y2="${Y1 + 6}" stroke="${col}" stroke-width="2" stroke-dasharray="4 3"/>`;
  s += `<text x="${sx(cfg.need)}" y="22" fill="${col}" font-size="12" font-weight="700" text-anchor="${sx(cfg.need) > 380 ? 'end' : 'start'}">+25 %: ${fmt(cfg.need)} ft</text>`;

  // marcadores y aviones
  if (cfg.kind === 'to') {
    s += PLANE(sx(cfg.a), YC, '#fffdf8');
    s += `<text x="16" y="158" fill="#9c4214" font-size="12" font-weight="700" text-anchor="start">Despegue ${fmt(cfg.a)} ft</text>`;
    s += `<circle cx="${sx(cfg.b)}" cy="${YC - 34}" r="4" fill="#26292c"/>`;
    s += `<text x="16" y="180" fill="#26292c" font-size="12" text-anchor="start">50 ft · ${fmt(cfg.b)} ft</text>`;
    s += `<text x="${X0}" y="206" fill="#6f6a5e" font-size="12">Inicio de carrera</text>`;
  } else {
    s += PLANE(sx(cfg.a), YC, '#fffdf8') ;
    s += PLANE(sx(cfg.b), YC, '#d9b43a');
    s += `<circle cx="${X0}" cy="${YC - 34}" r="4" fill="#26292c"/>`;
    s += `<text x="${X0 + 8}" y="${YC - 42}" fill="#26292c" font-size="12">Umbral a 50 ft</text>`;
    s += `<text x="16" y="158" fill="#6f6a5e" font-size="12" font-weight="700" text-anchor="start">Toma ${fmt(cfg.a)} ft</text>`;
    s += `<text x="16" y="180" fill="#8a6a10" font-size="12" font-weight="700" text-anchor="start">Parada ${fmt(cfg.b)} ft</text>`;
  }
  // final de pista
  if (cut) {
    s += `<path d="M${X1 - 22} ${Y1 + 3} L${X1 - 10} ${Y0 - 3}" stroke="#e4dfd0" stroke-width="8"/>`;
    s += `<text x="${X1}" y="222" fill="#26292c" font-size="12" text-anchor="end">Pista de ${fmt(cfg.len)} ft (se muestra el primer tramo)</text>`;
  } else {
    s += `<text x="${rEnd}" y="222" fill="#26292c" font-size="12" text-anchor="${rEnd > 400 ? 'end' : 'middle'}">Fin de pista: ${fmt(cfg.len)} ft</text>`;
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

  // Despegue: condiciones del aeródromo de salida. (wf = factor de unidades de peso, windFactor = efecto del viento)
  const wfT = windFactor(aD.head);
  const wT = num('to_w') * wf, sf = num('to_surf'), lenT = num('to_len');
  const k = Math.pow(wT / LIM.refW, 2) * wfT;
  const gr = interp(TAKEOFF, aD.da, 1) * k * sf;
  const d50 = interp(TAKEOFF, aD.da, 2) * k + (sf - 1) * interp(TAKEOFF, aD.da, 1) * k;
  const need = d50 * 1.25;
  const okT = need <= lenT ? 'ok' : (d50 <= lenT ? 'warn' : 'bad');
  $('to_out').innerHTML =
    kpi('Recorrido de despegue', fmt(gr) + ' ft') +
    kpi('Hasta 50 ft', fmt(d50) + ' ft', okT) +
    kpi('Con margen 25 %', fmt(need) + ' ft', okT) +
    kpi('Pista restante', fmt(lenT - need) + ' ft', okT) +
    (wT > LIM.mtow ? kpi('¡Sobrepeso!', dW(wT - LIM.mtow), 'bad') : '');
  drawRunway('to_fig', { kind: 'to', len: lenT, a: gr, b: d50, need, ok: okT, rwy: num('rwy') });
  SUM.to = { need, len: lenT, ok: okT };

  // Aterrizaje: condiciones del aeródromo de llegada
  const wfL = windFactor(aA.head);
  const wL = num('ld_w') * wf, sl = num('ld_surf'), lenL = num('ld_len');
  const kl = (wL / LIM.refW) * wfL;
  const lgr = interp(LANDING, aA.da, 1) * kl * sl;
  const l50 = interp(LANDING, aA.da, 2) * kl + (sl - 1) * interp(LANDING, aA.da, 1) * kl;
  const needL = l50 * 1.25;
  const okL = needL <= lenL ? 'ok' : (l50 <= lenL ? 'warn' : 'bad');
  $('ld_out').innerHTML =
    kpi('Recorrido de aterrizaje', fmt(lgr) + ' ft') +
    kpi('Desde 50 ft', fmt(l50) + ' ft', okL) +
    kpi('Con margen 25 %', fmt(needL) + ' ft', okL) +
    kpi('Pista restante', fmt(lenL - needL) + ' ft', okL);
  drawRunway('ld_fig', { kind: 'ld', len: lenL, a: Math.max(0, l50 - lgr), b: l50, need: needL, ok: okL, rwy: num('a_rwy') });
  SUM.ld = { need: needL, len: lenL, ok: okL };
}

// ---------- Combustible ----------
let fuelNeeded = 0, enrouteFuel = 0;
const hm = hrs => { const t = Math.round(hrs * 60); return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, '0')} min`; };
function calcFuel() {
  const d = num('r_dist'), tas = num('r_tas'), wind = num('r_wind'), burn = num('r_burn') * ff;
  const gs = tas - wind;
  const hrs = d / gs;
  const trip = hrs * burn;
  const resMin = num('r_res');
  const res = resMin / 60 * burn;
  const climb = num('r_climb') * ff;
  const total = trip + LIM.taxi + climb + res;
  fuelNeeded = total;
  enrouteFuel = trip + climb;
  const over = total > LIM.fuelMax;
  $('fuel_apply').disabled = over;
  $('fuel_out').innerHTML =
    kpi('Velocidad suelo', fmt(gs) + ' kt') +
    kpi('Tiempo en ruta', hm(hrs)) +
    kpi('Combustible de ruta', dF(trip)) +
    kpi('Reserva', dF(res)) +
    kpi('Total necesario', dF(total), over ? 'bad' : 'ok') +
    kpi('Total en peso', dW(total * LIM.lbPerGal)) +
    kpi(`Autonomía con ${dF(LIM.fuelMax, 0)}`, fmt(LIM.fuelMax / burn - resMin / 60, 1) + ' h + reserva');
  SUM.fuel = { need: total, have: num('f_gal') * ff, max: LIM.fuelMax };
}

// ---------- Inicio: vuelo y resumen ----------
function setRow(id, cls, title, text) {
  const r = $(id);
  r.querySelector('.dot').className = 'dot ' + cls;
  r.querySelector('b').textContent = title;
  r.querySelector('small').textContent = text;
}
const fitText = o => o.ok === 'ok' ? `Con margen del 25 %: ${fmt(o.need)} ft de ${fmt(o.len)} ft disponibles`
  : o.ok === 'warn' ? `Sin el margen del 25 %: pide ${fmt(o.need)} ft, hay ${fmt(o.len)} ft`
  : `No cabe: pide ${fmt(o.need)} ft, hay ${fmt(o.len)} ft`;

function renderHome() {
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
  const gs = Math.max(1, num('r_tas') - num('r_wind'));
  $('tk_dist').textContent = rt ? fmt(rt.nm) + ' NM' : '';
  $('tk_meta').textContent = rt
    ? `En línea recta · rumbo verdadero ${String(Math.round(rt.brg) % 360).padStart(3, '0')}° · ETE ${hm(rt.nm / gs)} a ${fmt(gs)} kt`
    : (f && t ? 'Sin coordenadas para calcular la distancia.' : 'Elige origen y destino para ver distancia, rumbo y tiempo.');
  $('fuel_route').hidden = !rt;
  if (rt) $('fuel_route_txt').textContent = `${f.i} → ${t.i}: ${fmt(rt.nm)} NM en línea recta`;

  $('model_specs').textContent = `MTOW ${dW(LIM.mtow)} · ${dF(LIM.fuelMax, 0)} utilizables`;

  const w = SUM.wb;
  if (w) setRow('sum_wb', w.ok ? 'ok' : 'bad', 'Peso y balance',
    w.ok ? `Dentro de límites · despegue ${dW(w.tow)} · margen ${dW(w.margin)}`
      : w.issues[0] + (w.issues.length > 1 ? ` (y ${w.issues.length - 1} más)` : ''));
  if (SUM.to) setRow('sum_to', SUM.to.ok, 'Despegue' + (f ? ' · ' + f.i : ''), fitText(SUM.to));
  if (SUM.ld) setRow('sum_ld', SUM.ld.ok, 'Aterrizaje' + (t ? ' · ' + t.i : ''), fitText(SUM.ld));
  const fu = SUM.fuel;
  if (fu) {
    const cls = fu.need > fu.max || fu.have + 1e-9 < fu.need ? 'bad' : 'ok';
    setRow('sum_fuel', cls, 'Combustible',
      fu.need > fu.max ? `La ruta pide ${dF(fu.need)} y el tanque rinde ${dF(fu.max, 0)}`
        : fu.have + 1e-9 < fu.need ? `Cargado ${dF(fu.have)}, necesitas ${dF(fu.need)}`
        : `Cargado ${dF(fu.have)} · necesitas ${dF(fu.need)} con reserva`);
  }
}

// ---------- Navegación ----------
function showSub(panelId) {
  const p = $(panelId);
  if (!p || !p.dataset.seg) return;
  const seg = $(p.dataset.seg);
  seg.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.sub === panelId); b.setAttribute('aria-selected', String(b.dataset.sub === panelId)); });
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
}

// ---------- Eventos ----------
function validateInputs() {
  const invalid = [];
  document.querySelectorAll('input[type="number"]').forEach(e => {
    const value = Number(e.value);
    const signed = ['elev', 'a_elev', 'oat', 'a_oat', 'r_wind'].includes(e.id);
    const positive = ['w_empty','to_w','ld_w','qnh','a_qnh','r_tas','r_burn','m_mtow','m_ramp','m_refw','m_lbgal','m_fuelmax','to_len','ld_len'].includes(e.id);
    const bad = e.value.trim() === '' || !Number.isFinite(value) || (!signed && value < 0) || (positive && value <= 0) || (e.min !== '' && value < Number(e.min)) || (e.max !== '' && value > Number(e.max));
    e.setAttribute('aria-invalid', String(bad));
    if (bad) invalid.push(e);
  });
  const modelOK = LIM.mtow > LIM.fwdKnee && LIM.fwdMin <= LIM.fwdMax && LIM.fwdMax <= LIM.aft;
  const routeOK = num('r_tas') > num('r_wind');
  const ok = !invalid.length && TAKEOFF && LANDING && modelOK && routeOK;
  $('validation').hidden = !!ok;
  $('validation').textContent = invalid.length ? 'Revisa los campos marcados: faltan valores o están fuera de rango. Los resultados están suspendidos.' : !routeOK ? 'La velocidad suelo debe ser mayor que cero. Revisa TAS y viento en Combustible.' : !modelOK ? 'Revisa los límites de peso y CG en Avión.' : 'Revisa las tablas: al menos dos altitudes distintas, distancias positivas y distancia a 50 ft no menor al recorrido.';
  return !!ok;
}
function recalc() {
  readModel();
  if (!validateInputs()) {
    ['wb_res','wb_msgs','chart','atm_out','a_atm_out','to_out','ld_out','to_fig','ld_fig','fuel_out'].forEach(id => $(id).replaceChildren());
    ['sum_wb','sum_to','sum_ld','sum_fuel'].forEach(id => setRow(id, 'warn', 'Datos pendientes', 'Revisa los campos y las tablas antes de calcular.'));
    $('fuel_apply').disabled = true;
    document.querySelectorAll('[data-copy]').forEach(b => b.disabled = true);
    return;
  }
  save(); calcWB(); calcPerf(); calcFuel(); renderHome();
  document.querySelectorAll('[data-copy]').forEach(b => b.disabled = false);
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
document.querySelector('[data-copy="to"]').addEventListener('click', () => { $('to_w').value = Math.round(TOW / wf); recalc(); });
// Peso de aterrizaje = peso de despegue menos el combustible de la ruta (ruta + ascenso extra)
document.querySelector('[data-copy="ld"]').addEventListener('click', () => {
  $('ld_w').value = Math.round(Math.max(0, TOW - enrouteFuel * LIM.lbPerGal) / wf);
  recalc();
});
$('fuel_apply').addEventListener('click', () => {
  $('f_gal').value = Math.min(LIM.fuelMax / ff, Math.ceil(fuelNeeded / ff * 10) / 10);
  recalc();
  go('wb');
});
$('fuel_route_apply').addEventListener('click', () => {
  const A = window.AD, rt = A && A.route(A.get($('fl_from').value), A.get($('fl_to').value));
  if (rt) { $('r_dist').value = Math.ceil(rt.nm); recalc(); }
});
$('go_plan').addEventListener('click', () => go('wb'));

document.querySelectorAll('.grid input').forEach(e => { e.setAttribute('aria-label', e.closest('tr').cells[0].textContent + (e.id === 'a_empty' ? ' · brazo (in)' : '')); });
document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-selected', String(b.classList.contains('on'))));
load();
curW = uw(); curF = uf();
recalc();



