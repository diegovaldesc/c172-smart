// Dependency-free regression checks for the calculation and rendering code.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/index.html','utf8');

// ---------------------------------------------------------------- DOM mínimo (suficiente para app.js)
class Txt{constructor(v){this.v=String(v)}get textContent(){return this.v}get innerHTML(){return this.v}}
class El{
  constructor(tag,id=''){this.tag=tag;this.id=id;this.kids=[];this._html='';this._text='';this.className='';this.dataset={};this.style={};
    this.hidden=false;this.disabled=false;this.min='';this.max='';this.type=undefined;this.attrs={};this.events={};this._cls=new Set();this._q=new Map();this._v='';this.cells=[];}
  get value(){return this._v}set value(v){this._v=String(v)}
  get classList(){const s=this._cls;return {add:c=>s.add(c),remove:c=>s.delete(c),toggle:(c,f)=>{(f===undefined?!s.has(c):f)?s.add(c):s.delete(c)},contains:c=>s.has(c)}}
  append(...c){c.forEach(x=>this.kids.push(typeof x==='string'?new Txt(x):x))}
  appendChild(c){this.kids.push(c);return c}
  replaceChildren(...c){this.kids=[];this._html='';this._text='';this.append(...c)}
  get innerHTML(){return this._html+this._text+this.kids.map(k=>k instanceof Txt?k.v:`<${k.tag}${k.className?` class="${k.className}"`:''}>${k.innerHTML}</${k.tag}>`).join('')}
  set innerHTML(v){this.kids=[];this._text='';this._html=String(v)}
  get textContent(){return this.innerHTML.replace(/<[^>]*>/g,'')}
  set textContent(v){this.kids=[];this._html='';this._text=String(v)}
  setAttribute(k,v){this.attrs[k]=String(v)}getAttribute(k){return this.attrs[k]??null}removeAttribute(k){delete this.attrs[k]}
  addEventListener(k,f){this.events[k]=f}
  querySelector(q){if(!this._q.has(q))this._q.set(q,new El('x'));return this._q.get(q)}
  querySelectorAll(){return []}
  closest(q){const man=['r_tas','r_burn','r_climb'],poh=['r_alt','r_rpm','r_isa','r_extra'];if(q!=='[hidden]')return null;return (man.includes(this.id)&&nodes.get('r_man_f').hidden)||(poh.includes(this.id)&&nodes.get('r_poh_f').hidden)?this:null}
}
const nodes=new Map();
for(const m of html.matchAll(/<([a-z0-9]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)){
  const n=new El(m[1],m[2]);n.type=m[0].match(/\btype="([^"]*)"/)?.[1];
  n.min=m[0].match(/\bmin="([^"]*)"/)?.[1]??'';n.max=m[0].match(/\bmax="([^"]*)"/)?.[1]??'';
  n.hidden=/\shidden[\s>]/.test(m[0]);
  let v=m[0].match(/\bvalue="([^"]*)"/)?.[1]||'';
  if(m[1]==='textarea')v=html.slice(m.index+m[0].length).split('</textarea>')[0];
  if(m[1]==='select'){const body=html.slice(m.index+m[0].length).split('</select>')[0];v=body.match(/value="([^"]*)"[^>]*\bselected/)?.[1]??body.match(/value="([^"]*)"/)?.[1]??'';}
  n.value=v;nodes.set(n.id,n);
}
const doc={
  getElementById:id=>{assert(nodes.has(id),'missing DOM id '+id);return nodes.get(id)},
  createElement:t=>new El(t),
  querySelector:()=>new El('x'),
  querySelectorAll:q=>q==='input[type="number"]'?[...nodes.values()].filter(n=>n.type==='number'):[],
  addEventListener(){},dispatchEvent(){},body:{dataset:{}}
};
class CustomEvent{constructor(t,o){this.type=t;this.detail=o&&o.detail}}
const g={document:doc,localStorage:{getItem:()=>null,setItem(){}},console,CustomEvent,scrollTo(){}};
g.window=g;
const ctx=vm.createContext(g);
const load=f=>vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),ctx);
load('modelos.js');load('ruta.js');
// la ruta (mapa.js) y el viento por tramo (viaje.js) se simulan: aquí se prueba el cálculo, no el mapa
const ROUTE={pts:[]},WIND={fn:()=>null};
g.MAPA={route:()=>ROUTE.pts,shown(){}};
g.VIAJE={windOf:(p,q)=>WIND.fn(p,q)};
load('app.js');
const run=code=>vm.runInContext(code,ctx);
const set=(id,v)=>nodes.get(id).value=String(v);
const near=(a,b,tol,msg)=>assert(Math.abs(a-b)<=tol,(msg||'')+` esperado ${b}, obtenido ${a}`);
const pick=id=>{set('fl_model',id);nodes.get('fl_model').events.change()};
const text=id=>nodes.get(id).textContent;
const SCTB={lat:-33.45694,lon:-70.54722,i:'SCTB',n:'Eulogio Sánchez'},SCRG={lat:-34.17322,lon:-70.77569,i:'SCRG'},SCSE={lat:-29.91639,lon:-71.19944,i:'SCSE'},SCCI={lat:-53.0026,lon:-70.8546,i:'SCCI'};
const pill=id=>({cls:nodes.get(id).querySelector('.dot').className.replace('dot ',''),txt:nodes.get(id).querySelector('small').textContent});

// las condiciones de superficie (viento, temperatura, QNH) solo cuentan como dato si vienen del pronóstico o las escribió el piloto: esto simula que las escribió
const DEP=['wdir','wspd','oat','qnh'],ARR=['a_wdir','a_wspd','a_oat','a_qnh'];
const confirmCond=()=>{DEP.forEach(id=>run("touchCond('dep','"+id+"')"));ARR.forEach(id=>run("touchCond('arr','"+id+"')"));run('recalc()')};

// el peso de despegue sale de Carga: para probar la performance a un peso dado se ajusta el peso vacío (en la unidad que esté activa)
const towTo=w=>{run('recalc()');set('w_empty',+nodes.get('w_empty').value+(w-run('TOW'))/run('wf'));run('recalc()');near(run('TOW'),w,1e-6,'peso de despegue ajustado')};


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


// ---------------------------------------------------------------- estado inicial: 172S, todavía sin ruta
assert.equal(run('MODEL.id'),'c172s');
assert.equal(nodes.get('w_empty').value,'1642');assert.equal(nodes.get('a_empty').value,'38.12');
assert.equal(run('validateInputs()'),true);
assert(/Todavía no hay ruta/.test(text('fuel_verdict')),'sin ruta: el veredicto lo dice');
assert.equal(nodes.get('fuel_apply').disabled,true);assert.equal(pill('st_fuel').cls,'off');assert.equal(text('chip'),'Sin ruta');

