import {emailConfig} from './assignment-mail.mjs';

export async function checkEmail(env=process.env,{loadMailer=()=>import('nodemailer'),timeoutMs=18000}={}) {
  const required=['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','PUBLIC_APP_URL'];
  if(String(env.ASSIGNMENT_EMAIL_ENABLED || '').trim()!=='true')return {ok:false,code:'email_disabled'};
  const missing=required.filter(key=>!env[key] || !String(env[key]).trim());
  if(missing.length)return {ok:false,code:'email_missing',missing};
  let config;
  try {config=emailConfig(env);}catch{return {ok:false,code:'email_invalid'};}
  let transport,timer;
  try {
    const {default:mail}=await loadMailer();
    transport=mail.createTransport({host:config.host,port:config.port,
      secure:config.port===465,requireTLS:config.port===587,
      auth:{user:config.user,pass:config.password},
      connectionTimeout:8000,greetingTimeout:8000,socketTimeout:8000});
    await Promise.race([transport.verify(),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Object.assign(Error('timeout'),{code:'ETIMEDOUT'})),timeoutMs);
    })]);
    return {ok:true,code:'email_ready'};
  }catch(e){
    if(e.code==='ERR_MODULE_NOT_FOUND')return {ok:false,code:'email_dependency'};
    if(e.code==='EAUTH' || [534,535].includes(e.responseCode))return {ok:false,code:'email_auth'};
    if(['ETIMEDOUT','ESOCKET','ECONNECTION','EDNS','ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET'].includes(e.code))return {ok:false,code:'email_network'};
    if(/CERT|TLS|SSL/.test(e.code || ''))return {ok:false,code:'email_tls'};
    return {ok:false,code:'email_failed'};
  }finally {clearTimeout(timer);try {transport?.close();}catch{}}
}
