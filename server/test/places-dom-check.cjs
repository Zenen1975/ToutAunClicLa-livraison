const {JSDOM}=require(process.env.JSDOM_MODULE||'jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const script=fs.readFileSync(require('node:path').join(__dirname,'../public/address-suggestions.js'),'utf8');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{for(const lang of ['es','fr']){
 const dom=new JSDOM('<html lang="'+lang+'"><head></head><body><form><input id="pickup" data-address-postal="postal"><input id="postal"></form></body></html>',{url:'https://preview.test',runScripts:'outside-only'}),w=dom.window,d=w.document;let details=0,delay=false,changed=0;
 w.AbortController=AbortController;w.fetch=async(path,opts)=>{if(path.endsWith('details')){details++;if(delay)await wait(100);return {ok:true,json:async()=>({address:{address:'123 Rue Test, Longueuil, QC',postalCode:details===1?'J4K 1A1':''}})}};return {ok:true,json:async()=>({suggestions:[{id:'fixture',label:'123 Rue Test, Longueuil'}]})};};
 w.eval(script);const input=d.getElementById('pickup'),postal=d.getElementById('postal');input.addEventListener('input',()=>changed++);
 const type=async value=>{input.focus();input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));await wait(380)};
 await type('123 rue');assert.equal(details,0);assert.equal(d.querySelectorAll('[role=option]').length,1);
 input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait(5);assert.equal(postal.value,'J4K 1A1');assert.equal(input.value,'123 Rue Test, Longueuil, QC');assert.ok(changed>=2);
 postal.value='H2X 1Y4';postal.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(postal.value,'H2X 1Y4');
 await type('456 rue');d.querySelector('[role=option]').click();await wait(5);assert.equal(postal.value,'');assert.match(d.querySelector('[role=status]').textContent,/Google/);
 delay=true;await type('789 rue');d.querySelector('[role=option]').click();input.value='Manual address';input.dispatchEvent(new w.Event('input',{bubbles:true}));await wait(120);assert.equal(input.value,'Manual address');
 d.querySelector('form').reset();assert.equal(d.querySelectorAll('[role=option]').length,0);dom.window.close();
}console.log('FR/ES DOM checks passed: explicit selection, keyboard/click, postal, manual edit, missing postal, stale response and quote invalidation events.');})().catch(e=>{console.error(e);process.exitCode=1});
