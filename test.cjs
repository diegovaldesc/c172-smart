// Dependency-free regression checks for the calculation and rendering code.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const nodes=new Map();
function node(id,value=''){return {id,value,min:'',max:'',hidden:false,disabled:false,dataset:{},classList:{contains:()=>false,toggle(){}},setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},addEventListener(k,v){(this.events??={})[k]=v},querySelector(){return node('child')},closest(q){const man=['r_tas','r_burn','r_climb'],poh=['r_alt','r_rpm','r_isa'];if(q!=='[hidden]')return null;return (man.includes(this.id)&&nodes.get('r_man_f').hidden)||(poh.includes(this.id)&&nodes.get('r_poh_f').hidden)?this:null},querySelectorAll(){return []},replaceChildren(){this.innerHTML=''},innerHTML:'',textContent:''};}
for(const m of html.matchAll(/<(input|select|textarea|div|svg|button|span|b|small|p|table|tbody|td|section|em|label)[^>]*\bid="([^"]+)"[^>]*>/g)){
 const n=node(m[2],m[0].match(/\bvalue="([^"]*)"/)?.[1]||'');n.type=m[0].match(/\btype="([^"]*)"/)?.[1];
 n.min=m[0].match(/\bmin="([^"]*)"/)?.[1]??'';n.max=m[0].match(/\bmax="([^"]*)"/)?.[1]??'';
 if(m[1]==='textarea')n.value=html.slice(m.index+m[0].length).split('</textarea>')[0];
 if(m[1]==='select'){const body=html.slice(m.index+m[0].length).split('</select>')[0];n.value=body.match(/value="([^"]*)"[^>]*\bselected/)?.[1]??body.match(/value="([^"]*)"/)?.[1]??'';}
 let storedValue=n.value; Object.defineProperty(n,"value",{get(){return storedValue},set(v){storedValue=String(v)}}); nodes.set(n.id,n);
}
const actions=new Map();
const document={getElementById:id=>{assert(nodes.has(id),'missing DOM id '+id);return nodes.get(id)},querySelector:q=>{if(!actions.has(q))actions.set(q,node(q));return actions.get(q)},querySelectorAll:q=>q==='input[type="number"]'?[...nodes.values()].filter(n=>n.type==='number'):[],addEventListener(){},body:{dataset:{}}};
const ctx=vm.createContext({document,window:{scrollTo(){}},localStorage:{getItem:()=>null,setItem(){}},console});
vm.runInContext(fs.readFileSync(__dirname+'/modelos.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/app.js','utf8'),ctx);
const run=code=>vm.runInContext(code,ctx);
const set=(id,v)=>nodes.get(id).value=String(v);
const near=(a,b,tol,msg)=>assert(Math.abs(a-b)<=tol,(msg||'')+` esperado ${b}, obtenido ${a}`);
const pick=id=>nodes.get('model_list').events.click({target:{closest:()=>({dataset:{model:id}})}});

// ---------------------------------------------------------------- integridad de las tablas del POH
const MODELS=JSON.parse(JSON.stringify(run('MODELS')));
assert.deepEqual(Object.keys(MODELS).sort(),['c172m','c172n','c172p','c172r','c172s'],'cinco modelos con POH');
for(const [id,m] of Object.entries(MODELS)){
  assert(m.tanks.length>=1 && m.tanks.every(t=>t.usable>0 && t.usable<=t.total),id+' tanques');
  assert(m.w.mtow>=m.w.mlw && m.w.ramp>=m.w.mtow,id+' pesos');
  assert(m.cg.fwdMin<m.cg.fwdMax && m.cg.fwdMax<m.cg.aft && m.cg.knee<m.w.mtow,id+' envolvente');
  assert.equal(m.perf.pa.length,9);assert.equal(m.perf.oat.length,5);
  for(const kind of ['to','ld']){
    const T=m.perf[kind];assert(T.sheets.length>=1,id+' '+kind+' tiene hojas');
    const ws=T.sheets.map(s=>s.w);assert.deepEqual(ws,[...ws].sort((a,b)=>b-a),id+' '+kind+' hojas de mayor a menor peso');
    for(const s of T.sheets){
      assert.equal(s.rows.length,9,id+' filas');
      for(const r of s.rows)assert.equal(r.length,10,id+' columnas');
      for(let i=0;i<9;i++)for(let j=0;j<5;j++){
        const g=s.rows[i][2*j],d=s.rows[i][2*j+1];
        assert((g===null)===(d===null),id+' celda a medias');
        if(g===null)continue;
        assert(d>g,`${id} ${kind} ${s.w} pa${i} t${j}: a 50 ft (${d}) debe superar el recorrido (${g})`);
        for(const k of [0,1]){ // crece con la altitud y con la temperatura
          if(i>0&&s.rows[i-1][2*j+k]!==null)assert(s.rows[i][2*j+k]>=s.rows[i-1][2*j+k],`${id} ${kind} ${s.w} pa${i} t${j} k${k} no crece con la altitud`);
          if(j>0&&s.rows[i][2*(j-1)+k]!==null)assert(s.rows[i][2*j+k]>=s.rows[i][2*(j-1)+k],`${id} ${kind} ${s.w} pa${i} t${j} k${k} no crece con la temperatura`);
        }
      }
    }
    // más liviano => distancias menores o iguales
    for(let n=1;n<T.sheets.length;n++)for(let i=0;i<9;i++)for(let c=0;c<10;c++){
      const heavy=T.sheets[n-1].rows[i][c],light=T.sheets[n].rows[i][c];
      if(heavy!==null&&light!==null)assert(light<=heavy,`${id} ${kind} pa${i} c${c}: la hoja liviana (${light}) supera a la pesada (${heavy})`);
    }
  }
}

