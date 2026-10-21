import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import {priceRoute,splitDeliveryPrice,TIP_OPTIONS} from './pricing.mjs';
import {routeInput} from './addresses.mjs';

export class Problem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const id = () => randomBytes(24).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (condition, status, message) => { if (condition) throw new Problem(status, message); };
export function createStore(path = 'livraison.sqlite') {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, role TEXT CHECK(role IN ('admin','driver')) NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS shifts(user_id TEXT PRIMARY KEY REFERENCES users(id), shift_id TEXT,
      consent_at INTEGER, latitude REAL, longitude REAL, accuracy REAL, measured_at INTEGER, received_at INTEGER);
    CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, pickup TEXT NOT NULL, destination TEXT NOT NULL,
      driver_id TEXT REFERENCES users(id), status TEXT NOT NULL DEFAULT 'assigned', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS assignment_emails(delivery_id TEXT PRIMARY KEY REFERENCES deliveries(id),
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
      sent_at INTEGER, skipped_at INTEGER, last_error TEXT);
    CREATE TABLE IF NOT EXISTS delivery_requests(id TEXT PRIMARY KEY, submission_id TEXT UNIQUE NOT NULL,
      requester_name TEXT NOT NULL, contact_name TEXT NOT NULL, contact_phone TEXT NOT NULL, contact_email TEXT NOT NULL,
      pickup TEXT NOT NULL, destination TEXT NOT NULL, recipient_name TEXT NOT NULL, recipient_phone TEXT NOT NULL,
      item_description TEXT NOT NULL, ready_at TEXT NOT NULL, notes TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','assigned','declined')),
      delivery_id TEXT UNIQUE REFERENCES deliveries(id), created_at INTEGER NOT NULL, reviewed_at INTEGER);
    CREATE INDEX IF NOT EXISTS delivery_requests_created ON delivery_requests(created_at);`);
  db.exec(`CREATE TABLE IF NOT EXISTS delivery_quotes(id TEXT PRIMARY KEY,pickup TEXT NOT NULL,destination TEXT NOT NULL,
    ready_at TEXT NOT NULL,distance_meters INTEGER NOT NULL,duration_seconds REAL NOT NULL,baseline_seconds REAL NOT NULL,
    distance_cents INTEGER NOT NULL,traffic_cents INTEGER NOT NULL,total_cents INTEGER NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);`);
  const requestColumns=new Set(db.prepare('PRAGMA table_info(delivery_requests)').all().map(c=>c.name));
  for(const [name,type]of [['quote_id','TEXT REFERENCES delivery_quotes(id)'],['status_token_hash','TEXT'],['accepted_at','INTEGER'],['tip_cents','INTEGER NOT NULL DEFAULT 0']])if(!requestColumns.has(name))db.exec('ALTER TABLE delivery_requests ADD COLUMN '+name+' '+type);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS delivery_requests_quote ON delivery_requests(quote_id)');
  if(!db.prepare('PRAGMA table_info(deliveries)').all().some(c=>c.name==='batch_id'))db.exec('ALTER TABLE deliveries ADD COLUMN batch_id TEXT');
  const deliveryColumns=new Set(db.prepare('PRAGMA table_info(deliveries)').all().map(c=>c.name));
  for(const name of ['total_price_cents','commission_cents','driver_payout_cents','delivery_fare_cents','tip_cents'])if(!deliveryColumns.has(name))db.exec('ALTER TABLE deliveries ADD COLUMN '+name+' INTEGER');
  const quoteColumns=new Set(db.prepare('PRAGMA table_info(delivery_quotes)').all().map(c=>c.name));
  for(const name of ['pickup_postal_code','destination_postal_code']){
    if(!requestColumns.has(name))db.exec('ALTER TABLE delivery_requests ADD COLUMN '+name+" TEXT NOT NULL DEFAULT ''");
    if(!quoteColumns.has(name))db.exec('ALTER TABLE delivery_quotes ADD COLUMN '+name+" TEXT NOT NULL DEFAULT ''");
  }
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const userView = u => ({id:u.id, name:u.name, email:u.email, role:u.role});
  const admin = u => fail(u.role !== 'admin', 403, 'Acceso reservado al administrador / Accès administrateur');
  const driver = u => fail(u.role !== 'driver', 403, 'Acceso reservado al repartidor / Accès livreur');
  const store = {
    db,
    createUser({email, name, password, role='driver'}) {
      fail(typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254, 400, 'Email incorrecto / Courriel invalide');
      fail(typeof name !== 'string' || !name.trim() || name.length > 100, 400, 'Nombre incorrecto / Nom invalide');
      fail(typeof password !== 'string' || password.length < 12 || password.length > 200, 400, 'Contraseña: 12–200 caracteres / Mot de passe : 12–200 caractères');
      fail(!['admin','driver'].includes(role), 400, 'Rol incorrecto');
      email = email.toLowerCase().trim();
      fail(!!one('SELECT id FROM users WHERE email=?', email), 409, 'Email ya registrado / Courriel déjà inscrit');
      const salt=id(), uid=id();
      run('INSERT INTO users VALUES(?,?,?,?,?,?)', uid,email,name.trim(),role,salt,scryptSync(password,salt,64).toString('hex'));
      return userView(one('SELECT * FROM users WHERE id=?',uid));
    },
    login(email, password) {
      fail(typeof email !== 'string' || typeof password !== 'string' || password.length > 200,401,'Credenciales incorrectas / Identifiants incorrects');
      const u=one('SELECT * FROM users WHERE email=?',email.trim().toLowerCase());
      const candidate=scryptSync(password,u?.salt || 'dummy-salt',64);
      fail(!u || !timingSafeEqual(candidate,Buffer.from(u.password,'hex')),401,'Credenciales incorrectas / Identifiants incorrects');
      run('DELETE FROM sessions WHERE expires<?',Date.now());
      const token=id();
      run('INSERT INTO sessions VALUES(?,?,?)', hash(token),u.id,Date.now()+7*86400000);
      return {token,user:userView(u)};
    },
    authenticate(token) {
      const u=one('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?',hash(token || ''),Date.now());
      fail(!u,401,'Inicia sesión / Connectez-vous'); return userView(u);
    },
    logout(u, token) { if(u.role==='driver') store.stop(u); run('DELETE FROM sessions WHERE token=?',hash(token)); return {ok:true}; },
    start(u, consent) {
      driver(u); fail(consent !== true,400,'Debes autorizar compartir tu ubicación / Autorisez le partage de position');
      const shiftId=id();
      run(`INSERT INTO shifts(user_id,shift_id,consent_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET
        shift_id=excluded.shift_id,consent_at=excluded.consent_at,latitude=NULL,longitude=NULL,accuracy=NULL,measured_at=NULL,received_at=NULL`,u.id,shiftId,Date.now());
      return {shiftId};
    },
    stop(u) {
      driver(u);
      run('UPDATE shifts SET shift_id=NULL,latitude=NULL,longitude=NULL,accuracy=NULL,measured_at=NULL,received_at=NULL WHERE user_id=?',u.id);
      return {ok:true};
    },
    locate(u,p) {
      driver(u);
      const s=one('SELECT * FROM shifts WHERE user_id=?',u.id);
      fail(!s?.shift_id || s.shift_id !== p.shiftId,409,'Turno terminado / Service terminé');
      fail(!Number.isFinite(p.latitude) || Math.abs(p.latitude)>90 || !Number.isFinite(p.longitude) || Math.abs(p.longitude)>180 || !Number.isFinite(p.accuracy) || p.accuracy<0,400,'GPS incorrecto / GPS invalide');
      fail(!Number.isFinite(p.measuredAt) || p.measuredAt>Date.now()+30000 || p.measuredAt<Date.now()-90000,400,'GPS desactualizado / GPS périmé');
      if(s.measured_at && p.measuredAt<=s.measured_at) return {ok:true,ignored:true};
      run('UPDATE shifts SET latitude=?,longitude=?,accuracy=?,measured_at=?,received_at=? WHERE user_id=?',p.latitude,p.longitude,p.accuracy,p.measuredAt,Date.now(),u.id);
      return {ok:true};
    },
    drivers(u) {
      admin(u);
      return db.prepare(`SELECT u.id,u.name,u.email,s.shift_id,s.latitude,s.longitude,s.accuracy,s.measured_at,s.received_at
        FROM users u LEFT JOIN shifts s ON s.user_id=u.id WHERE u.role='driver' ORDER BY u.name`).all().map(s=>{
          const fresh=!!s.shift_id && !!s.received_at && Date.now()-s.received_at<90000 && Date.now()-s.measured_at<90000;
          const activeJobs=db.prepare(`SELECT d.status,d.pickup,d.batch_id,r.requester_name FROM deliveries d
            LEFT JOIN delivery_requests r ON r.delivery_id=d.id WHERE d.driver_id=? AND d.status!='delivered' ORDER BY d.created_at`).all(s.id);
          const active=activeJobs.find(d=>d.status==='picked_up')||activeJobs[0];
          const batch=activeJobs.length&&activeJobs.every(d=>d.status==='assigned'&&d.batch_id&&d.batch_id===activeJobs[0].batch_id&&d.requester_name)
            ?{id:activeJobs[0].batch_id,count:activeJobs.length,pickup:activeJobs[0].pickup,requesterName:activeJobs[0].requester_name}:null;
          return {id:s.id,name:s.name,email:s.email,latitude:s.latitude,longitude:s.longitude,accuracy:s.accuracy,
            measuredAt:s.measured_at,lastUpdate:s.received_at,fresh,batch,status:!s.shift_id?'offline':!fresh?'stale':active?.status || 'available'};
        });
    },
    deliveries(u) {
      const sql=`SELECT d.*,r.requester_name,r.contact_name,r.contact_phone,r.recipient_name,r.recipient_phone,
        r.item_description,r.ready_at,r.notes,CASE WHEN r.id IS NOT NULL THEN 'TAC-'||upper(substr(r.id,1,12)) END AS request_reference
        FROM deliveries d LEFT JOIN delivery_requests r ON r.delivery_id=d.id`;
      return u.role==='admin' ? db.prepare(sql+' ORDER BY d.created_at DESC').all()
        : db.prepare(sql+' WHERE d.driver_id=? ORDER BY d.created_at DESC').all(u.id);
    },
    saveQuote(p) {
      p={...p,...routeInput(p)};
      const priced=priceRoute(p),qid=id(),now=Date.now(),expiresAt=now+600000;
      run(`INSERT INTO delivery_quotes(id,pickup,destination,ready_at,distance_meters,duration_seconds,baseline_seconds,distance_cents,traffic_cents,total_cents,expires_at,created_at,pickup_postal_code,destination_postal_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,qid,p.pickup,p.destination,p.readyAt,
        priced.distanceMeters,priced.durationSeconds,priced.baselineSeconds,priced.distanceCents,priced.trafficCents,priced.totalCents,expiresAt,now,p.pickupPostalCode,p.destinationPostalCode);
      return {quoteId:qid,pickup:p.pickup,destination:p.destination,pickupPostalCode:p.pickupPostalCode,destinationPostalCode:p.destinationPostalCode,readyAt:p.readyAt,...priced,expiresAt};
    },
    createRequest(p) {
      fail(p.consent!==true,400,'Autoriza el uso de los datos para organizar la entrega / Autorisez l’utilisation des coordonnées pour organiser la livraison');
      fail(typeof p.submissionId!=='string'||! /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p.submissionId),400,'Solicitud incorrecta / Demande invalide');
      fail(typeof p.statusToken!=='string'||! /^[a-f0-9]{64}$/.test(p.statusToken),400,'Solicitud incorrecta / Demande invalide');
      const existing=one('SELECT id,status_token_hash FROM delivery_requests WHERE submission_id=?',p.submissionId);
      if(existing){
        fail(existing.status_token_hash!==hash(p.statusToken),409,'Solicitud ya registrada / Demande déjà enregistrée');
        return {id:existing.id,reference:'TAC-'+existing.id.slice(0,12).toUpperCase()};
      }
      fail(p.acceptPrice!==true,400,'Acepta el precio para continuar / Acceptez le prix pour continuer');
      p={...p,...routeInput(p)};
      const tipCents=p.tipCents??0;
      fail(!TIP_OPTIONS.includes(tipCents),400,'Propina incorrecta / Pourboire invalide');
      const fields={requesterName:120,contactName:100,contactPhone:40,pickup:500,destination:500,recipientName:100,recipientPhone:40,itemDescription:500};
      for(const [key,max] of Object.entries(fields))fail(typeof p[key]!=='string'||!p[key].trim()||p[key].length>max,400,'Completa los campos obligatorios / Remplissez les champs obligatoires');
      for(const key of ['contactPhone','recipientPhone'])fail(!/^[+()\d .-]+$/.test(p[key])||p[key].replace(/\D/g,'').length<7||p[key].replace(/\D/g,'').length>15,400,'Teléfono incorrecto / Téléphone invalide');
      const email=p.contactEmail??'',notes=p.notes??'',ready=p.readyAt??'';
      fail(typeof email!=='string'||email.length>254||(email.trim()&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())),400,'Correo incorrecto / Courriel invalide');
      fail(typeof notes!=='string'||notes.length>1000,400,'Instrucciones: máximo 1000 caracteres / Instructions : 1000 caractères maximum');
      fail(typeof ready!=='string'||(ready&&(!Number.isFinite(Date.parse(ready))||Date.parse(ready)<Date.now()-900000||Date.parse(ready)>Date.now()+30*86400000)),400,'Fecha de recogida incorrecta / Date de collecte invalide');
      const quote=one('SELECT * FROM delivery_quotes WHERE id=?',typeof p.quoteId==='string'?p.quoteId:'');
      fail(!quote||quote.expires_at<Date.now(),409,'Cotización vencida. Calcula el precio nuevamente / Devis expiré. Recalculez le prix');
      fail(quote.pickup!==p.pickup.trim()||quote.destination!==p.destination.trim()||quote.ready_at!==(ready?new Date(ready).toISOString():''),409,'La ruta cambió. Calcula el precio nuevamente / Le trajet a changé. Recalculez le prix');
      fail(quote.pickup_postal_code!==p.pickupPostalCode||quote.destination_postal_code!==p.destinationPostalCode,409,'El código postal cambió. Calcula nuevamente / Code postal modifié. Recalculez le prix');
      fail(!!one('SELECT id FROM delivery_requests WHERE quote_id=?',quote.id),409,'Cotización ya aceptada / Devis déjà accepté');
      const rid=id();
      run(`INSERT INTO delivery_requests(id,submission_id,requester_name,contact_name,contact_phone,contact_email,
        pickup,destination,recipient_name,recipient_phone,item_description,ready_at,notes,created_at,quote_id,status_token_hash,accepted_at,tip_cents,pickup_postal_code,destination_postal_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        rid,p.submissionId,p.requesterName.trim(),p.contactName.trim(),p.contactPhone.trim(),email.trim(),p.pickup.trim(),p.destination.trim(),
        p.recipientName.trim(),p.recipientPhone.trim(),p.itemDescription.trim(),ready?new Date(ready).toISOString():'',notes.trim(),Date.now(),quote.id,hash(p.statusToken),Date.now(),tipCents,p.pickupPostalCode,p.destinationPostalCode);
      return {id:rid,reference:'TAC-'+rid.slice(0,12).toUpperCase()};
    },
    requestStatus(rid,token) {
      const r=one(`SELECT r.id,r.status,r.status_token_hash,r.tip_cents,d.status AS delivery_status,u.name AS driver_name,q.total_cents
        FROM delivery_requests r LEFT JOIN deliveries d ON d.id=r.delivery_id LEFT JOIN users u ON u.id=d.driver_id
        LEFT JOIN delivery_quotes q ON q.id=r.quote_id WHERE r.id=?`,rid);
      fail(!r||!r.status_token_hash||r.status_token_hash!==hash(token||''),404,'Solicitud no encontrada / Demande introuvable');
      return {reference:'TAC-'+r.id.slice(0,12).toUpperCase(),status:r.status==='assigned'?r.delivery_status:r.status,driverName:r.driver_name||'',deliveryFareCents:r.total_cents,tipCents:r.tip_cents,totalCents:r.total_cents+r.tip_cents,currency:'CAD'};
    },
    requests(u) {
      admin(u);
      return db.prepare(`SELECT r.*,d.status AS delivery_status,d.commission_cents,d.driver_payout_cents,q.total_cents,q.distance_meters,q.distance_cents,q.traffic_cents,q.duration_seconds,q.baseline_seconds
        FROM delivery_requests r LEFT JOIN deliveries d ON d.id=r.delivery_id LEFT JOIN delivery_quotes q ON q.id=r.quote_id
        ORDER BY CASE WHEN r.status='pending' THEN 0 ELSE 1 END,r.created_at DESC`).all().map(({submission_id,status_token_hash,...r})=>({...r,reference:'TAC-'+r.id.slice(0,12).toUpperCase()}));
    },
    declineRequest(u,rid) {
      admin(u);
      const r=one('SELECT * FROM delivery_requests WHERE id=?',rid);
      fail(!r,404,'Solicitud no encontrada / Demande introuvable');
      fail(r.status!=='pending',409,'Solicitud ya procesada / Demande déjà traitée');
      run("UPDATE delivery_requests SET status='declined',reviewed_at=? WHERE id=? AND status='pending'",Date.now(),rid);
      return {ok:true};
    },
    createDelivery(u,p) {
      admin(u);
      const request=p.requestId?one('SELECT * FROM delivery_requests WHERE id=?',p.requestId):null;
      if(p.requestId){
        fail(!request,404,'Solicitud no encontrada / Demande introuvable');
        fail(request.status!=='pending',409,'Solicitud ya procesada / Demande déjà traitée');
        p={...p,pickup:request.pickup,destination:request.destination};
      }
      fail(typeof p.pickup!=='string'||!p.pickup.trim()||p.pickup.length>500||typeof p.destination!=='string'||!p.destination.trim()||p.destination.length>500,400,'Direcciones obligatorias / Adresses obligatoires');
      const d=store.drivers(u).find(d=>d.id===p.driverId);
      fail(!d || !d.fresh,409,'Repartidor sin GPS reciente / Livreur sans GPS récent');
      const same=value=>value.trim().toLocaleLowerCase('fr-CA').replace(/\s+/g,' ');
      const joining=d.status!=='available';
      if(joining)fail(!request||p.joinBatch!==true||!d.batch||d.batch.count>=3||same(d.batch.pickup)!==same(request.pickup)||same(d.batch.requesterName)!==same(request.requester_name),409,'Repartidor ocupado o grupo incompatible / Livreur occupé ou tournée incompatible');
      const did=id(), now=Date.now();
      const quote=request?one('SELECT total_cents FROM delivery_quotes WHERE id=?',request.quote_id):null;
      const split=quote?splitDeliveryPrice(quote.total_cents,request.tip_cents):null;
      db.exec('BEGIN IMMEDIATE');
      try {
        run('INSERT INTO deliveries(id,pickup,destination,driver_id,created_at,batch_id,total_price_cents,commission_cents,driver_payout_cents,delivery_fare_cents,tip_cents) VALUES(?,?,?,?,?,?,?,?,?,?,?)',did,p.pickup.trim(),p.destination.trim(),p.driverId,now,joining?d.batch.id:did,split?.totalPriceCents??null,split?.commissionCents??null,split?.driverPayoutCents??null,split?.deliveryFareCents??null,split?.tipCents??null);
        run('INSERT INTO assignment_emails(delivery_id,next_attempt_at) VALUES(?,?)',did,now);
        if(request){
          const changed=run("UPDATE delivery_requests SET status='assigned',delivery_id=?,reviewed_at=? WHERE id=? AND status='pending'",did,now,request.id);
          fail(changed.changes!==1,409,'Solicitud ya procesada / Demande déjà traitée');
        }
        db.exec('COMMIT');
      } catch(error) { db.exec('ROLLBACK'); throw error; }
      return one('SELECT * FROM deliveries WHERE id=?',did);
    },
    collectBatch(u,batchId) {
      const jobs=db.prepare('SELECT * FROM deliveries WHERE batch_id=?').all(batchId);
      fail(!jobs.length,404,'Grupo no encontrado / Tournée introuvable');
      fail(u.role!=='admin'&&jobs.some(d=>d.driver_id!==u.id),403,'Acceso denegado / Accès refusé');
      fail(jobs.some(d=>d.status!=='assigned'),409,'La recogida ya cambió de estado / La collecte a déjà changé d’état');
      run("UPDATE deliveries SET status='picked_up' WHERE batch_id=? AND status='assigned'",batchId);
      return {ok:true,count:jobs.length};
    },
    updateDelivery(u,did,status) {
      const d=one('SELECT * FROM deliveries WHERE id=?',did);
      fail(!d,404,'Entrega no encontrada / Livraison introuvable');
      fail(u.role!=='admin' && d.driver_id!==u.id,403,'Acceso denegado / Accès refusé');
      const next={assigned:'picked_up',picked_up:'delivered'};
      fail(next[d.status]!==status,409,'Cambio de estado incorrecto / Transition invalide');
      run('UPDATE deliveries SET status=? WHERE id=?',status,did); return {...d,status};
    }
  };
  return store;
}
