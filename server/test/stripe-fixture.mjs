import {createHmac} from 'node:crypto';
export function stripeFixture(){
 process.env.STRIPE_SECRET_KEY='sk_test_fixture_only';process.env.STRIPE_WEBHOOK_SECRET='whsec_fixture_only';process.env.PUBLIC_APP_URL='https://delivery.example.test';
 const sessions=new Map();
 function respond(url,options){
   if(url!=='https://api.stripe.com/v1/checkout/sessions')throw Error('Unexpected external test request');
   const p=new URLSearchParams(options.body),id=p.get('metadata[request_id]');
   if(!sessions.has(id))sessions.set(id,{id:'cs_test_'+id,metadata:{request_id:id},client_reference_id:id,mode:'payment',payment_status:'unpaid',currency:'cad',livemode:false,amount_total:Number(p.get('line_items[0][price_data][unit_amount]')),expires_at:Number(p.get('expires_at')),url:'https://checkout.stripe.com/c/pay/cs_test_'+id});
   return {ok:true,json:async()=>sessions.get(id)};
 }
 async function pay(fetcher,base,id,overrides={},signatureOverride){
   const raw=JSON.stringify({id:'evt_test_'+id,type:'checkout.session.completed',livemode:false,data:{object:{...sessions.get(id),payment_status:'paid',...overrides}}});
   const stamp=Math.floor(Date.now()/1000),signature='t='+stamp+',v1='+createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(stamp+'.'+raw).digest('hex');
   return fetcher(base+'/stripe/webhook',{method:'POST',headers:{'Stripe-Signature':signatureOverride||signature},body:raw});
 }
 return {respond,pay,sessions};
}
