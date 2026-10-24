import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createStore} from '../core.mjs';
import {TERMS_VERSION} from '../terms.mjs';
function setup(){
 const store=createStore(':memory:');
 const admin={role:'admin'},driver={role:'driver'},restaurant={role:'restaurant'};
 const route={pickup:'123 Montréal',destination:'456 Longueuil',pickupPostalCode:'H2X 1Y4',destinationPostalCode:'J4K 1A1'};
 function quote(){return store.saveQuote({...route,distanceMeters:3500,durationSeconds:900,baselineSeconds:900},{publicQuote:true})}
 function request(awaitPayment=false){const q=quote();return store.createRequest({...route,quoteId:q.quoteId,requesterName:'Test',recipientName:'Client',recipientPhone:'4505550101',itemDescription:'Repas',submissionId:randomUUID(),statusToken:'ab'.repeat(32),acceptPrice:true,consent:true,acceptTerms:true,termsVersion:TERMS_VERSION},null,{awaitPayment})}
 const age=id=>store.db.prepare('UPDATE delivery_requests SET created_at=? WHERE id=?').run(Date.now()-3600001,id);
 return {store,admin,driver,restaurant,quote,request,age};
}
test('Manual cleanup enforces administrator role, refusal or strict one-hour boundary, and never removes assigned work',()=>{
 const {store,admin,driver,restaurant,request,age}=setup();
 try{
  const r=request();
  for(const role of [driver,restaurant])assert.throws(()=>store.removeRequest(role,r.id),e=>e.status===403);
  assert.throws(()=>store.removeRequest(admin,r.id),e=>e.status===409);
  store.declineRequest(admin,r.id);assert.ok(store.requests(admin).some(x=>x.id===r.id&&x.canDelete));
  store.removeRequest(admin,r.id);assert.ok(!store.requests(admin).some(x=>x.id===r.id));assert.ok(store.db.prepare('SELECT * FROM delivery_requests WHERE id=?').get(r.id));
  assert.throws(()=>store.createDelivery(admin,{requestId:r.id}),/eliminada/);
  const old=request();age(old.id);assert.ok(store.requests(admin).some(x=>x.id===old.id&&x.canDelete));store.removeRequest(admin,old.id);
  const assigned=request();age(assigned.id);store.db.prepare("UPDATE delivery_requests SET status='assigned' WHERE id=?").run(assigned.id);assert.throws(()=>store.removeRequest(admin,assigned.id),e=>e.status===409);
  assert.equal(store.db.prepare('SELECT admin_removed_at FROM delivery_requests WHERE id=?').get(assigned.id).admin_removed_at,null);
 }finally{store.db.close()}
});
test('Uncompleted quotation cleanup is manual and durable; late first payment restores a hidden request and preserves payment records',()=>{
 const {store,admin,driver,quote,request,age}=setup();
 try{
  const q=quote();assert.throws(()=>store.removeQuoteActivity(driver,q.quoteId),e=>e.status===403);assert.throws(()=>store.removeQuoteActivity(admin,q.quoteId),e=>e.status===409);
  store.db.prepare('UPDATE delivery_quotes SET created_at=? WHERE id=?').run(Date.now()-3600001,q.quoteId);
  assert.equal(store.quoteActivity(admin).find(x=>x.id===q.quoteId).canDelete,1);store.removeQuoteActivity(admin,q.quoteId);assert.ok(!store.quoteActivity(admin).some(x=>x.id===q.quoteId));
  assert.ok(store.db.prepare('SELECT skipped_at FROM quote_emails WHERE quote_id=?').get(q.quoteId).skipped_at);
  const r=request(true);age(r.id);store.removeRequest(admin,r.id);
  const payment=store.db.prepare('SELECT * FROM request_payments WHERE id=?').get(r.id);assert.ok(payment);assert.equal(payment.status,'unpaid');
  store.confirmPayment({id:'cs_live_late',mode:'payment',payment_status:'paid',currency:'cad',amount_total:payment.amount_cents,metadata:{request_id:r.id},client_reference_id:r.id});
  assert.ok(store.requests(admin).some(x=>x.id===r.id));assert.equal(store.db.prepare('SELECT status FROM request_payments WHERE id=?').get(r.id).status,'paid');
  // A duplicate event must not undo a later deliberate cleanup of a paid request.
  store.removeRequest(admin,r.id);store.confirmPayment({id:'cs_live_late',mode:'payment',payment_status:'paid',currency:'cad',amount_total:payment.amount_cents,metadata:{request_id:r.id},client_reference_id:r.id});assert.ok(!store.requests(admin).some(x=>x.id===r.id));
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM request_payments WHERE id=?').get(r.id).n,1);
 }finally{store.db.close()}
});
