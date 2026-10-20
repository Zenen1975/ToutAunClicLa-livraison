import http from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createStore,Problem} from './core.mjs';
import {createAssignmentMailer} from './assignment-mail.mjs';
import {checkEmail} from './email-check.mjs';
const store=createStore(process.env.DATABASE_PATH || 'livraison.sqlite');
const mailer=createAssignmentMailer(store);
const page=readFileSync(new URL('./public/index.html',import.meta.url));
const driverPage=readFileSync(new URL('./public/livreur.html',import.meta.url));
const attempts=new Map();
let nextEmailCheck=0;
export const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET'&&path==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(page);return;}
    if(req.method==='GET'&&['/livreur','/livreur/','/repartidor','/repartidor/'].includes(path)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(driverPage);return;}
    if(req.method==='GET'&&path==='/health'){send(200,{ok:true});return;}
    let p={};
    if(['POST','PATCH'].includes(req.method)) {
      let raw=''; for await (const chunk of req){raw+=chunk; if(Buffer.byteLength(raw)>16384)throw new Problem(413,'Solicitud demasiado grande');}
      try {p=JSON.parse(raw || '{}');}catch{throw new Problem(400,'JSON incorrecto');}
      if(!p || typeof p!=='object'||Array.isArray(p))throw new Problem(400,'JSON incorrecto');
    }
    if(req.method==='POST'&&path==='/login') {
      const key=req.socket.remoteAddress; const now=Date.now();
      if(attempts.size>10000)for(const [k,v]of attempts)if(now-v.start>600000)attempts.delete(k);
      let a=attempts.get(key); if(!a||now-a.start>600000){a={start:now,count:0};attempts.set(key,a);}
      if(++a.count>20)throw new Problem(429,'Demasiados intentos. Espera 10 minutos / Trop de tentatives');
      send(200,store.login(p.email,p.password));return;
    }
    const token=(req.headers.authorization || '').replace(/^Bearer /,'');
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
      data={mapsKey:process.env.GOOGLE_MAPS_BROWSER_KEY || ''};
    }
    else if(req.method==='POST'&&path==='/email/check'){
      if(u.role!=='admin')throw new Problem(403,'Acceso denegado / Accès refusé');
      if(Date.now()<nextEmailCheck)throw new Problem(429,'Espera un minuto antes de volver a comprobar / Attendez une minute');
      nextEmailCheck=Date.now()+60000;
      data=await checkEmail();
      data.queue=store.db.prepare(`SELECT
        SUM(CASE WHEN sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN sent_at IS NULL AND skipped_at IS NULL AND attempts<5 THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN sent_at IS NULL AND skipped_at IS NULL AND attempts>=5 THEN 1 ELSE 0 END) AS failed
        FROM assignment_emails`).get();
    }
    else if(req.method==='POST'&&path==='/users'){
      if(u.role!=='admin')throw new Problem(403,'Acceso denegado');
      data=store.createUser({...p,role:'driver'});
    }
    else if(req.method==='GET'&&path==='/deliveries')data=store.deliveries(u);
    else if(req.method==='POST'&&path==='/deliveries'){
      data=store.createDelivery(u,p);
      void mailer.flush();
    }
    else if(req.method==='PATCH'&&/^\/deliveries\/[a-f0-9]{48}$/.test(path))data=store.updateDelivery(u,path.split('/')[2],p.status);
    else throw new Problem(404,'Ruta no encontrada');
    send(200,data);
  }catch(e){send(e.status || 500,{error:e.status?e.message:'Error del servidor / Erreur serveur'});if(!e.status)console.error(e);}
});
server.on('listening',()=>mailer.start());
server.on('close',()=>mailer.stop());
if(process.argv[1]===fileURLToPath(import.meta.url))server.listen(Number(process.env.PORT || 8787),process.env.HOST || '127.0.0.1',()=>console.log('Panel: http://127.0.0.1:'+ (process.env.PORT || 8787)));

