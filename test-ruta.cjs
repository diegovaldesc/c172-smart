'use strict';
// Pruebas de la pestaña Ruta: cálculo (ruta.js), espacios aéreos (data/espacios.json) y rutas visuales (data/canales.json). Uso: node test-ruta.cjs
const assert = require('assert');
const fs = require('fs');
const R = require('./ruta.js');
const AD = JSON.parse(fs.readFileSync(__dirname + '/data/aerodromos.json', 'utf8')).ad;
const ESP = JSON.parse(fs.readFileSync(__dirname + '/data/espacios.json', 'utf8')).esp;
const CAN = JSON.parse(fs.readFileSync(__dirname + '/data/canales.json', 'utf8'));
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const ad = i => { const a = AD.find(x => x.i === i); assert(a, 'existe ' + i); return a; };
const P = a => ({ lat: a.lat, lon: a.lon });

// ---- geodesia ----
near(R.inv({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }).nm, 60, 0.1, '1° de latitud = 60 NM');
near(R.inv({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }).brg, 90, 1e-6, 'rumbo al este');
near(R.inv({ lat: 0, lon: 0 }, { lat: -1, lon: 0 }).brg, 180, 1e-6, 'rumbo al sur');
const q = R.dir({ lat: -33.4, lon: -70.6 }, 237, 25), back = R.inv({ lat: -33.4, lon: -70.6 }, q);
near(back.nm, 25, 1e-6, 'dir/inv: distancia de ida'); near(back.brg, 237, 1e-6, 'dir/inv: rumbo de ida');
const mid = R.between({ lat: -33, lon: -71 }, { lat: -34, lon: -70 }, 0.5);
near(R.inv({ lat: -33, lon: -71 }, mid).nm, R.inv({ lat: -33, lon: -71 }, { lat: -34, lon: -70 }).nm / 2, 1e-6, 'between: punto medio');
// SCTB → SCRG: ~44 NM (lo que muestra la app en Combustible) y rumbo sur
const tbrg = R.inv(P(ad('SCTB')), P(ad('SCRG')));
near(tbrg.nm, 44, 1.5, 'SCTB → SCRG ≈ 44 NM'); assert(tbrg.brg > 170 && tbrg.brg < 200, 'SCTB → SCRG rumbo sur: ' + tbrg.brg.toFixed(0));

// ---- viento ----
let w = R.windTriangle(360, 100, 0, 0); near(w.gs, 100, 1e-9, 'sin viento'); near(w.th, 360 % 360, 1e-9, 'sin viento: rumbo = ruta');
w = R.windTriangle(360, 100, 360, 20); near(w.gs, 80, 1e-9, 'viento de frente'); near(w.wca, 0, 1e-9, 'de frente: sin corrección'); near(w.head, 20, 1e-9, 'componente de frente');
w = R.windTriangle(360, 100, 180, 20); near(w.gs, 120, 1e-9, 'viento de cola'); near(w.head, -20, 1e-9, 'cola: componente negativo');
w = R.windTriangle(360, 100, 90, 20); near(w.wca, Math.asin(0.2) * 180 / Math.PI, 1e-9, 'viento de costado: corrección a la derecha'); near(w.gs, Math.sqrt(100 * 100 - 400), 1e-9, 'costado: velocidad suelo');
assert(w.th > 0 && w.th < 90, 'con viento desde el este hay que apuntar al este de la ruta (derecha)');
assert.strictEqual(R.windTriangle(360, 100, 90, 100), null, 'viento de costado = TAS: sin avance');
assert.strictEqual(R.windTriangle(360, 0, 0, 0), null, 'sin TAS no hay cálculo');

