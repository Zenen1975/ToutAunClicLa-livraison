import http from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createStore,Problem} from './core.mjs';
import {createAssignmentMailer} from './assignment-mail.mjs';
import {checkEmail} from './email-check.mjs';
import {computeQuote} from './routes.mjs';
import {createRequestMailer} from './request-mail.mjs';
import {createPasswordMailer} from './password-mail.mjs';
import {createQuoteMailer} from './quote-mail.mjs';
import {checkout,paymentConfig,verifyStripeEvent} from './payments.mjs';
const store=createStore(process.env.DATABASE_PATH || 'livraison.sqlite');
const mailer=createAssignmentMailer(store);
const requestMailer=createRequestMailer(store);
const quoteMailer=createQuoteMailer(store);
const passwordMailer=createPasswordMailer();
let retentionTimer;
const securityAttempts=new Map();
const page=readFileSync(new URL('./public/index.html',import.meta.url));
const driverPage=readFileSync(new URL('./public/livreur.html',import.meta.url));
const requestPage=readFileSync(new URL('./public/demander.html',import.meta.url));
const accountPages=Object.fromEntries(['forgot-password','reset-password','restaurant'].map(name=>['/'+name,readFileSync(new URL('./public/'+name+'.html',import.meta.url))]));
const termsPage=readFileSync(new URL('./public/conditions-2026-10-23-v1.html',import.meta.url));
const jingle=readFileSync(new URL('./public/assignment-jingle.mp3',import.meta.url));
const driverPortrait=readFileSync(new URL('./public/livreur-team-v1.webp',import.meta.url));
const attempts=new Map();
const requestAttempts=new Map();
let requestWindow={start:Date.now(),count:0};
let nextEmailCheck=0;
export const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET'&&accountPages[path.replace(/\/$/,'')]){res.setHeader('Referrer-Policy','no-referrer');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(accountPages[path.replace(/\/$/,'')]);return;}
    if(req.method==='GET'&&path==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(page);return;}
    if(req.method==='GET'&&['/livreur','/livreur/','/repartidor','/repartidor/'].includes(path)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(driverPage);return;}
    if(req.method==='GET'&&['/demander','/demander/','/solicitar','/solicitar/'].includes(path)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(requestPage);return;}
    if(['GET','HEAD'].includes(req.method)&&path==='/assignment-jingle.mp3'){
      const headers={'Content-Type':'audio/mpeg','Accept-Ranges':'bytes','Cache-Control':'public, max-age=86400'};
      let start=0,end=jingle.length-1,status=200;
      if(req.headers.range){
        const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        if(!match||Number(match[1])>=jingle.length||Number(match[1])>Number(match[2]||end)){
          res.writeHead(416,{...headers,'Content-Range':'bytes */'+jingle.length});res.end();return;
        }
        start=Number(match[1]);end=Math.min(Number(match[2]||end),end);status=206;
        headers['Content-Range']='bytes '+start+'-'+end+'/'+jingle.length;
      }
      headers['Content-Length']=end-start+1;
      res.writeHead(status,headers);res.end(req.method==='HEAD'?undefined:jingle.subarray(start,end+1));return;
    }
    if(['GET','HEAD'].includes(req.method)&&path==='/livreur-team-v1.webp'){res.writeHead(200,{'Content-Type':'image/webp','Content-Length':driverPortrait.length,'Cache-Control':'public, max-age=86400'});res.end(req.method==='HEAD'?undefined:driverPortrait);return;}
    if(req.method==='GET'&&['/conditions','/terms/2026-10-23-v1'].includes(path)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(termsPage);return;}
    if(req.method==='GET'&&path==='/health'){send(200,{ok:true});return;}
    if(req.method==='POST'&&path==='/stripe/webhook'){
      const config=paymentConfig();const chunks=[];let length=0;
      for await(const chunk of req){length+=chunk.length;if(length>1048576)throw new Problem(413,'Evento demasiado grande');chunks.push(chunk)}
      const event=verifyStripeEvent(Buffer.concat(chunks),req.headers['stripe-signature'],config);
      if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&event.data?.object?.payment_status==='paid'){
        store.confirmPayment(event.data.object);void requestMailer.flush();
      }
      send(200,{received:true});return;
    }
    let p={};
    if(['POST','PATCH'].includes(req.method)) {
      let raw=''; for await (const chunk of req){raw+=chunk; if(Buffer.byteLength(raw)>16384)throw new Problem(413,'Solicitud demasiado grande');}
      try {p=JSON.parse(raw || '{}');}catch{throw new Problem(400,'JSON incorrecto');}
      if(!p || typeof p!=='object'||Array.isArray(p))throw new Problem(400,'JSON incorrecto');
    }
    if(req.method==='POST'&&['/password/forgot','/password/reset'].includes(path)){
      const now=Date.now(),key=req.socket.remoteAddress;
      for(const [k,v]of securityAttempts)if(now-v.start>600000)securityAttempts.delete(k);
      let a=securityAttempts.get(key);if(!a){a={start:now,count:0};securityAttempts.set(key,a)}
      if(++a.count>60)throw new Problem(429,'Espera antes de reintentar / Attendez avant de réessayer');
      if(path==='/password/forgot'){
        const account=store.preparePasswordReset(p.email);
        send(200,{ok:true});void passwordMailer.send(account);
      }else send(200,store.resetPassword(p.token,p.password));
      return;
    }
    if(req.method==='POST'&&path==='/login') {
      const key=req.socket.remoteAddress; const now=Date.now();
      if(attempts.size>10000)for(const [k,v]of attempts)if(now-v.start>600000)attempts.delete(k);
      let a=attempts.get(key); if(!a||now-a.start>600000){a={start:now,count:0};attempts.set(key,a);}
      if(++a.count>20)throw new Problem(429,'Demasiados intentos. Espera 10 minutos / Trop de tentatives');
      send(200,store.login(p.email,p.password));return;
    }
    if(req.method==='POST'&&['/requests','/quotes'].includes(path)){
      if(p.website)throw new Problem(400,'Solicitud incorrecta / Demande invalide');
      const now=Date.now();
      if(now-requestWindow.start>60000)requestWindow={start:now,count:0};
      if(++requestWindow.count>120)throw new Problem(429,'Espera un minuto y vuelve a intentar / Réessayez dans une minute');
      const key=typeof p.contactPhone==='string'&&p.contactPhone.trim()?p.contactPhone.replace(/\D/g,'').slice(0,16):String(p.requesterName||'').trim().toLowerCase().slice(0,120)+'|'+String(p.pickupPostalCode||'').replace(/\s/g,'').toUpperCase().slice(0,6);
      if(requestAttempts.size>1000)for(const [k,v]of requestAttempts)if(now-v.start>600000)requestAttempts.delete(k);
      let a=requestAttempts.get(key);if(!a||now-a.start>600000){a={start:now,count:0};requestAttempts.set(key,a);}
      if(++a.count>10)throw new Problem(429,'Demasiadas solicitudes. Espera 10 minutos / Trop de demandes. Attendez 10 minutes');
      if(path==='/quotes'){send(201,store.saveQuote(await computeQuote(p),{publicQuote:true}));void quoteMailer.flush();}
      else {
        let restaurant=null;
        if(req.headers.authorization?.replace(/^Bearer(?:\s+|$)/,'').trim()){restaurant=store.authenticate(req.headers.authorization.replace(/^Bearer /,''));if(restaurant.role!=='restaurant')throw new Problem(403,'Acceso restaurante / Accès restaurant');p.requesterName=restaurant.name;}
        paymentConfig();
        const request=store.createRequest(p,restaurant,{awaitPayment:true});
        send(201,await checkout(store,request,p.statusToken));
      }
      return;
    }
    const token=(req.headers.authorization || '').replace(/^Bearer /,'');
    if(req.method==='GET'&&/^\/request-status\/[a-f0-9]{48}$/.test(path)){
      send(200,store.requestStatus(path.split('/')[2],token));return;
    }
    const u=store.authenticate(token);
    let data;
    if(req.method==='GET'&&path==='/me')data=u;
    else if(req.method==='POST'&&path==='/logout')data=store.logout(u,token);
    else if(req.method==='POST'&&path==='/shift/start')data=store.start(u,p.consent);
    else if(req.method==='POST'&&path==='/shift/stop')data=store.stop(u);
    else if(req.method==='POST'&&path==='/location')data=store.locate(u,p);
    else if(req.method==='GET'&&path==='/drivers')data=store.drivers(u);
    else if(req.method==='GET'&&path==='/config'){
      if(u.role!=='admin')throw new Problem(403,'Acceso denegado');
      let paymentsConfigured=false;try{paymentConfig();paymentsConfigured=true}catch{}
      data={mapsKey:process.env.GOOGLE_MAPS_BROWSER_KEY || '',quotesConfigured:!!process.env.GOOGLE_ROUTES_API_KEY?.trim(),requestNotifications:requestMailer.status(),quoteNotifications:quoteMailer.status(),paymentsConfigured};
    }
    else if(req.method==='POST'&&path==='/email/check'){
      if(u.role!=='admin')throw new Problem(403,'Acceso denegado / Accès refusé');
      if(Date.now()<nextEmailCheck)throw new Problem(429,'Espera un minuto antes de volver a comprobar / Attendez une minute');
      nextEmailCheck=Date.now()+60000;
      data=await checkEmail();
      data.requestNotifications={...requestMailer.status(),queue:store.db.prepare(`SELECT
        SUM(CASE WHEN sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN sent_at IS NULL AND skipped_at IS NULL AND attempts<5 THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN sent_at IS NULL AND skipped_at IS NULL AND attempts>=5 THEN 1 ELSE 0 END) AS failed FROM request_emails`).get()};
      data.queue=store.db.prepare(`SELECT
        SUM(CASE WHEN sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN sent_at IS NULL AND skipped_at IS NULL AND attempts<5 THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN sent_at IS NULL AND skipped_at IS NULL AND attempts>=5 THEN 1 ELSE 0 END) AS failed
        FROM assignment_emails`).get();
    }
    else if(req.method==='POST'&&path==='/users'){
      if(u.role!=='admin')throw new Problem(403,'Acceso denegado');
      data=store.createUser({...p,role:p.role==='restaurant'?'restaurant':'driver'});
    }
    else if(req.method==='GET'&&path==='/restaurant/profile')data=store.restaurantProfile(u);
    else if(req.method==='PATCH'&&path==='/restaurant/profile')data=store.restaurantProfile(u,p);
    else if(req.method==='GET'&&path==='/restaurant/requests')data=store.restaurantRequests(u);
    else if(req.method==='GET'&&path==='/deliveries')data=store.deliveries(u);
    else if(req.method==='GET'&&path==='/requests')data=store.requests(u);
    else if(req.method==='GET'&&path==='/admin/quote-activity')data=store.quoteActivity(u);
    else if(req.method==='PATCH'&&/^\/requests\/[a-f0-9]{48}$/.test(path)){
      if(u.role!=='admin')throw new Problem(403,'Acceso denegado / Accès refusé');
      const requestId=path.split('/')[2];
      if(p.action==='assign'){data=store.createDelivery(u,{requestId,driverId:p.driverId,joinBatch:p.joinBatch===true});void mailer.flush();}
      else if(p.action==='decline')data=store.declineRequest(u,requestId);
      else throw new Problem(400,'Acción incorrecta / Action invalide');
    }
    else if(req.method==='POST'&&path==='/admin/quotes'){
      if(u.role!=='admin')throw new Problem(403,'Acceso denegado / Accès refusé');
      data=store.saveQuote(await computeQuote(p));
    }
    else if(req.method==='POST'&&path==='/deliveries'){
      data=p.requestId?store.createDelivery(u,p):store.assignQuotedDelivery(u,p);
      void mailer.flush();
    }
    else if(req.method==='PATCH'&&/^\/deliveries\/[a-f0-9]{48}$/.test(path))data=store.updateDelivery(u,path.split('/')[2],p.status);
    else if(req.method==='POST'&&/^\/batches\/[a-f0-9]{48}\/pickup$/.test(path))data=store.collectBatch(u,path.split('/')[2]);
    else throw new Problem(404,'Ruta no encontrada');
    send(200,data);
  }catch(e){send(e.status || 500,{error:e.status?e.message:'Error del servidor / Erreur serveur'});if(!e.status)console.error(e);}
});
server.on('listening',()=>{store.pruneHistory();mailer.start();requestMailer.start();quoteMailer.start();retentionTimer=setInterval(()=>{try{store.pruneHistory()}catch{console.error('No se pudo limpiar el historial de entregas.')}},60000);retentionTimer.unref()});
server.on('close',()=>{clearInterval(retentionTimer);mailer.stop();requestMailer.stop();quoteMailer.stop()});
if(process.argv[1]===fileURLToPath(import.meta.url))server.listen(Number(process.env.PORT || 8787),process.env.HOST || '127.0.0.1',()=>console.log('Panel: http://127.0.0.1:'+ (process.env.PORT || 8787)));

