import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore} from '../core.mjs';
import {priceRoute,deliveryTaxes,splitDeliveryPrice} from '../pricing.mjs';
import {computeQuote} from '../routes.mjs';
import {postalCode} from '../addresses.mjs';

const input=()=>({pickup:'123 rue Exemple, Montréal, QC',destination:'456 rue Démo, Longueuil, QC',readyAt:'',pickupPostalCode:'H2X 1Y4',destinationPostalCode:'J4K 1A1'});
const request=q=>({...input(),quoteId:q.quoteId,acceptPrice:true,consent:true,submissionId:randomUUID(),statusToken:'ab'.repeat(32),requesterName:'Restaurant Test',contactName:'Contact',contactPhone:'514-555-0100',contactEmail:'test@example.test',recipientName:'Client',recipientPhone:'450-555-0101',itemDescription:'Deux repas',notes:'Sonnette 2'});
const quote=s=>s.saveQuote({...input(),distanceMeters:5000,durationSeconds:2100,baselineSeconds:900});

test('Approved pricing respects every distance and congestion boundary; normal driving time is not charged twice',()=>{
 for(const [meters,delay,total]of [[0,0,600],[3000,599,600],[3001,0,650],[3500,0,650],[3501,0,700],[5000,1200,1300],[3000,600,850],[3000,1199.99,850],[3000,1200,1100]]){
  const p=priceRoute({distanceMeters:meters,baselineSeconds:1000,durationSeconds:1000+delay});assert.equal(p.totalCents,total);assert.equal(p.currency,'CAD');
 }
 assert.equal(priceRoute({distanceMeters:3000,baselineSeconds:1000,durationSeconds:900}).trafficCents,0);
 for(const bad of [NaN,Infinity,-1,1.2])assert.throws(()=>priceRoute({distanceMeters:bad,durationSeconds:1,baselineSeconds:1}));
});

test('Routes integration requests actual traffic and historical baseline, never fabricates a price or exposes provider errors',async()=>{
 let call;
 const result=await computeQuote(input(),{env:{GOOGLE_ROUTES_API_KEY:'private-key'},fetchRoute:async(url,options)=>{call={url,...options};return {ok:true,json:async()=>({routes:[{distanceMeters:5000,duration:'2100s',staticDuration:'900s'}]})}}});
 assert.equal(result.totalCents,1300);assert.equal(JSON.parse(call.body).routingPreference,'TRAFFIC_AWARE_OPTIMAL');assert.equal(JSON.parse(call.body).origin.address,input().pickup+', '+input().pickupPostalCode);assert.ok(call.headers['X-Goog-FieldMask'].includes('staticDuration'));assert.ok(!JSON.stringify(result).includes('private-key'));
 await assert.rejects(computeQuote(input(),{env:{}}),e=>e.status===503);
 await assert.rejects(computeQuote(input(),{env:{GOOGLE_ROUTES_API_KEY:'private-key'},fetchRoute:async()=>{throw Error('private-key diagnostic')}}),e=>e.status===503&&!e.message.includes('private-key'));
 await assert.rejects(computeQuote(input(),{env:{GOOGLE_ROUTES_API_KEY:'private-key'},fetchRoute:async()=>({ok:true,json:async()=>({routes:[]})})}),e=>e.status===422);
});

