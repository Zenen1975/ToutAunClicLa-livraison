import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import {request,SESSION,SHIFT,LAST,ERROR} from './api';
export const TASK='tacl-background-location-v1';
const put=(key,value)=>SecureStore.setItemAsync(key,value,{keychainAccessible:SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY});
export async function sendPosition(location) {
  const shiftId=await SecureStore.getItemAsync(SHIFT);
  if(!shiftId)return;
  const p=location.coords;
  await request('/location','POST',{shiftId,latitude:p.latitude,longitude:p.longitude,accuracy:p.accuracy ?? 9999,measuredAt:location.timestamp});
  await put(LAST,JSON.stringify({latitude:p.latitude,longitude:p.longitude,accuracy:p.accuracy,measuredAt:location.timestamp,sentAt:Date.now()}));
  await SecureStore.deleteItemAsync(ERROR);
}
TaskManager.defineTask(TASK,async({data,error})=>{
  try {
    if(error)throw error;
    const positions=data?.locations || [];
    const latest=positions.sort((a,b)=>b.timestamp-a.timestamp)[0];
    if(latest)await sendPosition(latest);
  }catch(e){
    await put(ERROR,JSON.stringify({message:e.message,at:Date.now()}));
    if(e.status===401 || e.status===409){await SecureStore.deleteItemAsync(SHIFT);if(await Location.hasStartedLocationUpdatesAsync(TASK))await Location.stopLocationUpdatesAsync(TASK);}
  }
});
export async function startSharing() {
  const fg=await Location.requestForegroundPermissionsAsync();
  if(fg.status!=='granted')throw Error('Autoriza la ubicación en Ajustes / Autorisez la position dans les réglages');
  const bg=await Location.requestBackgroundPermissionsAsync();
  if(bg.status!=='granted')throw Error('Activa la ubicación en segundo plano en Ajustes / Autorisez la position en arrière-plan dans les réglages');
  if(!await Location.hasServicesEnabledAsync())throw Error('Activa el GPS / Activez le GPS');
  if(!await TaskManager.isAvailableAsync())throw Error('Necesitas una compilación instalada / Une version installée est nécessaire');
  if(await Location.hasStartedLocationUpdatesAsync(TASK))await Location.stopLocationUpdatesAsync(TASK);
  // Rotating the server shift invalidates any delayed update from a previous shift.
  const {shiftId}=await request('/shift/start','POST',{consent:true});
  await put(SHIFT,shiftId);await SecureStore.deleteItemAsync(LAST);
  try {
    await Location.startLocationUpdatesAsync(TASK,{
      accuracy:Location.Accuracy.High,distanceInterval:15,timeInterval:12000,
      pausesUpdatesAutomatically:false,showsBackgroundLocationIndicator:true,
      foregroundService:{notificationTitle:'ToutAunClicLa · Livraison',notificationBody:'Position partagée pendant le service / Ubicación compartida durante el turno',killServiceOnDestroy:true}
    });
    await sendPosition(await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High}));
  }catch(e){await stopSharing().catch(()=>{});throw e;}
}
export async function stopSharing() {
  // Remove local authorization first, even if the server is unreachable.
  await SecureStore.deleteItemAsync(SHIFT);
  await SecureStore.deleteItemAsync(LAST);
  let stopError;
  try{if(await Location.hasStartedLocationUpdatesAsync(TASK))await Location.stopLocationUpdatesAsync(TASK);}catch(e){stopError=e;}
  await request('/shift/stop','POST',{});
  if(stopError)throw stopError;
}
export async function trackingState() {
  const shift=await SecureStore.getItemAsync(SHIFT);
  const fg=await Location.getForegroundPermissionsAsync(),bg=await Location.getBackgroundPermissionsAsync();
  if(shift&&(fg.status!=='granted'||bg.status!=='granted'||!await Location.hasServicesEnabledAsync())){
    await stopSharing().catch(()=>{});return {sharing:false,last:null,error:'GPS desactivado / GPS désactivé'};
  }
  const started=await Location.hasStartedLocationUpdatesAsync(TASK);
  return {sharing:!!shift&&started,last:JSON.parse(await SecureStore.getItemAsync(LAST)||'null'),error:JSON.parse(await SecureStore.getItemAsync(ERROR)||'null')?.message};
}
export async function saveToken(token){await put(SESSION,token)}
