(() => {
 const copy={es:{list:'Direcciones sugeridas',loading:'Buscando direcciones…',manual:'Puedes escribir y corregir la dirección y el código postal manualmente.',failed:'No se pudieron consultar las sugerencias. Completa la dirección manualmente.',missing:'Google no indicó un código postal. Escríbelo antes de continuar.'},fr:{list:'Adresses suggérées',loading:'Recherche d’adresses…',manual:'Vous pouvez saisir et corriger l’adresse et le code postal manuellement.',failed:'Suggestions indisponibles. Complétez l’adresse manuellement.',missing:'Google n’a pas indiqué de code postal. Saisissez-le avant de continuer.'}};
 const labels=()=>copy[document.documentElement.lang==='es'?'es':'fr'];
 const style=document.createElement('style');style.textContent='.address-suggestions{border:1px solid #d4c8e4;border-radius:10px;padding:4px;background:white;display:grid;gap:2px}.address-suggestions[hidden]{display:none}.address-suggestions button{background:white;color:#30213f;text-align:left;border-radius:6px;white-space:normal}.address-suggestions button[aria-selected=true]{background:#eee7f7}.address-attribution{font-family:Arial,sans-serif;text-align:right;padding:6px;color:#5e5e5e;font-size:13px}';document.head.append(style);
 document.querySelectorAll('[data-address-postal]').forEach(input=>{
  const postal=document.getElementById(input.dataset.addressPostal);if(!postal)return;
  const box=document.createElement('div'),list=document.createElement('div'),credit=document.createElement('div'),status=document.createElement('small');
  box.className='address-suggestions';box.hidden=true;list.id=input.id+'-suggestions';list.setAttribute('role','listbox');credit.className='address-attribution';credit.textContent='Google Maps';credit.translate=false;box.append(list,credit);
  input.insertAdjacentElement('afterend',box);box.insertAdjacentElement('afterend',status);status.setAttribute('role','status');status.textContent=labels().manual;
  input.autocomplete='off';input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');
  let timer,controller,generation=0,session='',active=-1,options=[],applying=false;
  const close=()=>{box.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
  const cancel=()=>{clearTimeout(timer);controller?.abort();generation++;close();};
  const token=()=>session||(session=crypto.randomUUID());
  const request=async(path,body,signal)=>{const response=await fetch('/places/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,language:document.documentElement.lang==='es'?'es':'fr',sessionToken:token()}),signal,cache:'no-store'});if(!response.ok)throw Error('unavailable');return response.json();};
  const highlight=()=>{Array.from(list.children).forEach((button,index)=>button.setAttribute('aria-selected',String(index===active)));if(active>=0)input.setAttribute('aria-activedescendant',list.id+'-'+active);};
  const choose=async(item)=>{
   cancel();const current=generation;controller=new AbortController();status.textContent=labels().loading;
   try{const result=await request('details',{placeId:item.id},controller.signal);if(current!==generation||input.disabled||postal.disabled)return;
    applying=true;input.value=result.address.address;postal.value=result.address.postalCode||'';
    input.dispatchEvent(new Event('input',{bubbles:true}));postal.dispatchEvent(new Event('input',{bubbles:true}));applying=false;session='';list.replaceChildren();options=[];
    status.textContent=postal.value?labels().manual:labels().missing;
   }catch{if(current===generation)status.textContent=labels().failed;}finally{applying=false;}
  };
  input.addEventListener('input',()=>{
   if(applying)return;cancel();list.replaceChildren();options=[];active=-1;status.textContent=labels().manual;
   const value=input.value.trim();if(value.length<3||input.disabled)return;
   const current=generation;timer=setTimeout(async()=>{
    if(document.activeElement!==input)return;controller=new AbortController();status.textContent=labels().loading;
    try{const data=await request('suggestions',{input:value},controller.signal);if(current!==generation||document.activeElement!==input)return;
     options=data.suggestions||[];list.setAttribute('aria-label',labels().list);
     options.forEach((item,index)=>{const button=document.createElement('button');button.type='button';button.id=list.id+'-'+index;button.setAttribute('role','option');button.setAttribute('aria-selected','false');button.textContent=item.label;button.addEventListener('mousedown',event=>event.preventDefault());button.addEventListener('click',()=>choose(item));list.append(button);});
     box.hidden=!options.length;input.setAttribute('aria-expanded',String(options.length>0));status.textContent=labels().manual;
    }catch{if(current===generation)status.textContent=labels().failed;}
   },350);
  });
  input.addEventListener('keydown',event=>{
   if(event.key==='Escape'){cancel();return;}
   if(box.hidden||!options.length)return;
   if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();active=event.key==='ArrowDown'?(active+1)%options.length:(active<=0?options.length:active)-1;highlight();}
   if(event.key==='Enter'&&active>=0){event.preventDefault();choose(options[active]);}
  });
  input.addEventListener('blur',event=>{if(!box.contains(event.relatedTarget))cancel();});
  postal.addEventListener('input',()=>{if(!applying)cancel();});
  input.form?.addEventListener('reset',()=>{cancel();session='';options=[];list.replaceChildren();status.textContent=labels().manual;});
 });
})();