// ---------------------------------------------------------------- valores exactos del POH (puntos de la tabla)
const look=(model,kind,pa,oat,w)=>JSON.parse(run(`(()=>{const keep=MODEL;MODEL=MODELS.${model};try{return JSON.stringify(pohLookup('${kind}',${pa},${oat},${w}))}finally{MODEL=keep}})()`));
let r=look('c172s','to',0,0,2550);assert.deepEqual([r.gr,r.d50,r.vr,r.v50],[860,1465,51,56],'172S despegue S.L. 0 °C 2550');
r=look('c172s','to',8000,40,2550);assert.deepEqual([r.gr,r.d50],[2450,4615],'172S despegue 8000 ft 40 °C');
r=look('c172s','ld',0,0,2550);assert.deepEqual([r.gr,r.d50,r.v50],[545,1290,61],'172S aterrizaje S.L. 0 °C');
r=look('c172s','ld',8000,40,2550);assert.deepEqual([r.gr,r.d50],[840,1755],'172S aterrizaje 8000 ft 40 °C');
r=look('c172s','to',0,0,2400);assert.deepEqual([r.gr,r.d50,r.vr,r.v50],[745,1275,48,54],'172S despegue 2400 lb');
r=look('c172s','to',8000,40,2200);assert.deepEqual([r.gr,r.d50],[1695,2950],'172S despegue 2200 lb 8000 ft 40 °C');
r=look('c172p','to',0,0,2400);assert.deepEqual([r.gr,r.d50],[795,1460],'172P despegue S.L. 0 °C 2400');
// interpolación bilineal (altitud × temperatura), lineal entre pesos
r=look('c172s','to',500,5,2550);near(r.gr,(860+925+940+1010)/4,1e-9,'bilineal gr');near(r.d50,(1465+1575+1600+1720)/4,1e-9,'bilineal d50');
r=look('c172s','to',0,0,2475);near(r.gr,(860+745)/2,1e-9,'peso intermedio gr');near(r.d50,(1465+1275)/2,1e-9);near(r.vr,49.5,1e-9);near(r.v50,55,1e-9);
assert.equal(r.notes.length,0,'entre hojas no hay nota');
// fuera de las hojas de peso: se usa la hoja más cercana y se avisa; nunca se extrapola
r=look('c172s','to',0,0,2000);assert.deepEqual([r.gr,r.d50],[610,1055],'bajo la hoja liviana usa 2200');assert(r.notes.length===1&&/más liviana/.test(r.notes[0]));
r=look('c172s','to',0,0,2600);assert.deepEqual([r.gr,r.d50],[860,1465]);assert(r.notes.length===1&&/sobre el máximo/.test(r.notes[0]));
r=look('c172s','ld',0,0,2190);assert.deepEqual([r.gr,r.d50],[545,1290]);assert(/solo para/.test(r.notes[0]),'aterrizaje: hoja única, sin corrección por peso');
// clamp bajo 0 y fuera de tabla
r=look('c172s','to',-1000,-5,2550);assert.deepEqual([r.gr,r.d50],[860,1465]);assert.equal(r.notes.length,2);
assert(look('c172s','to',8001,15,2550).out,'PA > 8000 ft: fuera de tabla');
assert(look('c172s','to',0,41,2550).out,'OAT > 40 °C: fuera de tabla');
// celda sin dato ("---") en el POH
const nullCell=(()=>{for(const [id,m] of Object.entries(MODELS))for(const kind of ['to','ld'])for(const s of m.perf[kind].sheets)for(let i=0;i<9;i++)for(let j=0;j<5;j++)if(s.rows[i][2*j]===null)return {id,kind,w:s.w,pa:i*1000,oat:j*10};return null})();
if(nullCell){r=look(nullCell.id,nullCell.kind,nullCell.pa,nullCell.oat,nullCell.w);assert(r.out&&/Sin dato/.test(r.out),'celda "---" => sin dato, no un número inventado');}

// ---------------------------------------------------------------- flujo completo con el 172S por defecto
assert.equal(run('MODEL.id'),'c172s');
assert.equal(nodes.get('w_empty').value,'1642');assert.equal(nodes.get('a_empty').value,'38.12');
assert.equal(run('validateInputs()'),true);
assert(Number.isFinite(run('fuelNeeded')));
const need=run('fuelNeeded');nodes.get('fuel_apply').events.click();
assert(+nodes.get('f_gal').value>=need && +nodes.get('f_gal').value<need+.101,'apply total once');
set('r_mode','man');run('recalc()');
set('r_burn',0);run('recalc()');assert.equal(nodes.get('fuel_apply').disabled,true);assert.equal(nodes.get('fuel_out').innerHTML,'');
set('r_burn',8.5);set('r_wind',105);run('recalc()');assert.equal(run('validateInputs()'),false);
set('r_wind',0);set('w_front',-1);run('recalc()');assert.equal(run('validateInputs()'),false);
set('w_front',340);set('qnh','');run('recalc()');assert.equal(run('validateInputs()'),false);set('qnh',1013);
set('r_dist',10000);run('recalc()');assert.equal(nodes.get('fuel_apply').disabled,true);set('r_dist',120);set('r_mode','poh');run('recalc()');
set('f_gal',.5);run('recalc()');assert.equal(run('SUM.wb.ok'),false);set('f_gal',40);
set('u_w','kg');set('u_f','L');run('onUnitChange()');assert.equal(run('validateInputs()'),true);nodes.get('fuel_apply').events.click();assert(run("num('f_gal') * ff + 1e-9 >= fuelNeeded"));assert(run("num('f_gal') * ff <= LIM.fuelMax"));
assert(!/NaN|Infinity/.test(nodes.get('to_fig').innerHTML));

