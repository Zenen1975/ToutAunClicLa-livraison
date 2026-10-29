// The service account key lives in EAS, never in this server or the APK.
const base='https://exp.host/--/api/v2/push/';
export function createNativePush(store,{fetchImpl=fetch,now=Date.now,env=process.env}={}){
  const db=store.db;let busy=false,timer;
  async function post(route,payload){
    const r=await fetchImpl(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(env.EXPO_ACCESS_TOKEN?{Authorization:'Bearer '+env.EXPO_ACCESS_TOKEN}:{})},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw Error('Expo HTTP '+r.status);
    const result=await r.json();if(result.errors?.length)throw Error('Expo rejected push request');return result.data;
  }
  const finish=(job,error=null)=>db.prepare('UPDATE native_push_jobs SET processed_at=?,last_error=? WHERE id=?').run(now(),error,job.id);
  const retry=(job,error)=>db.prepare('UPDATE native_push_jobs SET attempts=attempts+1,next_attempt_at=?,last_error=? WHERE id=?').run(now()+Math.min(300000,15000*2**job.attempts),error,job.id);
  function invalid(job,result){
    if(result?.details?.error==='DeviceNotRegistered'){db.prepare('DELETE FROM native_push_tokens WHERE token=?').run(job.token);return true;}
    return false;
  }
  async function flush(){
    if(busy)return;busy=true;
    try{
      db.prepare('DELETE FROM native_push_tokens WHERE session_token IN (SELECT token FROM sessions WHERE expires<=?)').run(now());
      const jobs=db.prepare(`SELECT j.*,d.status,d.driver_id,t.user_id,t.language FROM native_push_jobs j
        JOIN deliveries d ON d.id=j.delivery_id JOIN native_push_tokens t ON t.token=j.token
        WHERE j.processed_at IS NULL AND j.next_attempt_at<=? ORDER BY j.id LIMIT 30`).all(now());
      for(const job of jobs){
        const current=db.prepare(`SELECT 1 FROM native_push_tokens t JOIN sessions s ON s.token=t.session_token
          JOIN deliveries d ON d.id=? WHERE t.token=? AND t.user_id=? AND s.expires>? AND d.driver_id=t.user_id AND d.status='assigned'`).get(job.delivery_id,job.token,job.user_id,now());
        if(!current){finish(job,'Registration or assignment revoked');continue;}

        if(job.status!=='assigned'||job.driver_id!==job.user_id||job.created_at<now()-3600000||job.attempts>=8){finish(job,'Expired or no longer assigned');continue;}
        try{
          if(job.ticket){
            const receipts=await post('getReceipts',{ids:[job.ticket]});const receipt=receipts?.[job.ticket];
            if(!receipt){retry(job,'Receipt pending');continue;}
            if(invalid(job,receipt))continue;
            finish(job,receipt.status==='ok'?null:(receipt.details?.error||'Provider rejected notification'));continue;
          }
          const es=job.language==='es';
          const ticket=await post('send',{to:job.token,title:es?'Nueva entrega asignada':'Nouvelle livraison assignée',
            body:es?'Abre ToutAunClicLa para ver tu entrega.':'Ouvrez ToutAunClicLa pour voir votre livraison.',
            sound:'assignment_jingle.wav',channelId:'deliveries-v1',priority:'high',ttl:3600,
            data:{type:'delivery-assigned',deliveryId:job.delivery_id}});
          if(invalid(job,ticket))continue;
          if(ticket?.status==='ok'&&ticket.id){
            db.prepare('UPDATE native_push_jobs SET ticket=?,next_attempt_at=?,last_error=NULL WHERE id=?').run(ticket.id,now()+900000,job.id);
          }else retry(job,ticket?.details?.error||'Notification rejected');
        }catch{retry(job,'Push service unavailable');}
      }
    }catch{console.error('Native delivery notification worker failed');}finally{busy=false;}
  }
  return {flush,start(){if(!timer){void flush();timer=setInterval(()=>void flush(),15000);timer.unref();}},stop(){clearInterval(timer);timer=null;}};
}