// ---------------------------------------------------------------- combustible de punta a punta con la ruta cargada (172S, tablas del POH)
ROUTE.pts=[SCTB,SCRG,SCSE];
set('r_mode','poh');set('r_alt',6000);set('r_rpm',2500);set('r_isa',0);set('r_extra',0);set('r_res',30);set('r_taxi',1.4);set('f_gal',40);set('elev',0);set('qnh',1013.25);
run('recalc()');
assert.equal(text('chip'),'SCTB → SCSE (+1)');
{
  const T=run('TRIP');assert(!T.err&&!T.none);
  near(T.pl.nm,301,3,'SCTB → SCRG → SCSE ≈ 301 NM');assert.equal(T.pl.legs.length,2);
  // 6000 ft / 2500 RPM / ISA => 65 % · 114 kt · 9,0 gal/h; ascenso 10 min · 2,2 gal · 13 NM; sin viento
  near(T.total,1.4+2.2+(T.pl.nm-13)/114*9.0+4.5,1e-6,'total = rodaje + ascenso + crucero + reserva');
  near(T.pl.legs[1].gs,114,1e-9,'sin viento: velocidad suelo = TAS');
  near(T.pl.legs[0].min,10+(44.4-13)/114*60,1.5,'primer tramo: ascenso + crucero');
  // sin viento definido el resultado es PROVISORIO (ámbar): no se da por bueno un cálculo con calma supuesta en silencio
  assert.equal(T.wind,'none');
  assert(/Provisorio: sin viento definido/.test(text('fuel_verdict'))&&/aire en calma/.test(text('fuel_verdict')),'sin viento: el veredicto es provisorio y lo dice');
  assert(!/El combustible alcanza/.test(text('fuel_verdict')),'sin viento no se dice «alcanza» a secas');
  assert.equal(nodes.get('fuel_verdict').kids[0].className,'verdict warn');
  assert.equal(pill('st_fuel').cls,'warn');assert.equal(pill('st_fuel').txt,'Sin viento');
  assert.equal(nodes.get('fuel_apply').disabled,false,'se puede cargar el combustible igual');
  // con el viento definido (aquí, calma escrita a propósito) el mismo número pasa a ser un resultado confiable
  WIND.fn=()=>({dir:0,spd:0});run('recalc()');
  assert.equal(run('TRIP.wind'),'ok');near(run('TRIP.total'),T.total,1e-9);
  assert(/El combustible alcanza/.test(text('fuel_verdict'))&&/Cubre el viaje, la reserva de 30 min/.test(text('fuel_verdict')));assert(/¿Con cuánto llego\?/.test(text('fuel_ans')));
  assert.equal(nodes.get('fuel_verdict').kids[0].className,'verdict ok');
  assert.equal(pill('st_fuel').cls,'ok');assert(/Sobran/.test(pill('st_fuel').txt));
  const tb=text('fuel_tbl');
  assert(/Rodaje \+ despegue/.test(text('fuel_phases'))&&/Ascenso/.test(text('fuel_phases'))&&/Crucero hasta el destino/.test(text('fuel_phases'))&&/Reserva 30 min/.test(text('fuel_phases'))&&/Total a cargar/.test(text('fuel_phases')),'desglose por fase');
  assert(/Rodaje \+ despegue/.test(tb)&&/1\. SCTB → SCRG/.test(tb)&&/2\. SCRG → SCSE/.test(tb)&&/Reserva/.test(tb)&&/Total/.test(tb)&&/con ascenso/.test(tb),'tabla por tramo');
  assert(!/NaN|Infinity|undefined/.test(nodes.get('fuel_tbl').innerHTML+nodes.get('fuel_out').innerHTML+nodes.get('fuel_ans').innerHTML+nodes.get('fuel_phases').innerHTML));
  // veredicto: con poco combustible dice que NO alcanza y cuánto falta
  set('f_gal',20);run('recalc()');
  const L=run('TRIP');
  assert(L.short&&/NO alcanza/.test(text('fuel_verdict'))&&/faltan/.test(text('fuel_verdict')));
  near(L.reach,13+(20-1.4-4.5-2.2)/9.0*114,0.01,'alcance con lo cargado, sin tocar la reserva');
  assert.equal(pill('st_fuel').cls,'bad');assert(/Faltan/.test(pill('st_fuel').txt));assert.equal(nodes.get('fuel_apply').disabled,false);
  assert(/−/.test(text('fuel_tbl')),'la tabla muestra dónde se acaba el combustible (queda negativo)');
  // «Cargar el combustible necesario»: redondea hacia arriba al 0,1 y deja el veredicto en verde
  nodes.get('fuel_apply').events.click();
  const loaded=+nodes.get('f_gal').value,need=run('TRIP').total;
  assert(loaded>=need-1e-9&&loaded<need+0.101,`carga = necesario redondeado al 0,1 (${loaded} vs ${need})`);
  assert(/El combustible alcanza/.test(text('fuel_verdict'))&&run('TRIP.short')===false);
  assert.equal(run('SUM.wb.ok'),true);
}
set('f_gal',40);run('recalc()');

// ---------------------------------------------------------------- las cuatro respuestas de combustible (un solo total por ruta)
{
  const n1=x=>g.APP.dF(x).split(' ')[0];
  const tiles=()=>nodes.get('fuel_ans').innerHTML.split('<div class="ans ').slice(1);
  const unit=n=>'<b>'+n+'<small> gal</small></b>';
  set('f_gal',40);WIND.fn=()=>({dir:0,spd:0});run('recalc()');
  let T=run('TRIP'),P=tiles();
  assert.equal(P.length,4,'cuatro respuestas');
  ['¿Cuánto consumo hasta el destino?','¿Cuánto debo cargar?','¿Cuánto llevo?','¿Con cuánto llego?'].forEach((q,i)=>assert(P[i].includes(q),'pregunta '+(i+1)+': '+q));
  near(T.trip,T.total-T.pl.galReserve-T.galAlt,1e-9,'consumo hasta el destino = total − reserva − alterno');
  assert(P[0].includes(unit(n1(T.trip)))&&/de vuelo · 30\d NM \(incluye el rodaje\)/.test(P[0]),'1) consumo, tiempo y distancia');
  assert(P[1].includes(unit(n1(T.total)))&&/con reserva de 30 min/.test(P[1]),'2) cuánto cargar');
  assert(P[2].includes(unit('40,0'))&&/te sobran/.test(P[2]),'3) cuánto llevo y cuánto sobra');
  assert(P[3].includes(unit(n1(T.landGal)))&&/más de vuelo · reserva 30 min/.test(P[3]),'4) con cuánto llego');
  assert(P.every(p=>!/prov/.test(p.split('"')[0])),'con viento definido ninguna respuesta es provisoria');assert(!/provisorio/.test(nodes.get('fuel_ans').innerHTML));
  // el desglose por fase suma el mismo total que se ve arriba, y en el mismo número en toda la app
  const ph=nodes.get('fuel_phases').innerHTML;
  assert(ph.includes('Total a cargar')&&ph.includes(g.APP.dF(T.total)),'el desglose termina en el mismo total');
  near(T.prm.taxi+T.pl.galClimb+T.pl.galCruise+T.pl.galReserve+T.galAlt,T.total,1e-9,'rodaje + ascenso + crucero + reserva (+ alterno) = total');
  assert.equal(nodes.get('fuel_sub').hidden,false);
  // sin viento definido o viejo: las cuatro quedan marcadas como provisorias
  WIND.fn=()=>null;run('recalc()');P=tiles();assert(P.every(p=>/prov/.test(p.split('"')[0])),'sin viento: todas provisorias');assert.equal((nodes.get('fuel_ans').innerHTML.match(/<em>provisorio<\/em>/g)||[]).length,4);
  WIND.fn=()=>({dir:0,spd:0});
  // con poco combustible: lo que llevo y con cuánto llego salen en rojo y dicen cuánto falta
  set('f_gal',30);run('recalc()');T=run('TRIP');P=tiles();
  assert(T.short&&T.landGal>0&&T.landGal<T.pl.galReserve,'30 gal: llega, pero por debajo de la reserva');
  assert(P[1].startsWith('bad')&&P[2].startsWith('bad')&&P[3].startsWith('bad'),'no alcanza: respuestas en rojo');
  assert(/te faltan/.test(P[2])&&P[2].includes(unit('30,0')),'3) cuánto falta');assert(/sin cubrir la reserva/.test(P[3]),'4) llega por debajo de la reserva');
  // sin combustible para llegar: llega con 0 y lo dice
  set('f_gal',5);run('recalc()');P=tiles();assert(run('TRIP.landGal')<0&&P[3].includes(unit('0,0'))&&/se acaba antes del destino/.test(P[3]));
  set('f_gal',40);run('recalc()');
  // sin ruta o con error de cálculo no hay respuestas inventadas
  ROUTE.pts=[];run('recalc()');assert.equal(nodes.get('fuel_ans').innerHTML,'');assert.equal(nodes.get('fuel_phases').innerHTML,'');assert.equal(nodes.get('fuel_sub').hidden,true);
  ROUTE.pts=[SCTB,SCRG,SCSE];WIND.fn=()=>({dir:285,spd:200});run('recalc()');assert(run('TRIP.err'));assert.equal(nodes.get('fuel_ans').innerHTML,'');
  WIND.fn=()=>null;run('recalc()');
}

