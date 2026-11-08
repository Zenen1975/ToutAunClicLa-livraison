import test from 'node:test';
import assert from 'node:assert/strict';
import {places,parseAddress,placesLimiter} from '../places.mjs';
const common={sessionToken:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',language:'es'};
const parts=[['country','Canada','CA'],['administrative_area_level_1','Québec','QC'],['street_number','123'],['route','Rue Test'],['locality','Longueuil'],['postal_code','j4k1a1']].map(([type,longText,shortText])=>({types:[type],longText,shortText}));
test('Places uses a server key, restricted fields and same session for selection',async()=>{
 const calls=[];const fetchImpl=async(url,options)=>{calls.push({url:String(url),options});return {ok:true,json:async()=>calls.length===1?{suggestions:[{placePrediction:{placeId:'place_1',text:{text:'123 Rue Test'}}}]}:{addressComponents:parts}}};
 const suggestions=await places({...common,input:'123 rue'},false,{key:'private-key',fetchImpl});assert.equal(suggestions[0].id,'place_1');
 const resolved=await places({...common,placeId:suggestions[0].id},true,{key:'private-key',fetchImpl});assert.equal(resolved.postalCode,'J4K 1A1');assert.equal(resolved.address,'123 Rue Test, Longueuil, QC');
 assert.equal(calls[0].options.headers['X-Goog-Api-Key'],'private-key');assert.equal(JSON.parse(calls[0].options.body).sessionToken,common.sessionToken);assert.ok(calls[1].url.includes(common.sessionToken));assert.equal(calls[1].options.headers['X-Goog-FieldMask'],'addressComponents');assert.ok(!JSON.stringify(resolved).includes('private-key'));
});
test('Missing postal remains empty and unsupported regions are rejected',()=>{
 assert.equal(parseAddress(parts.filter(p=>!p.types.includes('postal_code'))).postalCode,'');assert.throws(()=>parseAddress(parts.map(p=>p.types.includes('country')?{...p,shortText:'US'}:p)),{status:400});
});
test('Invalid requests and Google failures never expose upstream errors or keys',async()=>{
 await assert.rejects(places({...common,input:'12'},false,{key:'private-key'}),{status:400});await assert.rejects(places({...common,input:'123 rue'},false,{key:''}),{status:503});
 await assert.rejects(places({...common,input:'123 rue'},false,{key:'private-key',fetchImpl:async()=>({ok:false,json:async()=>({error:'private-key upstream secret'})})}),e=>e.status===503&&!e.message.includes('private-key'));
});
test('Suggestion traffic has client and global limits with automatic reset',()=>{
 const limit=placesLimiter();for(let i=0;i<90;i++)limit('a',100000);assert.throws(()=>limit('a',100000),{status:429});limit('b',100000);limit('a',160001);
 const global=placesLimiter();for(let i=0;i<300;i++)global(String(i),100000);assert.throws(()=>global('other',100000),{status:429});
});
test('Public form and all account roles use one same-origin Places service without exposing credentials',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'tacl-places-'));process.env.DATABASE_PATH=join(dir,'test.sqlite');
 process.env.ASSIGNMENT_EMAIL_ENABLED='false';process.env.REQUEST_EMAIL_ENABLED='false';process.env.QUOTE_EMAIL_ENABLED='false';process.env.PASSWORD_RESET_EMAIL_ENABLED='false';
 const realFetch=globalThis.fetch;const {server}=await import('../server.mjs');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{
  const asset=await realFetch(origin+'/address-suggestions.js');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
  for(const path of ['/','/restaurant','/demander'])assert.match(await (await realFetch(origin+path)).text(),/src="\/address-suggestions.js"/);
  const post=body=>realFetch(origin+'/places/suggestions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({})).status,400);delete process.env.GOOGLE_PLACES_API_KEY;assert.equal((await post({...common,input:'123 rue'})).status,503);
  process.env.GOOGLE_PLACES_API_KEY='test-private-key';globalThis.fetch=async()=>({ok:true,json:async()=>({suggestions:[{placePrediction:{placeId:'fixture',text:{text:'123 Rue Test'}}}]})});
  const response=await post({...common,input:'123 rue'});assert.equal(response.status,200);assert.equal((await response.json()).suggestions[0].id,'fixture');
 }finally{globalThis.fetch=realFetch;delete process.env.GOOGLE_PLACES_API_KEY;await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
