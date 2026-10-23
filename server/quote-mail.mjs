import {requestEmailConfig} from './request-mail.mjs';
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function quoteMessage(job,config){
 const reference='DEV-'+job.id.slice(0,12).toUpperCase();
 const money=c=>new Intl.NumberFormat('fr-CA',{style:'currency',currency:'CAD'}).format(c/100)+' CAD';
 const fields=[['Référence / Referencia',reference],['Collecte / Recogida',job.pickup],['Destination / Destino',job.destination],['Devis avec taxes, hors pourboire / Cotización con impuestos, sin propina',money(job.total_cents+job.gst_cents+job.qst_cents)]];
 const intro='Un client a calculé un prix. Aucun paiement confirmé à ce stade : ne pas attribuer ce devis. / Un cliente calculó un precio. Este aviso no confirma un pago: todavía no asignes esta cotización.';
 return {from:{name:'ToutAunClicLa · Livraison',address:config.from},to:{name:'ToutAunClicLa · Service client',address:config.recipient},subject:'Devis calculé, paiement non confirmé / Cotización realizada, sin pago confirmado · '+reference,
   messageId:`<quote-${job.id}@${config.from.split('@')[1]}>`,text:intro+'\n\n'+fields.map(([k,v])=>k+': '+v).join('\n')+'\n\n'+config.appUrl+'/',
   html:'<!doctype html><html><body style="font:16px Arial,sans-serif;color:#292239;padding:24px"><h1>ToutAunClicLa</h1><p>'+escape(intro)+'</p>'+fields.map(([k,v])=>'<p><strong>'+escape(k)+'</strong><br>'+escape(v)+'</p>').join('')+'<p><a href="'+escape(config.appUrl)+'/">Ouvrir le panneau / Abrir el panel</a></p></body></html>',disableFileAccess:true,disableUrlAccess:true};
}
export function createQuoteMailer(store,{env=process.env,send,now=Date.now,log=console}={}){
 let config=null,sender=send,busy=false,timer,stopped=false;
 try{if(env.QUOTE_EMAIL_ENABLED?.trim()!=='false')config=requestEmailConfig(env)}catch{log.error('Avisos de cotización desactivados: revisa la configuración SMTP.');}
 async function flush(){
   if(!config||busy||stopped)return;busy=true;
   try{
     if(!sender){const {default:nodemailer}=await import('nodemailer');const transport=nodemailer.createTransport({host:config.host,port:config.port,secure:config.port===465,requireTLS:config.port===587,auth:{user:config.user,pass:config.password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true});sender=m=>transport.sendMail(m)}
     const at=now();
     store.db.prepare('UPDATE quote_emails SET skipped_at=? WHERE sent_at IS NULL AND skipped_at IS NULL AND quote_id IN (SELECT id FROM delivery_quotes WHERE created_at<?)').run(at,at-86400000);
     const jobs=store.db.prepare(`SELECT e.quote_id,q.* FROM quote_emails e JOIN delivery_quotes q ON q.id=e.quote_id WHERE e.sent_at IS NULL AND e.skipped_at IS NULL AND e.attempts<5 AND e.next_attempt_at<=? ORDER BY q.created_at LIMIT 5`).all(at);
     for(const job of jobs){
       if(stopped)break;
       store.db.prepare('UPDATE quote_emails SET attempts=attempts+1,next_attempt_at=? WHERE quote_id=?').run(now()+60000,job.id);
       try{const result=await sender(quoteMessage(job,config));if(!result?.accepted?.some(a=>a.toLowerCase()===config.recipient.toLowerCase()))throw Error();store.db.prepare('UPDATE quote_emails SET sent_at=?,last_error=NULL WHERE quote_id=?').run(now(),job.id)}
       catch{store.db.prepare("UPDATE quote_emails SET last_error='smtp_send_failed' WHERE quote_id=?").run(job.id);log.error('No se pudo enviar un aviso de cotización; se reintentará (máximo 5 intentos).');}
     }
   }catch{log.error('No se pudo procesar la cola de cotizaciones.');}finally{busy=false}
 }
 return {flush,start(){if(timer||!config)return;stopped=false;void flush();timer=setInterval(()=>void flush(),30000);timer.unref()},stop(){stopped=true;clearInterval(timer);timer=null},status(){return {configured:!!config,recipient:config?.recipient||''}}};
}
