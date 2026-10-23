import {createHmac,timingSafeEqual} from 'node:crypto';
import {Problem} from './core.mjs';

export function paymentConfig(env=process.env){
 const key=env.STRIPE_SECRET_KEY?.trim(),webhookSecret=env.STRIPE_WEBHOOK_SECRET?.trim();
 let base;try{base=new URL(env.PUBLIC_APP_URL)}catch{}
 if(!key||!webhookSecret||!base||base.protocol!=='https:'||base.username||base.password)throw new Problem(503,'Pago no disponible por el momento. Contacta a ToutAunClicLa / Paiement temporairement indisponible. Contactez ToutAunClicLa');
 return {key,webhookSecret,appUrl:base.origin,live:/^(sk|rk)_live_/.test(key)};
}
export function verifyStripeEvent(raw,signature,config,now=Date.now()){
 const fields=typeof signature==='string'?signature.split(','):[];
 const stamp=fields.find(x=>x.startsWith('t='))?.slice(2);
 if(!stamp||!/^\d+$/.test(stamp)||Math.abs(now/1000-Number(stamp))>300)throw new Problem(400,'Firma Stripe incorrecta');
 const expected=createHmac('sha256',config.webhookSecret).update(stamp+'.').update(raw).digest();
 const valid=fields.filter(x=>x.startsWith('v1=')).some(x=>{const value=x.slice(3);return /^[a-f0-9]{64}$/.test(value)&&timingSafeEqual(expected,Buffer.from(value,'hex'))});
 if(!valid)throw new Problem(400,'Firma Stripe incorrecta');
 let event;try{event=JSON.parse(raw.toString('utf8'))}catch{throw new Problem(400,'Evento Stripe incorrecto')}
 if(event.livemode!==config.live)throw new Problem(400,'Modo Stripe incompatible');
 return event;
}
export async function checkout(store,request,token,{env=process.env,fetcher=fetch}={}){
 const config=paymentConfig(env);
 store.requestStatus(request.id,token);
 const payment=store.db.prepare('SELECT * FROM request_payments WHERE request_id=?').get(request.id);
 if(!payment)throw new Problem(409,'Solicitud anterior sin pago Stripe / Demande antérieure sans paiement Stripe');
 if(payment.status==='paid')return {...request,paid:true};
 if(payment.session_id){
   if(payment.expires_at<=Date.now())throw new Problem(409,'El enlace de pago venció. Inicia una nueva solicitud / Le lien de paiement a expiré. Créez une nouvelle demande');
   return {...request,checkoutUrl:payment.checkout_url};
 }
 // The persisted creation time fixes parameters across retries and restarts.
 if(Date.now()-payment.created_at>23*3600000)throw new Problem(409,'Inicia una nueva solicitud / Créez une nouvelle demande');
 const back=config.appUrl+'/demander#'+request.id+'.'+token;
 const params=new URLSearchParams({mode:'payment',client_reference_id:payment.id,'metadata[request_id]':payment.id,
   'payment_intent_data[metadata][request_id]':payment.id,success_url:back,cancel_url:back,
   expires_at:String(Math.floor(payment.created_at/1000)+1860),
   'line_items[0][quantity]':'1','line_items[0][price_data][currency]':'cad',
   'line_items[0][price_data][unit_amount]':String(payment.amount_cents),
   'line_items[0][price_data][product_data][name]':'ToutAunClicLa · Livraison · '+request.reference,
   'line_items[0][price_data][product_data][description]':'Total CAD incluant TPS, TVQ et pourboire choisi / Total CAD con TPS, TVQ y propina elegida'});
 // A 31-minute Checkout window allows creation time while keeping parameters stable on retries.
 let response,session;
 try{
   response=await fetcher('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':'tacl-delivery-'+payment.id},body:params.toString(),signal:AbortSignal.timeout(15000)});
   session=await response.json();
 }catch{throw new Problem(503,'Stripe no respondió. Reintenta el mismo pago / Stripe ne répond pas. Réessayez le même paiement')}
 if(!response.ok||typeof session.id!=='string'||!session.id.startsWith('cs_')||typeof session.url!=='string'||!session.url.startsWith('https://checkout.stripe.com/')||session.amount_total!==payment.amount_cents||session.currency!=='cad'||session.livemode!==config.live||!Number.isSafeInteger(session.expires_at)||session.expires_at*1000<=Date.now())throw new Problem(503,'No se pudo preparar el pago Stripe / Impossible de préparer le paiement Stripe');
 store.db.prepare('UPDATE request_payments SET session_id=?,checkout_url=?,expires_at=? WHERE id=? AND (session_id IS NULL OR session_id=?)').run(session.id,session.url,session.expires_at*1000,payment.id,session.id);
 return {...request,checkoutUrl:session.url};
}
