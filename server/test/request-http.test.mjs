import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore} from '../core.mjs';

test('HTTP quote → accepted price and tip → admin assignment → restaurant status and driver earnings is private and durable',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tacl-request-http-'));process.env.DATABASE_PATH=join(dir,'test.sqlite');process.env.ASSIGNMENT_EMAIL_ENABLED='false';process.env.GOOGLE_ROUTES_API_KEY='test-only-key';
 const store=createStore(process.env.DATABASE_PATH),password='test-password-123';
 const admin=store.createUser({name:'Admin',email:'admin@example.test',password,role:'admin'}),driver=store.createUser({name:'Driver',email:'driver@example.test',password});
 const realFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://routes.googleapis.com/directions/v2:computeRoutes');assert.equal(options.headers['X-Goog-Api-Key'],'test-only-key');return {ok:true,json:async()=>({routes:[{distanceMeters:5000,duration:'2100s',staticDuration:'900s'}]})};
 };
 const {server}=await import('../server.mjs');await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 async function api(path,{token='',body,method=body?'POST':'GET'}={}){const r=await realFetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
 try{
  for(const path of ['/demander','/demander/','/solicitar','/solicitar/']){const r=await realFetch(base+path);assert.equal(r.status,200);const html=await r.text();assert.match(html,/id="calculate"/);assert.equal((html.match(/data-tip="/g)||[]).length,4);}
  assert.equal((await api('/requests')).status,401);
  const route={pickup:'123 Test Montréal',destination:'456 Test Longueuil',contactPhone:'5145550100',pickupPostalCode:'H2X 1Y4',destinationPostalCode:'J4K 1A1'};
  delete process.env.GOOGLE_ROUTES_API_KEY;assert.equal((await api('/quotes',{body:route})).status,503);process.env.GOOGLE_ROUTES_API_KEY='test-only-key';
  const q=await api('/quotes',{body:route});assert.equal(q.status,201);assert.equal(q.data.totalCents,1536);assert.ok(!JSON.stringify(q).includes('test-only-key'));
  const {contactPhone:removedPhone,...requestRoute}=route;
  const body={...requestRoute,quoteId:q.data.quoteId,consent:true,acceptPrice:true,tipCents:500,submissionId:randomUUID(),statusToken:'cd'.repeat(32),requesterName:'Restaurant',recipientName:'Recipient',recipientPhone:'4505550101',itemDescription:'Repas'};
  assert.equal((await api('/requests',{body:{...body,acceptPrice:false}})).status,400);
  const accepted=await api('/requests',{body});assert.equal(accepted.status,201);assert.deepEqual((await api('/requests',{body})).data,accepted.data);
  const statusPath='/request-status/'+accepted.data.id;
  assert.equal((await api(statusPath)).status,404);assert.equal((await api(statusPath,{token:'wrong'})).status,404);
  const pending=await api(statusPath,{token:body.statusToken});assert.equal(pending.data.status,'pending');assert.equal(pending.data.totalCents,2036);assert.ok(!JSON.stringify(pending).includes(body.recipientPhone));
  const at=(await api('/login',{body:{email:admin.email,password}})).data.token,dt=(await api('/login',{body:{email:driver.email,password}})).data.token;
  assert.equal((await api('/requests',{token:dt})).status,403);assert.equal((await api('/requests/'+accepted.data.id,{token:dt,method:'PATCH',body:{action:'assign',driverId:driver.id}})).status,403);
  const listed=await api('/requests',{token:at});assert.equal(listed.data.length,1);assert.ok(!JSON.stringify(listed).includes('status_token_hash'));assert.equal(listed.data[0].tip_cents,500);assert.equal(listed.data[0].contact_phone,'');assert.equal(listed.data[0].contact_name,'Restaurant');
  const shift=(await api('/shift/start',{token:dt,body:{consent:true}})).data.shiftId;
  await api('/location',{token:dt,body:{shiftId:shift,latitude:45.5,longitude:-73.5,accuracy:5,measuredAt:Date.now()}});
  const assigned=await api('/requests/'+accepted.data.id,{token:at,method:'PATCH',body:{action:'assign',driverId:driver.id}});assert.equal(assigned.status,200);assert.equal(assigned.data.driver_payout_cents,1702);assert.equal(assigned.data.commission_cents,134);
  assert.equal((await api(statusPath,{token:body.statusToken})).data.status,'assigned');assert.equal((await api('/deliveries',{token:dt})).data[0].recipient_phone,body.recipientPhone);
  await api('/batches/'+assigned.data.batch_id+'/pickup',{token:dt,body:{}});assert.equal((await api(statusPath,{token:body.statusToken})).data.status,'picked_up');
  await api('/deliveries/'+assigned.data.id,{token:dt,method:'PATCH',body:{status:'delivered'}});assert.equal((await api(statusPath,{token:body.statusToken})).data.status,'delivered');

  // Direct admin assignments require a fresh reviewed quote, preserve prices and retry without duplicates.
  assert.equal((await api('/admin/quotes',{body:route})).status,401);
  assert.equal((await api('/admin/quotes',{token:dt,body:route})).status,403);
  assert.equal((await api('/deliveries',{token:at,body:{...route,driverId:driver.id}})).status,400);
  const aq=await api('/admin/quotes',{token:at,body:route});assert.equal(aq.status,200);assert.equal(aq.data.subtotalCents,1336);
  const direct={...route,quoteId:aq.data.quoteId,acceptPrice:true,driverId:driver.id,tipCents:800,totalCents:1,commissionCents:0};
  assert.equal((await api('/deliveries',{token:dt,body:direct})).status,403);
  assert.equal((await api('/deliveries',{token:at,body:{...direct,acceptPrice:false}})).status,400);
  assert.equal((await api('/deliveries',{token:at,body:{...direct,pickup:'Changed pickup'}})).status,409);
  assert.equal((await api('/deliveries',{token:at,body:{...direct,tipCents:123}})).status,400);
  store.db.prepare('UPDATE delivery_quotes SET expires_at=0 WHERE id=?').run(aq.data.quoteId);
  assert.equal((await api('/deliveries',{token:at,body:direct})).status,409);
  store.db.prepare('UPDATE delivery_quotes SET expires_at=? WHERE id=?').run(Date.now()+600000,aq.data.quoteId);
  const manual=await api('/deliveries',{token:at,body:direct});assert.equal(manual.status,200);
  assert.equal(manual.data.delivery_fare_cents,1336);assert.equal(manual.data.tip_cents,800);assert.equal(manual.data.driver_payout_cents,2002);assert.equal(manual.data.total_price_cents,2336);assert.equal(manual.data.commission_cents,134);
  assert.deepEqual((await api('/deliveries',{token:at,body:direct})).data,manual.data);
  assert.equal((await api('/deliveries',{token:at,body:{...direct,tipCents:500}})).status,409);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM assignment_emails WHERE delivery_id=?').get(manual.data.id).n,1);
  const reopened=createStore(process.env.DATABASE_PATH);assert.equal(reopened.deliveries(driver).find(d=>d.id===manual.data.id).driver_payout_cents,2002);reopened.db.close();
 }finally{globalThis.fetch=realFetch;await new Promise(r=>server.close(r));store.db.close();rmSync(dir,{recursive:true,force:true})}
});
