import {emailConfig} from './assignment-mail.mjs';
const h=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mailbox=value=>typeof value==='string'&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);

export function requestEmailConfig(env=process.env){
 if(env.REQUEST_EMAIL_ENABLED?.trim()==='false')return null;
 const recipient=(env.REQUEST_NOTIFICATION_EMAIL??'serviceclient@toutaunclicla.com').trim();
 if(!mailbox(recipient))throw Error('REQUEST_NOTIFICATION_EMAIL incorrecto');
 const config=emailConfig({...env,ASSIGNMENT_EMAIL_ENABLED:'true'});
 return {...config,recipient};
}
export function requestMessage(job,config){
 const reference='TAC-'+job.request_id.slice(0,12).toUpperCase();
 const price=c=>new Intl.NumberFormat('fr-CA',{style:'currency',currency:'CAD'}).format(c/100)+' CAD';
 const total=job.total_cents+job.gst_cents+job.qst_cents+job.tip_cents;
 const ready=job.ready_at?new Date(job.ready_at).toLocaleString('fr-CA',{timeZone:'America/Toronto'}):'Dès que possible / Lo antes posible';
 const fields=[['Référence / Referencia',reference],['Nom du demandeur ou de l’entreprise / Nombre del solicitante o negocio',job.requester_name],['Collecte / Recogida',job.pickup],['Livraison / Destino',job.destination],['Collecte souhaitée / Recogida solicitada',ready],['Envoi / Envío',job.item_description],['Prix confirmé, taxes incluses / Precio confirmado, tasas incluidas',price(total)],['Pourboire inclus dans le total / Propina incluida en el total',price(job.tip_cents)]];
 const url=config.appUrl+'/';
 const intro=(job.payment_state==='paid'?'Paiement Stripe confirmé / Pago Stripe confirmado. ':'')+'Une nouvelle demande de livraison attend votre attribution. / Tienes una nueva solicitud de livraison pendiente de asignar.';
 return {from:{name:'ToutAunClicLa · Livraison',address:config.from},to:{name:'ToutAunClicLa · Service client',address:config.recipient},
  subject:(job.payment_state==='paid'?'Paiement confirmé / Pago confirmado · ':'')+'Nouvelle demande de livraison / Nueva solicitud de livraison · '+reference,
  messageId:`<request-${job.request_id}@${config.from.split('@')[1]}>`,
  text:intro+'\n\n'+fields.map(([label,value])=>label+': '+value).join('\n')+'\n\nOuvrir le panneau / Abrir el panel: '+url,
  html:'<!doctype html><html><body style="margin:0;padding:24px;background:#f7f5fb;font:16px Arial,sans-serif;color:#292239"><main style="max-width:600px;margin:auto;padding:24px;background:white;border-radius:16px"><h1 style="font-size:22px;color:#572794">ToutAunClicLa</h1><p>'+h(intro)+'</p>'+fields.map(([label,value])=>'<p><strong>'+h(label)+'</strong><br>'+h(value)+'</p>').join('')+'<p><a href="'+h(url)+'" style="display:inline-block;background:#6332a0;color:white;text-decoration:none;padding:14px 22px;border-radius:8px">Ouvrir le panneau / Abrir el panel</a></p><p>Connexion administrateur requise / Acceso de administrador requerido.</p></main></body></html>',
  disableFileAccess:true,disableUrlAccess:true};
}
export function createRequestMailer(store,{env=process.env,send,now=Date.now,log=console}={}){
 let config=null,sender=send,busy=false,timer,stopped=false;
 try{config=requestEmailConfig(env)}catch{log.error('Avisos de solicitudes desactivados: revisa SMTP, PUBLIC_APP_URL y REQUEST_NOTIFICATION_EMAIL.');}
 async function flush(){
  if(!config||busy||stopped)return;
  busy=true;
  try{
   if(!sender){const {default:nodemailer}=await import('nodemailer');const transport=nodemailer.createTransport({host:config.host,port:config.port,secure:config.port===465,requireTLS:config.port===587,auth:{user:config.user,pass:config.password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true});sender=message=>transport.sendMail(message)}
   const at=now();
   store.db.prepare(`UPDATE request_emails SET skipped_at=? WHERE sent_at IS NULL AND skipped_at IS NULL AND request_id IN (SELECT id FROM delivery_requests WHERE admin_removed_at IS NOT NULL OR status!='pending' OR COALESCE((SELECT paid_at FROM request_payments WHERE request_id=delivery_requests.id),created_at)<?)`).run(at,at-86400000);
   const jobs=store.db.prepare(`SELECT e.*,r.payment_state,r.requester_name,r.pickup,r.destination,r.ready_at,r.item_description,r.tip_cents,q.total_cents,q.gst_cents,q.qst_cents
    FROM request_emails e JOIN delivery_requests r ON r.id=e.request_id JOIN delivery_quotes q ON q.id=r.quote_id
    WHERE r.admin_removed_at IS NULL AND e.sent_at IS NULL AND e.skipped_at IS NULL AND e.attempts<5 AND e.next_attempt_at<=? ORDER BY r.created_at LIMIT 5`).all(at);
   for(const job of jobs){
    if(stopped)break;
    const current=store.db.prepare('SELECT status,admin_removed_at FROM delivery_requests WHERE id=?').get(job.request_id);if(current?.status!=='pending'||current.admin_removed_at!=null)continue;
    const attempts=job.attempts+1;
    store.db.prepare('UPDATE request_emails SET attempts=?,next_attempt_at=? WHERE request_id=?').run(attempts,now()+Math.min(3600000,60000*2**(attempts-1)),job.request_id);
    try{
     const result=await sender(requestMessage(job,config));
     if(!result?.accepted?.some(address=>address.toLowerCase()===config.recipient.toLowerCase()))throw Error('recipient_rejected');
     store.db.prepare('UPDATE request_emails SET sent_at=?,last_error=NULL WHERE request_id=?').run(now(),job.request_id);
    }catch{store.db.prepare('UPDATE request_emails SET last_error=? WHERE request_id=?').run('smtp_send_failed',job.request_id);log.error('No se pudo enviar un aviso de solicitud; queda guardado para reintento (máximo 5 intentos).');}
   }
  }catch{log.error('No se pudo procesar la cola de avisos de solicitudes. Revisa SMTP y la base de datos.');}finally{busy=false}
 }
 return {flush,start(){if(timer||!config)return;stopped=false;void flush();timer=setInterval(()=>void flush(),30000);timer.unref()},stop(){stopped=true;clearInterval(timer);timer=null},status(){return {configured:!!config,recipient:config?.recipient||''}}};
}
