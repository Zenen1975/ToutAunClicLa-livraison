import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('Driver map includes pickup before delivery and advances after collection in both languages',()=>{
  const s=setup();
  const pickup='123 Rue de l’Église, Montréal & Laval';
  const destination='456 Avenue du Parc #2, Longueuil';
  s.evaluate('jobs='+JSON.stringify([{id:'map-job',status:'assigned',pickup,destination}]));
  for(const lang of ['es','fr']){
    s.evaluate("lang='"+lang+"';renderJobs()");
    const card=s.nodes.get('jobs').children[0];
    const links=card.children.filter(n=>n.href);
    assert.equal(links.length,3);
    const full=new URL(links[0].href);
    assert.equal(full.origin,'https://www.google.com');
    assert.equal(full.searchParams.get('destination'),destination);
    assert.equal(full.searchParams.get('waypoints'),pickup);
    assert.equal(full.searchParams.has('origin'),false);
    assert.equal(full.searchParams.get('travelmode'),'driving');
    assert.equal(new URL(links[1].href).searchParams.get('destination'),pickup);
    assert.equal(new URL(links[2].href).searchParams.get('destination'),destination);
    assert.match(links[0].textContent,lang==='es'?/recogida y entrega/:/collecte et livraison/);
    for(const link of links)assert.equal(link.target,'_blank');
  }
  s.evaluate("jobs[0].status='picked_up';renderJobs()");
  const deliveryLinks=s.nodes.get('jobs').children[0].children.filter(n=>n.href);
  assert.equal(deliveryLinks.length,1);
  const deliveryUrl=new URL(deliveryLinks[0].href);
  assert.equal(deliveryUrl.searchParams.get('destination'),destination);
  assert.equal(deliveryUrl.searchParams.has('waypoints'),false);
  assert.equal(deliveryUrl.searchParams.get('dir_action'),'navigate');
  s.evaluate("jobs[0].status='delivered';renderJobs()");
  assert.equal(s.nodes.get('jobs').children.some(n=>n.className==='job'),false);
});

// Exercise the delivered script with browser API substitutes; real-device GPS remains a deployment check.
function setup(){
  const nodes=new Map(),events={},calls=[];let locks=0,releases=0,deny=false,plays=0,pauses=0,audioBlocked=false;
  function node(){const classes=new Set();return {style:{},textContent:'',checked:false,disabled:false,value:'',dataset:{},children:[],classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle(c,on){on?classes.add(c):classes.delete(c)}},append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},addEventListener(){},querySelector(){return node()}}}
  const document={hidden:false,documentElement:{},getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},querySelectorAll(){return []},createElement:node,addEventListener:(n,fn)=>events[n]=fn};
  document.getElementById('keepScreen').checked=true;
  const context=vm.createContext({document,window:{addEventListener:(n,fn)=>events[n]=fn},navigator:{language:'es',geolocation:{getCurrentPosition(ok,no){deny?no({code:1}):ok({coords:{latitude:45.5,longitude:-73.5,accuracy:5},timestamp:Date.now()})}},wakeLock:{async request(){locks++;let callback;return {released:false,addEventListener(n,fn){callback=fn},async release(){this.released=true;releases++;callback?.()}}}}},Date,Error,Promise,AbortSignal,encodeURIComponent,setInterval:()=>1,clearInterval(){},fetch:async(path,options)=>{calls.push({path,options});return {ok:true,status:200,json:async()=>path==='/shift/start'?{shiftId:'test-shift'}:path==='/deliveries'?[]:{ok:true}}}});
  const html=readFileSync(new URL('../public/livreur.html',import.meta.url),'utf8');vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  class Audio{
    constructor(src){this.src=src;this.currentTime=0;this.paused=true}
    addEventListener(){}
    async play(){if(audioBlocked)throw Error('Playback denied');plays++;this.paused=false}
    pause(){pauses++;this.paused=true}
  }
  context.window.Audio=Audio;
  const evaluate=code=>vm.runInContext(code,context);
  return {nodes,calls,events,evaluate,deny:()=>{deny=true},blockAudio:()=>{audioBlocked=true},stats:()=>({locks,releases,plays,pauses})};
}
test('Web driver requires consent, sends GPS, holds screen only during shift, and stops cleanly',async()=>{
  const s=setup();s.evaluate("token='test-token'");
  await s.evaluate("$('start').onclick()");assert.equal(s.calls.length,0);assert.match(s.nodes.get('error').textContent,/Autoriza/);
  s.nodes.get('consent').checked=true;await s.evaluate("$('start').onclick()");
  assert.equal(s.calls.filter(c=>c.path==='/location').length,1);assert.equal(s.nodes.get('status').textContent,'Ubicación compartida');assert.equal(s.stats().locks,1);
  s.nodes.get('keepScreen').checked=false;await s.evaluate("$('keepScreen').onchange()");assert.equal(s.stats().releases,1);
  s.nodes.get('keepScreen').checked=true;await s.evaluate("$('keepScreen').onchange()");assert.equal(s.stats().locks,2);
  await s.evaluate("$('stop').onclick()");assert.equal(s.stats().releases,2);assert.equal(s.nodes.get('status').textContent,'Desconectado');assert.equal(s.calls.at(-1).path,'/shift/stop');
  const before=s.calls.length;await s.evaluate('locate()');assert.equal(s.calls.length,before);
});
test('Denied GPS closes shift and releases screen without sending location',async()=>{
  const s=setup();s.deny();s.evaluate("token='test-token';$('consent').checked=true");await s.evaluate("$('start').onclick()");
  assert.equal(s.calls.filter(c=>c.path==='/location').length,0);assert.equal(s.calls.at(-1).path,'/shift/stop');assert.equal(s.nodes.get('status').textContent,'Desconectado');assert.match(s.nodes.get('error').textContent,/Ubicación denegada/);assert.equal(s.stats().releases,1);
});
test('Unavailable wake lock does not block GPS and displays the fallback',async()=>{
  const s=setup();s.evaluate("navigator.wakeLock=undefined;token='test-token';$('consent').checked=true");await s.evaluate("$('start').onclick()");
  assert.match(s.nodes.get('screenStatus').textContent,/No se pudo/);assert.equal(s.calls.filter(c=>c.path==='/location').length,1);
});

