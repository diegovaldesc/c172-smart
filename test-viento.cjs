'use strict';
// Pruebas del viento en vivo (viento.js) con respuestas simuladas de Open-Meteo. Uso: node test-viento.cjs
// Con --live hace además una llamada real a la API (necesita internet) y comprueba que la forma de la respuesta sigue siendo la esperada.
const assert = require('assert');
const V = require('./viento.js');
const R = require('./ruta.js');
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

// ---- atmósfera ----
near(V.hpaOfPA(0), 1013.25, 1e-6, 'presión a nivel del mar'); near(V.hpaOfPA(5000), 843, 1.5, '5000 ft ≈ 843 hPa'); near(V.hpaOfPA(10000), 697, 1.5, '10 000 ft ≈ 697 hPa');
near(V.isaAt(0), 15, 1e-9, 'ISA a nivel del mar'); near(V.isaAt(6000), 15 - 11.88, 1e-9, 'ISA a 6000 ft');

// ---- vectores ----
let w = V.toUV(0, 10); near(w.u, 0, 1e-9, 'viento del norte: sin componente este'); near(w.v, -10, 1e-9, 'viento del norte sopla hacia el sur');
w = V.toUV(90, 10); near(w.u, -10, 1e-9, 'viento del este sopla hacia el oeste');
for (let d = 0; d < 360; d += 15) { const b = V.fromUV(V.toUV(d, 17).u, V.toUV(d, 17).v); near((b.dir - d + 540) % 360 - 180, 0, 1e-6, 'ida y vuelta de dirección ' + d); near(b.spd, 17, 1e-9, 'ida y vuelta de velocidad'); }
const calm = V.fromUV(V.toUV(90, 10).u + V.toUV(270, 10).u, V.toUV(90, 10).v + V.toUV(270, 10).v); near(calm.spd, 0, 1e-9, 'vientos opuestos se anulan (se promedia por componentes, no por dirección)');

// ---- perfil e interpolación ----
const prof = [{ p: 900, u: -10, v: 0, t: 10 }, { p: 800, u: -20, v: 0, t: 4 }, { p: 700, u: -40, v: 0, t: -2 }];
let it = V.interp(prof, 900); near(it.u, -10, 1e-9, 'exacto en un nivel'); assert.strictEqual(it.clamp, null);
it = V.interp(prof, 850); near(it.u, -10 + (Math.log(900 / 850) / Math.log(900 / 800)) * -10, 1e-9, 'interpolación lineal en ln p'); near(it.t, 10 + (Math.log(900 / 850) / Math.log(900 / 800)) * -6, 1e-9, 'temperatura interpolada');
it = V.interp(prof, 750); assert(it.u < -20 && it.u > -40, 'entre 800 y 700');
it = V.interp(prof, 960); assert.strictEqual(it.clamp, 'low', 'bajo el nivel más bajo: avisa'); near(it.u, -10, 1e-9, 'y usa el más bajo');
it = V.interp(prof, 905); assert.strictEqual(it.clamp, null, 'diferencia chica con el nivel más bajo: no avisa');
it = V.interp(prof, 500); assert.strictEqual(it.clamp, 'high'); assert.strictEqual(V.interp([], 800), null);
// niveles bajo tierra se descartan: con presión de superficie 930 no valen 975 ni 950
const H1 = { time: ['2026-11-26T00:00'], surface_pressure: [930], wind_speed_10m: [4], wind_direction_10m: [180], temperature_2m: [20] };
for (const L of V.LEVELS) { H1['wind_speed_' + L + 'hPa'] = [10]; H1['wind_direction_' + L + 'hPa'] = [270]; H1['temperature_' + L + 'hPa'] = [15]; }
const pr = V.profileAt(H1, 0);
assert.deepStrictEqual(pr.map(e => e.p), [930, 925, 900, 850, 800, 700, 600], 'superficie + niveles sobre el suelo, de abajo hacia arriba');
near(pr[0].t, 20, 1e-9, 'la superficie trae su temperatura');

// ---- hora ----
const T = { time: ['2026-11-26T00:00', '2026-11-26T01:00', '2026-11-26T02:00'] };
near(V.hourIndex(T, Date.parse('2026-11-26T01:30:00Z')), 1.5, 1e-9, 'hora fraccionaria'); assert.strictEqual(V.hourIndex(T, Date.parse('2026-11-25T23:00:00Z')), null, 'antes del pronóstico'); assert.strictEqual(V.hourIndex(T, Date.parse('2026-11-26T03:00:00Z')), null, 'después del pronóstico');

// ---- puntos de muestreo ----
const A = { lat: -33.4, lon: -70.6 }, B = R.dir(A, 180, 130), C = R.dir(B, 90, 20);
const sp = V.samplePoints([A, B, C], 100, Date.parse('2026-11-26T12:00:00Z'));
assert.strictEqual(sp.samples.filter(s => s.leg === 0).length, 3, 'tramo de 130 NM: 3 muestras'); assert.strictEqual(sp.samples.filter(s => s.leg === 1).length, 1, 'tramo de 20 NM: 1 muestra');
for (let i = 1; i < sp.samples.length; i++) assert(sp.samples[i].tMs > sp.samples[i - 1].tMs, 'las horas avanzan');
near(sp.totalNm, 150, 0.2, 'distancia total'); near(sp.etaMs - Date.parse('2026-11-26T12:00:00Z'), 1.5 * 3600000, 0.003 * 3600000, 'llegada a 100 kt');
assert(sp.samples[0].lat < A.lat && sp.samples[0].lat > B.lat, 'la 1.ª muestra está dentro del tramo 1');