// ---------------------------------------------------------------- el viento de cada tramo cambia el combustible
{
  const base=run('TRIP').total;
  WIND.fn=(p,q)=>({dir:q===SCRG?195:355,spd:30});run('recalc()');            // de frente en los dos tramos (rumbos 195° y 355°)
  let T=run('TRIP');near(T.pl.legs[1].gs,84,0.5,'viento de frente de 30 kt: 114 − 30');assert(T.total>base+3,'con viento de frente se gasta más');
  assert(!/Provisorio/.test(text('fuel_verdict')));assert(/viento 355° 30 kt/.test(text('fuel_tbl')),'la tabla muestra el viento de cada tramo');
  WIND.fn=(p,q)=>({dir:q===SCRG?15:175,spd:30});run('recalc()');             // de cola
  T=run('TRIP');near(T.pl.legs[1].gs,144,0.5,'viento de cola de 30 kt');assert(T.total<base-3,'con viento de cola se gasta menos');
  WIND.fn=(p,q)=>(p===SCTB?{dir:195,spd:10}:null);run('recalc()');
  assert.equal(run('TRIP.wind'),'partial');assert(/Provisorio: falta el viento de algún tramo/.test(text('fuel_verdict')),'viento en un solo tramo: provisorio');assert.equal(pill('st_fuel').txt,'Falta viento');
  WIND.fn=()=>({dir:270,spd:10,stale:true});run('recalc()');
  assert.equal(run('TRIP.wind'),'stale');assert(/Provisorio: el viento está desactualizado/.test(text('fuel_verdict')),'viento desactualizado: provisorio');assert.equal(pill('st_fuel').txt,'Viento viejo');
  WIND.fn=()=>({dir:285,spd:200});run('recalc()');                           // viento de costado mayor que la TAS: no hay avance
  assert(run('TRIP.err')&&/no hay avance/.test(text('fuel_verdict'))&&/No se puede calcular/.test(text('fuel_verdict')));assert.equal(nodes.get('fuel_apply').disabled,true);assert.equal(pill('st_fuel').cls,'bad');
  WIND.fn=()=>null;run('recalc()');near(run('TRIP.total'),base,1e-9);
}

// ---------------------------------------------------------------- alterno, tanque y ruta imposible
{
  const base=run('TRIP').total;
  g.AD={get:id=>id==='SCXX'?{i:'SCXX',n:'Alterno de prueba',lat:-30.6,lon:-71.2}:id==='SCSE'?{...SCSE,n:'La Florida'}:null};
  set('alt_icao','SCXX');run('recalc()');
  let T=run('TRIP');assert(T.alt&&T.galAlt>2&&T.galAlt<5,'alterno a ~40 NM del destino: '+T.galAlt);near(T.total,base+T.galAlt,1e-9);assert(/Alterno SCXX/.test(text('fuel_tbl'))&&/Alterno SCXX/.test(text('fuel_phases'))&&/y alterno/.test(text('fuel_ans')),'el alterno entra en el desglose y en «cuánto debo cargar»');
  set('alt_icao','SCSE');run('recalc()');assert.equal(run('TRIP.alt'),null,'el alterno no puede ser el destino');
  set('alt_icao','');
  ROUTE.pts=[SCTB,SCCI];run('recalc()');                                      // ~1.100 NM: más que el tanque
  T=run('TRIP');assert(T.over&&/No llegas sin escala/.test(text('fuel_verdict'))&&/más de lo que rinden tus tanques/.test(text('fuel_ans')));assert.equal(nodes.get('fuel_apply').disabled,true);assert.equal(pill('st_fuel').txt,'No llegas');
  ROUTE.pts=[SCTB];run('recalc()');assert(/Todavía no hay ruta/.test(text('fuel_verdict')),'un solo punto no es una ruta');
  ROUTE.pts=[SCTB,SCRG,SCSE];run('recalc()');
}

// ---------------------------------------------------------------- consumo extra, ISA, fuera de tabla y modo manual
{
  const nm=run('TRIP.pl.nm');
  set('r_extra',10);run('recalc()');near(run('TRIP.total'),1.4+2.2*1.1+(nm-13)/114*9.9+0.5*9.9,1e-6,'+10 % de consumo sobre el POH (práctica, no valor del POH)');set('r_extra',0);
  // +20 °C sobre ISA: columna ISA+20 del POH (112 kt, 8,5 gal/h a 6000 ft y 2500 RPM) y ascenso +20 %
  set('r_isa',20);run('recalc()');{const tas=112,gph=8.5,cm=13*1.2;near(run('TRIP.total'),1.4+2.2*1.2+(nm-cm)/tas*gph+0.5*gph,1e-6,'ISA+20');}set('r_isa',0);
  // reserva de 45 min
  set('r_res',45);run('recalc()');near(run('TRIP.total'),1.4+2.2+(nm-13)/114*9.0+0.75*9.0,1e-6);set('r_res',30);
  // fuera de la tabla del POH: mensaje claro y ningún número inventado
  set('r_alt',1500);run('recalc()');assert(run('TRIP.err')&&/2\.?000/.test(text('fuel_verdict')));assert.equal(nodes.get('fuel_tbl').innerHTML,'');assert.equal(nodes.get('fuel_apply').disabled,true);
  set('r_alt',6000);set('r_rpm',3000);run('recalc()');assert(run('TRIP.err')&&/RPM/.test(text('fuel_verdict')));set('r_rpm',2500);
  // modo manual: TAS, consumo y ascenso propios; los campos del POH ocultos no se validan
  set('r_mode','man');set('r_tas',105);set('r_burn',8.5);set('r_climb',1.5);set('r_alt','');set('r_rpm','');run('recalc()');
  assert.equal(run('validateInputs()'),true,'manual: los campos del POH ocultos no invalidan');
  near(run('TRIP.total'),1.4+1.5+nm/105*8.5+4.25,1e-9,'manual: TAS, consumo y ascenso propios');
  set('r_burn',0);run('recalc()');assert.equal(run('validateInputs()'),false);assert.equal(nodes.get('fuel_apply').disabled,true);assert.equal(nodes.get('fuel_verdict').innerHTML,'');
  set('r_burn',8.5);
  WIND.fn=()=>({dir:300,spd:200});run('recalc()');assert(run('TRIP.err'),'manual: viento mayor que la TAS');WIND.fn=()=>null;
  set('r_mode','poh');set('r_alt',6000);set('r_rpm',2500);run('recalc()');assert.equal(run('validateInputs()'),true);assert(!run('TRIP.err'));
}

