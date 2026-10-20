import test from 'node:test';
import assert from 'node:assert/strict';
import {checkEmail} from '../email-check.mjs';
import {emailConfig} from '../assignment-mail.mjs';

const env={ASSIGNMENT_EMAIL_ENABLED:'true',SMTP_HOST:'smtp.example.test',SMTP_USER:'dispatch@example.test',SMTP_PASSWORD:'private-test-password',PUBLIC_APP_URL:'https://example.test'};
test('Mail check reports configuration problems without attempting SMTP or exposing values',async()=>{
 let loaded=0;const options={loadMailer:async()=>{loaded++;throw Error('must not load');}};
 assert.equal((await checkEmail({},options)).code,'email_disabled');
 const missing=await checkEmail({ASSIGNMENT_EMAIL_ENABLED:'true'},options);
 assert.deepEqual(missing.missing,['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','PUBLIC_APP_URL']);
 assert.equal((await checkEmail({...env,SMTP_USER:'invalid'},options)).code,'email_invalid');
 assert.equal((await checkEmail({...env,PUBLIC_APP_URL:'http://example.test'},options)).code,'email_invalid');
 assert.equal(loaded,0);
 assert.equal(emailConfig({...env,SMTP_HOST:' smtp.example.test\n',SMTP_USER:' dispatch@example.test\n'}).user,env.SMTP_USER);
});
test('Mail check classifies SMTP outcomes, closes transport and never returns secret errors',async()=>{
 for(const [error,expected] of [
  [null,'email_ready'],[{code:'EAUTH'},'email_auth'],[{responseCode:535},'email_auth'],
  [{code:'ETIMEDOUT'},'email_network'],[{code:'CERT_HAS_EXPIRED'},'email_tls'],[{code:'OTHER'},'email_failed']
 ]){
  let closed=0,verified=0;
  const result=await checkEmail(env,{loadMailer:async()=>({default:{createTransport:options=>{
   assert.equal(options.secure,true);
   return {verify:async()=>{verified++;if(error)throw {...error,message:'private-test-password'};},close:()=>closed++};
  }}})});
  assert.equal(result.code,expected);assert.equal(closed,1);assert.equal(verified,1);
  assert.ok(!JSON.stringify(result).includes('private-test-password'));
 }
 assert.equal((await checkEmail(env,{loadMailer:async()=>{throw {code:'ERR_MODULE_NOT_FOUND'};}})).code,'email_dependency');
});
test('Mail check stops waiting on an unresponsive SMTP server and closes its transport',async()=>{
 let closed=false;
 const result=await checkEmail(env,{timeoutMs:5,loadMailer:async()=>({default:{createTransport:()=>({verify:()=>new Promise(()=>{}),close:()=>{closed=true;}})}})});
 assert.equal(result.code,'email_network');assert.equal(closed,true);
});