// ---- plan por tramos ----
const A = { lat: 0, lon: 0 }, B = R.dir(A, 90, 60), C = R.dir(B, 90, 30);
let pl = R.plan([A, B, C], { tas: 120, gph: 9, climb: { min: 5, gal: 0.6, nm: 6 }, taxi: 1.4, resMin: 30, wdir: 0, wspd: 0, vari: 0 });
assert(pl.ok && pl.legs.length === 2, 'dos tramos');
near(pl.nm, 90, 1e-6, 'distancia total'); near(pl.min, 5 + (90 - 6) / 120 * 60, 1e-6, 'tiempo = ascenso + crucero');
near(pl.galClimb, 0.6, 1e-9, 'combustible de ascenso'); near(pl.galCruise, (90 - 6) / 120 * 9, 1e-9, 'combustible de crucero');
near(pl.galReserve, 4.5, 1e-9, 'reserva 30 min a 9 gal/h'); near(pl.galTotal, 1.4 + 0.6 + (90 - 6) / 120 * 9 + 4.5, 1e-9, 'total = rodaje + ascenso + crucero + reserva');
near(pl.legs[0].climbNm, 6, 1e-9, 'el ascenso ocurre en el primer tramo'); near(pl.legs[1].climbNm, 0, 1e-9, 'y no en el segundo');
pl = R.plan([A, B], { tas: 120, gph: 9, climb: { min: 12, gal: 1.5, nm: 20 }, taxi: 0, resMin: 0, wdir: 0, wspd: 0, vari: 0 });
pl = R.plan([A, R.dir(A, 0, 10)], { tas: 120, gph: 9, climb: { min: 12, gal: 1.5, nm: 20 }, taxi: 0, resMin: 0 });
assert(pl.warns.length === 1, 'aviso cuando la ruta es más corta que el ascenso'); near(pl.galClimb, 0.75, 1e-9, 'se prorratea el ascenso a la mitad');
pl = R.plan([A, B], { tas: 100, gph: 9, climb: { min: 0, gal: 0, nm: 0 }, taxi: 0, resMin: 0, wdir: 90, wspd: 20, vari: 0 });   // tramo al este con viento del este: de frente
near(pl.legs[0].gs, 80, 1e-6, 'tramo con viento de frente'); near(pl.min, 60 / 80 * 60, 1e-6, 'tiempo con viento');
pl = R.plan([A, R.dir(A, 0, 30)], { tas: 100, gph: 9, climb: { min: 0, gal: 0, nm: 0 }, taxi: 0, resMin: 0, wdir: 90, wspd: 20, vari: 5 });  // al norte, viento del este
near(pl.legs[0].mh, ((pl.legs[0].th - 5) + 360) % 360, 1e-9, 'rumbo magnético = verdadero − declinación E');
pl = R.plan([A, B], { tas: 50, gph: 9, climb: { min: 0, gal: 0, nm: 0 }, taxi: 0, resMin: 0, wdir: 0, wspd: 80 });
assert.strictEqual(pl.ok, false, 'viento mayor que la TAS: la ruta no avanza');

// ---- un viento distinto por tramo (viento en vivo) ----
{
  const E = R.dir(A, 90, 60), F = R.dir(E, 0, 60);                       // tramo 1 al este, tramo 2 al norte
  const o = { tas: 100, gph: 9, climb: { min: 0, gal: 0, nm: 0 }, taxi: 0, resMin: 0, vari: 0 };
  const pw = R.plan([A, E, F], { ...o, winds: [{ dir: 90, spd: 20 }, { dir: 180, spd: 10 }] });   // viento de frente en el 1.º, de cola en el 2.º
  near(pw.legs[0].gs, 80, 1e-6, 'tramo 1: viento de frente'); near(pw.legs[1].gs, 110, 1e-6, 'tramo 2: viento de cola');
  near(pw.legs[0].wdir, 90, 1e-9, 'el tramo recuerda su viento'); near(pw.legs[1].wspd, 10, 1e-9, 'el tramo recuerda su viento (vel.)');
  near(pw.min, 60 / 80 * 60 + 60 / 110 * 60, 1e-6, 'tiempo = suma de los tramos con su viento');
  near(pw.legs[0].minCum, 45, 1e-6, 'tiempo acumulado al final del tramo 1'); near(pw.legs[1].minCum, pw.min, 1e-9, 'el acumulado final es el total');
  near(pw.legs[1].galCum, pw.galEnroute, 1e-9, 'combustible acumulado final = combustible de ruta');
  const same = R.plan([A, E, F], { ...o, wdir: 90, wspd: 20 }), arr = R.plan([A, E, F], { ...o, winds: [{ dir: 90, spd: 20 }, { dir: 90, spd: 20 }] });
  near(same.min, arr.min, 1e-9, 'viento único = el mismo viento en cada tramo');
  const part = R.plan([A, E, F], { ...o, wdir: 90, wspd: 20, winds: [{ dir: 270, spd: 20 }] });          // solo el tramo 1 tiene viento propio; el 2.º usa wdir/wspd
  near(part.legs[0].gs, 120, 1e-6, 'tramo con viento propio'); near(part.legs[1].wspd, 20, 1e-9, 'tramo sin viento propio usa el general');
  const man = R.plan([A, E, F], { ...o, climb: { min: 0, gal: 1.5, nm: 0 } });                          // valores propios: el ascenso es combustible extra, una sola vez
  near(man.galClimb, 1.5, 1e-9, 'combustible de ascenso manual entra al plan'); near(man.galTotal, 1.5 + 120 / 100 * 9, 1e-9, 'total = ascenso extra + crucero');
  near(man.legs[1].climbGal, 0, 1e-9, 'y no se repite en el segundo tramo');
  const bad = R.plan([A, E, F], { ...o, winds: [{ dir: 0, spd: 0 }, { dir: 90, spd: 150 }] });
  assert.strictEqual(bad.ok, false, 'un tramo sin avance invalida el plan'); assert(bad.legs[1].noWind && bad.legs[1].wspd === 150, 'el tramo sin avance queda marcado');
}