test('Quote acceptance persists a fixed server-side price, rejects changed/expired/unaccepted quotes, retries once, protects status and links one assignment',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tacl-requests-')),file=join(dir,'test.sqlite');let s=createStore(file);
 try{
  const admin=s.createUser({name:'Admin',email:'admin@example.test',password:'test-password-123',role:'admin'}),a=s.createUser({name:'Driver A',email:'a@example.test',password:'test-password-123'}),b=s.createUser({name:'Driver B',email:'b@example.test',password:'test-password-123'});
  const q=quote(s),p=request(q);
  assert.throws(()=>s.createRequest({...p,acceptPrice:false}),e=>e.status===400);
  assert.throws(()=>s.createRequest({...p,pickup:'A different address'}),e=>e.status===409);
  assert.throws(()=>s.createRequest({...p,quoteId:'missing'}),e=>e.status===409);
  const expired=quote(s);s.db.prepare('UPDATE delivery_quotes SET expires_at=0 WHERE id=?').run(expired.quoteId);
  assert.throws(()=>s.createRequest(request(expired)),e=>e.status===409);
  const created=s.createRequest({...p,totalCents:1,trafficCents:0});
  assert.deepEqual(s.createRequest(p),created);assert.equal(s.requests(admin).length,1);
  assert.equal(s.requestStatus(created.id,p.statusToken).totalCents,1495);
  assert.equal(s.requestStatus(created.id,p.statusToken).status,'pending');
  assert.throws(()=>s.createRequest({...p,submissionId:randomUUID()}),e=>e.status===409);
  assert.throws(()=>s.requestStatus(created.id,'wrong'),e=>e.status===404);
  assert.throws(()=>s.requests(a),e=>e.status===403);
  assert.throws(()=>s.declineRequest(a,created.id),e=>e.status===403);
  assert.throws(()=>s.createDelivery(admin,{requestId:created.id,driverId:a.id}),e=>e.status===409);
  const shift=s.start(a,true);s.locate(a,{shiftId:shift.shiftId,latitude:45.5,longitude:-73.5,accuracy:5,measuredAt:Date.now()});
  const delivery=s.createDelivery(admin,{requestId:created.id,driverId:a.id,pickup:'tampered'});
  assert.equal(delivery.pickup,input().pickup+', '+input().pickupPostalCode);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM assignment_emails WHERE delivery_id=?').get(delivery.id).n,1);
  assert.equal(s.requestStatus(created.id,p.statusToken).status,'assigned');assert.equal(s.requestStatus(created.id,p.statusToken).driverName,a.name);
  assert.equal(s.deliveries(a)[0].contact_phone,p.contactPhone);assert.equal(s.deliveries(b).length,0);
  assert.throws(()=>s.createDelivery(admin,{requestId:created.id,driverId:b.id}),e=>e.status===409);
  assert.throws(()=>s.declineRequest(admin,created.id),e=>e.status===409);
  s.updateDelivery(a,delivery.id,'picked_up');assert.equal(s.requestStatus(created.id,p.statusToken).status,'picked_up');s.updateDelivery(a,delivery.id,'delivered');assert.equal(s.requestStatus(created.id,p.statusToken).status,'delivered');
  assert.ok(!JSON.stringify(s.requests(admin)).includes(p.statusToken));assert.ok(!('status_token_hash' in s.requests(admin)[0]));assert.ok(!('contact_phone' in s.requestStatus(created.id,p.statusToken)));
  s.db.close();s=createStore(file);assert.equal(s.requestStatus(created.id,p.statusToken).totalCents,1495);assert.equal(s.requests(admin).length,1);
  const declined=s.createRequest(request(quote(s)));s.declineRequest(admin,declined.id);assert.equal(s.requestStatus(declined.id,p.statusToken).status,'declined');assert.throws(()=>s.createDelivery(admin,{requestId:declined.id,driverId:a.id}),e=>e.status===409);
 }finally{s.db.close();rmSync(dir,{recursive:true,force:true})}
});