// ---------------------------------------------------------------- validaciones y avisos de peso y balance
{
  const reset=()=>{set('u_w','lb');set('u_f','gal');run('onUnitChange()')};
  reset();
  set('w_front',340);set('w_rear',0);set('f_gal',40);set('a_empty','38.12');set('qnh',1013);set('elev',0);run('recalc()');
  assert.equal(run('validateInputs()'),true,'estado base válido');
  set('w_front',-1);run('recalc()');assert.equal(run('validateInputs()'),false);set('w_front',340);
  set('qnh','');run('recalc()');assert.equal(run('validateInputs()'),false);set('qnh',1013);
  // campos opcionales en blanco valen 0 (sin pasajeros atrás, sin equipaje, sin viento)
  set('w_rear','');set('w_bagA','');set('wspd','');set('r_climb','');run('recalc()');assert.equal(run('validateInputs()'),true,'campos opcionales en blanco');
  set('w_rear',0);set('w_bagA',0);set('wspd',0);set('r_climb',1.5);
  // pista y dirección del viento: solo obligatorias si hay viento
  set('rwy','');set('wdir','');set('wspd',0);run('recalc()');assert.equal(run('validateInputs()'),true,'sin viento no exige pista');
  set('wspd',10);run('recalc()');assert.equal(run('validateInputs()'),false,'con viento exige pista y dirección');
  set('rwy',27);set('wdir',270);run('recalc()');assert.equal(run('validateInputs()'),true);set('wspd',0);
  // campos obligatorios en blanco y errores de tipeo fuera de rango
  set('elev','');run('recalc()');assert.equal(run('validateInputs()'),false,'elevación en blanco');assert(/elev/i.test(text('validation')),'el aviso nombra el campo');set('elev',0);
  set('qnh',10013);run('recalc()');assert.equal(run('validateInputs()'),false,'QNH 10013');set('qnh',1013);
  set('oat',150);run('recalc()');assert.equal(run('validateInputs()'),false,'OAT 150 °C');set('oat',15);
  // al suspender se limpian resumen y salidas (también el veredicto: mejor nada que un número falso); al corregir vuelven
  set('qnh','');run('recalc()');
  assert.equal(run('SUM.wb'),null);assert.equal(nodes.get('to_out').innerHTML,'');assert.equal(nodes.get('fuel_verdict').innerHTML,'');assert.equal(nodes.get('fuel_ans').innerHTML,'');assert.equal(nodes.get('fuel_phases').innerHTML,'');assert.equal(nodes.get('validation').hidden,false);assert.equal(pill('st_fuel').cls,'warn');
  set('qnh',1013);run('recalc()');
  assert.notEqual(run('SUM.wb'),null);assert.notEqual(nodes.get('to_out').innerHTML,'');assert.notEqual(nodes.get('fuel_verdict').innerHTML,'');assert.equal(nodes.get('validation').hidden,true);
  // avisos de peso y balance
  set('f_gal',1);run('recalc()');assert(/rodaje/.test(nodes.get('wb_msgs').innerHTML),'aviso de rodaje');assert.equal(run('SUM.wb.ok'),false);assert.equal(pill('st_wb').cls,'bad');
  set('f_gal',40);set('a_empty',28);run('recalc()');assert(/consumir el combustible/.test(nodes.get('wb_msgs').innerHTML),'aviso de CG sin combustible');set('a_empty','38.12');
  set('f_gal',60);run('recalc()');assert(/supera los/.test(nodes.get('wb_msgs').innerHTML),'combustible sobre el tanque');set('f_gal',40);run('recalc()');
  // los pesos de Pista salen de Carga: despegue = rampa − rodaje; aterrizaje = despegue − combustible de la ruta
  const TOW=run('TOW'),en=run('enrouteFuel');
  near(+nodes.get('to_w').value,TOW,0.51);near(+nodes.get('ld_w').value,TOW-en*6,0.51);assert(en>20,'combustible de la ruta: '+en);
  // kg / L: ida y vuelta sin deriva, cargas válidas y «Cargar el combustible necesario» en litros
  for(let i=0;i<4;i++){set('u_w','kg');set('u_f','L');run('onUnitChange()');set('u_w','lb');set('u_f','gal');run('onUnitChange()');}
  assert.equal(nodes.get('w_empty').value,'1642');assert.equal(nodes.get('f_gal').value,'40');assert.equal(run('validateInputs()'),true);
  set('u_w','kg');set('u_f','L');run('onUnitChange()');assert.equal(run('validateInputs()'),true);set('f_gal',20);run('recalc()');
  nodes.get('fuel_apply').events.click();
  assert(run("num('f_gal') * ff + 1e-9 >= TRIP.total"),'litros: alcanza');assert(run("num('f_gal') * ff <= LIM.fuelMax"));assert(/<small> L<\/small>/.test(nodes.get('fuel_ans').innerHTML)&&!/<small> gal<\/small>/.test(nodes.get('fuel_ans').innerHTML),'las respuestas salen en litros');
  reset();set('f_gal',40);run('recalc()');
}

