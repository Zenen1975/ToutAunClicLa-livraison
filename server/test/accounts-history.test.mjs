import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createStore} from '../core.mjs';
import {passwordMessage,createPasswordMailer} from '../password-mail.mjs';
const password='original-password-123',changed='new-password-456789';
function setup(){const s=createStore(':memory:');const admin=s.createUser({name:'Admin',email:'admin@example.test',password,role:'admin'}),driver=s.createUser({name:'Driver',email:'driver@example.test',password}),restaurant=s.createUser({name:'Restaurant',email:'restaurant@example.test',password,role:'restaurant',pickup:'123 Montréal',pickupPostalCode:'H2X 1Y4'});return {s,admin,driver,restaurant}}
function request(s,u){const route={pickup:'123 Montréal',destination:'456 Longueuil',pickupPostalCode:'H2X 1Y4',destinationPostalCode:'J4K 1A1'};const q=s.saveQuote({...route,distanceMeters:3500,durationSeconds:900,baselineSeconds:900});return s.createRequest({...route,quoteId:q.quoteId,acceptPrice:true,consent:true,submissionId:randomUUID(),statusToken:'ab'.repeat(32),requesterName:u?.name||'Public',recipientName:'Client',recipientPhone:'4505550101',itemDescription:'Repas'},u)}
function active(s,driver){const {shiftId}=s.start(driver,true);s.locate(driver,{shiftId,latitude:45.5,longitude:-73.5,accuracy:5,measuredAt:Date.now()})}
test('Restaurant accounts have saved pickup, isolated history and no driver or admin permissions',()=>{
 const {s,admin,driver,restaurant}=setup();
 try{
  assert.equal(s.login(restaurant.email,password).user.role,'restaurant');const u=s.authenticate(s.login(restaurant.email,password).token);assert.equal(u.role,'restaurant');
  assert.deepEqual(s.restaurantProfile(u),{name:'Restaurant',pickup:'123 Montréal',pickupPostalCode:'H2X 1Y4'});
  assert.equal(s.restaurantProfile(u,{pickup:'Other address',pickupPostalCode:'h3a1a1'}).pickupPostalCode,'H3A 1A1');
  assert.deepEqual(s.drivers(admin).map(d=>d.id),[driver.id]);
  assert.throws(()=>s.start(u,true),e=>e.status===403);assert.throws(()=>s.deliveries(u),e=>e.status===403);assert.throws(()=>s.requests(u),e=>e.status===403);assert.throws(()=>s.restaurantProfile(driver),e=>e.status===403);
  const r=request(s,u);request(s,null);assert.deepEqual(s.restaurantRequests(u).map(r=>r.id),[r.id]);
 }finally{s.db.close()}
});
test('Password links expire, are hashed and single use, change both account kinds, revoke sessions and clear driver GPS',()=>{
 const {s,driver,restaurant}=setup();
 try{
  for(const account of [driver,restaurant]){
   const session=s.login(account.email,password);if(account.role==='driver')active(s,driver);
   const now=Date.now(),reset=s.preparePasswordReset(account.email,now);
   assert.equal(reset.email,account.email);assert.equal(reset.token.length,96);
   const dbReset=s.db.prepare('SELECT * FROM password_resets WHERE user_id=?').get(account.id);assert.equal(dbReset.token_hash,createHash('sha256').update(reset.token).digest('hex'));assert.ok(!JSON.stringify(dbReset).includes(reset.token));
   assert.equal(s.preparePasswordReset(account.email,now+1),null);
   assert.throws(()=>s.resetPassword(reset.token,'short'),e=>e.status===400);
   assert.throws(()=>s.resetPassword(reset.token,changed,now+30*60000),e=>e.status===400);
   assert.deepEqual(s.resetPassword(reset.token,changed,now+1000),{ok:true});
   assert.throws(()=>s.resetPassword(reset.token,changed),e=>e.status===400);assert.throws(()=>s.authenticate(session.token),e=>e.status===401);assert.throws(()=>s.login(account.email,password),e=>e.status===401);assert.equal(s.login(account.email,changed).user.id,account.id);
  }
  assert.equal(s.db.prepare('SELECT shift_id FROM shifts WHERE user_id=?').get(driver.id).shift_id,null);
  assert.equal(s.preparePasswordReset('missing@example.test'),null);
 }finally{s.db.close()}
});
test('Completed delivery retention is five days for admin and driver, ten for restaurant, measured from completion; active work remains',()=>{
 const {s,admin,driver,restaurant}=setup(),now=Date.now(),day=86400000;
 try{
  active(s,driver);const owned=request(s,restaurant),d=s.createDelivery(admin,{requestId:owned.id,driverId:driver.id});s.updateDelivery(driver,d.id,'picked_up');s.updateDelivery(driver,d.id,'delivered');
  const completed=s.db.prepare('SELECT completed_at FROM deliveries WHERE id=?').get(d.id).completed_at;assert.ok(Math.abs(completed-now)<1000);
  s.db.prepare('UPDATE deliveries SET created_at=?,completed_at=? WHERE id=?').run(now-20*day,now-4*day,d.id);
  assert.equal(s.deliveries(admin).length,1);assert.equal(s.deliveries(driver).length,1);
  s.db.prepare('UPDATE deliveries SET completed_at=? WHERE id=?').run(now-6*day,d.id);
  assert.equal(s.deliveries(admin).length,0);assert.equal(s.deliveries(driver).length,0);assert.equal(s.requests(admin).length,0);assert.equal(s.restaurantRequests(restaurant).length,1);
  s.db.prepare('UPDATE deliveries SET completed_at=? WHERE id=?').run(now-10*day,d.id);s.pruneHistory(now);
  assert.equal(s.restaurantRequests(restaurant).length,0);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM request_emails').get().n,0);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM assignment_emails').get().n,0);
  const publicRequest=request(s,null),publicD=s.createDelivery(admin,{requestId:publicRequest.id,driverId:driver.id});s.updateDelivery(driver,publicD.id,'picked_up');s.updateDelivery(driver,publicD.id,'delivered');s.db.prepare('UPDATE deliveries SET completed_at=? WHERE id=?').run(now-5*day,publicD.id);s.pruneHistory(now);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n,0);
  const pending=request(s,restaurant),ongoing=s.createDelivery(admin,{requestId:pending.id,driverId:driver.id});s.db.prepare('UPDATE deliveries SET created_at=? WHERE id=?').run(now-100*day,ongoing.id);s.pruneHistory(now);assert.equal(s.deliveries(driver).length,1);assert.equal(s.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{s.db.close()}
});
test('Password reset email goes only to registered account, uses fragment and trusted origin, and never contains a password',async()=>{
 const account={name:'<Name>',email:'account@example.test',token:'a'.repeat(96)},config={appUrl:'https://deliveries.example.test',from:'sender@example.test'};
 const message=passwordMessage(account,config);assert.equal(message.to.address,account.email);assert.ok(message.html.includes('&lt;Name&gt;'));assert.ok(message.text.includes('/reset-password#'+account.token));assert.ok(!message.text.includes(password));
 let called=0;const mailer=createPasswordMailer({env:{SMTP_HOST:'smtp.example.test',SMTP_USER:config.from,SMTP_PASSWORD:'test-only',PUBLIC_APP_URL:config.appUrl},send:async m=>{called++;assert.equal(m.to.address,account.email);return {accepted:[account.email]}}});await mailer.send(null);assert.equal(called,0);await mailer.send(account);assert.equal(called,1);
});
