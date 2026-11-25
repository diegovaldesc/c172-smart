'use strict';
const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value) || 0;
const fmt = (n, d = 0) => n.toLocaleString('es', { maximumFractionDigits: d, minimumFractionDigits: d });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- Datos del modelo (se leen de la pestaña "Avión") ----------
let LIM = {}, TAKEOFF = [], LANDING = [];
const DEFAULT_TAB = [[0, 1, 1], [2000, 1, 1]];

function parseTable(id) {
  const rows = $(id).value.split('\n')
    .map(l => l.split(/[,;\s]+/).map(parseFloat))
    .filter(r => r.length >= 3 && r.slice(0, 3).every(isFinite))
    .map(r => r.slice(0, 3))
    .sort((a, b) => a[0] - b[0]);
  return rows.length >= 2 ? rows : DEFAULT_TAB;
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
function convertFields(ids, factor, decimals) {
  ids.forEach(id => { const v = parseFloat($(id).value); if (isFinite(v)) $(id).value = +(v * factor).toFixed(decimals); });
}
function onUnitChange() {
  const newW = uw(), newF = uf();
  if (newW !== curW) convertFields(WIDS, newW === 'kg' ? KG_PER_LB : 1 / KG_PER_LB, 1);
  if (newF !== curF) convertFields(FIDS, newF === 'L' ? L_PER_GAL : 1 / L_PER_GAL, 1);
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
const FIELDS = 'input[id],select[id],textarea[id]';
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

  const msgs = [];
  const add = (t, c) => msgs.push(`<div class="msg ${c}">${t}</div>`);
  if (ramp.w > LIM.ramp) add(`Peso en rampa ${dW(ramp.w)} supera el máx. (${dW(LIM.ramp)}).`, 'bad');
  if (toff.w > LIM.mtow) add(`Peso de despegue ${dW(toff.w)} supera el MTOW (${dW(LIM.mtow)}) en ${dW(toff.w - LIM.mtow)}.`, 'bad');
  if (toff.cg > LIM.aft) add(`CG trasero fuera de límites (${fmt(toff.cg, 2)} > ${LIM.aft} in).`, 'bad');
  else if (toff.cg < fwdLimit(toff.w)) add(`CG delantero fuera de límites (${fmt(toff.cg, 2)} < ${fmt(fwdLimit(toff.w), 2)} in).`, 'bad');
  const bA = num('w_bagA') * wf, bB = num('w_bagB') * wf;
  if (bA > LIM.bagAMax) add(`Equipaje A supera ${dW(LIM.bagAMax)}.`, 'bad');
  if (bB > LIM.bagBMax) add(`Equipaje B supera ${dW(LIM.bagBMax)}.`, 'bad');
  if (bA + bB > LIM.bagTotal) add(`Equipaje total supera ${dW(LIM.bagTotal)}.`, 'bad');
  if (gal > LIM.fuelMax) add(`Combustible supera los ${dF(LIM.fuelMax, 0)} utilizables.`, 'bad');
  if (!msgs.length) add(`Dentro de límites. Margen de peso al MTOW: ${dW(LIM.mtow - toff.w)}.`, 'ok');
  if (toff.w <= LIM.mtow && gal < LIM.fuelMax) {
    const extra = Math.min(LIM.fuelMax - gal, Math.floor((LIM.mtow - toff.w) / LIM.lbPerGal));
    if (extra > 0) add(`Podrías cargar hasta ${dF(extra, 0)} más sin pasar el MTOW.`, 'warn');
  }
  $('wb_msgs').innerHTML = msgs.join('');
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
  s += `<text x="${(X(LIM.fwdMin) + X(LIM.aft)) / 2}" y="${Y(LIM.fwdKnee * 0.8 + wBot * 0.2)}" fill="#3d6b4f" font-size="12" font-weight="700" text-anchor="middle" opacity=".55">ENVOLVENTE OPERACIONAL</text>`;
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
    s += `<text x="${left ? px - 10 : px + 10}" y="${i === 0 ? py - 9 : py + 4}" fill="#26292c" font-size="11" font-weight="700" text-anchor="${left ? 'end' : 'start'}">${name}</text>`;
  });
  // leyenda
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
  const span = Math.max(cfg.len, cfg.need, cfg.b) * 1.04;
  const sx = ft => X0 + ft / span * (X1 - X0);
  const rEnd = sx(cfg.len);
  let s = '';
  // terreno
  s += `<rect x="0" y="40" width="480" height="95" fill="#e4dfd0"/>`;
  // zona más allá del final de pista
  if (rEnd < X1) s += `<rect x="${rEnd}" y="${Y0}" width="${X1 - rEnd}" height="${Y1 - Y0}" fill="#cdbf9e"/>`;
  // pista
  s += `<rect x="${X0}" y="${Y0}" width="${rEnd - X0}" height="${Y1 - Y0}" fill="#4a4e53"/>`;
  // umbral (rayas) y numeración
  for (let i = 0; i < 6; i++) s += `<rect x="${X0 + 4}" y="${Y0 + 5 + i * 7.5}" width="12" height="4" fill="#f4efe3"/>`;
  s += `<rect x="${rEnd - 5}" y="${Y0}" width="3" height="${Y1 - Y0}" fill="#f4efe3"/>`;
  for (let x = X0 + 40; x < rEnd - 30; x += 28) s += `<rect x="${x}" y="${YC - 1}" width="14" height="2" fill="#d8d2c2"/>`;
  s += `<text x="${X0 + 22}" y="${YC + 4}" fill="#f4efe3" font-size="13" font-weight="700" text-anchor="start">${String(Math.round(num('rwy'))).padStart(2, '0')}</text>`;

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
  s += `<line x1="${sx(cfg.need)}" y1="${Y0 - 14}" x2="${sx(cfg.need)}" y2="${Y1 + 6}" stroke="${col}" stroke-width="2" stroke-dasharray="4 3"/>`;
  s += `<text x="${sx(cfg.need)}" y="${Y0 - 18}" fill="${col}" font-size="12" font-weight="700" text-anchor="${sx(cfg.need) > 380 ? 'end' : 'start'}">+25 %: ${fmt(cfg.need)} ft</text>`;

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
  s +=`<text x="${rEnd}" y="${Y1 + 50}" fill="#26292c" font-size="12" text-anchor="${rEnd > 400 ? 'end' : 'middle'}">Fin de pista: ${fmt(cfg.len)} ft</text>`;
  if (cfg.b > cfg.len) s += `<text x="${(rEnd + X1) / 2}" y="${YC + 4}" fill="#a8342a" font-size="12" font-weight="700" text-anchor="middle">¡FUERA!</text>`;
  $(svgId).innerHTML = s;
}

