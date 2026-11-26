// Dependency-free regression checks for the calculation and rendering code.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const nodes=new Map();
function node(id,value=''){return {id,value,min:'',max:'',hidden:false,disabled:false,dataset:{},classList:{contains:()=>false,toggle(){}},setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},addEventListener(k,v){(this.events??={})[k]=v},querySelector(){return node('child')},querySelectorAll(){return []},replaceChildren(){this.innerHTML=''},innerHTML:''};}
for(const m of html.matchAll(/<(input|select|textarea|div|svg|button|span|b|small|p|tbody|td|section|em)[^>]*\bid="([^"]+)"[^>]*>/g)){
 const n=node(m[2],m[0].match(/\bvalue="([^"]*)"/)?.[1]||'');n.type=m[0].match(/\btype="([^"]*)"/)?.[1];
 n.min=m[0].match(/\bmin="([^"]*)"/)?.[1]??'';n.max=m[0].match(/\bmax="([^"]*)"/)?.[1]??'';
 if(m[1]==='textarea')n.value=html.slice(m.index+m[0].length).split('</textarea>')[0];
 if(m[1]==='select')n.value=html.slice(m.index+m[0].length).split('</select>')[0].match(/value="([^"]*)"/)?.[1]||'';
 let storedValue=n.value; Object.defineProperty(n,"value",{get(){return storedValue},set(v){storedValue=String(v)}}); nodes.set(n.id,n);
}
const actions=new Map();
const document={getElementById:id=>{assert(nodes.has(id),'missing DOM id '+id);return nodes.get(id)},querySelector:q=>{if(!actions.has(q))actions.set(q,node(q));return actions.get(q)},querySelectorAll:q=>q==='input[type="number"]'?[...nodes.values()].filter(n=>n.type==='number'):[],addEventListener(){},body:{dataset:{}}};
const ctx=vm.createContext({document,window:{scrollTo(){}},localStorage:{getItem:()=>null,setItem(){}},console});
vm.runInContext(fs.readFileSync(__dirname+'/app.js','utf8'),ctx);
const run=code=>vm.runInContext(code,ctx);
const set=(id,v)=>nodes.get(id).value=String(v);
assert.equal(run('validateInputs()'),true);
assert(Number.isFinite(run('fuelNeeded')));
const need=run('fuelNeeded');nodes.get('fuel_apply').events.click();
assert(+nodes.get('f_gal').value>=need && +nodes.get('f_gal').value<need+.101,'apply total once');
set('r_burn',0);run('recalc()');assert.equal(nodes.get('fuel_apply').disabled,true);assert.equal(nodes.get('fuel_out').innerHTML,'');
set('r_burn',8.5);set('r_wind',105);run('recalc()');assert.equal(run('validateInputs()'),false);
set('r_wind',0);set('w_front',-1);run('recalc()');assert.equal(run('validateInputs()'),false);
set('w_front',340);set('qnh','');run('recalc()');assert.equal(run('validateInputs()'),false);set('qnh',1013);
const original=nodes.get('m_totab').value;set('m_totab','0,860,1465\n0,900,1500');run('recalc()');assert.equal(run('validateInputs()'),false);set('m_totab',original);
set('r_dist',10000);run('recalc()');assert.equal(nodes.get('fuel_apply').disabled,true);set('r_dist',120);run('recalc()');
set('f_gal',.5);run('recalc()');assert.equal(run('SUM.wb.ok'),false);set('f_gal',40);
set('u_w','kg');set('u_f','L');run('onUnitChange()');assert.equal(run('validateInputs()'),true);nodes.get('fuel_apply').events.click();assert(run("num('f_gal') * ff + 1e-9 >= fuelNeeded"));assert(run("num('f_gal') * ff <= LIM.fuelMax"));
assert(!/NaN|Infinity/.test(nodes.get('to_fig').innerHTML));