const reset = () => { set('u_w','lb'); set('u_f','gal'); run('onUnitChange()'); };
reset();
set('w_front',340); set('w_rear',0); set('f_gal',40); set('a_empty','38.12'); set('qnh',1013); set('r_dist',120); set('r_wind',0); set('r_burn',8.5); set('r_mode','poh'); run('recalc()');
assert.equal(run('validateInputs()'), true, 'estado base válido');
// Campos opcionales en blanco valen 0 (sin pasajeros atrás, sin equipaje, sin viento)
set('w_rear',''); set('w_bagA',''); set('wspd',''); set('r_climb',''); run('recalc()');
assert.equal(run('validateInputs()'), true, 'campos opcionales en blanco');
set('w_rear',0); set('w_bagA',0); set('wspd',0); set('r_climb',1.5);
// Pista y dirección del viento: solo obligatorias si hay viento
set('rwy',''); set('wdir',''); set('wspd',0); run('recalc()'); assert.equal(run('validateInputs()'), true, 'sin viento no exige pista');
set('wspd',10); run('recalc()'); assert.equal(run('validateInputs()'), false, 'con viento exige pista y dirección');
set('rwy',27); set('wdir',270); run('recalc()'); assert.equal(run('validateInputs()'), true); set('wspd',0);
// Campos obligatorios en blanco, y errores de tipeo fuera de rango
set('elev',''); run('recalc()'); assert.equal(run('validateInputs()'), false, 'elevación en blanco');
assert(/elev/i.test(nodes.get('validation').textContent), 'el aviso nombra el campo');
set('elev',0);
set('qnh',10013); run('recalc()'); assert.equal(run('validateInputs()'), false, 'QNH 10013'); set('qnh',1013);
set('oat',150); run('recalc()'); assert.equal(run('validateInputs()'), false, 'OAT 150 °C'); set('oat',15);
// Al suspender se limpian resumen y salidas; al corregir vuelven
set('qnh',''); run('recalc()');
assert.equal(run('SUM.wb'), null); assert.equal(nodes.get('to_out').innerHTML, ''); assert.equal(nodes.get('to_notes').innerHTML, ''); assert.equal(nodes.get('validation').hidden, false);
set('qnh',1013); run('recalc()');
assert.notEqual(run('SUM.wb'), null); assert.notEqual(nodes.get('to_out').innerHTML, ''); assert.equal(nodes.get('validation').hidden, true);
// Combustible: sin doble conteo del rodaje y sin pasar del tanque
run('recalc()'); const need2 = run('fuelNeeded'); nodes.get('fuel_apply').events.click();
const loaded = +nodes.get('f_gal').value;
assert(loaded >= need2 - 1e-9 && loaded < need2 + 0.1 + 1e-9, 'carga = necesario redondeado al 0,1 (' + loaded + ' vs ' + need2 + ')');
assert(run("SUM.fuel.have + 1e-9 >= SUM.fuel.need"), 'tras aplicar, el resumen no marca falta de combustible');
// Avisos de peso y balance
set('f_gal',1); run('recalc()'); assert(/rodaje/.test(nodes.get('wb_msgs').innerHTML), 'aviso de rodaje'); assert.equal(run('SUM.wb.ok'), false);
set('f_gal',40); set('a_empty',28); run('recalc()'); assert(/consumir el combustible/.test(nodes.get('wb_msgs').innerHTML), 'aviso de CG sin combustible'); set('a_empty','38.12');
// kg / L: ida y vuelta sin deriva y cargas válidas
for (let i = 0; i < 4; i++) { set('u_w','kg'); set('u_f','L'); run('onUnitChange()'); set('u_w','lb'); set('u_f','gal'); run('onUnitChange()'); }
assert.equal(nodes.get('w_empty').value, '1642'); assert.equal(nodes.get('f_gal').value, '40'); assert.equal(run('validateInputs()'), true);