test('Assignment alarm requires opt-in, repeats until acknowledgement, and deduplicates refreshes',async()=>{
  const s=setup();s.evaluate("token='test-token';jobs=[{id:'one',status:'assigned'}];detectAssignments()");
  assert.equal(s.stats().plays,0);assert.equal(s.evaluate('pendingAssignments.size'),1);
  await s.evaluate("$('enableSound').onclick()");assert.equal(s.stats().plays,1);assert.equal(s.evaluate('audioEnabled'),true);
  await s.evaluate('playJingle()');assert.equal(s.stats().plays,2);
  s.evaluate("$('acknowledge').onclick();detectAssignments()");assert.equal(s.evaluate('pendingAssignments.size'),0);assert.equal(s.evaluate('alarmTimer'),null);assert.equal(s.stats().plays,2);
  s.evaluate("jobs.push({id:'two',status:'assigned'});detectAssignments()");assert.equal(s.stats().plays,3);
  s.evaluate("jobs[1].status='picked_up';detectAssignments()");assert.equal(s.evaluate('pendingAssignments.size'),0);assert.equal(s.evaluate('alarmTimer'),null);
  s.evaluate("jobs.push({id:'three',status:'assigned'});detectAssignments();clearGps()");assert.equal(s.evaluate('audioEnabled'),false);assert.equal(s.evaluate('alarmTimer'),null);
});
test('Audio unavailable keeps visual assignment alert and reports fallback',async()=>{
  const s=setup();s.evaluate("window.Audio=undefined;token='test-token';jobs=[{id:'one',status:'assigned'}];detectAssignments()");
  await s.evaluate("$('enableSound').onclick()");assert.equal(s.evaluate('audioEnabled'),false);assert.equal(s.evaluate('pendingAssignments.size'),1);assert.match(s.nodes.get('soundStatus').textContent,/interrumpido/);
});

test('Jingle uses the bundled clip and stops on acknowledgement, disable and logout reset',async()=>{
  const s=setup();
  s.evaluate("token='test-token';jobs=[{id:'one',status:'assigned'}];detectAssignments()");
  await s.evaluate("$('enableSound').onclick()");
  assert.equal(s.evaluate('jingleAudio.src'),'/assignment-jingle.mp3');
  assert.equal(s.evaluate('jingleAudio.paused'),false);
  s.evaluate("$('acknowledge').onclick()");
  assert.equal(s.evaluate('jingleAudio.paused'),true);
  assert.equal(s.evaluate('jingleAudio.currentTime'),0);
  s.evaluate('repeatAlarm()');
  assert.equal(s.stats().plays,1);
  s.evaluate("jobs.push({id:'two',status:'assigned'});detectAssignments()");
  assert.equal(s.stats().plays,2);
  s.evaluate("$('disableSound').onclick()");
  assert.equal(s.evaluate('jingleAudio.paused'),true);
  assert.equal(s.evaluate('alarmTimer'),null);
  await s.evaluate("$('enableSound').onclick()");
  s.evaluate('reset()');
  assert.equal(s.evaluate('jingleAudio.paused'),true);
  assert.equal(s.evaluate('audioEnabled'),false);
});
test('Blocked jingle playback reports failure while retaining the visual assignment',async()=>{
  const s=setup();s.blockAudio();
  s.evaluate("token='test-token';jobs=[{id:'one',status:'assigned'}];detectAssignments()");
  await s.evaluate("$('enableSound').onclick()");
  assert.equal(s.evaluate('audioEnabled'),false);
  assert.equal(s.evaluate('pendingAssignments.size'),1);
  assert.match(s.nodes.get('soundStatus').textContent,/interrumpido/);
});

test('Grouped driver view includes all three destinations, one pickup confirmation, per-order earnings and full tips',()=>{
 const s=setup();
 s.evaluate('jobs='+JSON.stringify([1,2,3].map(i=>({id:'order'+i,batch_id:'batch1',status:'assigned',pickup:'Restaurant Montréal',destination:'Destination '+i,created_at:i,request_reference:'TAC-'+i,delivery_fare_cents:1000,tip_cents:500,commission_cents:100,driver_payout_cents:1400,total_price_cents:1500}))));
 s.evaluate("lang='es';renderJobs()");
 const group=s.nodes.get('jobs').children[0];
 const link=group.children.find(c=>c.href);
 const url=new URL(link.href);
 assert.equal(url.searchParams.get('destination'),'Destination 3');assert.equal(url.searchParams.get('waypoints'),'Restaurant Montréal|Destination 1|Destination 2');
 assert.ok(group.children.some(c=>c.textContent.includes('42,00')));
 assert.ok(group.children.some(c=>c.textContent.includes('todos los paquetes')));
 const first=s.nodes.get('jobs').children[1];assert.ok(first.children.some(c=>c.textContent.includes('14,00')));assert.ok(first.children.some(c=>c.textContent.includes('Propina íntegra')));
 s.evaluate("jobs.forEach(d=>d.status='picked_up');renderJobs()");
 const route=s.nodes.get('jobs').children[0].children.find(c=>c.href);
 assert.equal(new URL(route.href).searchParams.get('waypoints'),'Destination 1|Destination 2');
});
