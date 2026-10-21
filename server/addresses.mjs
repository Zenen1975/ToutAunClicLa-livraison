const invalid=message=>Object.assign(Error(message),{status:400});
export function postalCode(value) {
  if(typeof value!=='string'||!/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test(value.trim()))throw invalid('Código postal obligatorio, formato H2X 1Y4 / Code postal obligatoire, format H2X 1Y4');
  const compact=value.trim().replace(/\s/g,'').toUpperCase();
  return compact.slice(0,3)+' '+compact.slice(3);
}
export function routeInput(p) {
  const postals={pickupPostalCode:postalCode(p.pickupPostalCode),destinationPostalCode:postalCode(p.destinationPostalCode)};
  const addresses={};
  for(const key of ['pickup','destination']){
    if(typeof p[key]!=='string'||!p[key].trim()||p[key].length>500)throw invalid('Direcciones completas obligatorias / Adresses complètes obligatoires');
    const address=p[key].trim(),postal=postals[key+'PostalCode'];
    addresses[key]=address.toUpperCase().replace(/\s/g,'').endsWith(postal.replace(/\s/g,''))?address:address+', '+postal;
  }
  const ready=p.readyAt??'';
  if(typeof ready!=='string'||(ready&&(!Number.isFinite(Date.parse(ready))||Date.parse(ready)<Date.now()-900000||Date.parse(ready)>Date.now()+30*86400000)))throw invalid('Fecha de recogida incorrecta / Date de collecte invalide');
  return {...addresses,...postals,readyAt:ready?new Date(ready).toISOString():''};
}
