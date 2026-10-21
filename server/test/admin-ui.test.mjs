import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function setup(){
 const nodes=new Map(),calls=[];let quoteNumber=0;
 function node(id=''){
  const classes=new Set();return {id,value:'',textContent:'',checked:false,disabled:false,style:{},dataset:{},children:[],options:[],
   classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle(c,on){on?classes.add(c):classes.delete(c)},contains:c=>classes.has(c)},
   append(...items){this.children.push(...items)},replaceChildren(...items){this.children=[...items];this.options=[...items]},add(o){this.options.push(o)},setAttribute(){},reportValidity(){return !!this.value},querySelectorAll(){return []},reset(){for(const key of ['pickup','destination','pickupPostalCode','destinationPostalCode','driverSelect'])get(key).value='';get('adminTip').value='0';get('adminAccept').checked=false},querySelector(){return get('assignButton')}};
 }
 const get=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id)};
 get('adminTip').value='0';
 const document={getElementById:get,createElement:()=>node(),createTextNode:text=>({textContent:text}),querySelectorAll:()=>[],documentElement:{},head:{append(){}}};
 const context=vm.createContext({document,window:{},Intl,Date,JSON,Number,String,Object,Array,Map,Set,Error,Promise,AbortSignal,encodeURIComponent,
  Option:function(text,value){return {text,value}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},fetch:async(path,options)=>{
   calls.push({path,body:options.body&&JSON.parse(options.body)});
   return {ok:true,json:async()=>path==='/admin/quotes'?{quoteId:'quote'+(++quoteNumber),expiresAt:Date.now()+600000,distanceMeters:5000,subtotalCents:836,trafficCents:0,gstCents:42,qstCents:83,totalCents:961}:path==='/deliveries'?{id:'delivery'}:[]};
  }});
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
 for(const [key,value]of Object.entries({pickup:'123 Montréal',destination:'456 Longueuil',pickupPostalCode:'H2X 1Y4',destinationPostalCode:'J4K 1A1',driverSelect:'driver'}))get(key).value=value;
 return {get,calls,evaluate:code=>vm.runInContext(code,context)};
}
test('Admin reviews quote and taxes, accepts price, assigns tip and clears quotes when addresses change',async()=>{
 const s=setup();assert.equal(s.get('assignButton').disabled,true);
 await s.get('calculateAdmin').onclick();assert.equal(s.calls[0].path,'/admin/quotes');assert.equal(s.get('assignButton').disabled,true);
 s.get('adminTip').value='800';s.get('adminTip').onchange();
 const lines=s.get('adminQuote').children.map(c=>c.textContent).join('\n');assert.match(lines,/TPS/);assert.match(lines,/TVQ/);assert.match(lines,/17,61/);assert.match(lines,/15,52/);
 s.get('adminAccept').checked=true;s.get('adminAccept').onchange();assert.equal(s.get('assignButton').disabled,false);
 s.get('pickup').value='Changed pickup';s.get('pickup').oninput();assert.equal(s.get('assignButton').disabled,true);assert.equal(s.evaluate('adminQuote'),null);
 await s.get('calculateAdmin').onclick();s.get('adminAccept').checked=true;s.get('adminAccept').onchange();
 await s.get('deliveryForm').onsubmit({preventDefault(){}});
 const assigned=s.calls.find(c=>c.path==='/deliveries');assert.equal(assigned.body.tipCents,800);assert.equal(assigned.body.acceptPrice,true);assert.equal(assigned.body.pickup,'Changed pickup');assert.equal(assigned.body.driverId,'driver');
 assert.equal(s.evaluate('adminQuote'),null);assert.equal(s.get('assignButton').disabled,true);
});