// ---------------------------------------------------------------- despegue/aterrizaje con las tablas del POH, de punta a punta
// QNH 1013,25 hPa y elevación 0 => altitud presión exactamente 0; 2400 lb es una hoja del POH; 15 °C = entre las columnas de 10 y 20 °C
set('elev',0);set('qnh',1013.25);set('oat',15);set('to_w',2400);set('to_surf',1);set('wspd',0);set('to_len',3000);run('recalc()');
assert.equal(run('validateInputs()'),true);
near(run('SUM.to.need'),1.25*((1370+1470)/2),1e-6,'despegue 2400 lb SL 15 °C = interpolación 10/20 °C del POH');
assert(/830/.test(nodes.get('to_out').innerHTML)&&/1\.?420/.test(nodes.get('to_out').innerHTML),'se muestran 830 / 1420 ft');
assert(/48 \/ 54 KIAS/.test(nodes.get('to_out').innerHTML),'velocidades de la hoja de 2400 lb');
// viento de frente de 9 kt = -10 % (nota del POH)
set('wspd',9);run('recalc()');near(run('SUM.to.need'),1.25*1420*0.9,1e-6,'viento de frente 9 kt');
// hierba seca: +15 % del recorrido en tierra sumado a la distancia a 50 ft
set('wspd',0);set('to_surf',1.15);run('recalc()');near(run('SUM.to.need'),1.25*(1420+0.15*830),1e-6,'hierba seca');set('to_surf',1);
// viento de cola de más de 10 kt: el POH no lo cubre
set('wspd',12);set('wdir',90);run('recalc()');assert(/cola de más de 10 kt/.test(nodes.get('to_notes').innerHTML));set('wspd',0);set('wdir',270);
// peso: sobre el MTOW avisa
set('to_w',2600);run('recalc()');assert(/Sobrepeso/.test(nodes.get('to_out').innerHTML));assert(/sobre el máximo/.test(nodes.get('to_notes').innerHTML));set('to_w',2400);
// aterrizaje (hoja única al peso máximo): sin corrección por peso, con aviso
set('a_elev',0);set('a_qnh',1013.25);set('a_oat',15);set('ld_w',2190);set('ld_surf',1);set('a_wspd',0);set('ld_len',3000);run('recalc()');
near(run('SUM.ld.need'),1.25*((1320+1350)/2),1e-6,'aterrizaje SL 15 °C = interpolación 10/20 °C del POH');
assert(/solo para/.test(nodes.get('ld_notes').innerHTML),'avisa que el POH publica una sola hoja de aterrizaje');
set('ld_w',2600);run('recalc()');assert(/Sobre peso máx\. de aterrizaje/.test(nodes.get('ld_out').innerHTML));set('ld_w',2190);
// fuera de tabla: altitud presión > 8000 ft => sin número, con mensaje; el resto sigue funcionando
set('elev',9000);run('recalc()');
assert.equal(run('validateInputs()'),true);assert(run('SUM.to.out'),'resumen: sin dato');assert(/Sin dato del POH/.test(nodes.get('to_out').innerHTML));assert.equal(nodes.get('to_fig').innerHTML,'');
assert(/Fuera del rango/.test(nodes.get('to_notes').innerHTML));assert(/Fuera del rango/.test(run('fitText(SUM.to)')));
assert.notEqual(run('SUM.wb'),null);assert.notEqual(nodes.get('ld_fig').innerHTML,'');
set('elev',0);set('oat',45);run('recalc()');assert(run('SUM.to.out'),'OAT 45 °C: fuera de tabla');set('oat',15);run('recalc()');assert.equal(run('SUM.to.out'),undefined);


// ---------------------------------------------------------------- margen de seguridad seleccionable
set('elev',0);set('qnh',1013.25);set('oat',15);set('to_w',2400);set('to_surf',1);set('wspd',0);set('to_len',3000);set('wdir',270);
assert.equal(nodes.get('p_margin').value,'25','margen por defecto 25 %');
for(const [m,k] of [[0,1],[10,1.1],[15,1.15],[25,1.25],[50,1.5]]){
  set('p_margin',m);run('recalc()');
  near(run('SUM.to.need'),k*1420,1e-6,'margen '+m+' %');near(run('SUM.ld.need'),k*1335,1e-6,'margen aterrizaje '+m+' %');
  assert(m===0?/Sin margen/.test(nodes.get('to_out').innerHTML)&&/Necesario/.test(nodes.get('to_fig').innerHTML):new RegExp('Con margen '+m+' %').test(nodes.get('to_out').innerHTML)&&new RegExp('\\+'+m+' %').test(nodes.get('to_fig').innerHTML),'rótulos del margen '+m);
}
set('p_margin',0);run('recalc()');assert(/Cabe según el POH/.test(run('fitText(SUM.to)')),'sin margen: texto del resumen');
set('p_margin',25);run('recalc()');assert(/Con margen del 25 %/.test(run('fitText(SUM.to)')));

