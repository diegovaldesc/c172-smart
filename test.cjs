// Dependency-free regression checks for the calculation and rendering code.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const nodes=new Map();
function node(id,value=''){return {id,value,min:'',max:'',hidden:false,disabled:false,dataset:{},classList:{contains:()=>false,toggle(){}},setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},addEventListener(k,v){(this.events??={})[k]=v},querySelector(){return node('child')},querySelectorAll(){return []},replaceChildren(){this.innerHTML=''},innerHTML:'',textContent:''};}
for(const m of html.matchAll(/<(input|select|textarea|div|svg|button|span|b|small|p|tbody|td|section|em|label)[^>]*\bid="([^"]+)"[^>]*>/g)){
 const n=node(m[2],m[0].match(/\bvalue="([^"]*)"/)?.[1]||'');n.type=m[0].match(/\btype="([^"]*)"/)?.[1];
 n.min=m[0].match(/\bmin="([^"]*)"/)?.[1]??'';n.max=m[0].match(/\bmax="([^"]*)"/)?.[1]??'';
 if(m[1]==='textarea')n.value=html.slice(m.index+m[0].length).split('</textarea>')[0];
 if(m[1]==='select')n.value=html.slice(m.index+m[0].length).split('</select>')[0].match(/value="([^"]*)"/)?.[1]||'';
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
set('r_burn',0);run('recalc()');assert.equal(nodes.get('fuel_apply').disabled,true);assert.equal(nodes.get('fuel_out').innerHTML,'');
set('r_burn',8.5);set('r_wind',105);run('recalc()');assert.equal(run('validateInputs()'),false);
set('r_wind',0);set('w_front',-1);run('recalc()');assert.equal(run('validateInputs()'),false);
set('w_front',340);set('qnh','');run('recalc()');assert.equal(run('validateInputs()'),false);set('qnh',1013);
set('r_dist',10000);run('recalc()');assert.equal(nodes.get('fuel_apply').disabled,true);set('r_dist',120);run('recalc()');
set('f_gal',.5);run('recalc()');assert.equal(run('SUM.wb.ok'),false);set('f_gal',40);
set('u_w','kg');set('u_f','L');run('onUnitChange()');assert.equal(run('validateInputs()'),true);nodes.get('fuel_apply').events.click();assert(run("num('f_gal') * ff + 1e-9 >= fuelNeeded"));assert(run("num('f_gal') * ff <= LIM.fuelMax"));
assert(!/NaN|Infinity/.test(nodes.get('to_fig').innerHTML));

const reset = () => { set('u_w','lb'); set('u_f','gal'); run('onUnitChange()'); };
reset();
set('w_front',340); set('w_rear',0); set('f_gal',40); set('a_empty','38.12'); set('qnh',1013); set('r_dist',120); set('r_wind',0); set('r_burn',8.5); run('recalc()');
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
  for(const v of ['spd_view','lim_view','tab_view','model_list','chart','to_out','ld_out','to_fig','ld_fig','wb_res'])assert(nodes.get(v).innerHTML.length>0&&!/NaN|Infinity|undefined|null/.test(nodes.get(v).innerHTML),id+' '+v+' sin NaN/undefined');
  assert.equal((nodes.get('tab_view').innerHTML.match(/<table class="ptab">/g)||[]).length,M.perf.to.sheets.length+M.perf.ld.sheets.length,id+' una tabla por hoja del POH');
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
for (const id of ['chart','to_fig','ld_fig','to_out','ld_out','fuel_out','wb_res','spd_view','lim_view','tab_view']) assert(!/NaN|Infinity|undefined/.test(nodes.get(id).innerHTML), id + ' sin NaN');
console.log('PASS: integridad de las 5 tablas POH (M, N, P, R, S), valores exactos e interpolación contra el POH, viento/hierba/sobrepeso, fuera de tabla, cambio de modelo y tanques, kg/L, validaciones y salidas finitas.');
