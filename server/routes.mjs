import {Problem} from './core.mjs';
import {priceRoute} from './pricing.mjs';
import {routeInput} from './addresses.mjs';
export {routeInput} from './addresses.mjs';

export async function computeQuote(p,{env=process.env,fetchRoute=fetch}={}) {
  const input=routeInput(p);
  const key=env.GOOGLE_ROUTES_API_KEY?.trim();
  if(!key)throw new Problem(503,'La cotización aún no está disponible. Contacta a ToutAunClicLa / Le calcul du prix n’est pas encore disponible. Contactez ToutAunClicLa');
  let result;
  try {
    const body={origin:{address:input.pickup},destination:{address:input.destination},travelMode:'DRIVE',routingPreference:'TRAFFIC_AWARE_OPTIMAL',computeAlternativeRoutes:false,languageCode:'fr-CA',regionCode:'CA',units:'METRIC'};
    if(input.readyAt&&Date.parse(input.readyAt)>Date.now()+60000)body.departureTime=input.readyAt;
    const response=await fetchRoute('https://routes.googleapis.com/directions/v2:computeRoutes',{
      method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'routes.distanceMeters,routes.duration,routes.staticDuration'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error('Route provider unavailable');
    result=await response.json();
  }catch{throw new Problem(503,'No se pudo calcular la ruta. Revisa las direcciones o vuelve a intentar / Calcul de l’itinéraire indisponible. Vérifiez les adresses ou réessayez');}
  const route=result.routes?.[0];
  const seconds=value=>typeof value==='string'&&/^\d+(\.\d+)?s$/.test(value)?Number(value.slice(0,-1)):NaN;
  try {
    return {...input,...priceRoute({distanceMeters:route?.distanceMeters,durationSeconds:seconds(route?.duration),baselineSeconds:seconds(route?.staticDuration)})};
  }catch{throw new Problem(422,'Aucune route valide trouvée. Vérifiez les adresses / No se encontró una ruta válida. Revisa las direcciones');}
}
