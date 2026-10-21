import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore} from '../core.mjs';
import {createRequestMailer,requestEmailConfig,requestMessage} from '../request-mail.mjs';
import {assignmentMessage} from '../assignment-mail.mjs';
const env={SMTP_HOST:'smtp.example.test',SMTP_USER:'sender@example.test',SMTP_PASSWORD:'test-only-password',PUBLIC_APP_URL:'https://deliveries.example.test',ASSIGNMENT_EMAIL_ENABLED:'false'};
const quiet={error(){}};
function setup(file=':memory:'){
 const store=createStore(file),route={pickup:'123 Collecte <script>',destination:'456 Livraison & Road',pickupPostalCode:'H2X 1Y4',destinationPostalCode:'J4K 1A1'};
 const q=store.saveQuote({...route,distanceMeters:3500,durationSeconds:1300,baselineSeconds:1000});
 const payload={...route,quoteId:q.quoteId,acceptPrice:true,consent:true,submissionId:randomUUID(),statusToken:'ab'.repeat(32),requesterName:'Restaurant <Test>',recipientName:'Recipient',recipientPhone:'4505550101',itemDescription:'Deux repas & boissons',tipCents:500};
 return {store,payload};
}
test('Confirmed requests enqueue once, survive restart and send without an active admin session; SMTP retries do not repeat a successful send',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tacl-request-mail-')),file=join(dir,'db.sqlite');let {store,payload}=setup(file);
 const created=store.createRequest(payload);store.createRequest(payload);
 assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM request_emails').get().n,1);
 store.db.close();store=createStore(file);
 let at=Date.now()+1000,calls=0;const messages=[];
 const mailer=createRequestMailer(store,{env,now:()=>at,log:quiet,send:async message=>{calls++;messages.push(message);if(calls===1)throw Error('temporary');return {accepted:['serviceclient@toutaunclicla.com']}}});
 try{
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
  await mailer.flush();assert.equal(calls,1);assert.equal(store.db.prepare('SELECT last_error FROM request_emails').get().last_error,'smtp_send_failed');
  await mailer.flush();assert.equal(calls,1);at+=60001;await mailer.flush();await mailer.flush();assert.equal(calls,2);
  assert.equal(messages[0].messageId,messages[1].messageId);assert.equal(messages[1].to.address,'serviceclient@toutaunclicla.com');
  assert.ok(messages[1].text.includes('Restaurant <Test>'));assert.ok(messages[1].html.includes('Restaurant &lt;Test&gt;'));assert.ok(messages[1].html.includes('Collecte &lt;script&gt;'));assert.ok(!messages[1].html.includes('<script>'));
  assert.ok(messages[1].html.includes('href="https://deliveries.example.test/"'));assert.ok(!JSON.stringify(messages).includes(payload.statusToken));
  assert.equal(store.db.prepare('SELECT request_id FROM request_emails WHERE sent_at IS NOT NULL').get().request_id,created.id);
 }finally{mailer.stop();store.db.close();rmSync(dir,{recursive:true,force:true})}
});
test('Request notification persistence is atomic and processed or old requests do not generate stale pending alerts',async()=>{
 const {store,payload}=setup();
 try{
  store.db.exec("CREATE TRIGGER reject_notification BEFORE INSERT ON request_emails BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.throws(()=>store.createRequest(payload));assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM delivery_requests').get().n,0);
  store.db.exec('DROP TRIGGER reject_notification');store.createRequest(payload);
  let calls=0;const mailer=createRequestMailer(store,{env,log:quiet,send:async()=>{calls++;return {accepted:['serviceclient@toutaunclicla.com']}}});
  store.db.exec("UPDATE delivery_requests SET status='declined'");await mailer.flush();assert.equal(calls,0);assert.ok(store.db.prepare('SELECT skipped_at FROM request_emails').get().skipped_at);store.db.exec("UPDATE delivery_requests SET status='pending',created_at=0; UPDATE request_emails SET skipped_at=NULL");await mailer.flush();assert.equal(calls,0);assert.ok(store.db.prepare('SELECT skipped_at FROM request_emails').get().skipped_at);mailer.stop();
 }finally{store.db.close()}
});
test('Disabled or invalid notification configuration never sends; SMTP rejection stops after five attempts',async()=>{
 assert.equal(requestEmailConfig({...env,REQUEST_EMAIL_ENABLED:'false'}),null);
 assert.throws(()=>requestEmailConfig({...env,REQUEST_NOTIFICATION_EMAIL:'bad\r\nBcc: other@example.test'}));
 assert.throws(()=>requestEmailConfig({...env,PUBLIC_APP_URL:'http://unsafe.example.test'}));
 const {store,payload}=setup();store.createRequest(payload);let calls=0,at=Date.now();
 try{
  const disabled=createRequestMailer(store,{env:{...env,REQUEST_EMAIL_ENABLED:'false'},log:quiet,send:async()=>{calls++}});await disabled.flush();assert.equal(calls,0);disabled.stop();
  const invalid=createRequestMailer(store,{env:{...env,SMTP_PASSWORD:''},log:quiet,send:async()=>{calls++}});await invalid.flush();assert.equal(calls,0);invalid.stop();
  const retry=createRequestMailer(store,{env,now:()=>at,log:quiet,send:async()=>{calls++;return {accepted:['wrong@example.test']}}});
  for(let i=0;i<7;i++){await retry.flush();at+=3600001}
  assert.equal(calls,5);assert.equal(store.db.prepare('SELECT attempts FROM request_emails').get().attempts,5);retry.stop();
 }finally{store.db.close()}
});
test('Request mail has confirmed total including taxes and tip; courier mail shows only courier amount plus tip',()=>{
 const config=requestEmailConfig(env),message=requestMessage({request_id:'a'.repeat(48),requester_name:'Client',pickup:'Pickup',destination:'Destination',ready_at:'',item_description:'Repas',total_cents:799,gst_cents:40,qst_cents:80,tip_cents:500},config);
 assert.match(message.text,/14,19/);assert.equal(message.disableFileAccess,true);assert.equal(message.disableUrlAccess,true);
 const courier=assignmentMessage({delivery_id:'b'.repeat(48),name:'Driver',email:'driver@example.test',pickup:'Pickup',destination:'Destination',driver_payout_cents:1219,tip_cents:500},config);
 assert.match(courier.text,/7,19/);assert.match(courier.text,/5,00/);assert.match(courier.text,/Taxes incluses/);assert.match(courier.text,/Tasas incluidas/);assert.ok(!/90 %|commission/i.test(courier.text));assert.equal(courier.to.address,'driver@example.test');
});
