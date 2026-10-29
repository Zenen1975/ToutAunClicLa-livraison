import {TERMS_VERSION,TERMS_CONTENT_SHA256} from './terms.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import {priceRoute,splitDeliveryPrice,TIP_OPTIONS,deliveryTaxes} from './pricing.mjs';
import {routeInput,postalCode} from './addresses.mjs';

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
  db.exec(`CREATE TABLE IF NOT EXISTS request_emails(request_id TEXT PRIMARY KEY REFERENCES delivery_requests(id),
    attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL,sent_at INTEGER,skipped_at INTEGER,last_error TEXT);`);
  if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='account_type'))db.exec('ALTER TABLE users ADD COLUMN account_type TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS restaurant_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),pickup TEXT NOT NULL,pickup_postal_code TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS password_resets(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS password_reset_attempts(email_hash TEXT PRIMARY KEY,requested_at INTEGER NOT NULL,count INTEGER NOT NULL DEFAULT 0);`);
  if(!db.prepare('PRAGMA table_info(password_reset_attempts)').all().some(c=>c.name==='count'))db.exec('ALTER TABLE password_reset_attempts ADD COLUMN count INTEGER NOT NULL DEFAULT 0');
  const requestColumns=new Set(db.prepare('PRAGMA table_info(delivery_requests)').all().map(c=>c.name));
  for(const [name,type]of [['quote_id','TEXT REFERENCES delivery_quotes(id)'],['status_token_hash','TEXT'],['accepted_at','INTEGER'],['tip_cents','INTEGER NOT NULL DEFAULT 0']])if(!requestColumns.has(name))db.exec('ALTER TABLE delivery_requests ADD COLUMN '+name+' '+type);
  if(!requestColumns.has('restaurant_user_id'))db.exec('ALTER TABLE delivery_requests ADD COLUMN restaurant_user_id TEXT REFERENCES users(id)');
  for(const [name,type] of [['terms_version','TEXT'],['terms_content_sha256','TEXT'],['terms_accepted_at','INTEGER']])if(!requestColumns.has(name))db.exec('ALTER TABLE delivery_requests ADD COLUMN '+name+' '+type);
  if(!requestColumns.has('payment_state'))db.exec("ALTER TABLE delivery_requests ADD COLUMN payment_state TEXT NOT NULL DEFAULT 'legacy'");
  db.exec(`CREATE TABLE IF NOT EXISTS request_payments(id TEXT PRIMARY KEY,request_id TEXT UNIQUE REFERENCES delivery_requests(id) ON DELETE SET NULL,
    amount_cents INTEGER NOT NULL,currency TEXT NOT NULL DEFAULT 'cad',status TEXT NOT NULL DEFAULT 'unpaid',
    session_id TEXT UNIQUE,checkout_url TEXT,expires_at INTEGER,created_at INTEGER NOT NULL,paid_at INTEGER);`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS delivery_requests_quote ON delivery_requests(quote_id)');
  if(!db.prepare('PRAGMA table_info(deliveries)').all().some(c=>c.name==='batch_id'))db.exec('ALTER TABLE deliveries ADD COLUMN batch_id TEXT');
  const deliveryColumns=new Set(db.prepare('PRAGMA table_info(deliveries)').all().map(c=>c.name));
  for(const name of ['total_price_cents','commission_cents','driver_payout_cents','delivery_fare_cents','tip_cents','gst_cents','qst_cents'])if(!deliveryColumns.has(name))db.exec('ALTER TABLE deliveries ADD COLUMN '+name+' INTEGER');
  if(!deliveryColumns.has('admin_quote_id'))db.exec('ALTER TABLE deliveries ADD COLUMN admin_quote_id TEXT REFERENCES delivery_quotes(id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS deliveries_admin_quote ON deliveries(admin_quote_id)');
  if(!deliveryColumns.has('completed_at'))db.exec('ALTER TABLE deliveries ADD COLUMN completed_at INTEGER');
  db.exec("UPDATE deliveries SET completed_at=created_at WHERE status='delivered' AND completed_at IS NULL");
  db.exec('CREATE INDEX IF NOT EXISTS deliveries_completed ON deliveries(status,completed_at); CREATE INDEX IF NOT EXISTS restaurant_request_owner ON delivery_requests(restaurant_user_id,created_at)');
  const quoteColumns=new Set(db.prepare('PRAGMA table_info(delivery_quotes)').all().map(c=>c.name));
  if(!requestColumns.has('admin_removed_at'))db.exec('ALTER TABLE delivery_requests ADD COLUMN admin_removed_at INTEGER');
  if(!quoteColumns.has('admin_removed_at'))db.exec('ALTER TABLE delivery_quotes ADD COLUMN admin_removed_at INTEGER');
  if(!quoteColumns.has('public_quote'))db.exec('ALTER TABLE delivery_quotes ADD COLUMN public_quote INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE TABLE IF NOT EXISTS quote_emails(quote_id TEXT PRIMARY KEY REFERENCES delivery_quotes(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL,sent_at INTEGER,skipped_at INTEGER,last_error TEXT);`);
  for(const name of ['gst_cents','qst_cents','tax_version'])if(!quoteColumns.has(name))db.exec('ALTER TABLE delivery_quotes ADD COLUMN '+name+' INTEGER NOT NULL DEFAULT 0');
  for(const name of ['pickup_postal_code','destination_postal_code']){
    if(!requestColumns.has(name))db.exec('ALTER TABLE delivery_requests ADD COLUMN '+name+" TEXT NOT NULL DEFAULT ''");
    if(!quoteColumns.has(name))db.exec('ALTER TABLE delivery_quotes ADD COLUMN '+name+" TEXT NOT NULL DEFAULT ''");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS native_push_tokens(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),
    session_token TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,language TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS native_push_jobs(id INTEGER PRIMARY KEY,delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    token TEXT NOT NULL REFERENCES native_push_tokens(token) ON DELETE CASCADE,created_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL,ticket TEXT,processed_at INTEGER,last_error TEXT,
    UNIQUE(delivery_id,token));`);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const userView = u => ({id:u.id, name:u.name, email:u.email, role:u.account_type==='restaurant'?'restaurant':u.role});
  const admin = u => fail(u.role !== 'admin', 403, 'Acceso reservado al administrador / Accès administrateur');
  const driver = u => fail(u.role !== 'driver', 403, 'Acceso reservado al repartidor / Accès livreur');
  const store = {
    db,
    registerNativePush(u,p,sessionToken) {
      driver(u);
      fail(typeof p.token!=='string'||! /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/.test(p.token),400,'Token de notificación inválido / Jeton invalide');
      fail(!['fr','es'].includes(p.language),400,'Idioma inválido / Langue invalide');
      const session=one('SELECT token FROM sessions WHERE token=? AND user_id=? AND expires>?',hash(sessionToken),u.id,Date.now());
      fail(!session,401,'Sesión vencida / Session expirée');
      // Moving a shared phone to another login removes queued messages for its previous account.
      const previous=one('SELECT session_token FROM native_push_tokens WHERE token=?',p.token);
      if(previous&&previous.session_token!==session.token)run('DELETE FROM native_push_tokens WHERE token=?',p.token);
      run(`INSERT INTO native_push_tokens VALUES(?,?,?,?,?) ON CONFLICT(token) DO UPDATE SET
        language=excluded.language,updated_at=excluded.updated_at`,p.token,u.id,session.token,p.language,Date.now());
      return {ok:true};
    },
    unregisterNativePush(u,p,sessionToken) {
      driver(u);fail(typeof p.token!=='string'||p.token.length>250,400,'Token inválido');
      run('DELETE FROM native_push_tokens WHERE token=? AND user_id=? AND session_token=?',p.token,u.id,hash(sessionToken));return {ok:true};
    },
    createUser({email, name, password, role='driver',pickup='',pickupPostalCode=''}) {
      fail(typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254, 400, 'Email incorrecto / Courriel invalide');
      fail(typeof name !== 'string' || !name.trim() || name.length > 100, 400, 'Nombre incorrecto / Nom invalide');
      fail(typeof password !== 'string' || password.length < 12 || password.length > 200, 400, 'Contraseña: 12–200 caracteres / Mot de passe : 12–200 caractères');
      fail(!['admin','driver','restaurant'].includes(role), 400, 'Rol incorrecto');
      email = email.toLowerCase().trim();
      fail(!!one('SELECT id FROM users WHERE email=?', email), 409, 'Email ya registrado / Courriel déjà inscrit');
      if(role==='restaurant'){postalCode(pickupPostalCode);fail(typeof pickup!=='string'||!pickup.trim()||pickup.length>500,400,'Dirección de recogida obligatoria / Adresse de collecte obligatoire');}
      const salt=id(), uid=id();
      db.exec('BEGIN IMMEDIATE');
      try{
        run('INSERT INTO users(id,email,name,role,salt,password,account_type) VALUES(?,?,?,?,?,?,?)',uid,email,name.trim(),role==='restaurant'?'driver':role,salt,scryptSync(password,salt,64).toString('hex'),role==='restaurant'?'restaurant':null);
        if(role==='restaurant')run('INSERT INTO restaurant_profiles VALUES(?,?,?)',uid,pickup.trim(),postalCode(pickupPostalCode));
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      return userView(one('SELECT * FROM users WHERE id=?',uid));
    },
    restaurantProfile(u,p=null){
      fail(u.role!=='restaurant',403,'Acceso restaurante / Accès restaurant');
      if(p){
        fail(typeof p.pickup!=='string'||!p.pickup.trim()||p.pickup.length>500,400,'Dirección incorrecta / Adresse invalide');
        run('UPDATE restaurant_profiles SET pickup=?,pickup_postal_code=? WHERE user_id=?',p.pickup.trim(),postalCode(p.pickupPostalCode),u.id);
      }
      const profile=one('SELECT pickup,pickup_postal_code AS pickupPostalCode FROM restaurant_profiles WHERE user_id=?',u.id);
      return {name:u.name,...profile};
    },
    restaurantRequests(u){
      fail(u.role!=='restaurant',403,'Acceso restaurante / Accès restaurant');store.pruneHistory();
      return db.prepare(`SELECT r.id,r.pickup,r.destination,r.recipient_name,r.created_at,CASE WHEN r.payment_state='awaiting_payment' THEN 'awaiting_payment' ELSE r.status END AS status,d.status AS delivery_status,d.completed_at,
        q.total_cents+q.gst_cents+q.qst_cents+r.tip_cents AS total_cents FROM delivery_requests r
        LEFT JOIN deliveries d ON d.id=r.delivery_id JOIN delivery_quotes q ON q.id=r.quote_id WHERE r.restaurant_user_id=? ORDER BY r.created_at DESC`).all(u.id);
    },
    preparePasswordReset(email,now=Date.now()){
      fail(typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()),400,'Correo incorrecto / Courriel invalide');
      const normalized=email.trim().toLowerCase(),key=hash(normalized);
      run('DELETE FROM password_reset_attempts WHERE requested_at<?',now-3600000);
      const last=one('SELECT requested_at,count FROM password_reset_attempts WHERE email_hash=?',key);
      if(last&&(last.requested_at>now-60000||last.count>=3))return null;
      run('INSERT INTO password_reset_attempts(email_hash,requested_at,count) VALUES(?,?,1) ON CONFLICT(email_hash) DO UPDATE SET requested_at=excluded.requested_at,count=password_reset_attempts.count+1',key,now);
      run('DELETE FROM password_resets WHERE expires_at<=?',now);
      const u=one('SELECT * FROM users WHERE email=?',normalized);
      if(!u)return null;
      const token=id()+id();
      run('INSERT INTO password_resets VALUES(?,?,?)',hash(token),u.id,now+30*60000);
      return {email:u.email,name:u.name,token};
    },
    resetPassword(token,password,now=Date.now()){
      fail(typeof token!=='string'||!/^[a-f0-9]{96}$/.test(token),400,'Enlace inválido o vencido / Lien invalide ou expiré');
      fail(typeof password!=='string'||password.length<12||password.length>200,400,'Contraseña: 12–200 caracteres / Mot de passe : 12–200 caractères');
      const reset=one('SELECT * FROM password_resets WHERE token_hash=? AND expires_at>?',hash(token),now);
      fail(!reset,400,'Enlace inválido o vencido / Lien invalide ou expiré');
      const salt=id(),passwordHash=scryptSync(password,salt,64).toString('hex');
      db.exec('BEGIN IMMEDIATE');
      try{
        run('UPDATE users SET salt=?,password=? WHERE id=?',salt,passwordHash,reset.user_id);
        run('DELETE FROM sessions WHERE user_id=?',reset.user_id);
        run('UPDATE shifts SET shift_id=NULL,latitude=NULL,longitude=NULL,accuracy=NULL,measured_at=NULL,received_at=NULL WHERE user_id=?',reset.user_id);
        run('DELETE FROM password_resets WHERE user_id=?',reset.user_id);
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      return {ok:true};
    },
    pruneHistory(now=Date.now()){
      const cutoff=now-5*86400000,restaurantCutoff=now-10*86400000;
      db.exec('BEGIN IMMEDIATE');
      try{
        db.exec('CREATE TEMP TABLE IF NOT EXISTS history_expired(id TEXT PRIMARY KEY); DELETE FROM history_expired;');
        run(`INSERT INTO history_expired SELECT d.id FROM deliveries d LEFT JOIN delivery_requests r ON r.delivery_id=d.id
          WHERE d.status='delivered' AND d.completed_at<=? AND (r.restaurant_user_id IS NULL OR d.completed_at<=?)`,cutoff,restaurantCutoff);
        run('DELETE FROM request_emails WHERE request_id IN (SELECT id FROM delivery_requests WHERE delivery_id IN (SELECT id FROM history_expired))');
        run('DELETE FROM delivery_requests WHERE delivery_id IN (SELECT id FROM history_expired)');
        run('DELETE FROM assignment_emails WHERE delivery_id IN (SELECT id FROM history_expired)');
        const result=run('DELETE FROM deliveries WHERE id IN (SELECT id FROM history_expired)');
        run('DELETE FROM delivery_quotes WHERE expires_at<? AND id NOT IN (SELECT quote_id FROM delivery_requests WHERE quote_id IS NOT NULL) AND id NOT IN (SELECT admin_quote_id FROM deliveries WHERE admin_quote_id IS NOT NULL)',restaurantCutoff);
        run('DELETE FROM password_resets WHERE expires_at<=?',now);
        db.exec('COMMIT');return {deleted:result.changes};
      }catch(error){db.exec('ROLLBACK');throw error;}
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
        FROM users u LEFT JOIN shifts s ON s.user_id=u.id WHERE u.role='driver' AND COALESCE(u.account_type,'')!='restaurant' ORDER BY u.name`).all().map(s=>{
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
      fail(!['admin','driver'].includes(u.role),403,'Acceso denegado / Accès refusé');store.pruneHistory();
      const sql=`SELECT d.*,r.requester_name,r.contact_name,r.contact_phone,r.recipient_name,r.recipient_phone,
        r.item_description,r.ready_at,r.notes,CASE WHEN r.id IS NOT NULL THEN 'TAC-'||upper(substr(r.id,1,12)) END AS request_reference
        FROM deliveries d LEFT JOIN delivery_requests r ON r.delivery_id=d.id`;
      const cutoff=Date.now()-5*86400000;
      return u.role==='admin' ? db.prepare(sql+" WHERE d.status!='delivered' OR d.completed_at>? ORDER BY d.created_at DESC").all(cutoff)
        : db.prepare(sql+" WHERE d.driver_id=? AND (d.status!='delivered' OR d.completed_at>?) ORDER BY d.created_at DESC").all(u.id,cutoff);
    },
    quoteActivity(u){
      admin(u);
      const now=Date.now();
      return db.prepare(`SELECT q.id,q.pickup,q.destination,q.created_at,q.total_cents+q.gst_cents+q.qst_cents AS total_cents,
        COALESCE(r.payment_state,'quoted') AS payment_state,
        CASE WHEN (r.id IS NULL OR (r.status IN ('pending','declined') AND r.delivery_id IS NULL)) AND (r.status='declined' OR COALESCE(r.created_at,q.created_at)<?) THEN 1 ELSE 0 END AS canDelete
        FROM delivery_quotes q LEFT JOIN delivery_requests r ON r.quote_id=q.id
        WHERE q.public_quote=1 AND q.admin_removed_at IS NULL AND q.created_at>? ORDER BY q.created_at DESC LIMIT 50`).all(now-3600000,now-86400000);
    },
    saveQuote(p,{publicQuote=false}={}) {
      p={...p,...routeInput(p)};
      const priced=priceRoute(p),qid=id(),now=Date.now(),expiresAt=now+600000;
      const taxes=deliveryTaxes(priced.totalCents);
      run(`INSERT INTO delivery_quotes(id,pickup,destination,ready_at,distance_meters,duration_seconds,baseline_seconds,distance_cents,traffic_cents,total_cents,expires_at,created_at,pickup_postal_code,destination_postal_code,gst_cents,qst_cents,tax_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,qid,p.pickup,p.destination,p.readyAt,
        priced.distanceMeters,priced.durationSeconds,priced.baselineSeconds,priced.distanceCents,priced.trafficCents,priced.totalCents,expiresAt,now,p.pickupPostalCode,p.destinationPostalCode,taxes.gstCents,taxes.qstCents,1);
      if(publicQuote){run('UPDATE delivery_quotes SET public_quote=1 WHERE id=?',qid);run('INSERT INTO quote_emails(quote_id,next_attempt_at) VALUES(?,?)',qid,now);}
      return {quoteId:qid,pickup:p.pickup,destination:p.destination,pickupPostalCode:p.pickupPostalCode,destinationPostalCode:p.destinationPostalCode,readyAt:p.readyAt,...priced,subtotalCents:priced.totalCents,gstCents:taxes.gstCents,qstCents:taxes.qstCents,totalCents:taxes.totalWithTaxesCents,expiresAt};
    },
    createRequest(p,restaurant=null,{awaitPayment=false}={}) {
      if(awaitPayment)fail(p.acceptTerms!==true||p.termsVersion!==TERMS_VERSION,400,'Lee y acepta los términos y condiciones para continuar / Lisez et acceptez les conditions du service pour continuer');
      if(restaurant)fail(restaurant.role!=='restaurant',403,'Acceso restaurante / Accès restaurant');
      fail(p.consent!==true,400,'Autoriza el uso de los datos para organizar la entrega / Autorisez l’utilisation des coordonnées pour organiser la livraison');
      fail(typeof p.submissionId!=='string'||! /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p.submissionId),400,'Solicitud incorrecta / Demande invalide');
      fail(typeof p.statusToken!=='string'||! /^[a-f0-9]{64}$/.test(p.statusToken),400,'Solicitud incorrecta / Demande invalide');
      const existing=one('SELECT id,status_token_hash FROM delivery_requests WHERE submission_id=?',p.submissionId);
      if(existing){
        fail(existing.status_token_hash!==hash(p.statusToken),409,'Solicitud ya registrada / Demande déjà enregistrée');
        return {id:existing.id,reference:'TAC-'+existing.id.slice(0,12).toUpperCase()};
      }
      fail(p.acceptPrice!==true,400,'Acepta el precio para continuar / Acceptez le prix pour continuer');
      fail(!!one('SELECT id FROM deliveries WHERE admin_quote_id=?',p.quoteId||''),409,'Cotización ya utilizada / Devis déjà utilisé');
      p={...p,...routeInput(p)};
      const tipCents=p.tipCents??0;
      fail(!TIP_OPTIONS.includes(tipCents),400,'Propina incorrecta / Pourboire invalide');
      const fields={requesterName:120,pickup:500,destination:500,recipientName:100,recipientPhone:40,itemDescription:500};
      for(const [key,max] of Object.entries(fields))fail(typeof p[key]!=='string'||!p[key].trim()||p[key].length>max,400,'Completa los campos obligatorios / Remplissez les champs obligatoires');
      const contactName=p.contactName??p.requesterName,contactPhone=p.contactPhone??'';
      fail(typeof contactName!=='string'||contactName.length>120||typeof contactPhone!=='string'||contactPhone.length>40,400,'Datos de contacto incorrectos / Coordonnées invalides');
      for(const phone of [contactPhone,p.recipientPhone].filter(Boolean))fail(!/^[+()\d .-]+$/.test(phone)||phone.replace(/\D/g,'').length<7||phone.replace(/\D/g,'').length>15,400,'Teléfono incorrecto / Téléphone invalide');
      const email=p.contactEmail??'',notes=p.notes??'',ready=p.readyAt??'';
      fail(typeof email!=='string'||email.length>254||(email.trim()&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())),400,'Correo incorrecto / Courriel invalide');
      fail(typeof notes!=='string'||notes.length>1000,400,'Instrucciones: máximo 1000 caracteres / Instructions : 1000 caractères maximum');
      fail(typeof ready!=='string'||(ready&&(!Number.isFinite(Date.parse(ready))||Date.parse(ready)<Date.now()-900000||Date.parse(ready)>Date.now()+30*86400000)),400,'Fecha de recogida incorrecta / Date de collecte invalide');
      const quote=one('SELECT * FROM delivery_quotes WHERE id=?',typeof p.quoteId==='string'?p.quoteId:'');
      fail(!quote||quote.expires_at<Date.now()||quote.tax_version!==1,409,'Cotización vencida. Calcula el precio nuevamente / Devis expiré. Recalculez le prix');
      fail(quote.pickup!==p.pickup.trim()||quote.destination!==p.destination.trim()||quote.ready_at!==(ready?new Date(ready).toISOString():''),409,'La ruta cambió. Calcula el precio nuevamente / Le trajet a changé. Recalculez le prix');
      fail(quote.pickup_postal_code!==p.pickupPostalCode||quote.destination_postal_code!==p.destinationPostalCode,409,'El código postal cambió. Calcula nuevamente / Code postal modifié. Recalculez le prix');
      fail(!!one('SELECT id FROM delivery_requests WHERE quote_id=?',quote.id),409,'Cotización ya aceptada / Devis déjà accepté');
      const rid=id();
      db.exec('BEGIN IMMEDIATE');
      try {
      run(`INSERT INTO delivery_requests(id,submission_id,requester_name,contact_name,contact_phone,contact_email,
        pickup,destination,recipient_name,recipient_phone,item_description,ready_at,notes,created_at,quote_id,status_token_hash,accepted_at,tip_cents,pickup_postal_code,destination_postal_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        rid,p.submissionId,p.requesterName.trim(),contactName.trim(),contactPhone.trim(),email.trim(),p.pickup.trim(),p.destination.trim(),
        p.recipientName.trim(),p.recipientPhone.trim(),p.itemDescription.trim(),ready?new Date(ready).toISOString():'',notes.trim(),Date.now(),quote.id,hash(p.statusToken),Date.now(),tipCents,p.pickupPostalCode,p.destinationPostalCode);
        if(awaitPayment)run('UPDATE delivery_requests SET terms_version=?,terms_content_sha256=?,terms_accepted_at=? WHERE id=?',TERMS_VERSION,TERMS_CONTENT_SHA256,Date.now(),rid);
        if(restaurant)run('UPDATE delivery_requests SET restaurant_user_id=? WHERE id=?',restaurant.id,rid);
        if(awaitPayment){
          run("UPDATE delivery_requests SET payment_state='awaiting_payment' WHERE id=?",rid);
          run('INSERT INTO request_payments(id,request_id,amount_cents,created_at) VALUES(?,?,?,?)',rid,rid,quote.total_cents+quote.gst_cents+quote.qst_cents+tipCents,Date.now());
        }else run('INSERT INTO request_emails(request_id,next_attempt_at) VALUES(?,?)',rid,Date.now());
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      return {id:rid,reference:'TAC-'+rid.slice(0,12).toUpperCase()};
    },
    requestStatus(rid,token) {
      const r=one(`SELECT r.id,r.status,r.payment_state,r.status_token_hash,r.tip_cents,d.status AS delivery_status,u.name AS driver_name,q.total_cents,q.gst_cents,q.qst_cents
        FROM delivery_requests r LEFT JOIN deliveries d ON d.id=r.delivery_id LEFT JOIN users u ON u.id=d.driver_id
        LEFT JOIN delivery_quotes q ON q.id=r.quote_id WHERE r.id=?`,rid);
      fail(!r||!r.status_token_hash||r.status_token_hash!==hash(token||''),404,'Solicitud no encontrada / Demande introuvable');
      const payment=one('SELECT status,checkout_url,expires_at FROM request_payments WHERE request_id=?',rid);
      return {reference:'TAC-'+r.id.slice(0,12).toUpperCase(),status:r.payment_state==='awaiting_payment'?'awaiting_payment':r.status==='assigned'?r.delivery_status:r.status,paymentStatus:payment?.status||'legacy',checkoutUrl:payment?.status==='unpaid'&&payment.expires_at>Date.now()?payment.checkout_url:null,driverName:r.driver_name||'',deliveryFareCents:r.total_cents,gstCents:r.gst_cents,qstCents:r.qst_cents,tipCents:r.tip_cents,totalCents:r.total_cents+r.gst_cents+r.qst_cents+r.tip_cents,currency:'CAD'};
    },
    confirmPayment(session){
      const payment=one('SELECT * FROM request_payments WHERE id=?',session.metadata?.request_id||'');
      if(!payment||!payment.request_id)return {ignored:true};
      fail(session.mode!=='payment'||session.payment_status!=='paid'||session.currency!=='cad'||session.amount_total!==payment.amount_cents||session.client_reference_id!==payment.id||typeof session.id!=='string'||!session.id.startsWith('cs_')||(payment.session_id&&payment.session_id!==session.id),400,'Pago incompatible / Paiement incompatible');
      if(payment.status==='paid')return {duplicate:true};
      db.exec('BEGIN IMMEDIATE');
      try{
        run("UPDATE request_payments SET status='paid',session_id=?,paid_at=? WHERE id=? AND status!='paid'",session.id,Date.now(),payment.id);
        run("UPDATE delivery_requests SET payment_state='paid',admin_removed_at=NULL WHERE id=? AND payment_state='awaiting_payment'",payment.request_id);
        run('UPDATE delivery_quotes SET admin_removed_at=NULL WHERE id=(SELECT quote_id FROM delivery_requests WHERE id=?)',payment.request_id);
        run('INSERT OR IGNORE INTO request_emails(request_id,next_attempt_at) VALUES(?,?)',payment.request_id,Date.now());
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      return {paid:true};
    },
    requests(u) {
      admin(u);store.pruneHistory();
      return db.prepare(`SELECT r.*,d.status AS delivery_status,d.commission_cents,d.driver_payout_cents,q.total_cents,q.gst_cents,q.qst_cents,q.distance_meters,q.distance_cents,q.traffic_cents,q.duration_seconds,q.baseline_seconds
        FROM delivery_requests r LEFT JOIN deliveries d ON d.id=r.delivery_id LEFT JOIN delivery_quotes q ON q.id=r.quote_id
        WHERE r.admin_removed_at IS NULL AND r.payment_state IN ('legacy','paid') AND (d.id IS NULL OR d.status!='delivered' OR d.completed_at>?)
        ORDER BY CASE WHEN r.status='pending' THEN 0 ELSE 1 END,r.created_at DESC`).all(Date.now()-5*86400000).map(({submission_id,status_token_hash,...r})=>({...r,canDelete:!r.delivery_id&&(r.status==='declined'||r.status==='pending'&&r.created_at<Date.now()-3600000),reference:'TAC-'+r.id.slice(0,12).toUpperCase()}));
    },
    removeRequest(u,rid){
      admin(u);
      const r=one('SELECT * FROM delivery_requests WHERE id=?',rid);
      fail(!r,404,'Solicitud no encontrada / Demande introuvable');
      fail(r.delivery_id||!(r.status==='declined'||r.status==='pending'&&r.created_at<Date.now()-3600000),409,'Solo puedes eliminar solicitudes rechazadas o en espera más de una hora, sin repartidor asignado / Seules les demandes refusées ou en attente depuis plus d’une heure, sans livreur assigné, peuvent être supprimées');
      const now=Date.now();db.exec('BEGIN IMMEDIATE');
      try{
        run('UPDATE delivery_requests SET admin_removed_at=COALESCE(admin_removed_at,?) WHERE id=?',now,rid);
        run('UPDATE delivery_quotes SET admin_removed_at=COALESCE(admin_removed_at,?) WHERE id=?',now,r.quote_id);
        run('UPDATE request_emails SET skipped_at=COALESCE(skipped_at,?) WHERE request_id=? AND sent_at IS NULL',now,rid);
        run('UPDATE quote_emails SET skipped_at=COALESCE(skipped_at,?) WHERE quote_id=? AND sent_at IS NULL',now,r.quote_id);
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      return {ok:true};
    },
    removeQuoteActivity(u,qid){
      admin(u);
      const q=one('SELECT * FROM delivery_quotes WHERE id=? AND public_quote=1',qid);
      fail(!q,404,'Cotización no encontrada / Devis introuvable');
      const r=one('SELECT id FROM delivery_requests WHERE quote_id=?',qid);
      if(r)return store.removeRequest(u,r.id);
      fail(q.created_at>=Date.now()-3600000||!!one('SELECT id FROM deliveries WHERE admin_quote_id=?',qid),409,'La cotización debe llevar más de una hora sin completar / Le devis doit être incomplet depuis plus d’une heure');
      const now=Date.now();db.exec('BEGIN IMMEDIATE');
      try{
        run('UPDATE delivery_quotes SET admin_removed_at=COALESCE(admin_removed_at,?) WHERE id=?',now,qid);
        run('UPDATE quote_emails SET skipped_at=COALESCE(skipped_at,?) WHERE quote_id=? AND sent_at IS NULL',now,qid);
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      return {ok:true};
    },
    declineRequest(u,rid) {
      admin(u);
      const r=one('SELECT * FROM delivery_requests WHERE id=?',rid);
      fail(!r,404,'Solicitud no encontrada / Demande introuvable');
      fail(r.admin_removed_at!=null,409,'Solicitud eliminada del panel / Demande supprimée du panneau');
      fail(r.payment_state==='awaiting_payment',409,'Pago pendiente / Paiement en attente');
      fail(r.status!=='pending',409,'Solicitud ya procesada / Demande déjà traitée');
      run("UPDATE delivery_requests SET status='declined',reviewed_at=? WHERE id=? AND status='pending'",Date.now(),rid);
      return {ok:true};
    },
    assignQuotedDelivery(u,p) {
      admin(u);
      fail(p.acceptPrice!==true||typeof p.quoteId!=='string',400,'Calcula y acepta el precio / Calculez et acceptez le prix');
      const route=routeInput(p),tipCents=p.tipCents??0;
      fail(!TIP_OPTIONS.includes(tipCents),400,'Propina incorrecta / Pourboire invalide');
      const quote=one('SELECT * FROM delivery_quotes WHERE id=?',p.quoteId);
      fail(!quote,409,'Cotización no encontrada / Devis introuvable');
      fail(['pickup','destination','pickupPostalCode','destinationPostalCode','readyAt'].some(k=>route[k]!==quote[({pickupPostalCode:'pickup_postal_code',destinationPostalCode:'destination_postal_code',readyAt:'ready_at'})[k]||k]),409,'Las direcciones cambiaron. Recalcula el precio / Les adresses ont changé. Recalculez le prix');
      const existing=one('SELECT * FROM deliveries WHERE admin_quote_id=?',quote.id);
      if(existing){
        fail(existing.driver_id!==p.driverId||existing.tip_cents!==tipCents,409,'Cotización ya asignada / Devis déjà assigné');
        return existing;
      }
      fail(quote.expires_at<Date.now()||quote.tax_version!==1,409,'Cotización vencida. Recalcula el precio / Devis expiré. Recalculez le prix');
      fail(!!one('SELECT id FROM delivery_requests WHERE quote_id=?',quote.id),409,'Cotización ya utilizada / Devis déjà utilisé');
      return store.createDelivery(u,{pickup:route.pickup,destination:route.destination,driverId:p.driverId}, {...quote,tipCents});
    },
    createDelivery(u,p,manualQuote=null) {
      admin(u);
      const request=p.requestId?one('SELECT * FROM delivery_requests WHERE id=?',p.requestId):null;
      if(p.requestId){
        fail(!request,404,'Solicitud no encontrada / Demande introuvable');
        fail(request.admin_removed_at!=null,409,'Solicitud eliminada del panel / Demande supprimée du panneau');
        fail(request.payment_state==='awaiting_payment',409,'Pago pendiente / Paiement en attente');
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
      const quote=request?one('SELECT total_cents,gst_cents,qst_cents FROM delivery_quotes WHERE id=?',request.quote_id):manualQuote;
      const split=quote?splitDeliveryPrice(quote.total_cents,request?request.tip_cents:manualQuote.tipCents,{gstCents:quote.gst_cents,qstCents:quote.qst_cents}):null;
      db.exec('BEGIN IMMEDIATE');
      try {
        run('INSERT INTO deliveries(id,pickup,destination,driver_id,created_at,batch_id,total_price_cents,commission_cents,driver_payout_cents,delivery_fare_cents,tip_cents,gst_cents,qst_cents) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',did,p.pickup.trim(),p.destination.trim(),p.driverId,now,joining?d.batch.id:did,split?.totalPriceCents??null,split?.commissionCents??null,split?.driverPayoutCents??null,split?.deliveryFareCents??null,split?.tipCents??null,split?.gstCents??null,split?.qstCents??null);
        if(manualQuote)run('UPDATE deliveries SET admin_quote_id=? WHERE id=?',manualQuote.id,did);
        run('INSERT INTO assignment_emails(delivery_id,next_attempt_at) VALUES(?,?)',did,now);
        run(`INSERT INTO native_push_jobs(delivery_id,token,created_at,next_attempt_at)
          SELECT ?,t.token,?,? FROM native_push_tokens t JOIN sessions s ON s.token=t.session_token
          WHERE t.user_id=? AND s.expires>?`,did,now,now,p.driverId,now);
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
      const completedAt=status==='delivered'?Date.now():null;
      run('UPDATE deliveries SET status=?,completed_at=? WHERE id=?',status,completedAt,did); return {...d,status,completed_at:completedAt};
    }
  };
  return store;
}