// ---------- Performance ----------
function atmosphere() {
  const pa = num('elev') + (1013.25 - num('qnh')) * 27;
  const isa = 15 - 1.98 * pa / 1000;
  const da = pa + 120 * (num('oat') - isa);
  const rwy = num('rwy') * 10, ang = (num('wdir') - rwy) * Math.PI / 180, ws = num('wspd');
  return { pa, da, isaDev: num('oat') - isa, head: ws * Math.cos(ang), cross: ws * Math.sin(ang) };
}
function windFactor(head) {
  return head >= 0 ? Math.max(0.5, 1 - 0.10 * head / 9) : 1 + 0.10 * (-head) / 2;
}
const kpi = (label, value, cls = '') => `<div class="kpi ${cls}"><b>${value}</b><span>${label}</span></div>`;

function calcPerf() {
  const a = atmosphere();
  const xw = Math.abs(a.cross);
  $('atm_out').innerHTML =
    kpi('Altitud presión', fmt(a.pa) + ' ft') +
    kpi('Altitud densidad', fmt(a.da) + ' ft', a.da > 5000 ? 'warn' : '') +
    kpi('Desviación ISA', (a.isaDev >= 0 ? '+' : '') + fmt(a.isaDev) + ' °C') +
    kpi(a.head >= 0 ? 'Viento de frente' : 'Viento de cola', fmt(Math.abs(a.head)) + ' kt', a.head < 0 ? 'warn' : '') +
    kpi('Viento cruzado', fmt(xw) + ' kt', xw > LIM.xw ? 'bad' : xw > LIM.xw * 0.7 ? 'warn' : 'ok');

  const wf = windFactor(a.head);

  const wT = num('to_w') * wf, sf = num('to_surf'), lenT = num('to_len');
  const k = Math.pow(wT / LIM.refW, 2) * wf;
  const gr = interp(TAKEOFF, a.da, 1) * k * sf;
  const d50 = interp(TAKEOFF, a.da, 2) * k + (sf - 1) * interp(TAKEOFF, a.da, 1) * k;
  const need = d50 * 1.25;
  const okT = need <= lenT ? 'ok' : (d50 <= lenT ? 'warn' : 'bad');
  $('to_out').innerHTML =
    kpi('Recorrido de despegue', fmt(gr) + ' ft') +
    kpi('Hasta 50 ft', fmt(d50) + ' ft', okT) +
    kpi('Con margen 25 %', fmt(need) + ' ft', okT) +
    kpi('Pista restante', fmt(lenT - need) + ' ft', okT) +
    (wT > LIM.mtow ? kpi('¡Sobrepeso!', dW(wT - LIM.mtow), 'bad') : '');
  drawRunway('to_fig', { kind: 'to', len: lenT, a: gr, b: d50, need, ok: okT });

  const wL = num('ld_w') * wf, sl = num('ld_surf'), lenL = num('ld_len');
  const kl = (wL / LIM.refW) * wf;
  const lgr = interp(LANDING, a.da, 1) * kl * sl;
  const l50 = interp(LANDING, a.da, 2) * kl + (sl - 1) * interp(LANDING, a.da, 1) * kl;
  const needL = l50 * 1.25;
  const okL = needL <= lenL ? 'ok' : (l50 <= lenL ? 'warn' : 'bad');
  $('ld_out').innerHTML =
    kpi('Recorrido de aterrizaje', fmt(lgr) + ' ft') +
    kpi('Desde 50 ft', fmt(l50) + ' ft', okL) +
    kpi('Con margen 25 %', fmt(needL) + ' ft', okL) +
    kpi('Pista restante', fmt(lenL - needL) + ' ft', okL);
  drawRunway('ld_fig', { kind: 'ld', len: lenL, a: Math.max(0, l50 - lgr), b: l50, need: needL, ok: okL });
}

