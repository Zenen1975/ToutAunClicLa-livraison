import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const keys={SESSION:'session',SHIFT:'shift',LAST:'last',ERROR:'error'};
let sequence=0;
async function fixture({shift='active-shift',running=false,last=null}={}){
 const memory=new Map([[keys.SESSION,'session-token']]);if(shift)memory.set(keys.SHIFT,shift);if(last)memory.set(keys.LAST,JSON.stringify(last));
 const events=[];let task;const state={running,online:true,gps:true,permitted:true,position:null,positionError:null,httpError:null};
 const position=()=>({coords:{latitude:45.5,longitude:-73.5,accuracy:10},timestamp:Date.now()});
 const permission=async()=>({status:state.permitted?'granted':'denied'});
 const SecureStore={getItemAsync:async k=>memory.get(k)||null,setItemAsync:async(k,v)=>{memory.set(k,v)},deleteItemAsync:async k=>{memory.delete(k)},AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:1};
 const Location={Accuracy:{High:4},getForegroundPermissionsAsync:permission,getBackgroundPermissionsAsync:permission,
 requestForegroundPermissionsAsync:async()=>{events.push('prompt');return permission()},requestBackgroundPermissionsAsync:async()=>{events.push('prompt');return permission()},
 hasServicesEnabledAsync:async()=>state.gps,hasStartedLocationUpdatesAsync:async()=>state.running,
 startLocationUpdatesAsync:async(_,options)=>{events.push({start:options});state.running=true},stopLocationUpdatesAsync:async()=>{events.push('stop');state.running=false},
 getCurrentPositionAsync:async()=>{events.push('gps');if(state.positionError)throw state.positionError;return state.position?await state.position:position()}};
 const request=async(path,method,p)=>{events.push({path,p});if(!state.online)throw Error('offline');if(state.httpError&&path==='/location')throw state.httpError;return path==='/shift/start'?{shiftId:'new-shift'}:{ok:true}};
 const TaskManager={isAvailableAsync:async()=>true,defineTask:(_,fn)=>{task=fn}};
 const slot='tracking-test-'+sequence++;globalThis[slot]={Location,TaskManager,SecureStore,request,...keys};
 let source=await readFile(new URL('../src/tracking.js',import.meta.url),'utf8');
 source=source.replace(/^import .*;\n/gm,'');source=`const {Location,TaskManager,SecureStore,request,SESSION,SHIFT,LAST,ERROR}=globalThis[${JSON.stringify(slot)}];\n`+source;
 const mod=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));delete globalThis[slot];
 return {mod,memory,state,events,task:()=>task,position};
}
const uploads=f=>f.events.filter(e=>e.path==='/location');
test('Opening an active shift restores native tracking and uploads fresh GPS without creating another shift',async()=>{
 const f=await fixture();await f.mod.resumeSharing({force:true});
 assert.equal(f.state.running,true);assert.equal(uploads(f).length,1);assert.equal(uploads(f)[0].p.shiftId,'active-shift');
 assert.equal(f.events.some(e=>e.path==='/shift/start'||e==='prompt'),false);
 assert.ok(JSON.parse(f.memory.get(keys.LAST)).sentAt);assert.equal((await f.mod.trackingState()).sharing,true);
});
test('Ending a shift prevents reopening, timers and delayed background fixes from resuming it',async()=>{
 const f=await fixture({running:true});await f.mod.stopSharing();await f.mod.resumeSharing({force:true});await f.task()({data:{locations:[f.position()]}});
 assert.equal(f.state.running,false);assert.equal(f.memory.has(keys.SHIFT),false);assert.equal(uploads(f).length,0);
});
test('No network and GPS failures preserve the shift; another automatic attempt recovers',async()=>{
 const f=await fixture();f.state.online=false;await f.mod.resumeSharing({force:true});assert.equal(f.memory.get(keys.SHIFT),'active-shift');assert.match((await f.mod.trackingState()).error,/offline/);
 f.state.online=true;f.state.gps=false;await f.mod.resumeSharing();assert.equal(f.memory.get(keys.SHIFT),'active-shift');
 f.state.gps=true;f.state.positionError=Error('No GPS fix');await f.mod.resumeSharing();assert.equal(f.memory.get(keys.SHIFT),'active-shift');
 f.state.positionError=null;await f.mod.resumeSharing();assert.equal(f.state.running,true);assert.equal(f.memory.has(keys.ERROR),false);
});
test('Background GPS callbacks retry after coverage returns and request stationary updates',async()=>{
 const f=await fixture();await f.mod.resumeSharing();const options=f.events.find(e=>e.start).start;assert.equal(options.distanceInterval,0);assert.equal(options.timeInterval,15000);
 f.state.online=false;await f.task()({data:{locations:[f.position()]}});assert.equal(f.memory.get(keys.SHIFT),'active-shift');
 f.state.online=true;await f.task()({data:{locations:[f.position()]}});assert.equal(f.memory.has(keys.ERROR),false);assert.ok(f.memory.get(keys.LAST));
});
test('Server rejection of an expired or superseded shift clears local tracking without reopening consent',async()=>{
 for(const status of [401,409]){const f=await fixture({running:true});f.state.httpError=Object.assign(Error('revoked'),{status});await f.mod.resumeSharing({force:true});assert.equal(f.memory.has(keys.SHIFT),false);assert.equal(f.state.running,false);assert.equal(f.events.some(e=>e.path==='/shift/start'),false);}
});
test('Manual stop cancels an in-flight GPS recovery; duplicate resume requests share one attempt',async()=>{
 const f=await fixture();let release;f.state.position=new Promise(resolve=>{release=resolve});
 const first=f.mod.resumeSharing({force:true});const second=f.mod.resumeSharing({force:true});assert.equal(first,second);
 while(!f.events.includes('gps'))await new Promise(resolve=>setImmediate(resolve));
 const stop=f.mod.stopSharing();release(f.position());await Promise.all([first,stop]);
 assert.equal(uploads(f).length,0);assert.equal(f.state.running,false);assert.equal(f.memory.has(keys.SHIFT),false);
});
test('State reads preserve service intent; missing permissions never trigger prompts automatically',async()=>{
 const f=await fixture();f.state.permitted=false;assert.equal((await f.mod.trackingState()).sharing,true);await f.mod.resumeSharing();assert.equal(f.memory.get(keys.SHIFT),'active-shift');assert.equal(f.events.includes('prompt'),false);assert.equal(f.state.running,false);
 f.state.permitted=true;await f.mod.resumeSharing();assert.equal(f.state.running,true);
});
test('Stale registered service is restarted; a recent service is not churned by timer retries',async()=>{
 const f=await fixture({running:true,last:{sentAt:Date.now()-100000,measuredAt:Date.now()-100000}});await f.mod.resumeSharing();assert.ok(f.events.includes('stop'));assert.equal(uploads(f).length,1);
 const before=f.events.length;await f.mod.resumeSharing();assert.equal(f.events.length,before);
});
