import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../core.mjs';
import {createNativePush} from '../native-push.mjs';
const token='ExpoPushToken[testing_device_123456]';
function setup(){
 const s=createStore(':memory:');
 const a=s.createUser({name:'Admin',email:'admin@test.example',password:'test-password-123',role:'admin'});
 const d=s.createUser({name:'Driver',email:'driver@test.example',password:'test-password-123'});
 const b=s.createUser({name:'Other',email:'other@test.example',password:'test-password-123'});
 const session=s.login(d.email,'test-password-123');
 const {shiftId}=s.start(d,true);s.locate(d,{shiftId,latitude:45.5,longitude:-73.5,accuracy:10,measuredAt:Date.now()});
 const register=()=>s.registerNativePush(d,{token,language:'es'},session.token);
 const assign=()=>s.createDelivery(a,{pickup:'123 Test Street',destination:'456 Test Street',driverId:d.id});
 return {s,a,d,b,session,register,assign};
}
test('Only driver sessions can register; shared phones transfer safely; logout revokes tokens and jobs',()=>{
 const {s,a,d,b,session,register,assign}=setup();
 assert.throws(()=>s.registerNativePush(a,{token,language:'es'},session.token),{status:403});
 assert.throws(()=>s.registerNativePush(d,{token:'https://evil.example',language:'es'},session.token),{status:400});
 register();assign();assert.equal(s.db.prepare('SELECT count(*) AS n FROM native_push_jobs').get().n,1);
 const second=s.login(b.email,'test-password-123');s.registerNativePush(b,{token,language:'fr'},second.token);
 assert.equal(s.db.prepare('SELECT count(*) AS n FROM native_push_jobs').get().n,0);
 s.unregisterNativePush(d,{token},session.token);assert.equal(s.db.prepare('SELECT user_id FROM native_push_tokens').get().user_id,b.id);
 s.logout(b,second.token);assert.equal(s.db.prepare('SELECT count(*) AS n FROM native_push_tokens').get().n,0);s.db.close();
});
test('Assignment durably sends one sound notification and checks receipt without resending',async()=>{
 const {s,register,assign}=setup();register();const delivery=assign();let clock=Date.now();const calls=[];
 const worker=createNativePush(s,{now:()=>clock,fetchImpl:async(url,options)=>{
  calls.push({url,p:JSON.parse(options.body)});return {ok:true,json:async()=>({data:url.endsWith('send')?{status:'ok',id:'ticket-1'}:{'ticket-1':{status:'ok'}}})};
 }});
 await worker.flush();assert.equal(calls.length,1);assert.equal(calls[0].p.to,token);assert.equal(calls[0].p.sound,'assignment_jingle.wav');assert.equal(calls[0].p.channelId,'deliveries-v1');assert.equal(calls[0].p.data.deliveryId,delivery.id);
 await worker.flush();assert.equal(calls.length,1);clock+=900001;await worker.flush();assert.equal(calls.length,2);assert.ok(calls[1].url.endsWith('getReceipts'));assert.ok(s.db.prepare('SELECT processed_at FROM native_push_jobs').get().processed_at);s.db.close();
});
test('Network failures retry; invalid devices are removed; completed deliveries do not alert',async()=>{
 const {s,d,register,assign}=setup();register();const delivery=assign();let clock=Date.now();let fail=true;
 const worker=createNativePush(s,{now:()=>clock,fetchImpl:async()=>{if(fail)throw Error('offline');return {ok:true,json:async()=>({data:{status:'error',details:{error:'DeviceNotRegistered'}}})}}});
 await worker.flush();assert.equal(s.db.prepare('SELECT attempts FROM native_push_jobs').get().attempts,1);
 clock+=15001;fail=false;await worker.flush();assert.equal(s.db.prepare('SELECT count(*) AS n FROM native_push_tokens').get().n,0);
 register();s.db.prepare('INSERT INTO native_push_jobs(delivery_id,token,created_at,next_attempt_at) VALUES(?,?,?,?)').run(delivery.id,token,clock,clock);
 s.updateDelivery(d,delivery.id,'picked_up');let calls=0;
 await createNativePush(s,{now:()=>clock,fetchImpl:async()=>{calls++;}}).flush();assert.equal(calls,0);s.db.close();
});
test('Expired sessions are removed before any notification is sent',async()=>{
 const {s,register,assign}=setup();register();assign();s.db.exec('UPDATE sessions SET expires=0');let calls=0;
 await createNativePush(s,{fetchImpl:async()=>{calls++;}}).flush();assert.equal(calls,0);assert.equal(s.db.prepare('SELECT count(*) AS n FROM native_push_tokens').get().n,0);s.db.close();
});
