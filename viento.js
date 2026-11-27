'use strict';
// Viento en vivo para la ruta. Fuente: Open-Meteo (https://open-meteo.com, datos CC BY 4.0), pronóstico de modelo numérico
// por niveles de presión. NO es un producto aeronáutico oficial (ni METAR/TAF ni viento en altura de la DMC): es referencial.
// Este archivo es de funciones puras + la llamada a la red; la pantalla está en viaje.js. Se prueba en Node (test-viento.cjs).
(function (root) {
  const D2R = Math.PI / 180;
  const R = root.RUTA || (typeof require !== 'undefined' ? require('./ruta.js') : null);
  const API = 'https://api.open-meteo.com/v1/forecast';
  const LEVELS = [975, 950, 925, 900, 850, 800, 700, 600];          // hPa: de ~1000 ft a ~14 000 ft, el rango de un C172
  const MAX_AGE_H = 3;                                              // un pronóstico obtenido hace más que esto se marca como viejo

  // ---------- atmósfera estándar ----------
  const hpaOfPA = ft => 1013.25 * Math.pow(1 - 6.8755856e-6 * ft, 5.2558797);   // presión a una altitud presión
  const isaAt = ft => 15 - 1.98 * ft / 1000;                                    // temperatura estándar (°C), la misma que usa la app

  // ---------- vectores de viento (dir = de dónde viene) ----------
  const toUV = (dir, spd) => ({ u: -spd * Math.sin(dir * D2R), v: -spd * Math.cos(dir * D2R) });
  const fromUV = (u, v) => ({ dir: (Math.atan2(-u, -v) / D2R + 360) % 360, spd: Math.hypot(u, v) });

  // ---------- perfil vertical en un punto y una hora ----------
  // h = "hourly" de Open-Meteo para un punto. i = índice de hora entera. Entradas {p, u, v, t}, de más a menos presión.
  // La entrada de superficie es el viento a 10 m y la temperatura a 2 m, a la presión de superficie del modelo.
  function profileAt(h, i) {
    const at = k => (h[k] ? h[k][i] : null);
    const psfc = at('surface_pressure'), out = [];
    const s = at('wind_speed_10m'), d = at('wind_direction_10m'), t0 = at('temperature_2m');
    if (psfc != null && s != null && d != null) out.push({ p: psfc, ...toUV(d, s), t: t0 });
    for (const L of LEVELS) {
      const sp = at('wind_speed_' + L + 'hPa'), di = at('wind_direction_' + L + 'hPa'), te = at('temperature_' + L + 'hPa');
      if (sp == null || di == null) continue;
      if (psfc != null && L >= psfc - 1) continue;                  // nivel bajo tierra: el modelo lo extrapola, no vale
      out.push({ p: L, ...toUV(di, sp), t: te });
    }
    return out.sort((a, b) => b.p - a.p);
  }
  // Interpola (lineal en ln p) viento y temperatura a la presión p. clamp: 'low' si p queda bajo el nivel más bajo disponible, 'high' si sobre el más alto.
  function interp(prof, p) {
    if (!prof.length) return null;
    const lo = prof[0], hi = prof[prof.length - 1];
    if (p >= lo.p) return { u: lo.u, v: lo.v, t: lo.t, clamp: p > lo.p + 25 ? 'low' : null };
    if (p <= hi.p) return { u: hi.u, v: hi.v, t: hi.t, clamp: p < hi.p - 25 ? 'high' : null };
    let k = 0; while (k < prof.length - 2 && prof[k + 1].p >= p) k++;
    const a = prof[k], b = prof[k + 1], f = Math.log(a.p / p) / Math.log(a.p / b.p);
    const mix = (x, y) => (x == null || y == null) ? (x == null ? y : x) : x + f * (y - x);
    return { u: mix(a.u, b.u), v: mix(a.v, b.v), t: mix(a.t, b.t), clamp: null };
  }
  // Hora fraccionaria dentro de la serie (en horas desde la primera). null si cae fuera del pronóstico.
  function hourIndex(h, tMs) {
    const t0 = Date.parse(h.time[0] + 'Z');
    const f = (tMs - t0) / 3600000;
    return f < 0 || f > h.time.length - 1 ? null : f;
  }
  // Viento y temperatura a la presión p, también interpolados en el tiempo (entre la hora de arriba y la de abajo)
  function interpAt(h, f, p) {
    const n = h.time.length, i = Math.min(Math.floor(f), n - 1), j = Math.min(i + 1, n - 1), g = f - i;
    const a = interp(profileAt(h, i), p);
    if (!a || g < 1e-9 || j === i) return a;
    const b = interp(profileAt(h, j), p);
    if (!b) return a;
    const m = (x, y) => (x == null || y == null) ? (x == null ? y : x) : x + g * (y - x);
    return { u: m(a.u, b.u), v: m(a.v, b.v), t: m(a.t, b.t), clamp: a.clamp || b.clamp };
  }

  // ---------- puntos de muestreo a lo largo de la ruta ----------
  // Un viento medio por tramo: se toman puntos cada ~60 NM (como mucho 5 por tramo) y la hora a la que se pasaría por ahí
  // (a la TAS, sin viento: basta para elegir la hora del pronóstico).
  function samplePoints(pts, tas, etdMs) {
    const samples = []; let cum = 0;
    for (let i = 1; i < pts.length; i++) {
      const r = R.inv(pts[i - 1], pts[i]), n = Math.max(1, Math.min(5, Math.ceil(r.nm / 60)));
      for (let k = 0; k < n; k++) {
        const fr = (k + 0.5) / n, q = R.between(pts[i - 1], pts[i], fr);
        samples.push({ leg: i - 1, lat: q.lat, lon: q.lon, tMs: etdMs + (cum + r.nm * fr) / tas * 3600000 });
      }
      cum += r.nm;
    }
    return { samples, totalNm: cum, etaMs: etdMs + cum / tas * 3600000 };
  }

  // ---------- red ----------
  const VARS = ['wind_speed_10m', 'wind_direction_10m', 'temperature_2m', 'surface_pressure', 'pressure_msl']
    .concat(...LEVELS.map(L => ['wind_speed_' + L + 'hPa', 'wind_direction_' + L + 'hPa', 'temperature_' + L + 'hPa']));
  function buildUrl(points) {
    const r = x => (+x).toFixed(3);
    return API + '?latitude=' + points.map(p => r(p.lat)).join(',') + '&longitude=' + points.map(p => r(p.lon)).join(',') +
      '&hourly=' + VARS.join(',') + '&wind_speed_unit=kn&timezone=UTC&past_days=1&forecast_days=3';
  }
  // points: [{lat, lon}] -> respuestas (una por punto, en el mismo orden). Pide de a 12 puntos.
  async function fetchPoints(points, fetchFn) {
    const f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) throw new Error('sin red');
    const out = [];
    for (let i = 0; i < points.length; i += 12) {
      const chunk = points.slice(i, i + 12);
      const res = await f(buildUrl(chunk));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const arr = Array.isArray(j) ? j : [j];
      if (arr.length !== chunk.length || arr.some(x => !x || !x.hourly || !x.hourly.time)) throw new Error('respuesta inesperada');
      out.push(...arr);
    }
    return out;
  }

  // ---------- resultado ----------
  // ctx = { pts, tas, etdMs, paFt }. Devuelve { legs:[{dir, spd, tmp, clamp, err?}], dep, arr, etaMs } con viento VERDADERO (de dónde viene).
  // El orden de "points" que se pidió es: muestras (en orden), luego salida, luego llegada (ver pointsFor).
  function pointsFor(ctx) {
    const sp = samplePoints(ctx.pts, ctx.tas, ctx.etdMs);
    const dep = ctx.pts[0], arr = ctx.pts[ctx.pts.length - 1];
    return { sp, points: sp.samples.map(s => ({ lat: s.lat, lon: s.lon })).concat([{ lat: dep.lat, lon: dep.lon }, { lat: arr.lat, lon: arr.lon }]) };
  }
  function surfaceMet(r, tMs) {
    const h = r.hourly, f = hourIndex(h, tMs);
    if (f == null) return null;
    const i = Math.round(f), g = k => (h[k] ? h[k][i] : null);
    const s = g('wind_speed_10m'), d = g('wind_direction_10m');
    return { dir: d == null ? null : Math.round(d), spd: s == null ? null : Math.round(s), tmp: g('temperature_2m'), qnh: g('pressure_msl') };
  }
  function compute(resps, ctx) {
    const { sp } = pointsFor(ctx), n = sp.samples.length, p = hpaOfPA(ctx.paFt);
    const nLegs = ctx.pts.length - 1, acc = Array.from({ length: nLegs }, () => ({ u: 0, v: 0, t: 0, nt: 0, n: 0, bad: false, clamp: null }));
    sp.samples.forEach((s, k) => {
      const h = resps[k].hourly, f = hourIndex(h, s.tMs), a = acc[s.leg];
      if (f == null) { a.bad = true; return; }
      const it = interpAt(h, f, p);
      if (!it) { a.bad = true; return; }
      a.u += it.u; a.v += it.v; a.n++;
      if (it.t != null) { a.t += it.t; a.nt++; }
      if (it.clamp) a.clamp = it.clamp;
    });
    const legs = acc.map(a => {
      if (a.bad || !a.n) return { err: 'fuera del rango del pronóstico' };
      const w = fromUV(a.u / a.n, a.v / a.n);
      return { dir: Math.round(w.dir) % 360, spd: Math.round(w.spd), tmp: a.nt ? a.t / a.nt : null, clamp: a.clamp };
    });
    return { legs, dep: surfaceMet(resps[n], ctx.etdMs), arr: surfaceMet(resps[n + 1], sp.etaMs), etaMs: sp.etaMs, hpa: p };
  }
  async function fetchPlan(ctx, fetchFn) {
    const { points } = pointsFor(ctx);
    return compute(await fetchPoints(points, fetchFn), ctx);
  }

  const api = { LEVELS, MAX_AGE_H, hpaOfPA, isaAt, toUV, fromUV, profileAt, interp, interpAt, hourIndex, samplePoints, buildUrl, fetchPoints, pointsFor, compute, fetchPlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VIENTO = api;
})(typeof window !== 'undefined' ? window : globalThis);
