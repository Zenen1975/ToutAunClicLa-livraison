import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';

// Exercise the actual shipped page script. Google, geolocation and layout are
// separate deployment checks; these tests cover acceptance, tips and retries.
function setup(){
 const nodes=new Map(),calls=[],storage=new Map();let receiptFails=false,status='pending';
 const names=['requesterName','pickup','destination','pickupPostalCode','destinationPostalCode','recipientName','recipientPhone','itemDescription','notes','website','tipCents'];
 function node(id){const classes=new Set(),events={};return {id,style:{},value:'',checked:false,disabled:false,required:false,dataset:{},textContent:'',events,attributes:{},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,on){on?classes.add(c):classes.delete(c)}},setAttribute(k,v){this.attributes[k]=v},addEventListener(k,fn){events[k]=fn},scrollIntoView(){},focus(){},checkValidity:()=>true,reportValidity:()=>true,querySelectorAll:()=>[...nodes.values()].filter(e=>names.includes(e.id)||['consent','acceptPrice','readyAt','timing'].includes(e.id)||e.dataset.tip),reset(){for(const e of nodes.values()){e.value='';e.checked=false}nodes.get('tipCents').value='0';nodes.get('timing').value='asap'}}}
 const get=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id)};
 const html=readFileSync(new URL('../public/demander.html',import.meta.url),'utf8');for(const match of html.matchAll(/id="([^"]+)"/g))get(match[1]);for(const v of [0,500,800,1200,1700])get('tip'+v).dataset.tip=String(v);
 for(const n of names)get(n).value=n==='tipCents'?'0':n==='website'||n==='contactEmail'||n==='notes'?'':n.includes('Phone')?'5145550100':'Test '+n;
 get('pickupPostalCode').value='H2X 1Y4';get('destinationPostalCode').value='J4K 1A1';get('timing').value='asap';get('consent').checked=true;
 const document={documentElement:{},getElementById:get,querySelectorAll:selector=>selector==='[data-tip]'?[0,500,800,1200,1700].map(v=>get('tip'+v)):[]};
 const quote={subtotalCents:1300,gstCents:65,qstCents:130,quoteId:'a'.repeat(48),pickup:get('pickup').value,destination:get('destination').value,readyAt:'',totalCents:1495,distanceCents:800,trafficCents:500,distanceMeters:5000,durationSeconds:2100,baselineSeconds:900,delaySeconds:1200,expiresAt:Date.now()+600000};
 const context=vm.createContext({document,navigator:{language:'es'},crypto:webcrypto,Intl,Date,JSON,Number,String,Array,Map,Set,Error,Promise,AbortSignal,encodeURIComponent,location:{hash:'',pathname:'/demander',assign(url){calls.push({redirect:url})}},history:{replaceState(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},FormData:class{constructor(){return names.filter(n=>!get(n).disabled).map(n=>[n,get(n).value])}},fetch:async(path,options)=>{calls.push({path,options});if(path==='/requests'&&receiptFails){receiptFails=false;throw TypeError('Network failed after commit')};return {ok:true,json:async()=>path==='/quotes'?quote:path==='/requests'?{id:'b'.repeat(48),reference:'TAC-BBBBBBBBBBBB',checkoutUrl:'https://checkout.stripe.com/c/pay/cs_test_fixture'}:{reference:'TAC-BBBBBBBBBBBB',status,totalCents:2295,tipCents:800,driverName:status==='assigned'?'Driver':''}}}});
 vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
 return {nodes,calls,evaluate:code=>vm.runInContext(code,context),failNextReceipt:()=>{receiptFails=true},assign:()=>{status='assigned'}};
}

test('Restaurant page offers an explicit zero tip plus four optional tip amounts and requires explicit price acceptance; address changes clear the quote',async()=>{
 const s=setup(),n=id=>s.nodes.get(id);
 const html=readFileSync(new URL('../public/demander.html',import.meta.url),'utf8');for(const id of ['contactName','contactPhone','contactEmail'])assert.ok(!html.includes('id="'+id+'"'));assert.ok(html.includes('mailto:serviceclient@toutaunclicla.com'));assert.ok(html.indexOf('data-i18n="routeTitle"')<html.indexOf('id="requesterName"'));
 assert.deepEqual([...s.nodes.values()].filter(e=>e.dataset.tip).map(e=>e.dataset.tip),['0','500','800','1200','1700']);
 assert.equal(n('tipCents').value,'0');n('tip800').onclick();assert.equal(n('tipCents').value,'800');n('tip800').onclick();assert.equal(n('tipCents').value,'0');n('tip500').onclick();n('tip800').onclick();assert.equal(n('tipCents').value,'800');
 s.evaluate('showStep(3,false)');await n('calculate').onclick();assert.equal(s.evaluate('quote.totalCents'),1495);assert.match(n('price').textContent,/22,95/);assert.match(n('quoteDetails').textContent,/TPS \(5 %\): 0,65/);assert.match(n('quoteDetails').textContent,/TVQ \(9,975 %\): 1,30/);
 await n('requestForm').onsubmit({preventDefault(){}});assert.equal(s.calls.filter(c=>c.path==='/requests').length,0);
 n('pickup').value='Different pickup';n('pickup').events.input();assert.equal(s.evaluate('quote'),null);assert.equal(n('acceptPrice').required,false);
 s.evaluate('showStep(3,false)');await n('calculate').onclick();n('acceptPrice').checked=true;await n('requestForm').onsubmit({preventDefault(){}});assert.equal(s.calls.filter(c=>c.path==='/requests').length,0);assert.match(n('error').textContent,/términos y condiciones/);n('pickupPostalCode').value='H3A 1A1';n('pickupPostalCode').events.input();assert.equal(s.evaluate('quote'),null);
});

test('Uncertain receipt retries the identical accepted price and tip once; status changes show driver-on-way without exposing contact data',async()=>{
 const s=setup(),n=id=>s.nodes.get(id);n('tip800').onclick();s.evaluate('showStep(3,false)');await n('calculate').onclick();n('acceptPrice').checked=true;n('acceptTerms').checked=true;s.failNextReceipt();
 await n('requestForm').onsubmit({preventDefault(){}});assert.equal(n('pickup').disabled,true);assert.match(n('send').textContent,/Reintentar/);
 const first=s.calls.find(c=>c.path==='/requests').options.body;assert.equal(JSON.parse(first).tipCents,800);assert.equal(JSON.parse(first).acceptPrice,true);assert.equal(JSON.parse(first).acceptTerms,true);assert.equal(JSON.parse(first).termsVersion,'2026-10-23-v2');
 await n('requestForm').onsubmit({preventDefault(){}});assert.equal(s.calls.filter(c=>c.path==='/requests')[1].options.body,first);
 assert.equal(s.calls.filter(c=>c.redirect).length,1);assert.match(s.calls.find(c=>c.redirect).redirect,/^https:\/\/checkout.stripe.com\//);
 await new Promise(setImmediate);await s.evaluate('checkStatus()');assert.match(n('trackingMessage').textContent,/Estamos buscando un repartidor/);s.assign();await s.evaluate('checkStatus()');assert.match(n('trackingMessage').textContent,/Un repartidor va en camino/);assert.match(n('trackingPrice').textContent,/22,95/);
 n('another').onclick();assert.equal(n('tipCents').value,'0');assert.equal(n('pickup').disabled,false);assert.equal(s.evaluate('quote'),null);
});
