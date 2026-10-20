const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mailbox = value => typeof value === 'string' && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);

export function emailConfig(env=process.env) {
  if(env.ASSIGNMENT_EMAIL_ENABLED !== 'true')return null;
  const port=Number(env.SMTP_PORT || 465);
  if(!env.SMTP_HOST || !mailbox(env.SMTP_USER) || !env.SMTP_PASSWORD || !mailbox(env.SMTP_FROM || env.SMTP_USER) || ![465,587].includes(port))throw Error('Configure SMTP_HOST, SMTP_PORT (465/587), SMTP_USER, SMTP_PASSWORD y SMTP_FROM.');
  const url=new URL(env.PUBLIC_APP_URL || '');
  if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.pathname!=='/')throw Error('PUBLIC_APP_URL debe ser el origen HTTPS del panel.');
  return {host:env.SMTP_HOST,port,user:env.SMTP_USER,password:env.SMTP_PASSWORD,from:env.SMTP_FROM || env.SMTP_USER,appUrl:url.origin};
}

export function assignmentMessage(job,config) {
  const url=config.appUrl+'/livreur';
  const text=`Bonjour ${job.name},\nUne nouvelle livraison vous a été assignée.\nCollecte : ${job.pickup}\nLivraison : ${job.destination}\nOuvrez votre espace livreur pour consulter la livraison : ${url}\n\nHola ${job.name},\nTienes una nueva entrega asignada.\nRecogida: ${job.pickup}\nDestino: ${job.destination}\nAbre tu panel de repartidor para consultar la entrega: ${url}\n\nTout à un clic là`;
  const h=escapeHtml;
  const block=(lang,title,greeting,pickup,destination,button)=>`<section lang="${lang}"><h2 style="color:#572794">${title}</h2><p>${greeting} ${h(job.name)},</p><p><strong>${pickup}</strong><br>${h(job.pickup)}</p><p><strong>${destination}</strong><br>${h(job.destination)}</p><p><a href="${h(url)}" style="display:inline-block;background:#6332a0;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px">${button}</a></p></section>`;
  return {from:{name:'Tout à un clic là · Livraison',address:config.from},to:{name:job.name,address:job.email},
    subject:'Nouvelle livraison assignée / Nueva entrega asignada · ToutAunClicLa',
    messageId:`<assignment-${job.delivery_id}@${config.from.split('@')[1]}>`,text,
    html:`<!doctype html><html><body style="margin:0;padding:24px;background:#f7f5fb;font:16px Arial,sans-serif;color:#292239"><main style="max-width:600px;margin:auto;padding:24px;background:white;border-radius:16px"><h1 style="font-size:22px;color:#572794">Tout à un clic là</h1>${block('fr','Une nouvelle livraison vous attend','Bonjour','Lieu de collecte :','Adresse de livraison :','Ouvrir mon espace livreur')}<hr style="border:0;border-top:1px solid #eee7f7;margin:28px 0">${block('es','Tienes una nueva entrega asignada','Hola','Lugar de recogida:','Dirección de entrega:','Abrir mi panel de repartidor')}</main></body></html>`,
    disableFileAccess:true,disableUrlAccess:true};
}

export function createAssignmentMailer(store,{env=process.env,send,now=Date.now,log=console}={}) {
  let config=null, sender=send, busy=false, timer, stopped=false;
  try {config=emailConfig(env);}catch {log.error('Correo de asignación desactivado: revisa las variables SMTP y PUBLIC_APP_URL.');}
  async function flush() {
    if(!config || busy || stopped)return;
    busy=true;
    try {
      if(!sender){
        const {default:nodemailer}=await import('nodemailer');
        const transport=nodemailer.createTransport({host:config.host,port:config.port,secure:config.port===465,requireTLS:config.port===587,
          auth:{user:config.user,pass:config.password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,
          disableFileAccess:true,disableUrlAccess:true});
        sender=message=>transport.sendMail(message);
      }
      const at=now();
      // Never send an old assignment or one the driver has already collected.
      store.db.prepare(`UPDATE assignment_emails SET skipped_at=? WHERE sent_at IS NULL AND skipped_at IS NULL
        AND delivery_id IN (SELECT id FROM deliveries WHERE status!='assigned' OR created_at<?)`).run(at,at-86400000);
      const jobs=store.db.prepare(`SELECT e.*,d.pickup,d.destination,u.name,u.email FROM assignment_emails e
        JOIN deliveries d ON d.id=e.delivery_id JOIN users u ON u.id=d.driver_id
        WHERE e.sent_at IS NULL AND e.skipped_at IS NULL AND e.attempts<5 AND e.next_attempt_at<=? ORDER BY d.created_at LIMIT 5`).all(at);
      for(const job of jobs){
        if(stopped)break;
        // Recheck after each asynchronous send: another request may have changed the delivery.
        if(store.db.prepare('SELECT status FROM deliveries WHERE id=?').get(job.delivery_id)?.status!=='assigned')continue;
        const attempts=job.attempts+1;
        store.db.prepare('UPDATE assignment_emails SET attempts=?,next_attempt_at=? WHERE delivery_id=?').run(attempts,now()+Math.min(3600000,60000*2**(attempts-1)),job.delivery_id);
        try {
          const result=await sender(assignmentMessage(job,config));
          if(!result?.accepted?.some(address=>address.toLowerCase()===job.email.toLowerCase()))throw Error('recipient_rejected');
          store.db.prepare('UPDATE assignment_emails SET sent_at=?,last_error=NULL WHERE delivery_id=?').run(now(),job.delivery_id);
        }catch {
          store.db.prepare('UPDATE assignment_emails SET last_error=? WHERE delivery_id=?').run('smtp_send_failed',job.delivery_id);
          log.error('No se pudo enviar un correo de asignación; se conserva para reintento (máximo 5 intentos).');
        }
      }
    }catch {log.error('No se pudo procesar la cola de correos de asignación. Revisa la instalación y configuración SMTP.');}
    finally {busy=false;}
  }
  return {flush,start(){if(timer || !config)return;stopped=false;void flush();timer=setInterval(()=>void flush(),30000);timer.unref();},stop(){stopped=true;clearInterval(timer);timer=null;}};
}