// ---------------------------------------------------------------- despegue/aterrizaje con las tablas del POH, de punta a punta (sin ruta: aterrizaje al peso de despegue)
ROUTE.pts=[];
set('elev',0);set('qnh',1013.25);set('oat',15);set('to_surf',1);set('wspd',0);set('wdir',270);set('rwy',27);set('to_len',3000);run('recalc()');
// QNH 1013,25 hPa y elevación 0 => altitud presión 0; 2400 lb es una hoja del POH; 15 °C = entre las columnas de 10 y 20 °C
towTo(2400);assert.equal(run('validateInputs()'),true);
near(run('SUM.to.need'),1.25*((1370+1470)/2),1e-6,'despegue 2400 lb SL 15 °C = interpolación 10/20 °C del POH');
assert(/830/.test(nodes.get('to_out').innerHTML)&&/1\.?420/.test(nodes.get('to_out').innerHTML),'se muestran 830 / 1420 ft');
assert(/48 \/ 54 KIAS/.test(nodes.get('to_out').innerHTML),'velocidades de la hoja de 2400 lb');
// viento de frente de 9 kt = -10 % (nota del POH)
set('wspd',9);run('recalc()');near(run('SUM.to.need'),1.25*1420*0.9,1e-6,'viento de frente 9 kt');
// hierba seca: +15 % del recorrido en tierra sumado a la distancia a 50 ft
set('wspd',0);set('to_surf',1.15);run('recalc()');near(run('SUM.to.need'),1.25*(1420+0.15*830),1e-6,'hierba seca');set('to_surf',1);
// viento de cola de más de 10 kt: el POH no lo cubre
set('wspd',12);set('wdir',90);run('recalc()');assert(/cola de más de 10 kt/.test(nodes.get('to_notes').innerHTML));set('wspd',0);set('wdir',270);
// peso: sobre el MTOW avisa; bajo la hoja más liviana usa esa y avisa
towTo(2600);assert(/Sobrepeso/.test(nodes.get('to_out').innerHTML));assert(/sobre el máximo/.test(nodes.get('to_notes').innerHTML));assert.equal(pill('st_wb').cls,'bad');
towTo(2000);assert(/más liviana/.test(nodes.get('to_notes').innerHTML));
// aterrizaje (hoja única al peso máximo): sin corrección por peso, con aviso
set('a_elev',0);set('a_qnh',1013.25);set('a_oat',15);set('ld_surf',1);set('a_wspd',0);set('a_wdir',270);set('a_rwy',27);set('ld_len',3000);towTo(2400);
near(run('SUM.ld.need'),1.25*((1320+1350)/2),1e-6,'aterrizaje SL 15 °C = interpolación 10/20 °C del POH');
assert(/solo para/.test(nodes.get('ld_notes').innerHTML),'avisa que el POH publica una sola hoja de aterrizaje');
towTo(2600);assert(/Sobre peso máx\. de aterrizaje/.test(nodes.get('ld_out').innerHTML));towTo(2400);
// fuera de tabla: altitud presión > 8000 ft => sin número, con mensaje; el resto sigue funcionando
set('elev',9000);run('recalc()');
assert.equal(run('validateInputs()'),true);assert(run('SUM.to.out'),'resumen: sin dato');assert(/Sin dato del POH/.test(nodes.get('to_out').innerHTML));assert.equal(nodes.get('to_fig').innerHTML,'');
assert(/Fuera del rango/.test(nodes.get('to_notes').innerHTML));assert.equal(run('SUM.to.ok'),'bad');
assert.notEqual(run('SUM.wb'),null);assert.notEqual(nodes.get('ld_fig').innerHTML,'');
set('elev',0);set('oat',45);run('recalc()');assert(run('SUM.to.out'),'OAT 45 °C: fuera de tabla');set('oat',15);run('recalc()');assert.equal(run('SUM.to.out'),undefined);
// la pista corta se marca en el resumen de arriba
assert.equal(pill('st_rwy').txt,'Sin ruta');assert.equal(pill('st_rwy').cls,'off');
ROUTE.pts=[SCTB,SCRG,SCSE];set('to_len',900);run('recalc()');assert.equal(run('SUM.to.ok'),'bad');assert.equal(pill('st_rwy').cls,'bad');assert(/No cabe/.test(pill('st_rwy').txt));set('to_len',3000);run('recalc()');
// cabe, pero con las condiciones por defecto (sin confirmar) la píldora no dice «Cabes»: queda en ámbar
assert.equal(pill('st_rwy').cls,'warn');assert.equal(pill('st_rwy').txt,'Sin confirmar');
confirmCond();assert.equal(pill('st_rwy').cls,'ok');assert.equal(pill('st_rwy').txt,'Cabes');ROUTE.pts=[];run('recalc()');

// ---------------------------------------------------------------- margen de seguridad seleccionable
set('elev',0);set('qnh',1013.25);set('oat',15);set('to_surf',1);set('wspd',0);set('to_len',3000);set('wdir',270);towTo(2400);
assert.equal(nodes.get('p_margin').value,'25','margen por defecto 25 %');
for(const [m,k] of [[0,1],[10,1.1],[15,1.15],[25,1.25],[50,1.5]]){
  set('p_margin',m);run('recalc()');
  near(run('SUM.to.need'),k*1420,1e-6,'margen '+m+' %');near(run('SUM.ld.need'),k*1335,1e-6,'margen aterrizaje '+m+' %');
  assert(m===0?/Sin margen/.test(nodes.get('to_out').innerHTML)&&/Necesario/.test(nodes.get('to_fig').innerHTML):new RegExp('Con margen '+m+' %').test(nodes.get('to_out').innerHTML)&&new RegExp('\\+'+m+' %').test(nodes.get('to_fig').innerHTML),'rótulos del margen '+m);
}
set('p_margin',25);run('recalc()');


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

// ---------------------------------------------------------------- la RPM por defecto sale de las tablas (≈65 % a 6.000 ft)
for(const [id,m] of Object.entries(MODELS)){const rpm=JSON.parse(run('(()=>{const keep=MODEL;MODEL=MODELS.'+id+';try{return defaultRpm(MODEL)}finally{MODEL=keep}})()'));const a=m.cruise.alts.find(x=>x.pa===6000);const row=a.rows.find(r=>r[0]===rpm);assert(row&&row[2][0]>=60&&row[2][0]<=70,id+' RPM por defecto '+rpm+' => '+(row&&row[2][0])+' %');}

