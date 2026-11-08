import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const script=readFileSync(new URL('../public/address-suggestions.js',import.meta.url),'utf8');
try{
 for(const language of ['fr','es']){
 const page=await browser.newPage({viewport:{width:390,height:844}});let details=0,delay=false;
 await page.route('https://preview.test/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/')return route.fulfill({contentType:'text/html',body:'<html lang="'+language+'"><head></head><body><form><label for="pickup">Adresse</label><input id="pickup" data-address-postal="postal"><label for="postal">Postal</label><input id="postal"><button type="reset">Reset</button></form></body></html>'});
  if(path==='/places/details'){details++;if(delay)await new Promise(resolve=>setTimeout(resolve,200));return route.fulfill({json:{address:{address:'123 Rue Test, Longueuil, QC',postalCode:details===1?'J4K 1A1':''}}});}
  return route.fulfill({json:{suggestions:[{id:'place_1',label:'123 Rue Test, Longueuil'}]}});
 });
 await page.goto('https://preview.test/');await page.addScriptTag({content:script});
 await page.locator('#pickup').fill('123 rue');await page.getByRole('option').waitFor();assert.equal(details,0);
 await page.locator('#pickup').press('ArrowDown');await page.locator('#pickup').press('Enter');await page.waitForFunction(()=>document.querySelector('#postal').value==='J4K 1A1');assert.equal(await page.locator('#pickup').inputValue(),'123 Rue Test, Longueuil, QC');
 await page.locator('#postal').fill('H2X 1Y4');assert.equal(await page.locator('#postal').inputValue(),'H2X 1Y4');
 await page.locator('#pickup').fill('456 rue');await page.getByRole('option').waitFor();await page.getByRole('option').click();await page.waitForFunction(()=>document.querySelector('#postal').value==='');assert.match(await page.getByRole('status').innerText(),language==='es'?/Google no indicó/:/Google n’a pas indiqué/);
 delay=true;await page.locator('#pickup').fill('789 rue');await page.getByRole('option').waitFor();await page.getByRole('option').click();await page.locator('#pickup').fill('Manual newer address');await page.waitForTimeout(260);assert.equal(await page.locator('#pickup').inputValue(),'Manual newer address');
 await page.getByRole('button',{name:'Reset'}).click();assert.equal(await page.locator('#pickup').inputValue(),'');assert.equal(await page.getByRole('option').count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.close();
 }
 for(const name of ['index','demander','restaurant']){const html=readFileSync(new URL('../public/'+name+'.html',import.meta.url),'utf8');assert.match(html,/data-address-postal=/);assert.match(html,/src="\/address-suggestions.js"/);}
 console.log('Browser checks passed: FR/ES, keyboard/click selection, postal code, manual correction, missing postal, stale details, reset and mobile width.');
}finally{await browser.close();}