// ---------------------------------------------------------------- crucero y ascenso del POH
const cr=(model,pa,rpm,dev)=>JSON.parse(run('(()=>{const keep=MODEL;MODEL=MODELS.'+model+';try{return JSON.stringify(cruiseAt('+pa+','+rpm+','+dev+'))}finally{MODEL=keep}})()'));
const cl=(model,from,to,dev)=>JSON.parse(run('(()=>{const keep=MODEL;MODEL=MODELS.'+model+';try{return JSON.stringify(climbBetween('+from+','+to+','+dev+'))}finally{MODEL=keep}})()'));
// 1) cada celda impresa en el POH se recupera exacta (altitud × RPM × columna de temperatura); "---" => sin dato
for(const [id,m] of Object.entries(MODELS)){
  assert(m.cruise.w>0&&m.climb.w>0&&m.climb.allow>0&&m.cruise.alts.length===6&&m.climb.rows.length===13,id+' tablas de crucero y ascenso completas');
  for(const a of m.cruise.alts)for(const row of a.rows)for(let c=1;c<=3;c++){
    const dev=(c-2)*20,cell=row[c],got=cr(id,a.pa,row[0],dev);
    if(cell===null)assert(got.out&&/---/.test(got.out),id+' '+a.pa+' '+row[0]+' dev'+dev+': celda "---" => sin dato');
    else assert.deepEqual([got.bhp,got.tas,got.gph].map(x=>+x.toFixed(6)),cell,id+' '+a.pa+' ft '+row[0]+' RPM dev '+dev);
  }
  for(const r of m.climb.rows){const c=cl(id,0,r[0],0);near(c.min,r[4],1e-9,id+' min');near(c.gal,r[5],1e-9,id+' gal');near(c.nm,r[6],1e-9,id+' nm');}
}
// 2) interpolación: altitud, RPM y temperatura (172S, valores impresos del POH)
let q=cr('c172s',3000,2500,0);near(q.bhp,(73+69)/2,1e-9);near(q.tas,115,1e-9);near(q.gph,(9.9+9.5)/2,1e-9);            // entre 2000 y 4000 ft
q=cr('c172s',2000,2450,0);near(q.bhp,(73+64)/2,1e-9);near(q.tas,(115+110)/2,1e-9);near(q.gph,(9.9+9.0)/2,1e-9);        // entre 2500 y 2400 RPM
q=cr('c172s',2000,2500,10);near(q.bhp,(73+68)/2,1e-9);near(q.gph,(9.9+9.4)/2,1e-9);                                   // entre ISA e ISA+20
q=cr('c172s',2000,2500,-10);near(q.bhp,(78+73)/2,1e-9);near(q.gph,(10.6+9.9)/2,1e-9);                                 // entre ISA−20 e ISA
// 3) fuera de tabla: nunca se extrapola
assert(cr('c172s',1000,2400,0).out&&/2.000/.test(cr('c172s',1000,2400,0).out),'bajo 2.000 ft');
assert(cr('c172s',13000,2400,0).out,'sobre 12.000 ft');
assert(cr('c172s',6000,3000,0).out&&/RPM/.test(cr('c172s',6000,3000,0).out),'RPM sobre la tabla');
assert(cr('c172s',6000,1500,0).out,'RPM bajo la tabla');
assert(cr('c172s',6000,2400,25).out&&cr('c172s',6000,2400,-25).out,'temperatura fuera de ±20 °C');
assert(cr('c172p',2000,2500,-5).out&&/---/.test(cr('c172p',2000,2500,-5).out),'172P 2000 ft 2500 RPM: columna ISA−20 sin dato (---)');
assert(cr('c172s',12000,2700,0).out,'RPM no publicado a esa altitud');
// 4) ascenso: diferencia entre altitudes, +10 % por cada 10 °C sobre la estándar, y límites
let c=cl('c172s',0,6000,0);assert.deepEqual([c.min,+c.gal.toFixed(6),c.nm],[10,2.2,13]);
c=cl('c172s',2000,6000,0);assert.deepEqual([c.min,+c.gal.toFixed(6),c.nm],[7,1.4,9],'ascenso desde 2.000 ft = tabla(6000) − tabla(2000)');
c=cl('c172s',0,6000,10);near(c.min,11,1e-9);near(c.gal,2.42,1e-9);near(c.nm,14.3,1e-9);
c=cl('c172s',0,6000,-15);assert.deepEqual([c.min,+c.gal.toFixed(6),c.nm],[10,2.2,13],'más frío que ISA no reduce (el POH solo da el aumento)');
c=cl('c172s',0,500,0);near(c.min,0.5,1e-9);near(c.gal,0.2,1e-9);near(c.nm,1,1e-9);
c=cl('c172s',8000,6000,0);assert.deepEqual([c.min,c.gal,c.nm],[0,0,0],'cruzar más bajo que la salida: sin ascenso');
assert(cl('c172s',0,13000,0).out,'ascenso sobre 12.000 ft: fuera de tabla');
c=cl('c172s',-500,500,0);near(c.min,0.5,1e-9,'altitud de salida bajo el mar se trata como nivel del mar');

// ---------------------------------------------------------------- planificador de ruta de punta a punta (172S, tablas del POH)
set('r_mode','poh');set('r_alt',6000);set('r_rpm',2500);set('r_isa',0);set('r_dist',120);set('r_wind',0);set('r_res',30);set('r_taxi',1.4);set('f_gal',40);set('elev',0);set('qnh',1013.25);
run('recalc()');
// 6000 ft / 2500 RPM / ISA => 65 % · 114 kt · 9,0 gal/h; ascenso 10 min · 2,2 gal · 13 NM
let hrsC=(120-13)/114;
near(run('fuelNeeded'),1.4+2.2+hrsC*9.0+4.5,1e-9,'total = rodaje + ascenso + crucero + reserva');near(run('PLAN.hours'),10/60+hrsC,1e-9,'tiempo = ascenso + crucero');near(run('PLAN.gs'),114,1e-9);
near(run('enrouteFuel'),2.2+hrsC*9.0,1e-9);
assert(/Alcanza/.test(nodes.get('fuel_msg').innerHTML)&&/Ascenso/.test(nodes.get('fuel_tbl').innerHTML)&&/a 6.?000 ft/.test(nodes.get('fuel_tbl').innerHTML)&&/2.?500 RPM/.test(nodes.get('fuel_tbl').innerHTML)&&/Rodaje \+ despegue/.test(nodes.get('fuel_tbl').innerHTML),'tabla de fases');
// viento de frente de 20 kt: velocidad suelo 94
set('r_wind',20);run('recalc()');near(run('fuelNeeded'),1.4+2.2+(120-13)/94*9.0+4.5,1e-9,'viento de frente');set('r_wind',0);
// +20 °C sobre ISA: columna ISA+20 del POH (113 kt, 8,5 gal/h; 6000 ft 2500 RPM = 60 % · 112 kt · 8,5) y ascenso +20 %
set('r_isa',20);run('recalc()');
{const tas=112,gph=8.5,cm=13*1.2;near(run('fuelNeeded'),1.4+2.2*1.2+(120-cm)/tas*gph+0.5*gph,1e-9,'ISA+20');}
set('r_isa',0);
// con poco combustible cargado: avisa cuánto falta; sigue pudiéndose cargar lo necesario
set('f_gal',10);run('recalc()');assert(/no alcanza/.test(nodes.get('fuel_msg').innerHTML)&&/faltan/.test(nodes.get('fuel_msg').innerHTML));assert.equal(run('SUM.fuel.have<SUM.fuel.need'),true);assert.equal(nodes.get('fuel_apply').disabled,false);
// ruta más larga que el tanque: no llegas sin escala, botón deshabilitado
set('f_gal',40);set('r_dist',900);run('recalc()');assert(/No llegas sin escala/.test(nodes.get('fuel_msg').innerHTML));assert.equal(nodes.get('fuel_apply').disabled,true);
set('r_dist',120);
// fuera de la tabla del POH: mensaje claro, resumen en error y sin tabla de números inventados
set('r_alt',1500);run('recalc()');assert(run('SUM.fuel.err'));assert(/2\.?000/.test(nodes.get('fuel_msg').innerHTML));assert.equal(nodes.get('fuel_tbl').innerHTML,'');assert.equal(nodes.get('fuel_apply').disabled,true);assert.equal(run('PLAN'),null);
set('r_alt',6000);set('r_rpm',3000);run('recalc()');assert(run('SUM.fuel.err')&&/RPM/.test(nodes.get('fuel_msg').innerHTML));set('r_rpm',2500);
// modo manual: valores propios; los campos del POH ocultos no se validan
set('r_mode','man');set('r_wind',200);run('recalc()');assert.equal(run('validateInputs()'),false,'manual: viento mayor que la TAS');set('r_wind',0);
set('r_tas',105);set('r_burn',8.5);set('r_climb',1.5);set('r_alt','');set('r_rpm','');run('recalc()');
assert.equal(run('validateInputs()'),true,'manual: los campos del POH ocultos no invalidan');
near(run('fuelNeeded'),1.4+1.5+120/105*8.5+4.25,1e-9,'manual: TAS y consumo propios');
set('r_mode','poh');set('r_alt',6000);set('r_rpm',2500);run('recalc()');assert.equal(run('validateInputs()'),true);assert(!run('SUM.fuel.err'));

