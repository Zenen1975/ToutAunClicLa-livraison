import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

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
      driver_id TEXT REFERENCES users(id), status TEXT NOT NULL DEFAULT 'assigned', created_at INTEGER NOT NULL);`);
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
          const active=one("SELECT status FROM deliveries WHERE driver_id=? AND status!='delivered'",s.id);
          return {id:s.id,name:s.name,email:s.email,latitude:s.latitude,longitude:s.longitude,accuracy:s.accuracy,
            measuredAt:s.measured_at,lastUpdate:s.received_at,fresh,status:!s.shift_id?'offline':!fresh?'stale':active?.status || 'available'};
        });
    },
    deliveries(u) {
      return u.role==='admin' ? db.prepare('SELECT * FROM deliveries ORDER BY created_at DESC').all()
        : db.prepare('SELECT * FROM deliveries WHERE driver_id=? ORDER BY created_at DESC').all(u.id);
    },
    createDelivery(u,p) {
      admin(u);
      fail(typeof p.pickup!=='string'||!p.pickup.trim()||p.pickup.length>500||typeof p.destination!=='string'||!p.destination.trim()||p.destination.length>500,400,'Direcciones obligatorias / Adresses obligatoires');
      const d=store.drivers(u).find(d=>d.id===p.driverId);
      fail(!d || !d.fresh,409,'Repartidor sin GPS reciente / Livreur sans GPS récent');
      fail(d.status!=='available',409,'Repartidor ocupado / Livreur occupé');
      const did=id(); run('INSERT INTO deliveries(id,pickup,destination,driver_id,created_at) VALUES(?,?,?,?,?)',did,p.pickup.trim(),p.destination.trim(),p.driverId,Date.now());
      return one('SELECT * FROM deliveries WHERE id=?',did);
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
