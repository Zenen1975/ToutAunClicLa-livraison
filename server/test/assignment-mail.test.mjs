import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../core.mjs';
import {assignmentMessage,createAssignmentMailer,emailConfig} from '../assignment-mail.mjs';
const env={ASSIGNMENT_EMAIL_ENABLED:'true',SMTP_HOST:'smtp.example.test',SMTP_USER:'dispatch@example.test',SMTP_PASSWORD:'test-password-only',PUBLIC_APP_URL:'https://deliveries.example.test'};
const quiet={error(){}};
function assigned(path=':memory:'){
 const store=createStore(path);
 const admin=store.createUser({name:'Admin',email:'admin@example.test',password:'test-password-123',role:'admin'});
 const driver=store.createUser({name:'Driver <A>',email:'driver@example.test',password:'test-password-123'});
 const {shiftId}=store.start(driver,true);
 store.locate(driver,{shiftId,latitude:45.5,longitude:-73.5,accuracy:5,measuredAt:Date.now()});
 const delivery=store.createDelivery(admin,{driverId:driver.id,pickup:'Pickup <script>alert(1)</script>',destination:'Destination & Road'});
 return {store,admin,driver,delivery};
}
test('Assignment and email queue survive reopening; SMTP retry sends only to assigned driver and does not repeat a successful send',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tacl-mail-'));const path=join(dir,'db.sqlite');
 let {store,driver,delivery}=assigned(path);
 let time=Date.now()+1000,calls=0,messages=[];
 const send=async message=>{calls++;if(calls===1)throw Error('temporary SMTP failure');messages.push(message);return {accepted:[driver.email]};};
 try{
  const mailer=createAssignmentMailer(store,{env,send,now:()=>time,log:quiet});
  await mailer.flush();assert.equal(store.db.prepare('SELECT attempts FROM assignment_emails').get().attempts,1);
  assert.equal(store.deliveries(driver).length,1); // Email failure never rolls back the actual assignment.
  store.db.close();store=createStore(path);time+=61000;
  const restarted=createAssignmentMailer(store,{env,send,now:()=>time,log:quiet});
  await restarted.flush();await restarted.flush();
  assert.equal(calls,2);assert.equal(messages.length,1);assert.equal(messages[0].to.address,driver.email);
  assert.match(messages[0].text,/Nouvelle|nouvelle/);assert.match(messages[0].text,/nueva entrega/);
  assert.match(messages[0].html,/&lt;script&gt;/);assert.doesNotMatch(messages[0].html,/<script>/);
  assert.match(messages[0].html,/https:\/\/deliveries.example.test\/livreur/);
  assert.equal(store.db.prepare('SELECT sent_at FROM assignment_emails WHERE delivery_id=?').get(delivery.id).sent_at,time);
 }finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('Disabled, invalid, old and already collected assignments do not send email',async()=>{
 const {store,driver,delivery}=assigned();let calls=0;const send=async()=>{calls++;};
 try{
  await createAssignmentMailer(store,{env:{},send,log:quiet}).flush();assert.equal(calls,0);
  await createAssignmentMailer(store,{env:{...env,PUBLIC_APP_URL:'http://unsafe.test'},send,log:quiet}).flush();assert.equal(calls,0);
  store.updateDelivery(driver,delivery.id,'picked_up');
  await createAssignmentMailer(store,{env,send,log:quiet}).flush();assert.equal(calls,0);
  assert.ok(store.db.prepare('SELECT skipped_at FROM assignment_emails').get().skipped_at);
 }finally{store.db.close();}
 const old=assigned();try{
  await createAssignmentMailer(old.store,{env,send,now:()=>Date.now()+86401000,log:quiet}).flush();assert.equal(calls,0);
 }finally{old.store.db.close();}
});
test('TLS ports and HTTPS app link are validated; rejected recipients and concurrent flushes are handled',async()=>{
 assert.equal(emailConfig({}),null);assert.throws(()=>emailConfig({...env,SMTP_PORT:'25'}));
 assert.throws(()=>emailConfig({...env,PUBLIC_APP_URL:'https://user:password@example.test'}));
 const {store}=assigned();let calls=0,release;const wait=new Promise(resolve=>release=resolve);
 const worker=createAssignmentMailer(store,{env,log:quiet,send:async()=>{calls++;await wait;return {accepted:[]};}});
 try{
  const first=worker.flush();await worker.flush();assert.equal(calls,1);release();await first;
  assert.equal(store.db.prepare('SELECT sent_at FROM assignment_emails').get().sent_at,null);
  assert.equal(store.db.prepare('SELECT last_error FROM assignment_emails').get().last_error,'smtp_send_failed');
 }finally{store.db.close();}
});
