// Optional real-browser checks. No production server or external API is used.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome
// UI_SCREENSHOTS=/optional/output node server/test/ui-browser-check.mjs
import {readFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
const root=new URL('../public/',import.meta.url),origin='https://delivery-preview.example.test';
const shots=process.env.UI_SCREENSHOTS;
if(shots)mkdirSync(shots,{recursive:true});
const checks=[];
let requestCount=0,patchCount=0,driverStage='assigned',confirmedBody;
const adminRequests=[{id:'d'.repeat(48),reference:'TAC-DECLINED',requester_name:'Client',status:'declined',payment_state:'paid',canDelete:true,created_at:1,pickup:'Montréal',destination:'Longueuil'},
 {id:'a'.repeat(48),reference:'TAC-PAID',requester_name:'Client',status:'pending',payment_state:'paid',canDelete:false,created_at:2,pickup:'Montréal',destination:'Longueuil',recipient_name:'Destinataire',recipient_phone:'4505550101'}];
async function context(locale='es-CA',width=375){
 const context=await browser.newContext({locale,viewport:{width,height:850}});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  if(url.origin!==origin)return route.fulfill({status:200,body:'External navigation intercepted for this test.'});
  const pages={'/':'index.html','/demander':'demander.html','/restaurant':'restaurant.html','/livreur':'livreur.html','/forgot-password':'forgot-password.html','/reset-password':'reset-password.html','/terms/2026-10-23-v2':'conditions-2026-10-23-v2.html'};
  if(pages[path])return route.fulfill({contentType:'text/html',body:readFileSync(new URL(pages[path],root),'utf8')});
  if(path.endsWith('.webp'))return route.fulfill({contentType:'image/webp',body:readFileSync(new URL('livreur-team-v1.webp',root))});
  const body=req.postDataJSON();let response={ok:true};
  if(path==='/login'){const role=body.email.startsWith('driver')?'driver':body.email.startsWith('admin')?'admin':'restaurant';response={token:role,user:{role,name:'Compte de démonstration'}}}
  else if(path==='/quotes')response={...body,quoteId:'c'.repeat(48),expiresAt:Date.now()+600000,distanceMeters:3500,durationSeconds:900,baselineSeconds:900,delaySeconds:0,distanceCents:659,trafficCents:0,subtotalCents:659,gstCents:33,qstCents:66,totalCents:758};
  else if(path==='/requests'&&req.method()==='POST'){requestCount++;confirmedBody=body;response={id:'b'.repeat(48),reference:'TAC-BBBB',checkoutUrl:'https://checkout.stripe.com/test-only'}}
  else if(path==='/requests')response=adminRequests;
  else if(path==='/admin/quote-activity')response=[];
  else if(path==='/drivers')response=[{id:'driver1',name:'Livreur',fresh:true,status:'available'}];
  else if(path==='/deliveries')response=req.headers().authorization==='Bearer driver'?[{id:'job1',request_reference:'TAC-DEMO',status:driverStage,pickup:'123 rue de la Collecte, Montréal',destination:'456 rue du Client, Longueuil',recipient_name:'Client',recipient_phone:'450 555-0101',driver_payout_cents:1093,tip_cents:500}]:[];
  else if(path.startsWith('/deliveries/')&&req.method()==='PATCH'){patchCount++;driverStage=body.status}
  else if(path==='/config')response={mapsKey:'',quotesConfigured:true,paymentsConfigured:true};
  else if(path==='/restaurant/profile')response={name:'Commerce de démonstration',pickup:'123 rue du Commerce, Montréal',pickupPostalCode:'H2X 1Y4'};
  else if(path==='/restaurant/requests')response=[{id:'f'.repeat(48),status:'assigned',recipient_name:'Client',pickup:'Montréal',destination:'Longueuil',total_cents:758,created_at:Date.now()}];
  else if(path.startsWith('/request-status/'))response={reference:'TAC-BBBB',status:'awaiting_payment',totalCents:758};
  return route.fulfill({contentType:'application/json',body:JSON.stringify(response)});
 });
 return context;
}
async function noOverflow(page,label){const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,label+' has horizontal overflow')}
async function screenshot(page,name){if(shots)await page.screenshot({path:shots+'/'+name+'.png',fullPage:true})}
async function login(page,role){await page.locator('#email').fill(role+'@example.test');await page.locator('#password').fill('Test-only-password');await page.locator('#loginForm button:not([type=button])').click();await page.locator('#dashboard').waitFor({state:'visible'})}
try{
 for(const lang of ['es','fr']){
  const ctx=await context(lang+'-CA');const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/demander?new=1');
  await page.locator('#stepNext1').click();assert.equal(await page.locator('#step1').isVisible(),true);assert.notEqual(await page.locator('#requesterName-error').textContent(),'');
  await page.locator('#requesterName').fill('Commerce de démonstration');await page.locator('#pickup').fill('123 rue du Commerce, Montréal');await page.locator('#pickupPostalCode').fill('INVALID');await page.locator('#stepNext1').click();assert.notEqual(await page.locator('#pickupPostalCode-error').textContent(),'');
  await page.locator('#pickupPostalCode').fill('H2X 1Y4');await page.locator('#stepNext1').click();await page.locator('#step2').waitFor({state:'visible'});
  await page.locator('#destination').fill('456 rue du Client, Longueuil');await page.locator('#destinationPostalCode').fill('J4K 1A1');await page.locator('#recipientName').fill('Client');await page.locator('#recipientPhone').fill('4505550101');await page.locator('#itemDescription').fill('Repas');
  await page.locator('#stepBack2').click();assert.equal(await page.locator('#pickup').inputValue(),'123 rue du Commerce, Montréal');await page.locator('#stepNext1').click();assert.equal(await page.locator('#destination').inputValue(),'456 rue du Client, Longueuil');await page.locator('#stepNext2').click();
  await page.locator('#tip500').click();await page.locator('#tip0').click();assert.equal(await page.locator('#tipCents').inputValue(),'0');assert.equal(await page.locator('#tip0').getAttribute('aria-pressed'),'true');
  await page.locator('#consent').check();await page.locator('#calculate').click();await page.locator('#quoteCard').waitFor({state:'visible'});assert.match(await page.locator('#send').textContent(),/7,58/);assert.equal(await page.locator('#acceptPrice').isChecked(),false);assert.equal(await page.locator('#acceptTerms').isChecked(),false);
  const count=requestCount;await page.locator('#send').click();assert.equal(requestCount,count);
  await noOverflow(page,lang+' request mobile');await screenshot(page,'request-review-'+lang);
  await page.locator('#stepBack3').click();await page.locator('#pickup').fill('789 nouvelle collecte, Montréal');await page.locator('#stepNext1').click();await page.locator('#stepNext2').click();assert.equal(await page.locator('#quoteCard').isVisible(),false);
  await page.locator('#calculate').click();await page.locator('#quoteCard').waitFor({state:'visible'});await page.locator('#acceptPrice').check();await page.locator('#acceptTerms').check();await page.locator('#send').click();await page.waitForURL('https://checkout.stripe.com/test-only');assert.equal(requestCount,count+1);assert.equal(confirmedBody.acceptTerms,true);assert.equal(confirmedBody.termsVersion,'2026-10-23-v2');assert.equal(confirmedBody.tipCents,0);
  assert.deepEqual(errors,[]);checks.push(lang+': three steps, field errors, back/edit, zero tip, fixed total, explicit acceptance and intercepted Checkout');await ctx.close();
 }
 const ctx=await context('fr-CA');const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/restaurant');await page.locator('#lang').click();assert.equal(await page.locator('html').getAttribute('lang'),'es');await page.locator('[data-password-target=password]').click();assert.equal(await page.locator('#password').getAttribute('type'),'text');assert.match(await page.locator('[data-password-target=password]').textContent(),/Ocultar/);await login(page,'client');await page.locator('#lang').click();assert.match(await page.locator('#history').textContent(),/Un livreur/);await page.locator('#lang').click();await page.locator('[data-i18n=newRequest]').click();assert.equal(await page.locator('html').getAttribute('lang'),'es');await page.waitForFunction(()=>document.getElementById('pickup').value.includes('Commerce'));assert.equal(await page.locator('#pickupPostalCode').inputValue(),'H2X 1Y4');assert.equal(await page.locator('#destination').inputValue(),'');checks.push('Account: password toggle, immediate history translation, persistent language, saved pickup without previous recipient');
 await page.goto(origin+'/');await login(page,'admin');await page.locator('#clientsNav').click();assert.equal(await page.locator('#newRole').inputValue(),'restaurant');assert.equal(await page.locator('#restaurantFields').isVisible(),true);assert.match(await page.locator('#requests article').first().textContent(),/TAC-PAID/);assert.equal(await page.locator('.admin-navigation a').count(),5);await noOverflow(page,'admin mobile');await screenshot(page,'admin-clients-es');checks.push('Admin: five navigation sections, paid requests first, client account shortcut, mobile width');
 await page.goto(origin+'/livreur');await login(page,'driver');const maps=page.locator('#jobs a[href^="https://www.google.com"]');assert.equal(await maps.count(),1);assert.match(await maps.first().textContent(),/Ir a recoger/);assert.equal(await page.locator('#jobs a[href="tel:4505550101"]').count(),1);await page.locator('#jobs button').last().click();await page.waitForFunction(()=>document.querySelector('#jobs a.primary')?.textContent.includes('Ir a entregar'));await screenshot(page,'driver-es');
 let dialogAllowed=false;page.on('dialog',dialog=>dialogAllowed?dialog.accept():dialog.dismiss());await page.locator('#jobs button').last().click();assert.equal(patchCount,1);dialogAllowed=true;await page.locator('#jobs button').last().click();await page.waitForFunction(()=>!document.querySelector('#jobs .job'));assert.equal(patchCount,2);await noOverflow(page,'driver mobile');checks.push('Driver: one route per stage, recipient telephone, cancel/confirm completion prevents premature update');
 for(const path of ['/forgot-password','/reset-password#'+'a'.repeat(96)]){await page.goto(origin+path);assert.equal(await page.locator('html').getAttribute('lang'),'es');assert.equal(await page.locator('a[data-ui=help]').count(),1);await noOverflow(page,path)}
 await page.goto(origin+'/demander?new=1');await page.locator('[data-prohibited-link]').click();assert.equal(await page.locator('html').getAttribute('lang'),'es');assert.equal(await page.locator('#es').isVisible(),true);assert.equal(await page.locator('#fr').isVisible(),false);checks.push('Recovery and policy links preserve Spanish and expose help');
 // A 320 CSS-pixel viewport models a narrow screen and desktop 200% zoom reflow.
 await page.setViewportSize({width:320,height:800});await page.goto(origin+'/demander?new=1');await noOverflow(page,'request 320px');await page.goto(origin+'/');await login(page,'admin');await noOverflow(page,'admin 320px');await page.goto(origin+'/livreur');await noOverflow(page,'driver login 320px');checks.push('320px reflow: request, administrator and driver login');
 assert.deepEqual(errors,[]);await ctx.close();console.log(JSON.stringify({checks,requestsIntercepted:requestCount,deliveryUpdatesIntercepted:patchCount,externalServicesCalled:false},null,2));
}finally{await browser.close()}
