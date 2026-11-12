/* Installation du carnet. Aucun contenu privé n'est mis en cache. */
(() => {
 'use strict';
 const mode=window.matchMedia('(display-mode: standalone)');
 const installed=()=>mode.matches||window.navigator.standalone===true;
 let installPrompt=null;
 let returnFocus=null;
 const dialog=document.getElementById('carnet-install-dialog');
 const access=document.getElementById('carnet-install-access');
 const app=document.getElementById('app');
 function sync(){
  const standalone=installed();
  if(standalone)document.querySelectorAll('.install-carnet-card').forEach(c=>c.remove());
  access.hidden=standalone;
  document.querySelectorAll('[data-install-carnet]').forEach(b=>{b.hidden=standalone;});
  const content=app.querySelector('.content');
  if(!standalone&&content?.querySelector('.home-promise')&&!content.querySelector('.install-carnet-card')){
   const card=document.createElement('aside');
   card.className='install-carnet-card';
   card.innerHTML='<img src="assets/carnet-icon-192.png" alt="" width="48" height="48"><div><strong>Votre carnet à portée de main</strong><p>Ajoutez son icône sur votre téléphone pour le retrouver chaque jour.</p></div><button type="button" class="btn outline" data-install-carnet>Installer le carnet</button>';
   content.prepend(card);
  }
 }
 function help(){
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  dialog.querySelector('[data-install-ios]').hidden=!ios;
  dialog.querySelector('[data-install-other]').hidden=ios;
  returnFocus=document.activeElement;
  if(!dialog.open)dialog.showModal();
 }
 async function requestInstall(){
  if(installed())return;
  if(!installPrompt){help();return;}
  const prompt=installPrompt;installPrompt=null;
  try{
   await prompt.prompt();
   const choice=await prompt.userChoice;
   if(choice.outcome==='accepted'){access.hidden=true;document.querySelectorAll('.install-carnet-card').forEach(c=>c.remove());}
  }catch{help();}
 }
 document.addEventListener('click',event=>{
  if(event.target.closest('[data-install-carnet]'))requestInstall();
 });
 dialog.querySelector('[data-close-install]').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>{if(returnFocus?.isConnected)returnFocus.focus();});
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;sync();});
 window.addEventListener('appinstalled',()=>{installPrompt=null;access.hidden=true;document.querySelectorAll('.install-carnet-card').forEach(c=>c.remove());if(dialog.open)dialog.close();});
 mode.addEventListener?.('change',sync);
 new MutationObserver(sync).observe(app,{childList:true});
 sync();
 if('serviceWorker' in navigator&&window.isSecureContext){
  navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(()=>{
   // Le carnet connecté reste utilisable si l'enregistrement est indisponible.
  });
 }
})();