// ---------- Combustible ----------
let fuelNeeded = 0;
function calcFuel() {
  const d = num('r_dist'), tas = num('r_tas'), wind = num('r_wind'), burn = num('r_burn') * ff;
  const gs = Math.max(1, tas - wind);
  const hrs = d / gs;
  const trip = hrs * burn;
  const resMin = num('r_res');
  const res = resMin / 60 * burn;
  const total = trip + LIM.taxi + num('r_climb') * ff + res;
  fuelNeeded = total;
  const over = total > LIM.fuelMax;
  const h = Math.floor(hrs), m = Math.round((hrs - h) * 60);
  $('fuel_out').innerHTML =
    kpi('Velocidad suelo', fmt(gs) + ' kt') +
    kpi('Tiempo en ruta', `${h} h ${String(m).padStart(2, '0')} min`) +
    kpi('Combustible de ruta', dF(trip)) +
    kpi('Reserva', dF(res)) +
    kpi('Total necesario', dF(total), over ? 'bad' : 'ok') +
    kpi('Total en peso', dW(total * LIM.lbPerGal)) +
    kpi(`Autonomía con ${dF(LIM.fuelMax, 0)}`, fmt(LIM.fuelMax / burn - resMin / 60, 1) + ' h + reserva');
}

// ---------- Eventos ----------
function recalc() { save(); readModel(); calcWB(); calcPerf(); calcFuel(); }

document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#tabs button, .tab').forEach(e => e.classList.remove('active'));
  b.classList.add('active');
  $(b.dataset.tab).classList.add('active');
}));
document.querySelectorAll(FIELDS).forEach(e => { if (e.id !== 'u_w' && e.id !== 'u_f') e.addEventListener('input', recalc); });
$('u_w').addEventListener('change', onUnitChange);
$('u_f').addEventListener('change', onUnitChange);
document.querySelector('[data-copy="to"]').addEventListener('click', () => { $('to_w').value = Math.round(TOW / wf); recalc(); });
$('fuel_apply').addEventListener('click', () => {
  $('f_gal').value = Math.min(Math.round(LIM.fuelMax / ff), Math.ceil((fuelNeeded + LIM.taxi) / ff));
  recalc();
  document.querySelector('[data-tab="wb"]').click();
});

load();
curW = uw(); curF = uf();
recalc();