test('Three separately priced requests can join one pickup before collection; each retains its own fare, tip, commission and recipient status',()=>{
 const s=createStore(':memory:');
 try{
  const admin=s.createUser({name:'Admin',email:'admin@example.test',password:'test-password-123',role:'admin'}),a=s.createUser({name:'Driver',email:'a@example.test',password:'test-password-123'}),b=s.createUser({name:'Other',email:'b@example.test',password:'test-password-123'});
  const {shiftId}=s.start(a,true);s.locate(a,{shiftId,latitude:45.5,longitude:-73.5,accuracy:5,measuredAt:Date.now()});
  const orders=[];
  for(let i=0;i<4;i++){const tipCents=[500,800,1200,1700][i];const q=s.saveQuote({...input(),destination:'Destination '+i,distanceMeters:3000+i*500,durationSeconds:900,baselineSeconds:900});const p={...request(q),destination:q.destination,tipCents};orders.push({p,created:s.createRequest(p)});}
  const first=s.createDelivery(admin,{requestId:orders[0].created.id,driverId:a.id});
  assert.equal(first.total_price_cents,1190);assert.equal(first.driver_payout_cents,1040);assert.equal(first.commission_cents,60);assert.equal(first.delivery_fare_cents,600);assert.equal(first.tip_cents,500);
  assert.throws(()=>s.createDelivery(admin,{requestId:orders[1].created.id,driverId:a.id}),e=>e.status===409);
  const mismatch=s.createRequest({...request(quote(s)),requesterName:'Other restaurant'});
  assert.throws(()=>s.createDelivery(admin,{requestId:mismatch.id,driverId:a.id,joinBatch:true}),e=>e.status===409);
  for(let i=1;i<3;i++){const d=s.createDelivery(admin,{requestId:orders[i].created.id,driverId:a.id,joinBatch:true});assert.equal(d.batch_id,first.batch_id);assert.equal(d.driver_payout_cents,d.delivery_fare_cents-d.commission_cents+d.tip_cents);assert.equal(d.commission_cents,d.delivery_fare_cents/10);}
  assert.equal(s.drivers(admin)[0].batch.count,3);
  assert.throws(()=>s.createDelivery(admin,{requestId:orders[3].created.id,driverId:a.id,joinBatch:true}),e=>e.status===409);
  assert.throws(()=>s.collectBatch(b,first.batch_id),e=>e.status===403);
  assert.equal(s.collectBatch(a,first.batch_id).count,3);
  assert.throws(()=>s.collectBatch(a,first.batch_id),e=>e.status===409);
  assert.equal(s.drivers(admin)[0].batch,null);
  assert.throws(()=>s.createDelivery(admin,{requestId:orders[3].created.id,driverId:a.id,joinBatch:true}),e=>e.status===409);
  for(const o of orders.slice(0,3))assert.equal(s.requestStatus(o.created.id,o.p.statusToken).status,'picked_up');
  s.updateDelivery(a,first.id,'delivered');assert.equal(s.requestStatus(orders[0].created.id,orders[0].p.statusToken).status,'delivered');assert.equal(s.requestStatus(orders[1].created.id,orders[1].p.statusToken).status,'picked_up');
  assert.equal(s.requestStatus(orders[1].created.id,orders[1].p.statusToken).totalCents,1548);
  assert.equal(s.requests(admin).find(r=>r.id===orders[1].created.id).tip_cents,800);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM assignment_emails').get().n,3);
  assert.throws(()=>s.createRequest({...request(quote(s)),tipCents:999}),e=>e.status===400);
  assert.throws(()=>s.createRequest({...request(quote(s)),tipCents:'500'}),e=>e.status===400);
 }finally{s.db.close()}
});

test('Postal codes are separate, required, normalized and bound to the accepted quote',()=>{
 assert.equal(postalCode('h2x1y4'),'H2X 1Y4');assert.throws(()=>postalCode('12345'),e=>e.status===400);assert.throws(()=>postalCode(''),e=>e.status===400);
 const s=createStore(':memory:');try{const q=quote(s);assert.ok(q.pickup.endsWith('H2X 1Y4'));assert.ok(q.destination.endsWith('J4K 1A1'));assert.throws(()=>s.createRequest({...request(q),pickupPostalCode:'H3A 1A1'}),e=>e.status===409);assert.throws(()=>s.createRequest({...request(q),destinationPostalCode:''}),e=>e.status===400);}finally{s.db.close()}
});

test('TPS and TVQ are itemized on delivery fare; voluntary tips and courier commission exclude sales taxes',()=>{
 assert.deepEqual(deliveryTaxes(1300),{subtotalCents:1300,gstCents:65,qstCents:130,totalWithTaxesCents:1495});
 const split=splitDeliveryPrice(1300,800);assert.equal(split.totalPriceCents,2295);assert.equal(split.commissionCents,130);assert.equal(split.driverPayoutCents,1970);assert.equal(split.gstCents,65);assert.equal(split.qstCents,130);
});
