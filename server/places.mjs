const problem=(status,message)=>Object.assign(new Error(message),{status});
const unavailable=()=>problem(503,'Sugerencias no disponibles; escribe la dirección manualmente / Suggestions indisponibles; saisissez l’adresse manuellement');
export function validatePlaceInput(p,details=false){
 if(typeof p.sessionToken!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.sessionToken)||!['fr','es'].includes(p.language))throw problem(400,'Solicitud incorrecta / Demande invalide');
 const value=details?p.placeId:p.input;
 if(typeof value!=='string'||(details?!/^[A-Za-z0-9_-]{1,255}$/.test(value):value.trim().length<3||value.length>200))throw problem(400,'Solicitud incorrecta / Demande invalide');
 return {...p,input:p.input?.trim()};
}
export function parseAddress(parts=[]){
 const get=(type,short=false)=>{const c=parts.find(p=>p.types?.includes(type));return (short?c?.shortText:c?.longText)||''};
 if(get('country',true)!=='CA'||get('administrative_area_level_1',true)!=='QC')throw problem(400,'Selecciona una dirección de Québec / Choisissez une adresse au Québec');
 const street=[get('street_number'),get('route')].filter(Boolean).join(' ');
 if(!street)throw problem(400,'Completa la calle manualmente / Complétez la rue manuellement');
 const city=get('locality')||get('postal_town')||get('sublocality_level_1')||get('administrative_area_level_3');
 const compact=get('postal_code').replace(/\s/g,'').toUpperCase();
 return {address:[street,city,'QC'].filter(Boolean).join(', '),city,province:'Quebec',postalCode:/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)?compact.slice(0,3)+' '+compact.slice(3):''};
}
export async function places(p,details=false,{key=process.env.GOOGLE_PLACES_API_KEY,fetchImpl=globalThis.fetch}={}){
 validatePlaceInput(p,details);if(!key?.trim())throw unavailable();
 const headers={'Content-Type':'application/json','X-Goog-Api-Key':key.trim()};let url,options;
 if(details){url=new URL('https://places.googleapis.com/v1/places/'+encodeURIComponent(p.placeId));url.searchParams.set('sessionToken',p.sessionToken);url.searchParams.set('languageCode',p.language);headers['X-Goog-FieldMask']='addressComponents';options={headers};}
 else{url='https://places.googleapis.com/v1/places:autocomplete';headers['X-Goog-FieldMask']='suggestions.placePrediction.placeId,suggestions.placePrediction.text';options={method:'POST',headers,body:JSON.stringify({input:p.input.trim(),sessionToken:p.sessionToken,languageCode:p.language,regionCode:'ca',includedRegionCodes:['ca'],locationBias:{circle:{center:{latitude:45.5,longitude:-73.6},radius:50000}}})};}
 let data;try{const response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(6000)});if(!response.ok)throw unavailable();data=await response.json();}catch{throw unavailable();}
 return details?parseAddress(data.addressComponents):(data.suggestions||[]).flatMap(s=>s.placePrediction?.placeId?[{id:s.placePrediction.placeId,label:s.placePrediction.text?.text||''}]:[]).slice(0,5);
}
export function placesLimiter(){
 const clients=new Map();let windowStart=0,total=0;
 return (client,now=Date.now())=>{
  if(now-windowStart>=60000){clients.clear();windowStart=now;total=0;}
  const count=(clients.get(client)||0)+1;clients.set(client,count);
  if(++total>300||count>90)throw problem(429,'Espera un minuto / Attendez une minute');
 };
}