// ---------------------------------------------------------------- la RPM por defecto sale de las tablas (≈65 % a 6.000 ft)
for(const [id,m] of Object.entries(MODELS)){const rpm=JSON.parse(run('(()=>{const keep=MODEL;MODEL=MODELS.'+id+';try{return defaultRpm(MODEL)}finally{MODEL=keep}})()'));const a=m.cruise.alts.find(x=>x.pa===6000);const row=a.rows.find(r=>r[0]===rpm);assert(row&&row[2][0]>=60&&row[2][0]<=70,id+' RPM por defecto '+rpm+' => '+(row&&row[2][0])+' %');}

// ---------------------------------------------------------------- cambio de modelo
set('to_w',2400);run('recalc()');
pick('c172m');
assert.equal(run('MODEL.id'),'c172m');assert.equal(nodes.get('fl_model').value,'c172m');
assert.equal(run('LIM.mtow'),2300);assert.equal(run('LIM.fuelMax'),38,'tanque estándar del 172M');
assert.equal(nodes.get('w_empty').value,'1381');assert.equal(nodes.get('a_empty').value,'38.67');
assert.equal(nodes.get('to_w').value,'2160');assert.equal(nodes.get('ld_w').value,'1980');assert.equal(nodes.get('f_gal').value,'29');
assert.equal(nodes.get('tank_row').hidden,false,'el 172M tiene dos tanques');
assert(/Largo alcance/.test(nodes.get('m_tank').innerHTML));
assert.equal(run('validateInputs()'),true);assert.equal(run('SUM.wb.ok'),true,'carga por defecto del 172M dentro de límites');
assert(/Cessna 172M/.test(nodes.get('model_specs').textContent));
assert(/Ejemplo|POH/.test(nodes.get('empty_note').textContent));
// tanque de largo alcance y vuelta a estándar con combustible de más: se recorta a la capacidad
set('m_tank','lr');nodes.get('m_tank').events.change();assert.equal(run('LIM.fuelMax'),48);
set('f_gal',45);run('recalc()');assert.equal(run('SUM.wb.ok'),true);
set('m_tank','std');nodes.get('m_tank').events.change();assert.equal(run('LIM.fuelMax'),38);assert.equal(+nodes.get('f_gal').value,38,'recorta al nuevo tanque');
// cada modelo: valores por defecto válidos, dentro de límites y sin NaN
for(const id of ['c172r','c172p','c172n','c172s','c172m']){
  pick(id);
  assert.equal(run('MODEL.id'),id);assert.equal(run('validateInputs()'),true,id+' válido');
  assert.equal(run('SUM.wb.ok'),true,id+' carga por defecto dentro de límites: '+JSON.stringify(run('SUM.wb')));
  assert(run('SUM.to.ok')==='ok'||run('SUM.to.ok')==='warn'||run('SUM.to.ok')==='bad');assert(!run('SUM.to.out')&&!run('SUM.ld.out'),id+' con datos del POH a nivel del mar');
  const M=MODELS[id];assert.equal(nodes.get('tank_row').hidden,M.tanks.length<2);
  assert.equal(+nodes.get('w_empty').value,M.empty.w);assert.equal(+nodes.get('a_empty').value,M.empty.arm);
  for(const v of ['spd_view','lim_view','tab_view','model_list','chart','to_out','ld_out','to_fig','ld_fig','wb_res','fuel_msg','fuel_tbl','fuel_out'])assert(nodes.get(v).innerHTML.length>0&&!/NaN|Infinity|undefined|null/.test(nodes.get(v).innerHTML),id+' '+v+' sin NaN/undefined');
  assert.equal((nodes.get('tab_view').innerHTML.match(/<table class="ptab">/g)||[]).length,M.perf.to.sheets.length+M.perf.ld.sheets.length+M.cruise.alts.length+1,id+' una tabla por hoja del POH, por altitud de crucero y la de ascenso');
  assert(run('SUM.fuel.need')>0&&!run('SUM.fuel.err'),id+' planificador de ruta con datos del POH: '+JSON.stringify(run('SUM.fuel')));
  assert.equal(+nodes.get('r_taxi').value,M.climb.allow,id+' rodaje y despegue = valor del POH');
  assert(nodes.get('tab_view').innerHTML.includes(M.perf.to.fuente)&&nodes.get('tab_view').innerHTML.includes(M.perf.ld.fuente),id+' cita la figura del POH');
  assert((nodes.get('model_list').innerHTML.match(/data-model=/g)||[]).length===5,'cinco modelos en la lista');
  assert(new RegExp('data-model="'+id+'"').test(nodes.get('model_list').innerHTML.match(/<button[^>]*class="model on"[^>]*>/)?.[0]||''),id+' marcado como activo');
}
// en kg y litros con otro modelo (R: un solo tanque, una sola hoja de despegue)
pick('c172r');set('u_w','kg');set('u_f','L');run('onUnitChange()');
assert.equal(run('validateInputs()'),true);assert.equal(run('SUM.to.out'),undefined);assert(/solo para/.test(nodes.get('to_notes').innerHTML));
set('to_w',+(2450*0.45359237).toFixed(1));set('elev',0);set('qnh',1013.25);set('oat',0);run('recalc()');
near(run('SUM.to.need'),1.25*MODELS.c172r.perf.to.sheets[0].rows[0][1],0.5,'kg => lb sin deriva, 172R S.L. 0 °C');
reset();
// elegir de nuevo el modelo activo no pierde datos
set('w_empty',1700);pick('c172r');assert.equal(nodes.get('w_empty').value,'1700');
// Salidas finitas
for (const id of ['chart','to_fig','ld_fig','to_out','ld_out','fuel_out','fuel_msg','fuel_tbl','wb_res','spd_view','lim_view','tab_view']) assert(!/NaN|Infinity|undefined/.test(nodes.get(id).innerHTML), id + ' sin NaN');

