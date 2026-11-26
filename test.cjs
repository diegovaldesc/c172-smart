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
console.log('PASS: default inputs, fuel transfer in gal and L, capacity limit, zero burn, impossible wind, negative weight, blank QNH, duplicate table altitudes, insufficient taxi fuel and finite SVG output.');