// ---- geometría de espacios ----
const sq = [[0, 0], [0, 2], [2, 2], [2, 0]];
assert(R.ringContains(sq, 1, 1) && !R.ringContains(sq, 3, 1) && !R.ringContains(sq, 1, -0.1), 'punto en polígono');
const circ = { c: [-33, -70], nm: 5 };
assert(R.inside(circ, -33, -70) && R.inside(circ, -33 + 4.9 / 60, -70) && !R.inside(circ, -33 + 5.2 / 60, -70), 'punto en círculo');
const cx = R.crossings([{ lat: -33, lon: -70 - 10 / 60 }, { lat: -33, lon: -70 + 10 / 60 }], [{ id: 'X', g: circ }, { id: 'Y', g: { c: [-34, -70], nm: 5 } }]);
assert.strictEqual(cx[0].length, 1, 'cruza solo el círculo que toca'); assert.strictEqual(cx[0][0].id, 'X');
near(cx[0][0].to - cx[0][0].from, 10, 0.4, 'longitud dentro del círculo de 5 NM (≈ diámetro de 10 NM)');

// ---- límites verticales ----
assert.deepStrictEqual(R.limitFt('GND'), { ft: 0, agl: true }); assert.deepStrictEqual(R.limitFt('FL195'), { ft: 19500 });
assert.deepStrictEqual(R.limitFt('5000 FT ALT'), { ft: 5000, agl: false }); assert.deepStrictEqual(R.limitFt('2000 FT AGL'), { ft: 2000, agl: true });
assert.strictEqual(R.limitFt('FL195 / 5000 FT'), null, 'texto compuesto: no se compara');
assert.strictEqual(R.altRelation({ inf: '5000 FT ALT', sup: 'FL195' }, 6000), 'in'); assert.strictEqual(R.altRelation({ inf: '5000 FT ALT', sup: 'FL195' }, 4000), 'below');
assert.strictEqual(R.altRelation({ inf: 'GND', sup: '5000 FT ALT' }, 6000), 'above'); assert.strictEqual(R.altRelation({ inf: 'GND', sup: '2000 FT AGL' }, 1000), '?', 'AGL no se compara');

