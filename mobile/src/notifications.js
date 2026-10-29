import {Platform} from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import {request} from './api';
const TOKEN='tacl-push-token';
export const CHANNEL='deliveries-v1';
Notifications.setNotificationHandler({handleNotification:async()=>({shouldPlaySound:true,shouldSetBadge:false,shouldShowBanner:true,shouldShowList:true})});
export async function registerNotifications(language,ask=true){
  if(Platform.OS==='android')await Notifications.setNotificationChannelAsync(CHANNEL,{
    name:'Livraisons / Entregas',importance:Notifications.AndroidImportance.MAX,
    sound:'assignment_jingle.wav',vibrationPattern:[0,400,200,400],lockscreenVisibility:Notifications.AndroidNotificationVisibility.PRIVATE
  });
  let permission=await Notifications.getPermissionsAsync();
  if(!permission.granted&&ask&&permission.canAskAgain)permission=await Notifications.requestPermissionsAsync();
  if(!permission.granted){
    const old=await SecureStore.getItemAsync(TOKEN);
    if(old)await request('/driver/native-push/unregister','POST',{token:old});
    return false;
  }
  const projectId=Constants.expoConfig?.extra?.eas?.projectId||Constants.easConfig?.projectId;
  if(!projectId)throw Error('Falta configurar Expo / Configuration Expo manquante');
  const token=(await Notifications.getExpoPushTokenAsync({projectId})).data;
  await SecureStore.setItemAsync(TOKEN,token);
  await request('/driver/native-push/register','POST',{token,language});
  return true;
}
export async function testNotification(language){
  const es=language==='es';
  await Notifications.scheduleNotificationAsync({content:{title:es?'Prueba de sonido':'Test du son',
    body:es?'Así sonará una nueva entrega.':'Voici le son d’une nouvelle livraison.',sound:'assignment_jingle.wav'},
    trigger:{type:Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,seconds:5,channelId:CHANNEL}});
}
export function onDeliveryNotification(callback){
  const received=Notifications.addNotificationReceivedListener(callback);
  const response=Notifications.addNotificationResponseReceivedListener(callback);
  return ()=>{received.remove();response.remove();};
}
