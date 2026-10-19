import {createStore} from './core.mjs';

// Runs only on the first deployment. Existing credentials are never reset by a restart.
export function bootstrapAdmin(path,env=process.env) {
  const store=createStore(path);
  try {
    if(store.db.prepare('SELECT COUNT(*) AS count FROM users').get().count>0)return false;
    if(!env.ADMIN_EMAIL&&!env.ADMIN_PASSWORD)return false;
    if(!env.ADMIN_EMAIL||!env.ADMIN_PASSWORD)throw Error('Configure ADMIN_EMAIL y ADMIN_PASSWORD en el servidor.');
    store.createUser({email:env.ADMIN_EMAIL,name:'Administration ToutAunClicLa',password:env.ADMIN_PASSWORD,role:'admin'});
    return true;
  }finally{store.db.close()}
}