// ---- espacios aéreos (data/espacios.json) ----
assert(ESP.length >= 100, 'espacios cargados: ' + ESP.length);
const ids = new Set(); const TP = new Set(['C', 'CTR', 'ATZ', 'TMA', 'P', 'R', 'D', 'REC']);
const inChile = (la, lo) => la < -17 && ((la > -57 && lo > -111 && lo < -66) || (la <= -57 && lo > -100 && lo < -50));   // continente, Pascua, Juan Fernández y Antártica chilena (SCRM, Rey Jorge)
for (const e of ESP) {
  assert(!ids.has(e.id), 'id único ' + e.id); ids.add(e.id);
  assert(TP.has(e.tp) && e.nm && e.g, 'campos mínimos ' + e.id);
  if (e.g.r) { assert(e.g.r.length >= 3, 'polígono de ≥3 puntos ' + e.id); for (const [la, lo] of e.g.r) assert(inChile(la, lo), `${e.id}: punto fuera de Chile ${la},${lo}`); }
  else { assert(e.g.c && e.g.nm >= 0.1 && e.g.nm <= 110, `${e.id}: radio plausible ${e.g.nm}`); assert(inChile(e.g.c[0], e.g.c[1]), e.id + ': centro fuera de Chile'); }
  assert(!/@/.test(JSON.stringify(e)), e.id + ': sin correos');
}
// la ATZ/CTR de cada aeródromo contiene a su propio ARP
for (const [id, a] of [['ATZ-SCEL', 'SCEL'], ['ATZ-SCTB', 'SCTB'], ['CTR-SCEL', 'SCEL']]) {
  const e = ESP.find(x => x.id === id), p = ad(a); assert(e, id + ' existe'); assert(R.inside(e.g, p.lat, p.lon), id + ' contiene el ARP de ' + a);
}
// la ATZ de SCEL es el círculo de 5 NM del AIP
const ae = ESP.find(x => x.id === 'ATZ-SCEL'); assert.strictEqual(ae.g.nm, 5);
// la ruta de ejemplo SCTB → SCEL atraviesa la clase C y la CTR de Santiago, y se avisa de la altitud
const rte = [P(ad('SCTB')), P(ad('SCEL'))], cxs = R.crossings(rte, ESP)[0].map(c => c.id);
assert(cxs.includes('CTR-SCEL') && cxs.includes('ATZ-SCEL'), 'SCTB → SCEL cruza CTR y ATZ de SCEL: ' + cxs.join(','));
// el punto de la zona prohibida/restringida no es “sin espacios”: SC-P28 existe con geometría
assert(ESP.some(e => e.tp === 'P' && /P28/.test(e.id)), 'SC-P28 presente');

