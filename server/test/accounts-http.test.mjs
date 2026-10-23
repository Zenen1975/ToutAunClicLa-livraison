import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {stripeFixture} from './stripe-fixture.mjs';
import {createStore} from '../core.mjs';
test('Restaurant access, authenticated delivery submission and password recovery work through HTTP without sending test emails',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tacl-accounts-http-'));process.env.DATABASE_PATH=join(dir,'test.sqlite');process.env.ASSIGNMENT_EMAIL_ENABLED='false';process.env.REQUEST_EMAIL_ENABLED='false';process.env.PASSWORD_RESET_EMAIL_ENABLED='false';
 const store=createStore(process.env.DATABASE_PATH),password='test-password-123';store.createUser({name:'Admin',email:'admin@example.test',password,role:'admin'});
 const stripe=stripeFixture(),realFetch=globalThis.fetch;globalThis.fetch=(url,options)=>String(url).startsWith('https://api.stripe.com/')?stripe.respond(url,options):realFetch(url,options);
 const {server}=await import('../server.mjs');await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 async function api(path,{token='',body,method=body?'POST':'GET'}={}){const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
 try{
  for(const path of ['/forgot-password','/reset-password','/restaurant']){const r=await fetch(base+path);assert.equal(r.status,200);assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.ok((await r.text()).includes('data-i18n'))}
  const at=(await api('/login',{body:{email:'admin@example.test',password}})).data.token;
  const payload={email:'restaurant@example.test',name:'Restaurant <Name>',password,role:'restaurant',pickup:'123 Montréal',pickupPostalCode:'H2X 1Y4'};
  assert.equal((await api('/users',{body:payload})).status,401);
  const created=await api('/users',{token:at,body:payload});assert.equal(created.status,200);assert.equal(created.data.role,'restaurant');
  const rt=(await api('/login',{body:{email:payload.email,password}})).data.token;
  assert.equal((await api('/restaurant/profile',{token:rt})).data.pickup,payload.pickup);
  assert.equal((await api('/restaurant/requests',{token:at})).status,403);assert.equal((await api('/drivers',{token:rt})).status,403);assert.equal((await api('/shift/start',{token:rt,body:{consent:true}})).status,403);assert.equal((await api('/users',{token:rt,body:{...payload,email:'extra@example.test'}})).status,403);
  assert.equal((await api('/drivers',{token:at})).data.length,0);
  const route={pickup:payload.pickup,pickupPostalCode:payload.pickupPostalCode,destination:'456 Longueuil',destinationPostalCode:'J4K 1A1'};
  const q=store.saveQuote({...route,distanceMeters:3500,durationSeconds:900,baselineSeconds:900});
  const requested=await api('/requests',{token:rt,body:{...route,quoteId:q.quoteId,acceptPrice:true,acceptTerms:true,termsVersion:'2026-10-23-v2',consent:true,submissionId:randomUUID(),statusToken:'ab'.repeat(32),requesterName:'Spoofed name',recipientName:'Client',recipientPhone:'4505550101',itemDescription:'Repas'}});assert.equal(requested.status,201);
  assert.equal((await stripe.pay(realFetch,base,requested.data.id)).status,200);
  const own=(await api('/restaurant/requests',{token:rt})).data;assert.equal(own.length,1);assert.equal(own[0].id,requested.data.id);assert.ok(!JSON.stringify(own).includes('status_token_hash'));assert.equal(store.requests(store.authenticate(at))[0].requester_name,payload.name);
  const known=await api('/password/forgot',{body:{email:payload.email}}),unknown=await api('/password/forgot',{body:{email:'missing@example.test'}});assert.deepEqual(known,unknown);assert.deepEqual(known.data,{ok:true});
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM password_resets').get().n,1);
  const reset=store.preparePasswordReset(payload.email,Date.now()+61000);
  assert.equal((await api('/password/reset',{body:{token:reset.token,password:'new-password-12345'}})).status,200);
  assert.equal((await api('/restaurant/profile',{token:rt})).status,401);
  assert.equal((await api('/password/reset',{body:{token:reset.token,password:'another-password-123'}})).status,400);
  assert.equal((await api('/login',{body:{email:payload.email,password}})).status,401);
  assert.equal((await api('/login',{body:{email:payload.email,password:'new-password-12345'}})).data.user.role,'restaurant');
 }finally{globalThis.fetch=realFetch;await new Promise(r=>server.close(r));store.db.close();rmSync(dir,{recursive:true,force:true})}
});
function ui(filename,hash=''){
 const nodes=new Map(),calls=[],storage=new Map();
 function get(id){if(!nodes.has(id)){const classes=new Set();nodes.set(id,{value:'',disabled:false,textContent:'',dataset:{},children:[],classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},append(...c){this.children.push(...c)},replaceChildren(){this.children=[]},reset(){get('password').value='';get('confirm').value=''}})}return nodes.get(id)}
 const context=vm.createContext({document:{getElementById:get,querySelectorAll:()=>[],documentElement:{},createElement:()=>get('new'+nodes.size)},navigator:{language:'es'},location:{hash},history:{replaceState(...args){calls.push({history:args})}},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},Date,Intl,AbortSignal,JSON,Error,Promise,setInterval:()=>1,clearInterval(){},fetch:async(path,options)=>{calls.push({path,body:options?.body&&JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true})}}});
 const html=readFileSync(new URL('../public/'+filename+'.html',import.meta.url),'utf8');vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);return {get,calls,context};
}
test('Recovery screens keep reset token out of URL, require matching passwords and submit the chosen password',async()=>{
 const token='a'.repeat(96),s=ui('reset-password','#'+token);assert.ok(s.calls[0].history);s.get('password').value='new-password-12345';s.get('confirm').value='different-password';await s.get('form').onsubmit({preventDefault(){}});assert.equal(s.calls.filter(c=>c.path).length,0);
 s.get('confirm').value=s.get('password').value;await s.get('form').onsubmit({preventDefault(){}});assert.deepEqual(s.calls.find(c=>c.path).body,{token,password:'new-password-12345'});assert.equal(s.get('form').classList.contains('hidden'),true);
 const forgot=ui('forgot-password');forgot.get('email').value='account@example.test';await forgot.get('form').onsubmit({preventDefault(){}});assert.equal(forgot.calls.find(c=>c.path).path,'/password/forgot');assert.match(forgot.get('message').textContent,/Si el correo/);
 ui('restaurant');
});