// ---- URL y trozos ----
const u = V.buildUrl([A, B]);
for (const k of ['wind_speed_850hPa', 'wind_direction_700hPa', 'temperature_925hPa', 'surface_pressure', 'pressure_msl', 'wind_speed_10m', 'wind_speed_unit=kn', 'timezone=UTC']) assert(u.includes(k), 'la URL pide ' + k);
assert(u.startsWith('https://api.open-meteo.com/'), 'servicio esperado'); assert(/latitude=-33\.400,-/.test(u), 'coordenadas con 3 decimales: ' + u.slice(0, 120));
assert(!/avaldes|@/.test(u), 'la URL no lleva datos personales');

// ---- respuesta simulada: viento del oeste que aumenta con la altura ----
const times = []; for (let d = 0; d < 4; d++) for (let h = 0; h < 24; h++) times.push(`2026-11-${25 + d}T${String(h).padStart(2, '0')}:00`);
const hourly = (windAt, psfc = 940) => {
  const o = { time: times, surface_pressure: times.map(() => psfc), pressure_msl: times.map(() => 1012), temperature_2m: times.map(() => 22), wind_speed_10m: times.map(() => 5), wind_direction_10m: times.map(() => 270) };
  for (const L of V.LEVELS) { const [d, s, t] = windAt(L); o['wind_direction_' + L + 'hPa'] = times.map(() => d); o['wind_speed_' + L + 'hPa'] = times.map(() => s); o['temperature_' + L + 'hPa'] = times.map(() => t); }
  return o;
};
const westerly = L => [270, Math.round((1000 - L) / 10), 25 - (1000 - L) / 14];                      // 975 hPa → 2 kt … 700 hPa → 30 kt
const mockFetch = calls => async url => {
  calls.push(url);
  const n = (new URL(url).searchParams.get('latitude').split(',')).length;
  return { ok: true, json: async () => Array.from({ length: n }, () => ({ hourly: hourly(westerly) })) };
};
(async () => {
  const calls = [], etd = Date.parse('2026-11-26T15:00:00Z');
  const ctx = { pts: [A, B, C], tas: 110, etdMs: etd, paFt: 6000 };
  const res = await V.fetchPlan(ctx, mockFetch(calls));
  assert.strictEqual(calls.length, 1, 'todo en una consulta (≤12 puntos)');
  assert.strictEqual(res.legs.length, 2, 'un viento por tramo');
  const p6 = V.hpaOfPA(6000);                                                                         // ≈ 812 hPa
  const expSpd = Math.round((1000 - p6) / 10 * 1);                                                    // aprox. por la recta de la simulación
  res.legs.forEach(l => { assert(!l.err, 'sin error'); near(l.dir, 270, 1, 'viento del oeste'); near(l.spd, expSpd, 3, 'velocidad a 6000 ft ≈ ' + expSpd); });
  near(res.hpa, p6, 1e-9, 'presión usada = altitud presión pedida');
  assert(res.dep && res.arr && res.dep.qnh === 1012 && res.dep.dir === 270 && res.dep.spd === 5 && res.dep.tmp === 22, 'meteo de superficie en salida y llegada');
  near(res.legs[0].tmp, 25 - (1000 - p6) / 14, 1, 'temperatura a la altitud de crucero');
  // más trozos: 14 muestras+extremos → 2 consultas
  const long = { pts: [A, R.dir(A, 180, 300), R.dir(R.dir(A, 180, 300), 180, 300), R.dir(R.dir(A, 180, 600), 180, 300)], tas: 110, etdMs: etd, paFt: 6000 };
  const c2 = []; const r2 = await V.fetchPlan(long, mockFetch(c2)); assert(c2.length === 2, 'más de 12 puntos se piden en trozos: ' + c2.length); assert.strictEqual(r2.legs.length, 3);
  // fuera del rango del pronóstico (salida dentro de 10 días)
  const far = await V.fetchPlan({ ...ctx, etdMs: Date.parse('2026-12-20T12:00:00Z') }, mockFetch([]));
  assert(far.legs.every(l => l.err), 'sin pronóstico para esa fecha: cada tramo trae el error, no un número inventado'); assert.strictEqual(far.dep, null);
  // errores de red y respuestas raras
  await assert.rejects(V.fetchPlan(ctx, async () => ({ ok: false, status: 429 })), /429/, 'error HTTP se propaga');
  await assert.rejects(V.fetchPlan(ctx, async () => ({ ok: true, json: async () => ({ error: true, reason: 'x' }) })), /inesperada/, 'respuesta sin datos se rechaza');
  // por debajo del nivel más bajo: se avisa
  const low = await V.fetchPlan({ ...ctx, paFt: 500 }, async url => ({ ok: true, json: async () => Array.from({ length: new URL(url).searchParams.get('latitude').split(',').length }, () => ({ hourly: hourly(westerly, 1000) })) }));
  assert(low.legs.every(l => l.clamp === 'low' || l.clamp === null), 'clamp bajo coherente');

  if (process.argv.includes('--live')) {
    const live = await V.fetchPlan({ pts: [A, B], tas: 110, etdMs: Date.now() + 3600000, paFt: 6000 });
    assert(live.legs[0] && !live.legs[0].err && live.legs[0].spd >= 0 && live.legs[0].dir >= 0 && live.legs[0].dir < 360, 'respuesta real con viento: ' + JSON.stringify(live.legs[0]));
    assert(live.dep && live.dep.qnh > 950 && live.dep.qnh < 1060, 'QNH real plausible: ' + live.dep.qnh);
    console.log('  (en vivo) tramo 1:', JSON.stringify(live.legs[0]), ' salida:', JSON.stringify(live.dep));
  }
  console.log('PASS: viento.js (atmósfera, vectores, interpolación por presión y hora, muestreo, consultas en trozos, errores y fuera de rango).');
})().catch(e => { console.error(e); process.exit(1); });