// ---- rutas visuales (data/canales.json) ----
assert(CAN.items.length >= 100 && CAN.labels.length >= 20, 'canales cargados');
const inSantiago = (la, lo) => la > -34.1 && la < -32.9 && lo > -71.2 && lo < -70.2;
const K = new Set(['canal', 'ruta', 'flecha', 'punta']), idsC = new Set();
for (const it of CAN.items) {
  assert(!idsC.has(it.id), 'id único ' + it.id); idsC.add(it.id);
  assert(K.has(it.k) && (it.t === 'S' || it.t === 'L') && Array.isArray(it.p) && it.p.length >= 2, 'campos de ' + it.id);
  for (const [la, lo] of it.p) assert(inSantiago(la, lo), `${it.id}: punto fuera del área de la carta ${la},${lo}`);
  if (it.k === 'punta') assert.strictEqual(it.p.length, 3, 'la punta es un triángulo');
  if (it.k === 'ruta') {
    assert(it.p.length >= 2, 'ruta con forma: ' + it.id);
    for (const e of [it.desde, it.hasta]) if (e) { const a = ad(e.i); const d = R.inv(P(a), { lat: it.p[e === it.desde ? 0 : it.p.length - 1][0], lon: it.p[e === it.desde ? 0 : it.p.length - 1][1] }).nm; assert(d <= 2.6, `${it.id}: ${e.i} a ${d.toFixed(1)} NM del extremo`); }
  }
}
for (const l of CAN.labels) { assert(/^(\d{4} ft|FL ?\d{3})$/.test(l.t), 'etiqueta de altitud: ' + l.t); assert(inSantiago(l.p[0], l.p[1]), 'etiqueta dentro del área: ' + l.t); }
// desde SCTB salen rutas visuales (la ruta verde hacia SCLC está en la carta VRC-1 / ENR 7.8)
assert(CAN.items.some(it => it.k === 'ruta' && it.t === 'S' && it.desde && it.desde.i === 'SCTB'), 'hay salida visual desde SCTB');
assert(CAN.items.some(it => it.k === 'ruta' && it.hasta && it.hasta.i === 'SCLC'), 'hay ruta visual hacia SCLC');
// ---- texto de las rutas visuales del AIP (data/rutas_visuales.json, ENR 7.1 a 7.8) ----
const RV = JSON.parse(fs.readFileSync(__dirname + '/data/rutas_visuales.json', 'utf8'));
assert.deepStrictEqual(Object.keys(RV.puntos).sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'J', 'K', 'L'], 'puntos A–L del AIP (no hay H)');
for (const [k, p] of Object.entries(RV.puntos)) { assert(inSantiago(p.lat, p.lon), 'punto ' + k + ' en el área de Santiago'); assert(/^\d{2}°\d{2}’\d{2}” S · \d{3}°\d{2}’\d{2}” W$/.test(p.dms), 'dms de ' + k + ': ' + p.dms); }
const rvd = (a, b) => R.inv(RV.puntos[a], RV.puntos[b]).nm;
near(rvd('I', 'J'), 2.6, 0.1, 'PELDEHUE → TORTOLAS ≈ 2,6 NM (3′07″ de longitud a 33°S)'); near(rvd('J', 'K'), 6.9, 0.2, 'TORTOLAS → POLPAICO ≈ 6,9 NM');
// las rutas con puntos van en el sentido que dice el AIP: salidas hacia el Weste (longitud más al oeste cada vez), llegadas hacia el Este
const lonsOf = r => r.pts.map(k => RV.puntos[k].lon);
const west = ls => ls.every((v, i) => i === 0 || v < ls[i - 1]), east = ls => ls.every((v, i) => i === 0 || v > ls[i - 1]);
const rid = new Set(), RVT = new Set(['S', 'L', 'X', 'N']);
for (const r of RV.rutas) {
  assert(!rid.has(r.id), 'id único ' + r.id); rid.add(r.id);
  assert(RVT.has(r.tp) && r.grupo && r.texto && r.ref && r.fecha && r.ads.length, 'campos de ' + r.id);
  for (const a of r.ads) ad(a);
  for (const k of r.pts || []) assert(RV.puntos[k], r.id + ': punto ' + k + ' existe');
  assert(!/@/.test(JSON.stringify(r)), r.id + ': sin correos');
  if (r.rng) assert(r.rng.length === 2 && r.rng.every(v => v >= 0 && v <= 360), 'rango de rumbos de ' + r.id);
}
const byG = (g, tp) => RV.rutas.find(r => r.grupo.startsWith(g) && r.tp === tp);
assert(west(lonsOf(byG('Salida Polpaico', 'S'))) && west(lonsOf(byG('Salida Padre Hurtado', 'S'))), 'las salidas por Polpaico y Padre Hurtado van hacia el Weste');
assert(east(lonsOf(byG('Llegada Padre Hurtado', 'L'))), 'la llegada por Padre Hurtado va hacia el Este');
assert.deepStrictEqual(byG('Llegada Polpaico', 'L').pts, ['K', 'J', 'L'], 'llegada Polpaico: K → J → L');
const cnt = (a, tp) => RV.rutas.filter(r => r.tp === tp && r.ads.includes(a)).length;
assert(cnt('SCTB', 'S') >= 8 && cnt('SCTB', 'L') >= 9 && cnt('SCLC', 'S') >= 5 && cnt('SCLC', 'L') >= 9, `rutas por aeródromo: SCTB ${cnt('SCTB', 'S')}/${cnt('SCTB', 'L')}, SCLC ${cnt('SCLC', 'S')}/${cnt('SCLC', 'L')}`);
// un rumbo del AIP que cae en la salida «Hacia el Sur»: SCTB → SCRG sale hacia ≈ 190°
const inR = (b, r) => r[0] <= r[1] ? b >= r[0] && b <= r[1] : b >= r[0] || b <= r[1];
assert(inR(tbrg.brg, byG('Hacia el Sur Baja', 'S').rng) && !inR(tbrg.brg, byG('Hacia el Norte Baja', 'S').rng), 'SCTB → SCRG corresponde a la salida al Sur, no a la del Norte');
assert(inR(10, byG('Hacia el Norte Baja', 'S').rng) && inR(350, byG('Hacia el Norte Baja', 'S').rng), 'el rango del Norte cruza los 360°');
console.log('PASS: ruta.js (geodesia, viento, plan por tramos, cruce de espacios, límites verticales), ' + ESP.length + ' espacios aéreos, ' + CAN.items.length + ' trazos de rutas visuales y ' + RV.rutas.length + ' rutas de texto del AIP (ENR 7.1–7.8) con ' + Object.keys(RV.puntos).length + ' puntos publicados.');