// ---------------------------------------------------------------- cambio de modelo
ROUTE.pts=[SCTB,SCRG,SCSE];WIND.fn=()=>null;
set('f_gal',29);run('recalc()');
pick('c172m');
assert.equal(run('MODEL.id'),'c172m');assert.equal(nodes.get('fl_model').value,'c172m');
assert.equal(run('LIM.mtow'),2300);assert.equal(run('LIM.fuelMax'),38,'tanque estándar del 172M');
assert.equal(nodes.get('w_empty').value,'1381');assert.equal(nodes.get('a_empty').value,'38.67');assert.equal(nodes.get('f_gal').value,'29');
assert.equal(nodes.get('tank_row').hidden,false,'el 172M tiene dos tanques');
assert(/Largo alcance/.test(nodes.get('m_tank').innerHTML));
assert.equal(run('validateInputs()'),true);assert.equal(run('SUM.wb.ok'),true,'carga por defecto del 172M dentro de límites');
assert(/Cessna 172M/.test(text('model_specs')));
assert(/Ejemplo|POH/.test(text('empty_note')));
// tanque de largo alcance y vuelta a estándar con combustible de más: se recorta a la capacidad
set('m_tank','lr');nodes.get('m_tank').events.change();assert.equal(run('LIM.fuelMax'),48);
set('f_gal',45);run('recalc()');assert.equal(run('SUM.wb.ok'),true);
set('m_tank','std');nodes.get('m_tank').events.change();assert.equal(run('LIM.fuelMax'),38);assert.equal(+nodes.get('f_gal').value,38,'recorta al nuevo tanque');
// cada modelo: valores por defecto válidos, dentro de límites, sin NaN y con la ruta calculada con sus propias tablas
for(const id of ['c172r','c172p','c172n','c172s','c172m']){
  pick(id);
  assert.equal(run('MODEL.id'),id);assert.equal(run('validateInputs()'),true,id+' válido');
  assert.equal(run('SUM.wb.ok'),true,id+' carga por defecto dentro de límites: '+JSON.stringify(run('SUM.wb')));
  assert(['ok','warn','bad'].includes(run('SUM.to.ok')));assert(!run('SUM.to.out')&&!run('SUM.ld.out'),id+' con datos del POH a nivel del mar');
  const M=MODELS[id];assert.equal(nodes.get('tank_row').hidden,M.tanks.length<2);
  assert.equal(+nodes.get('w_empty').value,M.empty.w);assert.equal(+nodes.get('a_empty').value,M.empty.arm);
  for(const v of ['spd_view','lim_view','tab_view','chart','to_out','ld_out','to_fig','ld_fig','wb_res','fuel_verdict','fuel_tbl','fuel_out'])assert(nodes.get(v).innerHTML.length>0&&!/NaN|Infinity|undefined|null/.test(nodes.get(v).innerHTML),id+' '+v+' sin NaN/undefined');
  assert.equal((nodes.get('tab_view').innerHTML.match(/<table class="ptab">/g)||[]).length,M.perf.to.sheets.length+M.perf.ld.sheets.length+M.cruise.alts.length+1,id+' una tabla por hoja del POH, por altitud de crucero y la de ascenso');
  const T=run('TRIP');assert(!T.err&&T.total>0&&T.pl.nm>290,id+' ruta con las tablas del POH: '+JSON.stringify(T.err));
  assert.equal(+nodes.get('r_taxi').value,M.climb.allow,id+' rodaje y despegue = valor del POH');
  assert(nodes.get('tab_view').innerHTML.includes(M.perf.to.fuente)&&nodes.get('tab_view').innerHTML.includes(M.perf.ld.fuente),id+' cita la figura del POH');
  assert.equal(nodes.get('fl_model').value,id);
}
// en kg y litros con otro modelo (R: un solo tanque, una sola hoja de despegue)
pick('c172r');set('u_w','kg');set('u_f','L');run('onUnitChange()');
assert.equal(run('validateInputs()'),true);assert.equal(run('SUM.to.out'),undefined);
ROUTE.pts=[];set('elev',0);set('qnh',1013.25);set('oat',0);set('to_surf',1);set('wspd',0);towTo(2450*0.45359237);
assert(/solo para/.test(nodes.get('to_notes').innerHTML));
near(run('SUM.to.need'),1.25*MODELS.c172r.perf.to.sheets[0].rows[0][1],0.5,'kg => lb sin deriva, 172R S.L. 0 °C');
set('u_w','lb');set('u_f','gal');run('onUnitChange()');
// salidas finitas
for(const id of ['chart','to_fig','ld_fig','to_out','ld_out','fuel_out','fuel_verdict','fuel_tbl','wb_res','spd_view','lim_view','tab_view'])assert(!/NaN|Infinity|undefined/.test(nodes.get(id).innerHTML),id+' sin NaN');


// ---------------------------------------------------------------- bitácora (PVO): números coherentes con el cálculo y con el viento de cada tramo
{
  pick('c172s');ROUTE.pts=[SCTB,SCRG,SCSE];g.AD=null;
  set('r_mode','poh');set('r_alt',6000);set('r_rpm',2500);set('r_isa',0);set('r_extra',0);set('r_res',30);set('r_taxi',1.4);set('elev',0);set('qnh',1013.25);set('ru_var',0.9);
  g.VIAJE.etdMs=()=>Date.UTC(2026,10,26,21,0);g.VIAJE.provenance=()=>'2 tramos con pronóstico de modelo de Open-Meteo.com (obtenido 20:26)';
  WIND.fn=(p,q)=>q===SCRG?{dir:148,spd:2}:{dir:24,spd:3};
  load('pvo.js');
  set('f_gal',40);run('recalc()');nodes.get('fuel_apply').events.click();
  const S=g.PVO.build(),T=run('TRIP');
  assert(S,'con ruta y datos completos hay bitácora');
  assert.equal(S.rows.length,3,'rodaje + 2 tramos');assert.equal(S.cols.length,S.rows[1].cells.length);assert.equal(S.cols.length,S.foot.length);
  const [r0,r1,r2]=S.rows;
  assert.equal(r1.cells[0],'1. SCTB → SCRG');assert.equal(r2.cells[0],'2. SCRG → SCSE');
  assert.equal(r1.cells[2],'148°/2');assert.equal(r2.cells[2],'024°/3','el viento de cada tramo aparece en su fila');
  const pad=n=>String(Math.round(n)%360).padStart(3,'0');
  T.pl.legs.forEach((l,i)=>{const c=S.rows[i+1].cells;assert.equal(c[1],pad(l.tc)+'°');assert.equal(c[4],pad(l.th)+'°');assert.equal(c[5],pad(l.mh)+'°');near(((l.th-l.mh)+540)%360-180,0.9,1e-6,'rumbo magnético = verdadero − declinación E')});
  assert.equal(S.foot[6],String(Math.round(T.pl.nm)),'distancia total');
  assert(/^4,[56] gal$/.test(r2.cells[12]),'al final del último tramo queda la reserva: '+r2.cells[12]);
  assert.equal(r0.cells[12],g.APP.dF(T.have-1.4),'tras el rodaje queda lo cargado menos 1,4 gal: '+r0.cells[12]);
  const fuelBox=S.boxes.find(b=>b[0]==='Combustible')[1];assert(fuelBox.some(([k,v])=>/Necesario total/.test(k)&&/✔ alcanza/.test(v)));
  assert(S.head.some(([k,v])=>k==='Viento'&&/Open-Meteo/.test(v)));assert(S.notes.some(n=>/Open-Meteo\.com \(CC BY 4\.0\)/.test(n)),'atribución de Open-Meteo');
  assert(S.notes.some(n=>/no sustituye al POH/.test(n)));
  const txt=g.PVO.asText(S);assert(/BITÁCORA DE NAVEGACIÓN/.test(txt)&&/1\. SCTB → SCRG/.test(txt)&&!/NaN|undefined/.test(txt));
  // con poco combustible la bitácora lo dice
  set('f_gal',20);run('recalc()');assert(g.PVO.build().boxes.find(b=>b[0]==='Combustible')[1].some(([k,v])=>/⚠ NO ALCANZA/.test(v)));
  // sin ruta, o con error de cálculo, no hay bitácora
  ROUTE.pts=[];run('recalc()');assert.equal(g.PVO.build(),null);
  ROUTE.pts=[SCTB,SCRG,SCSE];set('f_gal',40);WIND.fn=()=>({dir:285,spd:200});run('recalc()');assert.equal(g.PVO.build(),null,'viento imposible: sin bitácora');
  WIND.fn=()=>null;run('recalc()');
}


