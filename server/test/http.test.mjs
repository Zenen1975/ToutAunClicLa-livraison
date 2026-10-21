import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../core.mjs';

test('Driver web routes, consent, GPS and delivery authorization work over HTTP',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'tacl-http-'));
  process.env.DATABASE_PATH=join(dir,'test.sqlite');
  const store=createStore(process.env.DATABASE_PATH);
  const password='test-password-123';
  const admin=store.createUser({name:'Admin',email:'admin@example.test',password,role:'admin'});
  const a=store.createUser({name:'Driver A',email:'a@example.test',password});
  store.createUser({name:'Driver B',email:'b@example.test',password});
  process.env.ASSIGNMENT_EMAIL_ENABLED='false'; // Tests must never send real mail, including during Render builds.
  const {server}=await import('../server.mjs');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function api(path,token,body,method=body?'POST':'GET'){
    const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+(token||''),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};
  }
  try{
    for(const path of ['/livreur','/livreur/','/repartidor']){const r=await fetch(base+path);assert.equal(r.status,200);assert.match(await r.text(),/id="consent"/)}
    const audio=await fetch(base+'/assignment-jingle.mp3');
    assert.equal(audio.status,200);
    assert.equal(audio.headers.get('content-type'),'audio/mpeg');
    const bytes=new Uint8Array(await audio.arrayBuffer());
    assert.ok(bytes.length>1000);
    const range=await fetch(base+'/assignment-jingle.mp3',{headers:{Range:'bytes=0-99'}});
    assert.equal(range.status,206);
    assert.equal(range.headers.get('content-range'),'bytes 0-99/'+bytes.length);
    assert.deepEqual(new Uint8Array(await range.arrayBuffer()),bytes.slice(0,100));
    const head=await fetch(base+'/assignment-jingle.mp3',{method:'HEAD'});
    assert.equal(head.status,200);
    assert.equal(head.headers.get('content-length'),String(bytes.length));
    assert.equal((await head.arrayBuffer()).byteLength,0);
    const invalid=await fetch(base+'/assignment-jingle.mp3',{headers:{Range:'bytes=9999999-'}});
    assert.equal(invalid.status,416);
    assert.equal((await api('/deliveries')).status,401);
    assert.equal((await api('/email/check',null,{})).status,401);
    const at=(await api('/login',null,{email:admin.email,password})).data.token;
    const dt=(await api('/login',null,{email:a.email,password})).data.token;
    const bt=(await api('/login',null,{email:'b@example.test',password})).data.token;
    assert.equal((await api('/shift/start',dt,{consent:false})).status,400);
    assert.equal((await api('/email/check',dt,{})).status,403);
    const check=await api('/email/check',at,{});
    assert.equal(check.data.code,'email_disabled');
    assert.ok(!JSON.stringify(check.data).includes('SMTP_PASSWORD'));
    assert.equal((await api('/email/check',at,{})).status,429);
    const shift=(await api('/shift/start',dt,{consent:true})).data.shiftId;
    assert.equal((await api('/location',dt,{shiftId:shift,latitude:45.5,longitude:-73.56,accuracy:8,measuredAt:Date.now()})).status,200);
    assert.equal((await api('/drivers',dt)).status,403);
    const route={pickup:'Montréal',destination:'Longueuil',pickupPostalCode:'H2X 1Y4',destinationPostalCode:'J4K 1A1'};
    const quote=store.saveQuote({...route,distanceMeters:5000,durationSeconds:1200,baselineSeconds:1200});
    const delivery=(await api('/deliveries',at,{...route,quoteId:quote.quoteId,acceptPrice:true,driverId:a.id})).data;
    assert.equal((await api('/deliveries',dt)).data.length,1);
    assert.equal((await api('/deliveries',bt)).data.length,0);
    assert.equal((await api('/deliveries/'+delivery.id,bt,{status:'picked_up'},'PATCH')).status,403);
    assert.equal((await api('/deliveries/'+delivery.id,dt,{status:'picked_up'},'PATCH')).status,200);
    assert.equal((await api('/deliveries/'+delivery.id,dt,{status:'delivered'},'PATCH')).status,200);
    await api('/shift/stop',dt,{});
    const driver=(await api('/drivers',at)).data[0];assert.equal(driver.status,'offline');assert.equal(driver.latitude,null);
    assert.equal((await api('/location',dt,{shiftId:shift,latitude:45.5,longitude:-73.56,accuracy:8,measuredAt:Date.now()})).status,409);
  }finally{await new Promise(resolve=>server.close(resolve));store.db.close();rmSync(dir,{recursive:true,force:true})}
});
