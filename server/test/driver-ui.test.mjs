import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Exercise the delivered script with browser API substitutes; real-device GPS remains a deployment check.
function setup(){
  const nodes=new Map(),events={},calls=[];let locks=0,releases=0,deny=false,tones=0;
  function node(){const classes=new Set();return {textContent:'',checked:false,disabled:false,value:'',dataset:{},children:[],classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle(c,on){on?classes.add(c):classes.delete(c)}},append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},addEventListener(){},querySelector(){return node()}}}
  const document={hidden:false,documentElement:{},getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},querySelectorAll(){return []},createElement:node,addEventListener:(n,fn)=>events[n]=fn};
  document.getElementById('keepScreen').checked=true;
  const context=vm.createContext({document,window:{addEventListener:(n,fn)=>events[n]=fn},navigator:{language:'es',geolocation:{getCurrentPosition(ok,no){deny?no({code:1}):ok({coords:{latitude:45.5,longitude:-73.5,accuracy:5},timestamp:Date.now()})}},wakeLock:{async request(){locks++;let callback;return {released:false,addEventListener(n,fn){callback=fn},async release(){this.released=true;releases++;callback?.()}}}}},Date,Error,Promise,AbortSignal,encodeURIComponent,setInterval:()=>1,clearInterval(){},fetch:async(path,options)=>{calls.push({path,options});return {ok:true,status:200,json:async()=>path==='/shift/start'?{shiftId:'test-shift'}:path==='/deliveries'?[]:{ok:true}}}});
  const html=readFileSync(new URL('../public/livreur.html',import.meta.url),'utf8');vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  class AudioContext{constructor(){this.state='running';this.currentTime=0;this.destination={}}async resume(){this.state='running'}async close(){this.state='closed'}createOscillator(){return {frequency:{},connect(){},disconnect(){},start(){tones++},stop(){}}}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}}}}
  context.window.AudioContext=AudioContext;
  const evaluate=code=>vm.runInContext(code,context);
  return {nodes,calls,events,evaluate,deny:()=>{deny=true},stats:()=>({locks,releases,tones})};
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
  assert.equal(s.stats().tones,0);assert.equal(s.evaluate('pendingAssignments.size'),1);
  await s.evaluate("$('enableSound').onclick()");assert.equal(s.stats().tones,6);assert.equal(s.evaluate('audioEnabled'),true);
  s.evaluate('playTone()');assert.equal(s.stats().tones,12);
  s.evaluate("$('acknowledge').onclick();detectAssignments()");assert.equal(s.evaluate('pendingAssignments.size'),0);assert.equal(s.evaluate('alarmTimer'),null);assert.equal(s.stats().tones,12);
  s.evaluate("jobs.push({id:'two',status:'assigned'});detectAssignments()");assert.equal(s.stats().tones,18);
  s.evaluate("jobs[1].status='picked_up';detectAssignments()");assert.equal(s.evaluate('pendingAssignments.size'),0);assert.equal(s.evaluate('alarmTimer'),null);
  s.evaluate("jobs.push({id:'three',status:'assigned'});detectAssignments();clearGps()");assert.equal(s.evaluate('audioEnabled'),false);assert.equal(s.evaluate('alarmTimer'),null);
});
test('Audio unavailable keeps visual assignment alert and reports fallback',async()=>{
  const s=setup();s.evaluate("window.AudioContext=undefined;token='test-token';jobs=[{id:'one',status:'assigned'}];detectAssignments()");
  await s.evaluate("$('enableSound').onclick()");assert.equal(s.evaluate('audioEnabled'),false);assert.equal(s.evaluate('pendingAssignments.size'),1);assert.match(s.nodes.get('soundStatus').textContent,/interrumpido/);
});