// ---------------------------------------------------------------- nada se supone en silencio: condiciones sin confirmar, peso ejemplo, revisión y BORRADOR
{
  const pend=w=>JSON.parse(run('JSON.stringify(condPending("'+w+'"))'));
  const defaults=()=>{DEP.forEach((id,i)=>set(id,[270,0,15,1013][i]));ARR.forEach((id,i)=>set(id,[270,0,15,1013][i]));};
  pick('c172s');set('fl_from','SCTB');set('fl_to','SCSE');ROUTE.pts=[SCTB,SCRG,SCSE];WIND.fn=(p,q)=>q===SCRG?{dir:148,spd:2}:{dir:24,spd:3};
  set('r_mode','poh');set('r_alt',6000);set('r_rpm',2500);set('r_isa',0);set('r_extra',0);set('r_res',30);set('r_taxi',1.4);set('ru_var',0.9);
  g.VIAJE.etdMs=()=>Date.UTC(2026,10,26,21,0);g.VIAJE.provenance=()=>'2 tramos con pronóstico de modelo de Open-Meteo.com (obtenido 20:26)';
  set('f_gal',40);

  // 1) sin nada escrito ni pronóstico: todo por confirmar, y los valores por defecto no se pasan por datos
  run('COND={}');defaults();run('recalc()');
  assert.deepEqual(pend('dep'),['viento','temperatura','QNH']);assert.deepEqual(pend('arr'),['viento','temperatura','QNH']);
  assert(/Sin confirmar: viento, temperatura, QNH/.test(text('dep_cond'))&&/Sin confirmar/.test(text('arr_cond')),'aviso visible en Pista');
  assert(/Resultado provisorio/.test(text('to_notes'))&&/Resultado provisorio/.test(text('ld_notes')));
  assert.deepEqual(JSON.parse(run('JSON.stringify(SUM.to.prov)')),['viento','temperatura','QNH']);
  assert.equal(pill('st_rwy').txt,'Sin confirmar');assert.notEqual(pill('st_rwy').cls,'ok');
  assert.equal(g.APP.cond('dep').src,null);
  // 2) escribir un campo lo confirma; el viento con velocidad > 0 exige también la dirección
  run("touchCond('dep','wspd')");assert.deepEqual(pend('dep'),['temperatura','QNH'],'viento 0 kt escrito: calma confirmada');
  set('wspd',10);assert.deepEqual(pend('dep'),['dirección del viento','temperatura','QNH'],'con viento > 0 falta la dirección');
  run("touchCond('dep','wdir')");run("touchCond('dep','oat')");assert.deepEqual(pend('dep'),['QNH']);
  run("touchCond('dep','qnh')");assert.deepEqual(pend('dep'),[]);assert.deepEqual(pend('arr'),['viento','temperatura','QNH'],'la llegada es independiente');
  run('recalc()');assert.equal(text('dep_cond'),'');assert(/Sin confirmar/.test(text('arr_cond')));assert.equal(g.APP.cond('dep').src,'manual');
  // 3) cambiar de aeródromo borra lo confirmado y vuelve a los valores por defecto
  set('fl_from','SCRG');run('recalc()');
  assert.deepEqual(pend('dep'),['viento','temperatura','QNH']);assert.equal(nodes.get('wspd').value,'0');assert.equal(nodes.get('qnh').value,'1013');assert.equal(g.APP.cond('dep').src,null);
  set('fl_from','SCTB');run('recalc()');
  // 4) el pronóstico completo confirma los cuatro campos (el viento verdadero pasa a magnético); incompleto, solo lo que trajo
  const etd=g.VIAJE.etdMs();
  g.APP.setMet('dep',{dir:270,spd:5,tmp:12,qnh:1015},etd);
  assert.equal(nodes.get('wdir').value,'269','viento verdadero 270° − variación 0,9° E = 269° mag.');assert.equal(nodes.get('wspd').value,'5');assert.equal(nodes.get('oat').value,'12');assert.equal(nodes.get('qnh').value,'1015');
  assert.deepEqual(pend('dep'),[]);assert.equal(g.APP.cond('dep').src,'forecast');
  run("touchCond('dep','oat')");assert.equal(g.APP.cond('dep').edited,true,'editar un campo del pronóstico se registra');assert.deepEqual(pend('dep'),[]);
  g.APP.setMet('dep',{dir:270,spd:5,tmp:12,qnh:1015},etd+3600000);assert.deepEqual(pend('dep'),['pronóstico desactualizado'],'pronóstico para otra hora que la salida');
  g.APP.setMet('dep',{dir:270,spd:5,tmp:12,qnh:1015},etd);run('COND.dep.at=Date.now()-4*3600000');assert.deepEqual(pend('dep'),['pronóstico desactualizado'],'pronóstico de hace más de 3 h');
  g.APP.setMet('arr',{dir:null,spd:null,tmp:9,qnh:null},null);assert.deepEqual(pend('arr'),['viento','QNH'],'pronóstico incompleto: solo confirma lo que trajo');
  g.APP.setMet('arr',{dir:200,spd:0,tmp:9,qnh:1010},null);assert.deepEqual(pend('arr'),[],'la llegada no se compara con la hora de salida');
  g.APP.setMet('dep',{dir:270,spd:5,tmp:12,qnh:1015},etd);

  // 5) el peso vacío del ejemplo del POH no es el de una matrícula
  pick('c172s');run('recalc()');assert.equal(run('emptyIsExample()'),true,'al elegir el modelo el peso vacío es el ejemplo del POH');
  assert.equal(pill('st_wb').txt,'Peso ejemplo');assert.equal(pill('st_wb').cls,'warn');assert.equal(g.APP.emptyIsExample(),true);
  set('w_empty',+nodes.get('w_empty').value+5/run('wf'));run('recalc()');assert.equal(run('emptyIsExample()'),false);assert.equal(pill('st_wb').txt,'Dentro de límites');assert.equal(pill('st_wb').cls,'ok');

  // 6) revisión previa y sello BORRADOR en la bitácora
  const R=()=>g.PVO.review(),by=k=>R().items.find(i=>i.k===k);
  run('COND={}');defaults();run('recalc()');WIND.fn=()=>null;run('recalc()');
  assert.equal(by('Viento en la ruta').st,'warn');assert.equal(by('Condiciones de pista (salida)').st,'warn');assert.equal(by('Condiciones de pista (llegada)').st,'warn');
  assert.equal(by('Combustible').st,'warn','alcanza, pero con viento supuesto: provisorio');assert.equal(by('Ruta').st,'ok');assert.equal(by('Meteorología oficial').st,'info');
  let S=g.PVO.build();assert(S.stamp&&/^BORRADOR · pendiente:/.test(S.stamp.text)&&/Viento en la ruta/.test(S.stamp.text),'sello BORRADOR con lo que falta');assert.equal(S.stamp.bad,false);
  assert(/^Supuestos de esta hoja:/.test(S.notes[0]),'los supuestos van primero en las notas');assert(/BORRADOR/.test(g.PVO.asText(S)),'el texto copiable también lleva el sello');
  g.AD={get:i=>({i,n:i,el:0,rw:[]}),freqShort:()=>''};S=g.PVO.build();g.AD=null;   // aeródromos mínimos de prueba: sin ellos la hoja no arma la caja «Pista»
  assert(/PROVISORIO: sin confirmar viento, temperatura, QNH/.test(JSON.stringify(S.boxes)),'las condiciones por defecto salen marcadas en la hoja');
  doc.body.dataset.view='pvo';   // la bitácora solo se pinta cuando el paso PVO está a la vista
  g.PVO.render();assert(/BORRADOR/.test(nodes.get('pvo_review').innerHTML)&&/Revisar/.test(nodes.get('pvo_review').innerHTML),'la tarjeta de revisión lista lo pendiente y ofrece «Revisar»');
  // todo confirmado: sin sello y con la tarjeta en verde
  WIND.fn=(p,q)=>q===SCRG?{dir:148,spd:2}:{dir:24,spd:3};confirmCond();
  assert.deepEqual([...R().pending.map(i=>i.k)],[],'con todo confirmado no queda nada pendiente');S=g.PVO.build();assert.equal(S.stamp,null);assert(!/BORRADOR/.test(g.PVO.asText(S)));
  assert(!/Supuestos de esta hoja/.test(S.notes.join(' ')));
  g.PVO.render();assert(/Todo revisado/.test(nodes.get('pvo_review').innerHTML)&&!/BORRADOR/.test(nodes.get('pvo_review').innerHTML));
  // peso vacío de ejemplo: vuelve a ser borrador
  pick('c172s');confirmCond();assert.equal(by('Avión').st,'warn');assert(g.PVO.build().stamp,'peso vacío del ejemplo => BORRADOR');
  // un punto «malo» (no alcanza el combustible) marca el sello como crítico
  set('w_empty',+nodes.get('w_empty').value+5/run('wf'));set('f_gal',20);run('recalc()');S=g.PVO.build();assert(S.stamp&&S.stamp.bad===true,'combustible insuficiente: sello crítico');
  set('f_gal',40);ROUTE.pts=[];WIND.fn=()=>null;doc.body.dataset.view='';run('recalc()');
}


