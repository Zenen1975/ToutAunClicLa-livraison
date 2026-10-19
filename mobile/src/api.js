import * as SecureStore from 'expo-secure-store';
export const API_URL=(process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/,'');
export const SESSION='tacl-session', SHIFT='tacl-shift', LAST='tacl-gps', ERROR='tacl-gps-error';
export async function request(path,method='GET',body,explicitToken) {
  if(!API_URL.startsWith('https://'))throw Error('Falta configurar el servidor HTTPS / Configurez le serveur HTTPS');
  const token=explicitToken || await SecureStore.getItemAsync(SESSION);
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
  try {
    const r=await fetch(API_URL+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token || '')},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
    const p=await r.json();if(!r.ok){const e=Error(p.error || 'Error de connexion');e.status=r.status;throw e;}return p;
  }finally{clearTimeout(timer)}
}