// ---------------------------------------------------------------- base de aeródromos: datos y buscador
const AD=JSON.parse(fs.readFileSync(__dirname+'/data/aerodromos.json','utf8'));
{
  const codes=AD.ad.map(a=>a.i);assert.equal(new Set(codes).size,codes.length,'códigos de aeródromo únicos');assert.equal(AD.total,AD.ad.length);
  for(const a of AD.ad){
    assert(Number.isFinite(a.lat)&&Number.isFinite(a.lon),a.i+' tiene coordenadas (sin ellas la ruta no se puede calcular)');
    assert(a.lat<-17&&a.lat>-81&&a.lon<-50&&a.lon>-110,a.i+' coordenadas dentro del territorio chileno: '+a.lat+','+a.lon);
    assert(a.r,a.i+' tiene región');
  }
  const regs=[...new Set(AD.ad.map(a=>a.r))];assert(!regs.includes('Vaparaíso')&&!regs.some(r=>/^[a-z]/.test(r)),'regiones bien escritas: '+regs);
  const g=c=>AD.ad.find(a=>a.i===c);
  // el vuelo del bug: SCTB tenía la latitud en blanco y el planificador seguía con 120 NM
  assert(g('SCTB').lat<-33.4&&g('SCTB').lat>-33.5,'SCTB tiene latitud');
  const gc=(a,b)=>{const r=Math.PI/180,h=Math.sin((b.lat-a.lat)*r/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((b.lon-a.lon)*r/2)**2;return 2*3440.065*Math.asin(Math.sqrt(h));};
  // base completa: todos los códigos del índice AD 3.0 del AIP (antes faltaban 43)
  for(const c of ['SCUE','SCSN','SCEI','SCAB','SCCY','SCVC','SCEY','SCGH'])assert(g(c),'aeródromo '+c+' está en la base');
  assert(AD.ad.length>=305,'base con todos los aeródromos del AIP (AD 2 + AD 3): '+AD.ad.length);
  for(const a of AD.ad){assert(Number.isFinite(a.el),a.i+' tiene elevación');assert(a.rw.length&&a.rw.every(r=>r.l>100&&r.w>3&&r.a),a.i+' pistas con designador, largo y ancho');assert(a.q===1||a.q===0);}
  assert(g('SCEO').lon<-71&&g('SCEO').lon>-72,'SCEO: el PDF separaba el primer dígito de la longitud');
  assert.equal(g('SCCI').rw.length,3,'Punta Arenas con sus 3 pistas');
  assert(g('SCSK').fix&&g('SCSK').el>=1410,'elevación con m y ft inconsistentes en el AIP: se usa la mayor y se avisa');
  const nm=gc(g('SCTB'),g('SCVI'));assert(nm>330&&nm<400,'SCTB → SCVI (Villarrica) ≈ 360 NM, no 120: '+nm.toFixed(1));
  // ENR 4.1: frecuencias (comprobadas contra la imagen de las páginas del AIP)
  const fq=(c,s)=>(g(c).fq||[]).filter(x=>x[0]===s).map(x=>x[1]);
  assert.deepEqual(fq('SCTB','TWR'),['132.45'],'Tobalaba TWR 132.45 (el PDF separa "132.45" de "MHz")');assert.deepEqual(fq('SCTB','GND'),['118.7']);
  assert.deepEqual(fq('SCSN','TWR'),['134.6']);assert.deepEqual(fq('SCIE','APP'),['125.8','129.35'],'Concepción APP/RDR: principal y secundaria');
  assert.deepEqual(g('SCIE').fq.find(x=>x[1]==='125.8'),['APP','125.8','PRI']);assert.deepEqual(fq('SCEL','ATIS'),['132.7','132.1']);
  assert.deepEqual(fq('SCTC','GND'),['128.8'],'Maquehue (página militar, sin columna SER)');assert.deepEqual(fq('SCBQ','TWR'),['118.8','120.1'],'El Bosque');
  assert.deepEqual(fq('SCVD','APP'),['118.7'],'Valdivia: no se pegan las radioayudas sueltas de Tabón/Tongoy');assert(!(g('SCVD').nv||[]).some(n=>n[1]==='TBN'||n[1]==='TOY'),'Tabón y Tongoy no son de Valdivia');
  assert(AD.ad.filter(a=>a.fq).length>=48,'frecuencias de los AD controlados y con AFIS: '+AD.ad.filter(a=>a.fq).length);
  for(const a of AD.ad.filter(x=>x.fq))for(const [s,f] of a.fq){const n=parseFloat(f);assert(n>=118&&n<=137&&/^\d{3}\.\d+$/.test(f),a.i+' '+s+' frecuencia VHF válida: '+f);}
  // ATZ circulares: el centro del AIP (ENR 4.1) coincide con el ARP del AD 3 (dos tablas distintas)
  const atz=AD.ad.filter(a=>a.atz);assert(atz.length>=15,'ATZ con centro y radio: '+atz.length);
  for(const a of atz){const d=gc(a,{lat:a.atz.c[0],lon:a.atz.c[1]});assert(d<0.3,a.i+' ATZ centrada en el ARP: '+d.toFixed(2)+' NM');assert(a.atz.nm>=3&&a.atz.nm<=5,a.i+' radio de ATZ plausible');}
  for(const a of AD.ad)assert(!/@/.test(a.nt||''),a.i+' sin correos en las notas');
}
(async()=>{
  // buscador y lista de aeródromos (aerodromos.js con un DOM mínimo)
  const stub=()=>{const o=new Proxy(function(){},{get:(t,k)=>k==='value'||k==='textContent'||k==='className'?(t[k]??''):k==='hidden'?(t[k]??false):k==='classList'?{toggle(){}}:k==='dataset'?{}:k==='closest'?()=>o:k==='options'?[]:k==='scrollTop'?0:(...a)=>o,set:(t,k,v)=>{t[k]=v;return true},apply:()=>o});return o;};
  const nodesAD=new Map();const doc={getElementById:id=>{if(!nodesAD.has(id))nodesAD.set(id,stub());return nodesAD.get(id)},createElement:()=>stub(),createTextNode:()=>stub()};
  const w={AD_DATA:AD};const c2=vm.createContext({document:doc,window:w,console,fetch:undefined,setTimeout});
  vm.runInContext(fs.readFileSync(__dirname+'/aerodromos.js','utf8'),c2);await new Promise(r=>setTimeout(r,20));
  const A=w.AD;assert(A&&typeof A.get==='function'&&typeof A.searchAll==='function'&&typeof A.browse==='function','API de aeródromos');
  // por código, nombre, ciudad, región y varias palabras
  assert.equal(A.search('scvi')[0].i,'SCVI','por código');
  assert(A.search('villarrica').some(a=>a.i==='SCVI')&&A.search('villarrica').some(a=>a.i==='SCMF'),'por ciudad (Villarrica: SCVI y Malloco)');
  assert(A.search('eulogio').some(a=>a.i==='SCTB'),'por nombre');assert.equal(A.search('tobalaba')[0].i,'SCTB','por el nombre con que lo conocen los pilotos (Tobalaba)');
  assert(A.search('Pucón').some(a=>a.i==='SCPC'),'con tilde y mayúscula');
  assert(A.search('puc').some(a=>a.i==='SCPC'),'por prefijo');
  assert(A.search('araucania').length>10&&A.search('araucania').every(a=>/Araucan/.test(a.r)),'por región');
  assert(A.search('araucania pucon').some(a=>a.i==='SCPC'),'varias palabras: región + ciudad');
  assert(A.search('maule').length>=15,'una región lista muchos aeródromos');
  const all=A.searchAll('a');assert(all.items.length<=60&&all.total>60,'tope de 60 resultados con el total informado: '+all.total);
  assert.equal(A.search('zzzzqq').length,0,'sin coincidencias');
  const br=A.browse();assert.equal(br.length,AD.ad.length,'explorar muestra todos los aeródromos');
  assert.equal(br[0].r,'Arica y Parinacota','de norte a sur: parte en Arica');assert.equal(br[br.length-1].r,'Magallanes y de la Antártica Chilena','y termina en Magallanes');
  // la ruta usa coordenadas completas
  const rt=A.route(A.get('SCTB'),A.get('SCVI'));assert(rt&&rt.nm>330&&rt.nm<400,'ruta SCTB → SCVI');
  assert.equal(A.route(A.get('SCTB'),{lat:null,lon:-70}),null,'sin coordenadas no hay ruta (la app lo avisa en vez de usar una distancia vieja)');
  console.log('PASS: integridad de las 5 tablas POH (M, N, P, R, S), valores exactos e interpolación contra el POH, viento/hierba/sobrepeso, fuera de tabla, cambio de modelo y tanques, kg/L, validaciones y salidas finitas, margen seleccionable, crucero/ascenso del POH (celdas exactas, interpolación, fuera de tabla), planificador de ruta, datos y buscador de aeródromos.');
})();