// ---------------------------------------------------------------- cuatro pasos: estructura de la navegación y píldoras que llevan a donde se arregla
{
  // 1) la página tiene 4 pasos + información; todo destino (data-go) cae dentro de uno de ellos
  const secs=[...html.matchAll(/<section id="([^"]+)" class="tab[^"]*">/g)].map(m=>({id:m[1],start:m.index,end:html.indexOf('</section>',m.index)}));
  assert.deepEqual(secs.map(s=>s.id),['ruta','cond','avion','pvo','info'],'cuatro pasos y la vista de información');
  assert.deepEqual([...html.matchAll(/<button type="button" data-tab="([^"]+)"/g)].map(m=>m[1]),['ruta','cond','avion','pvo'],'la barra de abajo tiene 4 pasos');
  assert.deepEqual([...html.matchAll(/<i class="stepno">(\d)<\/i>([^<]+)/g)].map(m=>m[1]+' '+m[2]),['1 Tu ruta','2 Condiciones','3 Avión y carga','4 Resumen'],'títulos numerados 1 a 4');
  const stepOf=id=>{const i=html.indexOf('id="'+id+'"');assert(i>0,'no existe #'+id);const s=secs.find(s=>i>s.start&&i<s.end);assert(s,'#'+id+' no está dentro de un paso');return s.id};
  const MAP={ruta:'ruta',cond:'cond',viento:'cond',pista:'cond',avion:'avion',plane:'avion',carga:'avion',perf:'avion',pvo:'pvo',info:'info'};
  for(const [id,step] of Object.entries(MAP))assert.equal(stepOf(id),step,'#'+id+' pertenece al paso '+step);
  const used=new Set([...html.matchAll(/data-go="([^"]+)"/g)].map(m=>m[1]));
  for(const f of ['app.js','pvo.js','viaje.js','mapa.js','aerodromos.js']){
    const code=fs.readFileSync(__dirname+'/'+f,'utf8');
    for(const m of code.matchAll(/(?:data-go="|dataset\.go = '|goTo\('\w+', '|APP\.go\(')(\w+)/g))used.add(m[1]);
    if(f==='pvo.js')for(const m of code.matchAll(/\badd\(.*?,\s*'(\w+)'\);?\s*$/gm))used.add(m[1]);          // pvo.js: add(título, estado, texto, destino)
  }
  for(const u of used)assert(u in MAP,'destino de navegación desconocido: '+u);
  assert(used.has('perf')&&used.has('pista')&&used.has('plane')&&used.has('viento')&&used.has('carga')&&used.has('cond')&&used.has('avion'),'los destinos nuevos se usan');
  for(const old of ['paso 3','paso 4','paso 5','paso 6'])for(const f of ['app.js','pvo.js','viaje.js','mapa.js','index.html']){
    const code=fs.readFileSync(__dirname+'/'+f,'utf8');assert(!code.includes(old+')')&&!code.includes(old+'.')&&!code.includes(old+' '),f+' todavía habla del '+old+' de la versión de 6 pasos');}

  // 2) las píldoras de estado llevan a donde se arregla lo que dicen
  const go=id=>nodes.get(id).dataset.go+'|'+(nodes.get(id).dataset.open||'');
  pick('c172s');set('fl_from','SCTB');set('fl_to','SCSE');run('COND={}');
  DEP.forEach((id,i)=>set(id,[270,0,15,1013][i]));ARR.forEach((id,i)=>set(id,[270,0,15,1013][i]));
  ROUTE.pts=[];WIND.fn=()=>null;run('recalc()');
  assert.equal(go('st_fuel'),'ruta|','sin ruta: lleva a armarla');assert.equal(go('st_rwy'),'ruta|');
  assert.equal(go('st_wb'),'plane|','peso vacío de ejemplo: lleva a «Tu avión»');
  assert(/peso vacío de ejemplo/.test(text('plane_sum'))&&nodes.get('plane_sum').className==='warn','el resumen de «Tu avión» avisa del ejemplo');
  ROUTE.pts=[SCTB,SCRG,SCSE];run('recalc()');
  assert.equal(go('st_fuel'),'viento|','sin viento: lleva a definirlo');assert.equal(go('st_rwy'),'pista|','condiciones sin confirmar: lleva a confirmarlas');
  WIND.fn=()=>({dir:0,spd:0});run('recalc()');assert.equal(go('st_fuel'),'carga|');
  assert(/Resultado provisorio: faltan confirmar las condiciones de la salida/.test(text('to_notes'))&&/data-go="pista"/.test(nodes.get('to_notes').innerHTML)&&/de la llegada/.test(text('ld_notes')),'el aviso de pista provisoria enlaza a las condiciones');
  confirmCond();assert.equal(go('st_rwy'),'perf|','todo confirmado: lleva al resultado de pista');
  set('w_empty',+nodes.get('w_empty').value+5/run('wf'));run('recalc()');
  assert.equal(go('st_wb'),'carga|wb');assert(/vacío \d[\d.]*\d? lb/.test(text('plane_sum'))&&nodes.get('plane_sum').className==='','con el peso de tu matrícula el resumen lo muestra');
  assert.equal(text('perf_seg_dep'),'SCTB');assert.equal(text('perf_seg_arr'),'SCSE');
  pick('c172s');ROUTE.pts=[];WIND.fn=()=>null;run('recalc()');
}


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
  const nodesAD=new Map();const doc={getElementById:id=>{if(!nodesAD.has(id))nodesAD.set(id,stub());return nodesAD.get(id)},createElement:()=>stub(),createTextNode:()=>stub(),addEventListener(){},querySelectorAll:()=>[],body:{dataset:{}}};
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
  console.log('PASS: integridad de las 5 tablas POH (M, N, P, R, S), valores exactos e interpolación contra el POH, viento/hierba/sobrepeso, fuera de tabla, cambio de modelo y tanques, kg/L, validaciones y salidas finitas, margen seleccionable, crucero/ascenso del POH (celdas exactas, interpolación, fuera de tabla), combustible por tramos con viento (veredicto, alterno, tanque, modo manual), las cuatro respuestas de combustible (consumo, cuánto cargar, cuánto llevo, con cuánto llego) con desglose por fase, navegación en 4 pasos (estructura y píldoras que llevan a donde se arregla), bitácora PVO, condiciones sin confirmar (provisorio), peso ejemplo, revisión previa y sello BORRADOR, datos y buscador de aeródromos.');
})();