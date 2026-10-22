import {emailConfig} from './assignment-mail.mjs';
const h=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function passwordMessage(account,config){
 const url=config.appUrl+'/reset-password#'+account.token;
 const text='Bonjour / Hola '+account.name+',\n\nRéinitialisez votre mot de passe / Restablece tu contraseña :\n'+url+'\n\nCe lien expire dans 30 minutes et ne fonctionne qu’une fois. / Este enlace vence en 30 minutos y solo se puede usar una vez.\nSi vous n’avez pas fait cette demande, ignorez ce message. / Si no solicitaste este cambio, ignora este correo.';
 return {from:{name:'ToutAunClicLa',address:config.from},to:{name:account.name,address:account.email},subject:'Réinitialiser le mot de passe / Restablecer contraseña · ToutAunClicLa',text,
 html:'<!doctype html><html><body style="padding:24px;background:#f7f5fb;font:16px Arial,sans-serif;color:#292239"><main style="max-width:600px;margin:auto;background:white;padding:24px;border-radius:16px"><h1 style="color:#572794">ToutAunClicLa</h1><p>Bonjour / Hola '+h(account.name)+'</p><p><a href="'+h(url)+'" style="display:inline-block;background:#6332a0;color:white;padding:14px 22px;border-radius:8px;text-decoration:none">Réinitialiser mon mot de passe / Restablecer mi contraseña</a></p><p>Ce lien expire dans 30 minutes et ne fonctionne qu’une fois.<br>Este enlace vence en 30 minutos y solo se puede usar una vez.</p><p>Si vous n’avez pas fait cette demande, ignorez ce message.<br>Si no solicitaste este cambio, ignora este correo.</p></main></body></html>',disableFileAccess:true,disableUrlAccess:true};
}
export function createPasswordMailer({env=process.env,send,log=console}={}){
 let config=null,sender=send;
 try{if(env.PASSWORD_RESET_EMAIL_ENABLED!=='false')config=emailConfig({...env,ASSIGNMENT_EMAIL_ENABLED:'true'})}catch{log.error('Recuperación por correo sin configurar. Revisa SMTP y PUBLIC_APP_URL.');}
 return {async send(account){
  if(!account||!config)return;
  try{
   if(!sender){const {default:nodemailer}=await import('nodemailer');const transport=nodemailer.createTransport({host:config.host,port:config.port,secure:config.port===465,requireTLS:config.port===587,auth:{user:config.user,pass:config.password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true});sender=message=>transport.sendMail(message)}
   const result=await sender(passwordMessage(account,config));if(!result?.accepted?.some(address=>address.toLowerCase()===account.email.toLowerCase()))throw Error('recipient_rejected');
  }catch{log.error('No se pudo enviar un enlace de recuperación. La cuenta puede solicitar otro enlace.');}
 }};
}
