import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import {request,SESSION,SHIFT,LAST,ERROR} from './api';
export const TASK='tacl-background-location-v1';
const put=(key,value)=>SecureStore.setItemAsync(key,value,{keychainAccessible:SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY});
const options={
  accuracy:Location.Accuracy.High,distanceInterval:0,timeInterval:15000,
  pausesUpdatesAutomatically:false,showsBackgroundLocationIndicator:true,
  foregroundService:{notificationTitle:'ToutAunClicLa · Livraison',notificationBody:'Position partagée pendant le service / Ubicación compartida durante el turno',killServiceOnDestroy:true}
};
// Serialize native service changes. A manual stop cancels any recovery already in flight.
let queue=Promise.resolve(),revision=0,recovery=null,recoveryRevision=-1;
const serial=fn=>{const next=queue.then(fn,fn);queue=next.catch(()=>{});return next;};
async function stopLocal(){if(await Location.hasStartedLocationUpdatesAsync(TASK))await Location.stopLocationUpdatesAsync(TASK);}
async function clearShift(){await SecureStore.deleteItemAsync(SHIFT);await SecureStore.deleteItemAsync(LAST);await stopLocal();}
async function failure(e,shift){
  if(!shift||await SecureStore.getItemAsync(SHIFT)!==shift)return;
  await put(ERROR,JSON.stringify({message:e.message,at:Date.now()}));
  if(e.status===401||e.status===409)await clearShift();
}
async function permissions(ask=false){
  const fg=await (ask?Location.requestForegroundPermissionsAsync():Location.getForegroundPermissionsAsync());
  if(fg.status!=='granted')throw Error('Autoriza la ubicación en Ajustes / Autorisez la position dans les réglages');
  const bg=await (ask?Location.requestBackgroundPermissionsAsync():Location.getBackgroundPermissionsAsync());
  if(bg.status!=='granted')throw Error('Activa la ubicación en segundo plano en Ajustes / Autorisez la position en arrière-plan dans les réglages');
  if(!await Location.hasServicesEnabledAsync())throw Error('Activa el GPS / Activez le GPS');
  if(!await TaskManager.isAvailableAsync())throw Error('Necesitas una compilación instalada / Une version installée est nécessaire');
}
async function currentPosition(){
  let timer;
  try{return await Promise.race([
    Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High}),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Esperando señal GPS. Se reintentará / Signal GPS en attente. Nouvel essai prévu')),15000);})
  ]);}finally{clearTimeout(timer);}
}
export async function sendPosition(location,expectedShift){
  const shiftId=expectedShift||await SecureStore.getItemAsync(SHIFT);
  if(!shiftId||await SecureStore.getItemAsync(SHIFT)!==shiftId)return;
  const p=location.coords;
  await request('/location','POST',{shiftId,latitude:p.latitude,longitude:p.longitude,accuracy:p.accuracy??9999,measuredAt:location.timestamp});
  if(await SecureStore.getItemAsync(SHIFT)!==shiftId)return;
  const previous=JSON.parse(await SecureStore.getItemAsync(LAST)||'null');
  if(previous&&previous.measuredAt>location.timestamp)return;
  await put(LAST,JSON.stringify({latitude:p.latitude,longitude:p.longitude,accuracy:p.accuracy,measuredAt:location.timestamp,sentAt:Date.now()}));
  await SecureStore.deleteItemAsync(ERROR);
}
TaskManager.defineTask(TASK,async({data,error})=>{
  const shift=await SecureStore.getItemAsync(SHIFT);
  try{
    if(error)throw error;
    const latest=[...(data?.locations||[])].sort((a,b)=>b.timestamp-a.timestamp)[0];
    if(latest)await sendPosition(latest,shift);
  }catch(e){await serial(()=>failure(e,shift));}
});
export function startSharing(){
  const rev=++revision;
  return serial(async()=>{
    await permissions(true);if(rev!==revision)return;
    await stopLocal();if(rev!==revision)return;
    const {shiftId}=await request('/shift/start','POST',{consent:true});
    await put(SHIFT,shiftId);await SecureStore.deleteItemAsync(LAST);
    if(rev!==revision)return; // A queued manual stop will revoke this shift.
    try{
      await Location.startLocationUpdatesAsync(TASK,options);
      const position=await currentPosition();if(rev===revision)await sendPosition(position,shiftId);
    }catch(e){
      // GPS/network interruptions must not discard the user's active shift.
      await failure(e,shiftId);throw e;
    }
  });
}
export function stopSharing(){
  ++revision;
  return serial(async()=>{
    await SecureStore.deleteItemAsync(SHIFT);await SecureStore.deleteItemAsync(LAST);await SecureStore.deleteItemAsync(ERROR);
    let stopError;try{await stopLocal();}catch(e){stopError=e;}
    await request('/shift/stop','POST',{});if(stopError)throw stopError;
  });
}
export function resumeSharing({force=false}={}){
  if(recovery&&recoveryRevision===revision)return recovery;
  const rev=revision;recoveryRevision=rev;
  const attempt=serial(async()=>{
    const shift=await SecureStore.getItemAsync(SHIFT);
    if(!shift||!await SecureStore.getItemAsync(SESSION)||rev!==revision)return;
    try{
      await permissions();if(rev!==revision)return;
      const started=await Location.hasStartedLocationUpdatesAsync(TASK);
      const last=JSON.parse(await SecureStore.getItemAsync(LAST)||'null');
      const stale=!last||Date.now()-last.sentAt>=60000||Date.now()-last.measuredAt>=60000;
      if(!force&&started&&!stale&&!await SecureStore.getItemAsync(ERROR))return;
      // A fresh upload first validates the saved server shift. Never create a new shift here.
      const position=await currentPosition();if(rev!==revision)return;
      await sendPosition(position,shift);if(rev!==revision)return;
      if(!started||stale){
        if(started)await stopLocal();if(rev!==revision)return;
        await Location.startLocationUpdatesAsync(TASK,options);
      }
    }catch(e){if(rev===revision)await failure(e,shift);}
  });
  recovery=attempt;
  void attempt.finally(()=>{if(recovery===attempt)recovery=null;}).catch(()=>{});
  return attempt;
}
export async function trackingState(){
  const shift=await SecureStore.getItemAsync(SHIFT);
  const running=await Location.hasStartedLocationUpdatesAsync(TASK);
  // Reading state must not erase a shift during temporary GPS/permission/network interruptions.
  return {sharing:!!shift,running:!!shift&&running,last:JSON.parse(await SecureStore.getItemAsync(LAST)||'null'),error:JSON.parse(await SecureStore.getItemAsync(ERROR)||'null')?.message};
}
export async function saveToken(token){await put(SESSION,token);}