// ---- Casos agregados al integrar (regresiones que la primera versión no cubría) ----
const reset = () => { set('u_w','lb'); set('u_f','gal'); run('onUnitChange()'); };
reset();
set('w_front',340); set('w_rear',0); set('f_gal',40); set('a_empty','40.0'); set('qnh',1013); set('r_dist',120); set('r_wind',0); set('r_burn',8.5); run('recalc()');
assert.equal(run('validateInputs()'), true, 'estado base válido');
// Tablas: líneas en blanco, coma final y espacios no deben suspender todo
const tab0 = nodes.get('m_totab').value;
const lines = (...l) => l.join('\n');
set('m_totab', lines('0,860,1465,', '', '2000,1010,1720', '   ', '4000,1190,2035', '')); run('recalc()');
assert.equal(run('validateInputs()'), true, 'línea en blanco / coma final en la tabla');
assert(run('TAKEOFF').length === 3, 'se leyeron las 3 filas');
// pero filas realmente rotas sí se rechazan
for (const bad of [lines('0,860', '2000,1010,1720'), lines('0,860,1465', '2000,abc,1720'), '0,860,1465', lines('0,860,1465', '2000,1010,900'), lines('0,0,0', '2000,1010,1720')]) {
  set('m_totab', bad); run('recalc()'); assert.equal(run('validateInputs()'), false, 'tabla inválida: ' + JSON.stringify(bad));
}
set('m_totab', tab0); run('recalc()'); assert.equal(run('validateInputs()'), true);
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
assert.equal(run('SUM.wb'), null); assert.equal(nodes.get('to_out').innerHTML, ''); assert.equal(nodes.get('validation').hidden, false);
set('qnh',1013); run('recalc()');
assert.notEqual(run('SUM.wb'), null); assert.notEqual(nodes.get('to_out').innerHTML, ''); assert.equal(nodes.get('validation').hidden, true);
// Combustible: sin doble conteo del rodaje y sin pasar del tanque
run('recalc()'); const need2 = run('fuelNeeded'); nodes.get('fuel_apply').events.click();
const loaded = +nodes.get('f_gal').value;
assert(loaded >= need2 - 1e-9 && loaded < need2 + 0.1 + 1e-9, 'carga = necesario redondeado al 0,1 (' + loaded + ' vs ' + need2 + ')');
assert(run("SUM.fuel.have + 1e-9 >= SUM.fuel.need"), 'tras aplicar, el resumen no marca falta de combustible');
// Avisos de peso y balance
set('f_gal',1); run('recalc()'); assert(/rodaje/.test(nodes.get('wb_msgs').innerHTML), 'aviso de rodaje'); assert.equal(run('SUM.wb.ok'), false);
set('f_gal',40); set('a_empty',28); run('recalc()'); assert(/consumir el combustible/.test(nodes.get('wb_msgs').innerHTML), 'aviso de CG sin combustible'); set('a_empty','40.0');
// kg / L: ida y vuelta sin deriva y cargas válidas
for (let i = 0; i < 4; i++) { set('u_w','kg'); set('u_f','L'); run('onUnitChange()'); set('u_w','lb'); set('u_f','gal'); run('onUnitChange()'); }
assert.equal(nodes.get('w_empty').value, '1663'); assert.equal(nodes.get('f_gal').value, '40'); assert.equal(run('validateInputs()'), true);
// Salidas finitas
for (const id of ['chart','to_fig','ld_fig','to_out','ld_out','fuel_out','wb_res']) assert(!/NaN|Infinity|undefined/.test(nodes.get(id).innerHTML), id + ' sin NaN');
console.log('PASS (incluye regresiones de tablas con líneas en blanco, campos opcionales, viento sin pista, rangos y deriva kg/L): default inputs, fuel transfer in gal and L, capacity limit, zero burn, impossible wind, negative weight, blank QNH, duplicate table altitudes, insufficient taxi fuel and finite SVG output.');





