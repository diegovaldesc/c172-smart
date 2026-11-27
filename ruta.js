'use strict';
// Cálculo de rutas por tramos: distancia y rumbo (círculo máximo), viento, combustible/tiempo por tramo
// y cruce de espacios aéreos. Funciones puras: se prueban en Node (test.cjs) y se usan en el mapa (mapa.js).
(function (root) {
  const R_NM = 3440.065, D2R = Math.PI / 180;
  const mod360 = a => ((a % 360) + 360) % 360;

  // p, q = {lat, lon}. Distancia en NM y rumbo verdadero inicial.
  function inv(p, q) {
    const f1 = p.lat * D2R, f2 = q.lat * D2R, dl = (q.lon - p.lon) * D2R;
    const h = Math.sin((f2 - f1) / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
    const nm = 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
    const y = Math.sin(dl) * Math.cos(f2), x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
    return { nm, brg: mod360(Math.atan2(y, x) / D2R) };
  }
  // punto a "nm" millas de p en el rumbo verdadero brg
  function dir(p, brg, nm) {
    const f1 = p.lat * D2R, l1 = p.lon * D2R, th = brg * D2R, d = nm / R_NM;
    const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(th));
    const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
    return { lat: f2 / D2R, lon: ((l2 / D2R + 540) % 360) - 180 };
  }
  // punto sobre el círculo máximo entre p y q a la fracción f (0..1)
  function between(p, q, f) {
    const r = inv(p, q);
    return r.nm < 1e-9 ? { lat: p.lat, lon: p.lon } : dir(p, r.brg, r.nm * f);
  }

  // ---------- tramos ----------
  function legsOf(pts) {
    const out = [];
    for (let i = 1; i < pts.length; i++) { const r = inv(pts[i - 1], pts[i]); out.push({ i, nm: r.nm, tc: r.brg }); }
    return out;
  }

  // ---------- viento ----------
  // tc = rumbo verdadero a volar (course), tas, viento DESDE wdir (° verdaderos) a wspd kt.
  // Devuelve rumbo verdadero a mantener (th), velocidad suelo (gs) y ángulo de corrección (wca, + = a la derecha). null si no hay avance.
  function windTriangle(tc, tas, wdir, wspd) {
    if (!(tas > 0)) return null;
    if (!(wspd > 0)) return { th: mod360(tc), gs: tas, wca: 0, head: 0 };
    const a = (wdir - tc) * D2R, s = wspd * Math.sin(a) / tas;
    if (Math.abs(s) >= 1) return null;                  // el viento de costado supera la TAS
    const wca = Math.asin(s), gs = tas * Math.cos(wca) - wspd * Math.cos(a);
    if (!(gs > 0)) return null;
    return { th: mod360(tc + wca / D2R), gs, wca: wca / D2R, head: wspd * Math.cos(a) };
  }

  // ---------- plan de combustible por tramos ----------
  // o = { tas, gph, climb:{min,gal,nm}, taxi (gal), resMin, wdir, wspd, vari (° E positivo, W negativo),
  //       winds?: [{dir, spd}] un viento por tramo (si falta el del tramo, valen wdir/wspd) }
  // El ascenso cubre los primeros climb.nm de la ruta (a la velocidad suelo del tramo); el resto es crucero.
  // Cada tramo trae además el tiempo y el combustible acumulados (minCum, galCum: sin rodaje ni reserva) para la bitácora.
  function plan(pts, o) {
    const legs = legsOf(pts), cl = o.climb || { min: 0, gal: 0, nm: 0 };
    const res = { legs: [], nm: 0, min: 0, galClimb: 0, galCruise: 0, warns: [], ok: true };
    let climbLeft = cl.nm;
    legs.forEach((L, k) => {
      const wi = (o.winds && o.winds[k]) || { dir: o.wdir || 0, spd: o.wspd || 0 }, wdir = wi.dir || 0, wspd = wi.spd || 0;
      const w = windTriangle(L.tc, o.tas, wdir, wspd);
      if (!w) { res.ok = false; res.legs.push({ ...L, th: null, mh: null, gs: null, min: null, gal: null, wdir, wspd, noWind: true }); return; }
      const cNm = Math.min(L.nm, Math.max(0, climbLeft)), kNm = L.nm - cNm;
      const frac = cl.nm > 0 ? cNm / cl.nm : 0;
      // sin distancia de ascenso (valores propios del piloto) el combustible de ascenso es un extra que se suma una vez, en el primer tramo
      const cMin = cl.min * frac, cGal = cl.gal * frac + (k === 0 && !(cl.nm > 0) ? (cl.gal || 0) : 0), kMin = kNm / w.gs * 60, kGal = kMin / 60 * o.gph;
      climbLeft -= cNm;
      res.nm += L.nm; res.min += cMin + kMin; res.galClimb += cGal; res.galCruise += kGal;
      res.legs.push({ ...L, th: w.th, mh: mod360(w.th - (o.vari || 0)), gs: w.gs, wca: w.wca, head: w.head, wdir, wspd, min: cMin + kMin, gal: cGal + kGal, climbNm: cNm, climbMin: cMin, climbGal: cGal, minCum: res.min, galCum: res.galClimb + res.galCruise });
    });
    if (legs.length && climbLeft > 1e-6) res.warns.push(`La ruta (${res.nm.toFixed(0)} NM) es más corta que el ascenso hasta la altitud de crucero (${cl.nm.toFixed(0)} NM): el combustible está sobreestimado; baja la altitud de crucero.`);
    res.galReserve = (o.resMin || 0) / 60 * o.gph;
    res.galTaxi = o.taxi || 0;
    res.galTotal = res.galTaxi + res.galClimb + res.galCruise + res.galReserve;
    res.galEnroute = res.galClimb + res.galCruise;
    return res;
  }

  // ---------- geometría de espacios aéreos ----------
  // e.g = { r: [[lat,lon],...] } o { c: [lat,lon], nm }
  function ringContains(ring, lat, lon) {
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i], [yj, xj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  function inside(g, lat, lon) {
    if (g.r) return ringContains(g.r, lat, lon);
    return inv({ lat: g.c[0], lon: g.c[1] }, { lat, lon }).nm <= g.nm;
  }
  function bbox(g) {
    if (g.bb) return g.bb;
    let a, b, c, d;
    if (g.r) { const la = g.r.map(p => p[0]), lo = g.r.map(p => p[1]); a = Math.min(...la); b = Math.max(...la); c = Math.min(...lo); d = Math.max(...lo); }
    else { const dl = g.nm / 60, dn = g.nm / (60 * Math.cos(g.c[0] * D2R)); a = g.c[0] - dl; b = g.c[0] + dl; c = g.c[1] - dn; d = g.c[1] + dn; }
    return [a, b, c, d];
  }
  // Para cada tramo, los espacios que atraviesa: [{ id, from, to }] con from/to en NM desde el inicio del tramo.
  function crossings(pts, esp, step = 0.2) {
    const out = [];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i], r = inv(p, q), n = Math.max(1, Math.ceil(r.nm / step));
      const la0 = Math.min(p.lat, q.lat) - 0.2, la1 = Math.max(p.lat, q.lat) + 0.2, lo0 = Math.min(p.lon, q.lon) - 0.2, lo1 = Math.max(p.lon, q.lon) + 0.2;
      const cand = esp.filter(e => { const [a, b, c, d] = bbox(e.g); return !(b < la0 || a > la1 || d < lo0 || c > lo1); });
      const open = new Map(), list = [];
      for (let k = 0; k <= n; k++) {
        const s = r.nm * k / n, pt = between(p, q, k / n);
        for (const e of cand) {
          const inn = inside(e.g, pt.lat, pt.lon), cur = open.get(e.id);
          if (inn && !cur) open.set(e.id, { id: e.id, from: s, to: s });
          else if (inn && cur) cur.to = s;
          else if (!inn && cur) { list.push(cur); open.delete(e.id); }
        }
      }
      for (const c of open.values()) list.push(c);
      out.push(list.sort((x, y) => x.from - y.from));
    }
    return out;
  }

  // Límite vertical del AIP a pies: "GND"→0, "FL195"→19500, "5000 FT ALT"→5000, "2000 FT AGL"→{ft:2000, agl:true}.
  // Texto compuesto o desconocido → null (la app muestra el texto del AIP y no compara).
  function limitFt(s) {
    if (s == null) return null;
    const t = String(s).trim().toUpperCase().replace(/\./g, '');
    if (/^(GND|SFC)(\s*\/\s*MSL)?$/.test(t)) return { ft: 0, agl: true };
    if (/^UNL$/.test(t)) return { ft: 99999 };
    let m = /^FL\s?(\d{2,3})$/.exec(t); if (m) return { ft: +m[1] * 100 };
    m = /^(\d{3,5})\s?FT(?:\s*(ALT|AMSL|MSL|AGL))?$/.exec(t); if (m) return { ft: +m[1], agl: m[2] === 'AGL' };
    return null;
  }
  // ¿La altitud (ft) está dentro de los límites del espacio? 'in' | 'below' | 'above' | '?' (no comparable)
  function altRelation(e, altFt) {
    const lo = limitFt(e.inf), hi = limitFt(e.sup);
    if (!lo || !hi) return '?';
    if (lo.agl && lo.ft > 0 || hi.agl) return '?';       // AGL depende del terreno: no se compara
    if (altFt < lo.ft) return 'below';
    if (altFt > hi.ft) return 'above';
    return 'in';
  }

  const api = { R_NM, inv, dir, between, legsOf, windTriangle, plan, ringContains, inside, bbox, crossings, limitFt, altRelation, mod360 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RUTA = api;
})(typeof window !== 'undefined' ? window : globalThis);
