import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {createStore} from '../core.mjs';
import {checkout,paymentConfig,verifyStripeEvent} from '../payments.mjs';
import {createQuoteMailer} from '../quote-mail.mjs';
import {createRequestMailer} from '../request-mail.mjs';
const env={STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',PUBLIC_APP_URL:'https://delivery.example.test',SMTP_HOST:'smtp.example.test',SMTP_USER:'sender@example.test',SMTP_PASSWORD:'fixture-only'};
function setup(){
 const store=createStore(':memory:'),route={pickup:'123 Montréal',destination:'456 Longueuil',pickupPostalCode:'H2X 1Y4',destinationPostalCode:'J4K 1A1'};
 const q=store.saveQuote({...route,distanceMeters:5000,durationSeconds:1400,baselineSeconds:1000},{publicQuote:true});
 const body={...route,requesterName:'Test',recipientName:'Client',recipientPhone:'4505550101',itemDescription:'Repas',submissionId:randomUUID(),statusToken:'ab'.repeat(32),quoteId:q.quoteId,consent:true,acceptPrice:true,acceptTerms:true,termsVersion:'2026-10-23-v2',tipCents:800};
 const request=store.createRequest(body,null,{awaitPayment:true});return {store,request,body,q};
}
test('Checkout fixes the server total, reuses one persisted session and activates delivery/mail only after verified paid data',async()=>{
 const {store,request,body,q}=setup();let calls=0,session;
 try{
 assert.equal(store.requestStatus(request.id,body.statusToken).status,'awaiting_payment');assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM request_emails').get().n,0);
 const fetcher=async(url,options)=>{calls++;assert.equal(url,'https://api.stripe.com/v1/checkout/sessions');const p=new URLSearchParams(options.body);assert.equal(Number(p.get('line_items[0][price_data][unit_amount]')),q.totalCents+800);assert.match(p.get('success_url'),/^https:\/\/delivery.example.test\/demander#/);assert.equal(p.get('success_url'),p.get('cancel_url'));assert.ok(!p.has('automatic_tax[enabled]'));session={id:'cs_test_123',mode:'payment',payment_status:'unpaid',currency:'cad',livemode:false,amount_total:q.totalCents+800,metadata:{request_id:request.id},client_reference_id:request.id,expires_at:Number(p.get('expires_at')),url:'https://checkout.stripe.com/c/pay/cs_test_123'};return {ok:true,json:async()=>session}};
 const c=await checkout(store,request,body.statusToken,{env,fetcher});assert.equal(c.checkoutUrl,session.url);await checkout(store,request,body.statusToken,{env,fetcher});assert.equal(calls,1);
 assert.throws(()=>store.confirmPayment(session),/Pago incompatible/);
 for(const values of [{amount_total:1},{currency:'usd'},{client_reference_id:'bad'},{id:'cs_test_other'}])assert.throws(()=>store.confirmPayment({...session,payment_status:'paid',...values}),/Pago incompatible/);
 store.db.exec('CREATE TRIGGER test_payment_failure BEFORE INSERT ON request_emails BEGIN SELECT RAISE(ABORT,"test"); END');assert.throws(()=>store.confirmPayment({...session,payment_status:'paid'}));assert.equal(store.requestStatus(request.id,body.statusToken).status,'awaiting_payment');store.db.exec('DROP TRIGGER test_payment_failure');
 assert.deepEqual(store.confirmPayment({...session,payment_status:'paid'}),{paid:true});assert.deepEqual(store.confirmPayment({...session,payment_status:'paid'}),{duplicate:true});assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM request_emails').get().n,1);assert.equal(store.requestStatus(request.id,body.statusToken).checkoutUrl,null);
 assert.throws(()=>paymentConfig({}),e=>e.status===503);
 }finally{store.db.close()}
});
test('Stripe webhook signature requires the unchanged body, a recent timestamp, correct secret and correct live/test mode',()=>{
 const config=paymentConfig(env),at=Date.now(),stamp=Math.floor(at/1000),raw=Buffer.from(JSON.stringify({type:'checkout.session.completed',livemode:false,data:{object:{}}}));
 const sig='t='+stamp+',v1='+createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(stamp+'.').update(raw).digest('hex');
 assert.equal(verifyStripeEvent(raw,sig,config,at).type,'checkout.session.completed');
 for(const [body,header,cfg,time]of [[Buffer.concat([raw,Buffer.from(' ')]),sig,config,at],[raw,sig,config,at+301000],[raw,'',config,at],[raw,sig,{...config,live:true},at]])assert.throws(()=>verifyStripeEvent(body,header,cfg,time));
});
test('Quote and payment notices are separate durable queues, send without a panel session, and do not repeat after success',async()=>{
 const {store,request,body,q}=setup(),messages=[];let at=Date.now()+1000,calls=0;
 const quoteMailer=createQuoteMailer(store,{env,now:()=>at,log:{error(){}},send:async m=>{calls++;if(calls===1)throw Error();messages.push(m);return {accepted:['serviceclient@toutaunclicla.com']}}});
 const paidMailer=createRequestMailer(store,{env,now:()=>at,log:{error(){}},send:async m=>{messages.push(m);return {accepted:['serviceclient@toutaunclicla.com']}}});
 try{
 await paidMailer.flush();assert.equal(messages.length,0);await quoteMailer.flush();assert.equal(messages.length,0);at+=60001;await quoteMailer.flush();await quoteMailer.flush();assert.equal(messages.length,1);assert.match(messages[0].subject,/Cotización realizada, sin pago/);assert.ok(!JSON.stringify(messages).includes(body.statusToken));
 store.confirmPayment({id:'cs_test_paid',mode:'payment',payment_status:'paid',currency:'cad',amount_total:q.totalCents+800,metadata:{request_id:request.id},client_reference_id:request.id});
 await paidMailer.flush();await paidMailer.flush();assert.equal(messages.length,2);assert.match(messages[1].subject,/Pago confirmado/);assert.equal(messages[1].to.address,'serviceclient@toutaunclicla.com');
 }finally{quoteMailer.stop();paidMailer.stop();store.db.close()}
});

test('Checkout diagnostics never reveal provider errors or credentials and stale attempts never contact Stripe',async()=>{
 for(const [status,param,expected] of [[401,undefined,'STRIPE_AUTH'],[403,undefined,'STRIPE_PERMISSION'],[429,undefined,'STRIPE_RATE_LIMIT'],[400,'expires_at','STRIPE_EXPIRED'],[400,undefined,'STRIPE_CHECKOUT_REJECTED']]){
  const {store,request,body}=setup(),logs=[];
  try{
   await assert.rejects(()=>checkout(store,request,body.statusToken,{env,log:{error:m=>logs.push(m)},fetcher:async()=>({ok:false,status,json:async()=>({error:{param,message:'SECRET_PROVIDER_PAYLOAD',code:'SECRET_PROVIDER_PAYLOAD'}})})}),e=>e.message.includes(expected)&&!e.message.includes('SECRET_PROVIDER_PAYLOAD'));
   assert.ok(!JSON.stringify(logs).includes('SECRET_PROVIDER_PAYLOAD'));assert.equal(store.db.prepare('SELECT session_id FROM request_payments').get().session_id,null);
  }finally{store.db.close()}
 }
 const {store,request,body}=setup();let calls=0;
 try{
  store.db.prepare('UPDATE request_payments SET created_at=?').run(Date.now()-61000);
  await assert.rejects(()=>checkout(store,request,body.statusToken,{env,fetcher:async()=>{calls++;throw Error()}}),e=>e.status===409&&e.message.includes('STRIPE_EXPIRED'));assert.equal(calls,0);
  store.db.prepare("UPDATE request_payments SET session_id='cs_test_stored',expires_at=?").run(Date.now()+600000);
  await assert.rejects(()=>checkout(store,request,body.statusToken,{env:{...env,STRIPE_SECRET_KEY:'sk_live_fixture'},fetcher:async()=>{calls++;throw Error()}}),e=>e.status===409&&e.message.includes('STRIPE_MODE'));assert.equal(calls,0);
  assert.throws(()=>paymentConfig({...env,STRIPE_SECRET_KEY:'pk_live_fixture'}),/STRIPE_KEY_FORMAT/);
 }finally{store.db.close()}
});
