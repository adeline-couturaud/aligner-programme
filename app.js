/* Mon carnet Aligné – Aligner Conseil. Mode démo local ou Supabase sécurisé. */
(() => {
'use strict';
const CFG=window.ALIGNER_CONFIG||{};
let DAYS=window.ALIGNER_PROGRAM||[];
const LIVE=Boolean(CFG.supabaseUrl&&CFG.supabasePublishableKey);
const DEMO=!LIVE&&CFG.demoMode===true;
const LS_KEY='aligner_mvp_demo_v2';
const root=document.getElementById('app');
const state={view:'home',day:1,phase:'Tous',entryFilter:'Tous',search:'',loading:false,dirty:false,user:null,role:'member',enrolled:DEMO,entries:{},photos:{},adminEntries:[],adminPhotos:[],adminProfiles:{},requests:[],totalMembers:0,authForm:'login',supabase:null,mode:LIVE?'connected':DEMO?'demo':'unconfigured',saving:null};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const D=(n)=>DAYS.find(x=>x.day===Number(n));
const fmt=n=>Number(n).toString().padStart(2,'0');
const phaseName=p=>p==='Observer'?'Observer':p==='Clarifier'?'Clarifier':'Agir';
const shortDate=d=>d?new Date(d).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}):'Date non précisée';
const entry=(n)=>state.entries[n]||{day:n,answers:{},notes:'',completed:false,shared_with_adeline:false};
const isDemo=()=>state.mode==='demo';
let timer=null;
function toast(msg){document.querySelector('.toast')?.remove(); const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.append(t);setTimeout(()=>t.remove(),3600)}
function persistDemo(){if(!isDemo())return;localStorage.setItem(LS_KEY,JSON.stringify({entries:state.entries,requests:state.requests}));}
function restoreDemo(){try{const obj=JSON.parse(localStorage.getItem(LS_KEY)||'{}');state.entries=obj.entries||{};state.requests=obj.requests||[];}catch{state.entries={};state.requests=[];}}
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('aligner-demo-photos-v1',1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('photos')){let store=db.createObjectStore('photos',{keyPath:'id'});store.createIndex('day','day');}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function demoPhotos(){if(!('indexedDB' in window))return;try{const db=await openDB(); const rows=await new Promise((resolve,reject)=>{let t=db.transaction('photos','readonly');let req=t.objectStore('photos').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});state.photos={}; for(let p of rows){const t={id:p.id,day:p.day,name:p.name,url:URL.createObjectURL(p.blob)};(state.photos[p.day]??=[]).push(t)}db.close();}catch(err){console.warn('Photos démo indisponibles',err)}}
async function demoAddPhoto(day,file){const id=crypto.randomUUID();const db=await openDB();await new Promise((resolve,reject)=>{let t=db.transaction('photos','readwrite');t.objectStore('photos').put({id,day,name:file.name,blob:file});t.oncomplete=resolve;t.onerror=()=>reject(t.error)});db.close();(state.photos[day]??=[]).push({id,day,name:file.name,url:URL.createObjectURL(file)});}
async function demoDeletePhoto(id){const db=await openDB();await new Promise((resolve,reject)=>{let t=db.transaction('photos','readwrite');t.objectStore('photos').delete(id);t.oncomplete=resolve;t.onerror=()=>reject(t.error)});db.close()}
async function setupLive(){
 const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
 state.supabase=createClient(CFG.supabaseUrl,CFG.supabasePublishableKey,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});
 state.supabase.auth.onAuthStateChange((event)=>{
  if(event==='PASSWORD_RECOVERY'){state.authForm='recovery';render();}
 });
 const {data:{user},error}=await state.supabase.auth.getUser();if(error&&error.status!==400)throw error;
 state.user=user;if(user)await refreshLive();
 if(user&&new URLSearchParams(location.search).get('paiement')==='succes'){
  // Stripe confirme le paiement par webhook côté serveur ; l'arrivée sur la page ne donne aucun accès.
  let attempt=0;const check=async()=>{if(state.enrolled||attempt++>=10)return;
   try{await refreshLive();render();}catch(e){console.warn(e)}
   if(!state.enrolled)setTimeout(check,2500);
  };setTimeout(check,2500);
 }
}
async function refreshLive(){
 const sb=state.supabase;if(!state.user)return;
 const {data:profile,error:pe}=await sb.from('profiles').select('id,display_name,role,email').eq('id',state.user.id).single();if(pe)throw pe;state.role=profile?.role||'member';state.displayName=profile?.display_name||state.user.email.split('@')[0];
 if(state.role==='admin'){await loadPaidResources();await refreshAdmin();return}
 const {data:access}=await sb.from('enrollments').select('status').eq('user_id',state.user.id).eq('status','active').maybeSingle();state.enrolled=!!access;
 if(!state.enrolled)return;
 await loadPaidResources();
 const {data, error}=await sb.from('daily_entries').select('*').eq('user_id',state.user.id).order('day');if(error)throw error;state.entries=Object.fromEntries((data||[]).map(e=>[e.day,e]));
 await refreshLivePhotos();
}
async function loadPaidResources(){
 const sb=state.supabase;
 if(DAYS.length!==21){const {data,error}=await sb.from('program_days').select('day,content').order('day');if(error)throw error;
  DAYS=(data||[]).map(r=>r.content);if(DAYS.length!==21)throw new Error('Les 21 journées ne sont pas encore chargées dans Supabase.');}
 const {data:resources,error:resError}=await sb.from('member_resources').select('key,value');
 if(resError)throw resError;
 state.whatsappInviteUrl=resources?.find(r=>r.key==='whatsapp_invite')?.value||'';
}
async function signedUrl(path){const {data,error}=await state.supabase.storage.from('carnet-prive').createSignedUrl(path,60);if(error)throw error;return data.signedUrl}
async function refreshLivePhotos(){const {data,error}=await state.supabase.from('photo_assets').select('id,day,storage_path,filename').eq('user_id',state.user.id);if(error)throw error;state.photos={};for(const p of data||[]){try{const url=await signedUrl(p.storage_path);(state.photos[p.day]??=[]).push({...p,name:p.filename,url})}catch(e){console.warn('Photo inaccessible',e)}}}
async function refreshAdmin(){
 const sb=state.supabase;
 const [{count:c}, {data:shared,error:e}, {data:requests}, {data:adminphotos}]=await Promise.all([
  sb.from('enrollments').select('*',{count:'exact',head:true}).eq('status','active'),
  sb.from('daily_entries').select('user_id,day,answers,notes,completed,updated_at,shared_with_adeline').eq('shared_with_adeline',true).order('updated_at',{ascending:false}),
  sb.from('lead_requests').select('id,user_id,day,message,created_at,status,contact_method,contact_phone').order('created_at',{ascending:false}),
  sb.from('photo_assets').select('id,user_id,day,storage_path,filename')]);
 if(e)throw e;state.totalMembers=c||0;state.adminEntries=shared||[];state.requests=requests||[];state.adminProfiles={};state.adminPhotos=[];
 const ids=[...new Set([...(shared||[]),...(requests||[])].map(e=>e.user_id))];
 if(ids.length){const {data:profiles,error:pr}=await sb.from('profiles').select('id,display_name,email').in('id',ids);if(pr)throw pr;state.adminProfiles=Object.fromEntries((profiles||[]).map(e=>[e.id,e]));}
 for(const p of adminphotos||[]){try{const url=await signedUrl(p.storage_path);state.adminPhotos.push({...p,url})}catch{}}
}
async function saveEntry(showToast=false){
 if(!state.dirty){if(showToast)toast('Tout est déjà enregistré.');return}
 if(state.saving)await state.saving;
 const n=state.day;const v=structuredClone(entry(n));state.dirty=false;
 const job=(async()=>{if(isDemo()){persistDemo()}else{
  const payload={user_id:state.user.id,day:n,answers:v.answers||{},notes:v.notes||'',completed:!!v.completed,shared_with_adeline:!!v.shared_with_adeline};
  const {error}=await state.supabase.from('daily_entries').upsert(payload,{onConflict:'user_id,day'});if(error)throw error;
 }} )();state.saving=job;
 try{await job;if(showToast)toast('Exercice enregistré.')}catch(err){state.dirty=true;toast('Enregistrement impossible : '+err.message)}finally{state.saving=null}
}
function scheduleSave(){state.dirty=true;if(isDemo())persistDemo();clearTimeout(timer);timer=setTimeout(()=>saveEntry(),850)}
function threeWords(){const g=entry(1).answers?.guided||{};const split=String(g.three_words||'').split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);return [g.word1||split[0]||'',g.word2||split[1]||'',g.word3||split[2]||''].map(x=>String(x).trim())}
function startWordsValid(){return threeWords().every(w=>w.length>0)}
function requireThreeWords(){if(startWordsValid())return true;state.view='day';state.day=1;render();requestAnimationFrame(()=>{const f=document.querySelector('[data-word]');f?.scrollIntoView({behavior:'smooth',block:'center'});f?.focus()});toast('Choisissez vos trois mots à votre rythme.');return false}
async function goto(view,day){clearTimeout(timer);await saveEntry();state.view=view;if(day)state.day=day;render();window.scrollTo(0,0)}
function completedCount(){return Object.values(state.entries).filter(e=>e.completed).length}
function layout(inner){
 const pro=(state.role==='admin'&&LIVE)||state.view==='admin';
 const nav=[['home','Vue d’ensemble','◈'],['day','Mes exercices','✎'],['community','Le Cercle Aligné','♡'],['bilan','Mon bilan style','✦'],['services','Pour aller plus loin','↗'],['profile','Mes informations','◌']];
 if(isDemo()||state.role==='admin')nav.push(['admin','Espace professionnel','▤']);
 return `<div class="layout"><aside class="sidebar"><div class="brand"><span class="monogram">A</span><span>Mon carnet Aligné<small>par Aligner Conseil</small></span></div><div class="nav-section">Mon parcours</div>${nav.map(([v,name,ico])=>`<button class="nav-btn ${state.view===v?'selected':''}" data-nav="${v}"><span>${ico}</span><span>${name}</span></button>`).join('')}<div class="aside-foot">21 jours · Observer, clarifier, agir.<br>Votre image doit vous servir, pas vous contraindre.<br><br>© Aligner Conseil</div></aside><main class="main"><div class="mobile-nav"><button data-nav="home">Accueil</button><button data-nav="day">Exercices</button><button data-nav="community">Communauté</button><button data-nav="bilan">Mon bilan</button><button data-nav="services">Prestations</button>${(isDemo()||state.role==='admin')?'<button data-nav="admin">Espace pro</button>':''}</div><header class="topbar"><div class="micro">Formation • Image • Stratégie</div><div class="right"><span class="badge ${isDemo()?'gold':''} demo-status">${isDemo()?'DÉMONSTRATION LOCALE':'ESPACE PRIVÉ'}</span>${LIVE?`<button class="btn small ghost" id="logout">Se déconnecter</button>`:''}</div></header><div class="content">${isDemo()?'<div class="notice warning"><strong>Prototype de démonstration.</strong> Les notes et photos restent dans ce navigateur. L’espace professionnel est simulé sur cet appareil, sans véritable compte ni partage entre appareils. Ne pas utiliser pour collecter des données clientes.</div>':''}${inner}</div></main></div>`;
}
function homeHTML(){const num=completedCount();const next=D(DAYS.find(d=>!entry(d.day).completed)?.day||21);const weeks=[['Observer','Observer vos habitudes',1,7],['Clarifier','Trouver vos repères',8,14],['Agir','Passer à l’action',15,21]];
 return `<img class="logo-hero" src="assets/logo_source.png" alt="Aligner Conseil : révéler l'humain, renforcer l'impact"><section class="home-promise"><span class="badge rose">MON CARNET ALIGNÉ · 21 JOURS POUR VOUS RETROUVER DANS VOTRE STYLE</span><h1>Un dressing plein… et toujours cette impression de ne rien avoir à vous mettre ?</h1><p class="home-hook">Vous n’avez pas besoin de tout racheter ni de changer de corps pour vous sentir bien dans vos vêtements.</p><p class="lead">En 21 jours, apprenez à comprendre ce qui vous va et surtout ce qui vous plaît, à oser de nouvelles associations et à composer des tenues adaptées à votre vraie vie, avec ce que vous possédez déjà.</p><div class="promise-results"><span>✓ Des conseils professionnels simples</span><span>✓ Un exercice concret chaque jour</span><span>✓ Vos découvertes dans un bilan personnel</span></div><p class="home-assurance">Ce carnet n’impose ni style ni silhouette idéale. Vous avancez à votre rythme, sans jugement, et vous repartez avec des repères qui vous appartiennent.</p><button class="btn pink" data-day="1">Commencer mon parcours →</button></section><section class="hello-adeline"><img loading="lazy" src="assets/portrait-accueil.png" onerror="this.onerror=null;this.src='https://raw.githubusercontent.com/adeline-couturaud/conseil/main/assets/img/photo-adeline.png'" alt="Portrait professionnel d’Adeline, fondatrice d’Aligner Conseil"><div><span class="badge rose">LE MOT D’ADELINE</span><h2>Bienvenue dans votre dressing, autrement.</h2><p>Je suis Adeline, et j’ai imaginé ce parcours pour vous aider à expérimenter sans vous juger. Ici, on part de votre vie, de vos envies et de vos vêtements. Pas de tenue imposée, pas de grand tri obligatoire : des découvertes à faire à votre rythme.</p><strong>À très vite dans votre carnet !</strong></div></section><div class="grid"><article class="card"><div class="stat-label">MON AVANCEMENT</div><span class="stat-num">${num} / 21</span><div class="progress" aria-label="${num} journées terminées"><span style="width:${(num/21*100).toFixed(2)}%"></span></div><small>Chaque découverte compte.</small></article><article class="card"><div class="stat-label">MON PROCHAIN EXERCICE</div><span class="stat-num">${fmt(next.day)}</span><div>${esc(next.title)}</div><button class="btn small" style="margin-top:13px" data-day="${next.day}">Continuer →</button></article><article class="card"><div class="stat-label">MES EXERCICES PARTAGÉS</div><span class="stat-num">${Object.values(state.entries).filter(e=>e.shared_with_adeline).length}</span><div>Vous choisissez librement ce qu'Adeline peut consulter.</div><button class="btn small outline" style="margin-top:13px" data-nav="profile">Comprendre les partages</button></article></div><h2 style="margin-top:40px">Vos trois étapes</h2><div class="grid">${weeks.map(([phase,title,a,b],i)=>`<article class="card"><span class="badge ${i===1?'rose':i===2?'blue':''}">SEMAINE ${i+1}</span><h3 style="margin-top:13px">${title}</h3><p>${i===0?'Vos réflexes, vos couleurs, vos vêtements refuges.':i===1?'Vos mots, vos lignes, vos matières, votre style.':'Vos tenues, vos nouveaux réflexes et votre plan durable.'}</p><small>Jours ${a} à ${b}</small><br><button class="btn small ghost" style="margin-top:14px" data-day="${a}">Découvrir</button></article>`).join('')}</div><div class="community"><h2>Le Cercle Aligné</h2><p>Un espace d'encouragements où chacun peut échanger et partager une photo, ou participer simplement en lisant les messages. Il restera facultatif.</p><button class="btn ghost" data-nav="community">Découvrir la communauté</button></div>`}
function listHTML(){const filtered=DAYS.filter(d=>state.phase==='Tous'||d.phase===state.phase);
 return `<span class="badge">LES 21 JOURS</span><h1>Mon parcours</h1><p class="lead">Chaque exercice est indépendant. Avancez à votre rythme, revenez à vos notes et partagez uniquement ce que vous souhaitez.</p><div class="pill-row">${['Tous','Observer','Clarifier','Agir'].map(p=>`<button class="pill ${p===state.phase?'active':''}" data-phase="${p}">${p==='Tous'?'Tous les jours':p}</button>`).join('')}</div><div class="day-list">${filtered.map(d=>`<button class="day-tile ${entry(d.day).completed?'done':''}" data-day="${d.day}"><span class="num">JOUR ${fmt(d.day)} ${entry(d.day).completed?'✓':''}</span><strong>${esc(d.title)}</strong><small>${esc(d.phase)} · ${d.minutes} minutes ${entry(d.day).shared_with_adeline?'· Partagé avec Adeline':''}</small></button>`).join('')}</div>`}
function visualHTML(kind){
 const palettes={
  color:[
   ['Rouges et roses',[['#D63B35','Rouge tomate'],['#AC243B','Rouge cerise'],['#BD5272','Framboise'],['#B25A51','Rouge brique'],['#EE796D','Corail'],['#DDA8B5','Rose poudré'],['#9D656F','Vieux rose']]],
   ['Bleus',[['#203D65','Bleu marine'],['#15638A','Bleu pétrole'],['#2D7B86','Bleu canard'],['#AFCDE2','Bleu ciel'],['#4C83AF','Bleu jean'],['#2856A5','Bleu roi'],['#9BABB9','Bleu grisé']]],
   ['Verts',[['#174F45','Vert sapin'],['#8B9243','Vert olive'],['#6F7751','Kaki'],['#A9C7B8','Vert d’eau'],['#B4C49C','Vert amande'],['#137C68','Vert émeraude'],['#A6B4A0','Vert sauge']]],
   ['Jaunes et orangés',[['#DCA93E','Jaune moutarde'],['#E3B75C','Miel'],['#F2B68B','Abricot'],['#E7A493','Pêche'],['#B75C40','Terracotta'],['#C28A58','Camel']]],
   ['Violets',[['#633A5B','Prune'],['#583B51','Aubergine'],['#BBA5D0','Lilas'],['#86609F','Violet moyen'],['#735984','Mauve']]],
   ['Neutres',[['#22252A','Noir'],['#F2EADD','Écru'],['#B9A897','Beige'],['#C8B2B4','Beige rosé'],['#A79E97','Taupe'],['#949DA1','Gris moyen'],['#DADADD','Gris clair'],['#765144','Chocolat'],['#303D53','Marine']]]
  ],
  neutrals:[
   ['Neutres à essayer',[['#242629','Noir'],['#1F3858','Marine'],['#765043','Chocolat'],['#A49C95','Taupe'],['#F0E8DC','Écru'],['#A2A6AA','Gris moyen'],['#D1D3D5','Gris clair'],['#C3A48B','Camel'],['#8E8678','Grège'],['#82725E','Kaki neutre'],['#D4BEBB','Beige rosé'],['#FFFFFF','Blanc']]]]
 };
 if(palettes[kind]){
  const grouped=palettes[kind];
  const groups=grouped.map(([name,items],i)=>`<details class="palette-group" ${i===0?'open':''}><summary>${esc(name)} <small>${items.length} teintes</small></summary><div class="color-grid">${items.map(([hex,label])=>`<div class="color-chip"><span class="color-swatch" style="background:${hex}"></span><strong>${esc(label)}</strong></div>`).join('')}</div></details>`).join('');
  return `<div class="visual-card palette-card"><h3>Un nuancier pour trouver des idées dans votre placard</h3><p>Ce sont des exemples de couleurs courantes. Commencez avec les vêtements ou tissus que vous possédez, sans rien acheter. Vous pouvez ouvrir chaque famille ci-dessous.</p>${groups}<p class="muted">Les nuances affichées sont approximatives : les écrans et la lumière modifient les couleurs. Ce nuancier ne détermine pas votre saison colorimétrique. Pour observer votre visage, comparez vos vrais tissus sous la même lumière.</p></div>`;
 }
 if(kind==='volumes')return '<div class="visual-card"><h3>Un bas, deux lectures possibles</h3><div class="simple-examples"><span>Haut fluide porté librement</span><span>Haut partiellement rentré</span></div><p class="muted">Gardez le même pantalon pour comparer les proportions, puis vérifiez votre aisance en mouvement.</p></div>';
 if(kind==='outfits')return '<div class="visual-card"><h3>Exemple : une base, trois ambiances</h3><div class="simple-examples"><span>Jeans + baskets + cardigan</span><span>Jeans + mocassins + blazer</span><span>Jeans + chaussures habillées + bijou</span></div><p class="muted">Ce ne sont que des inspirations : composez vos trois versions avec les pièces que vous avez.</p></div>';
 if(kind==='capsule')return '<div class="visual-card"><h3>Votre capsule, à adapter</h3><div class="simple-examples"><span>2 bas</span><span>4 hauts</span><span>2 vestes</span><span>2 paires de chaussures</span></div><p class="muted">Le vrai objectif : quatre tenues que vous aimez porter, pas un nombre imposé de vêtements.</p></div>';
 return '';
}

function guidedFieldsHTML(d,e){
 if(!Array.isArray(d.guided_fields)||!d.guided_fields.length)return '';
 const saved=e.answers?.guided||{};
 const renderField=f=>'<div class="field guided-field"><label for="guided-'+esc(f.id)+'">'+esc(f.label)+'</label>'+
  (f.kind==='textarea'?'<textarea id="guided-'+esc(f.id)+'" data-guided="'+esc(f.id)+'" maxlength="600" placeholder="'+esc(f.placeholder||'')+'">'+esc(saved[f.id]||'')+'</textarea>':
   '<input id="guided-'+esc(f.id)+'" data-guided="'+esc(f.id)+'" type="text" maxlength="220" value="'+esc(saved[f.id]||'')+'" placeholder="'+esc(f.placeholder||'')+'">')+'</div>';
 if(d.day===1){
  let groups='';
  for(let i=1;i<=3;i++){
   const fields=d.guided_fields.filter(f=>f.id.startsWith('s'+i+'_'));
   groups+='<div class="situation-card"><h4>Situation '+i+'</h4><div class="situation-grid">'+fields.map(renderField).join('')+'</div></div>';
  }
  return '<section class="guided-card"><h3>✎ '+esc(d.guided_heading||'Mon observation')+'</h3><p class="muted">Notez des situations qui correspondent à votre vraie vie. Vous pouvez revenir compléter plus tard.</p>'+'<div class="three-words-feature" id="threeWordsZone"><div class="three-words-head"><span aria-hidden="true">✦</span><div><h3>Mes trois mots pour les 21 prochains jours</h3><p>Choisissez trois mots qui disent comment vous aimeriez vous sentir. Vous pourrez les retrouver au jour 3 et au bilan final. Vous pourrez aussi les compléter plus tard.</p></div></div><div class="three-words-grid">'+[0,1,2].map((i)=>'<div class="field"><label for="threeWord'+i+'">Mon mot n° '+(i+1)+'</label><input id="threeWord'+i+'" type="text" data-word="'+i+'" maxlength="45" placeholder="'+(['Ex. élégante','Ex. affirmée','Ex. libre'][i])+'" value="'+esc(threeWords()[i])+'"></div>').join('')+'</div><p class="word-feedback" id="wordsFeedback">'+(startWordsValid()?'Vos trois mots sont enregistrés : vous pouvez poursuivre.':'Vous pouvez continuer et compléter vos mots plus tard.')+'</p></div>'+groups+'</section>';
 }
 return '<section class="guided-card"><h3>✎ '+esc(d.guided_heading||'Quelques repères à noter')+'</h3><div class="guided-grid">'+d.guided_fields.map(renderField).join('')+'</div></section>';
}
function dayReferenceHTML(d){
 if(d.day===3){
  const words=threeWords().filter(Boolean).join(' · ');
  return '<aside class="day-reference"><span class="reference-icon" aria-hidden="true">↗</span><div><strong>Vos trois mots du jour 1</strong><p>'+(words?esc(words):'Vous n’avez pas encore renseigné vos trois mots au jour 1. Vous pouvez y revenir à tout moment.')+'</p><button type="button" class="text-button" data-day="1">Retrouver mon point de départ</button></div></aside>';
 }
 if(d.day===21){
  const startWords=threeWords().filter(Boolean).join(' · ');
  const styleWords=entry(8).answers?.[0]||'';
  const signature=entry(14).answers?.[0]||'';
  const celebrate=entry(15).answers?.[0]||'';
  const reminders=[
   ['Votre intention de départ',startWords],
   ['Vos mots de style',styleWords],
   ['Votre signature',signature],
   ['Ce que vous aimez valoriser',celebrate]
  ];
  return '<section class="journey-recap"><h2>Le fil de vos 21 jours</h2><p>Voici les repères que vous avez déposés dans votre carnet. Les cases encore vides peuvent être complétées à votre rythme.</p><div class="recap-grid">'+reminders.map(([label,value])=>'<div><small>'+esc(label)+'</small><p>'+esc(value||'À découvrir ou à compléter…')+'</p></div>').join('')+'</div></section>';
 }
 return '';
}
function dayHTML(){
 const d=D(state.day),e=entry(d.day),photoSet=state.photos[d.day]||[];
 const photos={
  15:['assets/consultation-miroir.png','Un accompagnement en image autour du miroir'],
  16:['assets/couleurs-jardin-2.png','Une séance de draping avec des tissus colorés']
 };
 const picture=photos[d.day];
 const learning='<section class="day-learning">'+
  '<div class="learning-title"><span class="learning-symbol" aria-hidden="true">✦</span><div><span class="eyebrow">LE REGARD PROFESSIONNEL</span><h2>Le savoir du jour</h2></div></div><p>'+esc(d.lesson||d.why)+'</p></section>';
 const example='<section class="day-example"><div class="example-head"><span class="example-symbol" aria-hidden="true">↗</span><h3>Un exemple concret</h3></div>'+
  '<p>'+esc(d.example||'')+'</p>'+
  (picture?'<figure class="example-photo"><img loading="lazy" src="'+esc(picture[0])+'" alt="'+esc(picture[1])+'"><figcaption>Un aperçu de l’univers Aligner Conseil.</figcaption></figure>':'')+
  '</section>';
 const checklist= d.checklist?'<fieldset class="quick-reflection"><legend>'+esc(d.checklist.question)+'</legend><p>Plusieurs réponses sont possibles, ou aucune. Il n’y a pas de bonne ou de mauvaise réponse.</p>'+
  d.checklist.options.map((o,i)=>'<label class="quick-option"><input type="checkbox" data-quick-option="'+i+'" '+((Array.isArray(e.answers?.quick)?e.answers.quick:[]).includes(i)?'checked':'')+'><span>'+esc(o)+'</span></label>').join('')+'</fieldset>':'';
 const specialCommunity=d.day===18?'<aside class="day-reference"><span class="reference-icon" aria-hidden="true">♡</span><div><strong>Le Cercle Aligné</strong><p>'+esc(d.community_note||'Un espace de partage facultatif et bienveillant.')+'</p><button class="btn small outline" type="button" data-nav="community">Découvrir le Cercle Aligné</button></div></aside>':'';
 const final=d.day===21?'<section class="final-moment"><span aria-hidden="true">✦</span><h2>Et maintenant ?</h2><p>'+esc(d.final_message||'Votre style vous appartient.')+'</p><div class="actions"><button type="button" class="btn" data-nav="bilan">Découvrir mon bilan style →</button><button type="button" class="btn outline" data-nav="services">Explorer la suite, à mon rythme</button></div></section>':'';
 return '<div class="day-head"><span class="badge '+(d.phase==='Clarifier'?'rose':d.phase==='Agir'?'blue':'')+'">JOUR '+fmt(d.day)+' / 21 · '+esc(d.phase).toUpperCase()+'</span><span class="badge gold">'+esc(d.minutes)+' minutes</span></div>'+
 '<h1 class="day-title">'+esc(d.title)+'</h1><div class="stage-rule"></div>'+
 '<section class="day-intro"><h3 class="section-title">Pourquoi cette étape compte</h3><p>'+esc(d.why)+'</p></section>'+
 learning+example+
 (d.visual?visualHTML(d.visual):'')+
 dayReferenceHTML(d)+
 '<section class="section card experience-card"><h3 class="section-title"><span aria-hidden="true">✓</span> L’expérience du jour</h3><ol class="task-list">'+d.steps.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol>'+
 (d.coach_tip?'<div class="coach-tip"><strong>Le conseil d’Adeline</strong><p>'+esc(d.coach_tip)+'</p></div>':'')+
 (d.transition?'<p class="muted">'+esc(d.transition)+'</p>':'')+'</section>'+
 '<section class="section formbox"><h2>Mon carnet du jour</h2><p class="muted">Vos réponses sont personnelles. Elles ne deviennent visibles par Adeline que si vous choisissez de partager cette journée.</p>'+
 guidedFieldsHTML(d,e)+checklist+
 d.prompts.map((p,i)=>'<div class="field"><label for="prompt'+i+'">'+esc(p)+'</label><textarea id="prompt'+i+'" data-answer="'+i+'" placeholder="Ce que j’ai remarqué, ce que j’ai envie d’essayer…">'+esc(e.answers?.[i]||'')+'</textarea></div>').join('')+
 '<div class="field"><label for="note">Mes notes personnelles (facultatif)</label><textarea id="note" data-note="true" placeholder="Une découverte, une hésitation, un détail à conserver…">'+esc(e.notes||'')+'</textarea></div>'+
 '<h3 class="section-title">Mes photos du jour (facultatives)</h3><div class="upload"><div>Ajoutez une photo de tenue, de vêtement ou de vos essais si cela vous aide.</div><small>JPG, PNG ou WebP · 5 Mo maximum par photo</small><input id="photoUpload" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Ajouter des photos à mon exercice"></div>'+
 '<div class="photos">'+photoSet.map(p=>'<figure class="photo"><img src="'+esc(p.url)+'" alt="Photo déposée pour le jour '+d.day+'"><div class="photo-label">'+esc(p.name||'Photo')+'</div><button data-delete-photo="'+esc(p.id)+'" type="button">Supprimer</button></figure>').join('')+'</div>'+
 '<hr class="hline"><div class="switch-row"><input type="checkbox" id="share" '+(e.shared_with_adeline?'checked':'')+'><div><label for="share">J’autorise Adeline à consulter cet exercice</label><p>Si vous cochez, les réponses, les notes et toutes les photos de ce jour deviennent consultables dans son espace professionnel. Décochez à tout moment pour retirer cet accès. Vos contenus ne seront jamais publiés sans autorisation séparée.</p></div></div>'+
 '<p class="status" id="saveStatus" role="status"></p><div class="actions"><button class="btn" id="save">Enregistrer mes réponses</button><button class="btn ghost" id="complete">'+(e.completed?'✓ Étape terminée':'Marquer comme terminé')+'</button><button class="btn outline" id="request">Demander à Adeline de me contacter</button></div></section>'+
 specialCommunity+final+
 '<div class="actions" style="justify-content:space-between"><button class="btn ghost" '+(d.day===1?'disabled':'')+' data-day="'+(d.day-1)+'">← Jour précédent</button><button class="btn ghost" '+(d.day===21?'disabled':'')+' data-day="'+(d.day+1)+'">Jour suivant →</button></div>'+
 ([5,10,17].includes(d.day)?'<section class="community"><h2>Et si vous souhaitiez approfondir ce sujet ?</h2><p>'+(d.day===5?'Cette première exploration vous donne des repères. Une séance de colorimétrie personnalisée permet d’aller plus loin avec des comparaisons guidées, une analyse professionnelle et des conseils adaptés à votre visage.':d.day===10?'Ces premiers essais vous aident à observer les lignes et les volumes. Un accompagnement morphostyle permet d’approfondir vos préférences et de trouver ensemble des coupes qui vous ressemblent.':'Cet exercice est un premier pas vers une présence plus assurée. Un accompagnement individuel vous permet de travailler votre posture et votre aisance à l’oral grâce à des conseils personnalisés.')+'</p><button class="btn pink" data-open-request="">J’aimerais être recontactée</button><button class="btn outline" data-nav="services">Découvrir les accompagnements</button></section>':'');
}


function bilanAnswer(day,index=0){const a=entry(day).answers?.[index];return typeof a==='string'?a.trim():'';}
function bilanGuided(day,key){const a=entry(day).answers?.guided?.[key];return typeof a==='string'?a.trim():'';}
function bilanWords(){const a=['style_word1','style_word2','style_word3'].map(k=>bilanGuided(8,k)).filter(Boolean);return a.length?a.join(' · '):bilanAnswer(8,0)}
function bilanPick(day){const d=D(day),ids=Array.isArray(entry(day).answers?.quick)?entry(day).answers.quick:[];return d?.checklist?.options?ids.filter(i=>Number.isInteger(i)&&i>=0&&i<d.checklist.options.length).map(i=>d.checklist.options[i]).join(' ; '):''}
function bilanNotes(){
 return {
  firstWords:threeWords().filter(Boolean).join(' · '),initial:bilanAnswer(1,0),
  favorite:bilanGuided(2,'favorite_piece')||bilanAnswer(2,0),
  colors:[bilanGuided(5,'favorite_color'),bilanGuided(5,'worn_color')].filter(Boolean).join(' / '),
  neutral:bilanAnswer(6,0),material:bilanAnswer(11,0)||bilanAnswer(11,1),
  style:bilanWords(),universes:bilanPick(8),lines:bilanAnswer(10,0),
  signature:bilanAnswer(14,0),details:bilanAnswer(13,1),highlights:bilanAnswer(15,0),
  capsule:bilanAnswer(19,0),weekly:bilanAnswer(20,0),
  progress:bilanAnswer(21,0)||bilanAnswer(7,0),habit:bilanAnswer(21,1),
  future:bilanGuided(21,'letter_future')
 };
}
function bilanCard(title,value,day,help){
 const hasValue=!!String(value||'').trim();
 return '<article class="bilan-item'+(hasValue?'':' to-complete')+'"><div class="bilan-item-heading"><h3>'+esc(title)+'</h3><span>JOUR '+fmt(day)+'</span></div>'+
 (hasValue?'<p>'+esc(value).replace(/\n/g,'<br>')+'</p>':'<p class="bilan-pending">'+esc(help||'Votre découverte apparaîtra ici après cet exercice.')+'</p>')+
 '<button type="button" class="bilan-edit" data-day="'+day+'">'+(hasValue?'Retrouver mon exercice':'Compléter cette découverte')+' ↗</button></article>';
}
function bilanHTML(){
 const a=bilanNotes(),completed=completedCount(),photos=Object.values(state.photos||{}).flat();
 const displayName=String(state.displayName||'').trim();
 return '<span class="badge rose">MON BILAN PERSONNEL</span>'+
 '<div class="bilan-sheet">'+
 '<section class="bilan-hero"><div class="bilan-hero-eyebrow">ALIGNER CONSEIL · MON CARNET ALIGNÉ</div><h1>Ma boussole style</h1>'+
 '<p>Mon guide personnel pour retrouver ce qui me ressemble, choisir mes tenues avec plus de liberté et faire vivre mes découvertes au quotidien.</p>'+
 '<div class="bilan-identity">'+(displayName?'<span>Mon carnet : '+esc(displayName)+'</span>':'<span>Mon carnet personnel</span>')+
 '<span>'+completed+' journée'+(completed>1?'s':'')+' explorée'+(completed>1?'s':'')+' sur 21</span></div></section>'+
 '<section class="bilan-section"><div class="bilan-section-heading"><span>01</span><div><h2>Ce qui compte pour moi</h2><p>Mes envies de départ, mes repères et ce que j’aime déjà porter.</p></div></div>'+
 '<div class="bilan-card-grid">'+
 bilanCard('Mes trois mots de départ',a.firstWords,1,'Vous pouvez choisir vos trois mots quand vous le souhaitez.')+
 bilanCard('Mon intention de départ',a.initial,1,'Ce que vous souhaitez ressentir dans vos vêtements.')+
 bilanCard('Une pièce dans laquelle je me reconnais',a.favorite,2,'Une pièce préférée, sa coupe ou ce qu’elle vous apporte.')+
 '</div></section>'+
 '<section class="bilan-section"><div class="bilan-section-heading"><span>02</span><div><h2>Mes couleurs et mes matières</h2><p>Des observations et préférences personnelles, sans diagnostic colorimétrique automatique.</p></div></div>'+
 '<div class="bilan-card-grid">'+
 bilanCard('Mes couleurs préférées et habituelles',a.colors,5,'Les couleurs que vous aimez et portez le plus souvent.')+
 bilanCard('Le neutre que j’aime près du visage',a.neutral,6,'Une nuance testée près du visage, selon votre ressenti.')+
 bilanCard('Les matières que j’apprécie',a.material,11,'Un tombé, un toucher ou un critère de confort à retenir.')+
 '</div></section>'+
 '<section class="bilan-section"><div class="bilan-section-heading"><span>03</span><div><h2>Ma signature de style</h2><p>Des choix que je peux reconnaître, exprimer et réutiliser.</p></div></div>'+
 '<div class="bilan-card-grid">'+
 bilanCard('Mes mots de style',a.style,8,'Les trois mots qui vous correspondent aujourd’hui.')+
 bilanCard('Mes univers vestimentaires',a.universes,8,'Les inspirations qui vous attirent, même si elles sont différentes.')+
 bilanCard('Les lignes et volumes que j’aime',a.lines,10,'Une proportion, une coupe ou une ligne visuelle observée.')+
 bilanCard('Ma formule signature',a.signature,14,'Par exemple : une base simple, une veste structurée, un détail coloré.')+
 '</div></section>'+
 '<section class="bilan-section"><div class="bilan-section-heading"><span>04</span><div><h2>Mon dressing en action</h2><p>Les détails et associations qui rendent mon style facile à vivre.</p></div></div>'+
 '<div class="bilan-card-grid">'+
 bilanCard('Le détail qui transforme une tenue',a.details,13,'Sac, bijou, chaussure, coiffure ou touche de couleur.')+
 bilanCard('Ce que j’aime mettre en valeur',a.highlights,15,'Ce que vous choisissez de révéler, à votre manière.')+
 bilanCard('Mes pièces incontournables',a.capsule,19,'Les bases de votre mini-capsule personnelle.')+
 bilanCard('Mes tenues de la semaine',a.weekly,20,'Trois associations utiles pour votre vraie vie.')+
 '</div></section>'+
 '<section class="bilan-section bilan-next"><div class="bilan-section-heading"><span>05</span><div><h2>Je continue à mon rythme</h2><p>Mon plan d’action pour les trente prochains jours.</p></div></div>'+
 '<div class="bilan-card-grid">'+
 bilanCard('Les progrès que je reconnais',a.progress,21,'Un petit changement concret est déjà un progrès.')+
 bilanCard('Mon rituel pour les 30 prochains jours',a.habit,21,'Une habitude simple à répéter, à votre rythme.')+
 (a.future?bilanCard('Un mot à moi-même dans un mois',a.future,21,''):'')+
 '</div><div class="bilan-closing"><span aria-hidden="true">✦</span><p>Mon style n’est pas une liste de règles. C’est une manière de me reconnaître, d’exprimer ce que j’aime et d’habiller la personne que je suis aujourd’hui.</p></div></section>'+
 '</div>'+
 '<section class="bilan-export-panel"><div><h2>Je garde ma boussole style</h2><p>Votre document rassemble vos propres réponses. Vous pouvez le consulter dès maintenant, même si les 21 journées ne sont pas terminées. Il se met à jour au fil de votre parcours.</p>'+
 (photos.length?'<label class="bilan-photo-consent"><input id="bilanPhotos" type="checkbox"><span>Ajouter jusqu’à 6 de mes photos personnelles dans le document imprimable</span></label>':'<p class="muted">Vous pourrez ajouter des photos à vos exercices si vous le souhaitez. Elles restent privées par défaut.</p>')+
 '<p class="muted">Les photos ne sont incluses que si vous cochez cette option. Ce document ne contient aucun diagnostic automatique de morphologie ou de colorimétrie.</p></div>'+
 '<div class="bilan-export-actions"><button class="btn pink" id="downloadBilan">Ouvrir mon bilan pour l’enregistrer en PDF ↗</button><p class="muted">Une page imprimable s’ouvrira. Choisissez « Imprimer », puis « Enregistrer au format PDF ».</p></div></section>'+
 '<div class="community"><h2>Et si j’avais envie d’un regard professionnel personnalisé ?</h2><p>Ce bilan reflète vos découvertes personnelles. Un rendez-vous avec Adeline peut permettre d’aller plus loin grâce à une analyse individualisée, des essais guidés et des conseils adaptés à vos objectifs.</p><div class="actions"><button class="btn pink" data-nav="services">Découvrir les accompagnements</button><button class="btn outline" data-nav="services">Explorer le bilan d’image personnalisé</button></div></div>';
}

function servicesHTML(){
 const offerings=[
 ['Colorimétrie','Comprendre l’effet des nuances près du visage et explorer les harmonies qui vous ressemblent.','assets/couleurs-jardin-1.png',''],
 ['Morphostyle','Explorer les lignes, les coupes et les volumes qui vous plaisent et vous mettent à l’aise.','assets/morphostyle.webp','Coupes · Volumes · Allure'],
 ['Prise de parole','Développer votre aisance, votre voix et votre présence dans les échanges professionnels.','assets/prise-de-parole.webp','Voix · Posture · Présence']
 ];
 const packages=[
 ['Présence Juste','Diagnostic image & posture, colorimétrie complète, morphologie silhouette ou visage, conseils de style et carnet personnalisé.','Pour approfondir son image et mieux se connaître'],
 ['Image Alignée','Présence Juste, tri dressing OU shopping accompagné, carnet approfondi, coaching WhatsApp pendant un mois, préparation à l’oral, shooting professionnel de 30 minutes et 2 photos numériques.','Avec coaching et séance photo professionnelle'],
 ['Visibilité','Image Alignée, image professionnelle et supports, communication et posture, shooting professionnel approfondi avec 5 photos numériques et suivi personnalisé pendant 30 jours.','Pour les projets de visibilité professionnelle']
 ];
 return `<span class="badge rose">POUR ALLER PLUS LOIN</span><h1>Un accompagnement qui vous ressemble</h1><p class="lead">Ce carnet est un parcours complet en autonomie. Si vous souhaitez un regard individualisé sur vos couleurs, votre style ou votre présence, Aligner Conseil propose également des séances et des accompagnements plus complets, sans obligation.</p><div class="services-scroll-hint"><div class="scroll-hint-main"><span class="scroll-hint-icon" aria-hidden="true">↓</span><div><strong>La page continue plus bas !</strong><p>Découvrez toutes mes prestations, du bilan d’image aux accompagnements complets. Faites défiler pour ne rien manquer.</p></div></div><button type="button" class="btn small outline" data-scroll-target="packages-section">Voir les accompagnements complets ↓</button></div><section class="adeline-services"><img src="assets/portrait-accueil.png" alt="Adeline, fondatrice d’Aligner Conseil"><div><strong>Bonjour, je suis Adeline.</strong><p>Chaque parcours est différent. Vous pouvez simplement profiter de votre carnet, ou choisir un échange pour approfondir ce qui compte pour vous.</p></div></section><div class="availability-strip"><strong>En visio :</strong> partout en France <span>·</span> <strong>En présentiel :</strong> Tours, Blois et alentours selon disponibilités</div><section class="bilan-service"><div><figure class="bilan-photo-frame"><img src="assets/accompagnement.webp" loading="lazy" alt="Adeline en entretien personnalisé de conseil en image" onerror="this.closest(&quot;figure&quot;).hidden=true"></figure><span class="badge rose">UN PREMIER REGARD PROFESSIONNEL</span><h2>Votre bilan d’image personnalisé</h2><p>Vous avez envie d’y voir plus clair sur votre image, votre posture ou ce que vous souhaitez transmettre ? Ce bilan individuel, proposé dans les prestations à la carte sous le nom de <strong>Diagnostic image &amp; posture</strong>, permet de faire le point ensemble sur vos besoins et de définir les pistes adaptées à votre situation.</p><p class="muted">Une séance d’environ 1 h 30 avec Adeline. Contrairement au bilan style inclus dans votre carnet, ce rendez-vous repose sur un échange et un regard professionnel individualisé.</p></div><div class="bilan-service-actions"><button class="btn pink" data-open-request="Bilan d’image personnalisé">Je découvre mon bilan d’image</button><a href="https://alignerconseil.fr/#individuel" target="_blank" rel="noopener noreferrer">Consulter les modalités sur mon site ↗</a></div></section><h2 style="margin:28px 0 14px">Une question précise ?</h2><div class="grid">${offerings.map(([name,desc,img,visual])=>`<article class="card service-card">${img?`<img class="service-photo" loading="lazy" src="${esc(img)}" alt="${esc(name)} : conseil et accompagnement Aligner Conseil" onerror="this.onerror=null;this.hidden=true;this.nextElementSibling.hidden=false"><div class="service-placeholder" hidden><strong>${esc(name)}</strong><small>${esc(visual)}</small></div>`:`<div class="service-placeholder"><strong>${esc(name)}</strong><small>${esc(visual)}</small></div>`}<h3>${esc(name)}</h3><p>${esc(desc)}</p><button class="btn small outline" data-open-request="${esc(name)}">En parler avec Adeline</button></article>`).join('')}</div><h2 id="packages-section" style="margin:34px 0 10px">Mes accompagnements complets</h2><p class="lead">Un diagnostic personnalisé, des conseils adaptés à votre style et, selon la formule, un shooting photo avec un photographe professionnel.</p><div class="grid">${packages.map(([name,desc,detail],i)=>`<article class="card package-card"><span class="badge ${i===1?'rose':''}">${i===0?'Se découvrir':i===1?'Style & photographie':'Projet professionnel'}</span><h3>${esc(name)}</h3><p>${esc(desc)}</p><small>${esc(detail)}</small><button class="btn small ${i===1?'pink':'outline'}" data-open-request="${esc(name)}">Découvrir cette formule</button></article>`).join('')}</div><p class="muted" style="margin-top:14px">Les prestations détaillées, les tarifs et les modalités pratiques sont disponibles sur le site Aligner Conseil. Les disponibilités du photographe sont à confirmer lors de l’échange.</p><a class="btn outline" href="https://alignerconseil.fr/#individuel" target="_blank" rel="noopener noreferrer">Voir les prestations sur Aligner Conseil ↗</a><div class="community"><h2>On en parle ?</h2><p>Choisissez le sujet ou la formule qui vous intéresse et votre préférence de contact : email, téléphone ou SMS. Votre demande n’engage à aucune réservation ni paiement.</p><button class="btn pink" data-open-request="">Je souhaite être recontactée</button></div>`;
}


function closeBilanPreview(){
 const preview=document.getElementById('bilan-print-overlay');
 if(preview)preview.remove();
 document.body.classList.remove('bilan-print-open');
}
function exportBilan(){
 try{
  const original=document.querySelector('.bilan-sheet');
  if(!original){toast('Votre bilan est momentanément indisponible.');return}
  closeBilanPreview();
  const sheet=original.cloneNode(true);
  sheet.querySelectorAll('button').forEach(el=>el.remove());
  const usePhotos=!!document.getElementById('bilanPhotos')?.checked;
  const photos=usePhotos?Object.values(state.photos||{}).flat().filter(p=>p.url).slice(0,6):[];
  const preview=document.createElement('div');
  preview.id='bilan-print-overlay';
  preview.setAttribute('role','dialog');
  preview.setAttribute('aria-modal','true');
  preview.setAttribute('aria-label','Aperçu de ma boussole style');
  preview.innerHTML='<header class="bilan-print-toolbar"><div><strong>Aperçu de votre boussole style</strong><p>Vérifiez votre document puis cliquez sur « Imprimer / Enregistrer en PDF ». Sur Mac, choisissez PDF dans les options d’impression.</p></div><div class="bilan-print-actions"><button type="button" class="btn pink" id="printBilanNow">Imprimer / Enregistrer en PDF</button><button type="button" class="btn outline" id="closeBilanPreview">Fermer l’aperçu</button></div></header><div class="bilan-print-content"></div>';
  const content=preview.querySelector('.bilan-print-content');
  content.appendChild(sheet);
  if(photos.length){
   const gallery=document.createElement('section');
   gallery.className='bilan-print-photos';
   gallery.innerHTML='<h2>Mes souvenirs en images</h2><p>Ces photographies personnelles ont été ajoutées à mon bilan avec mon accord.</p><div class="bilan-print-photo-grid">'+photos.map(p=>'<figure><img loading="eager" alt="Ma photo du jour '+esc(p.day)+'" src="'+esc(p.url)+'"><figcaption>Jour '+fmt(p.day)+'</figcaption></figure>').join('')+'</div>';
   content.appendChild(gallery);
  }
  const note=document.createElement('p');
  note.className='bilan-print-disclaimer';
  note.textContent='Aligner Conseil. Synthèse personnelle issue des exercices de Mon Carnet Aligné. Ce document ne constitue pas un diagnostic professionnel individualisé.';
  content.appendChild(note);
  document.body.appendChild(preview);
  document.body.classList.add('bilan-print-open');
  preview.querySelector('#printBilanNow').addEventListener('click',()=>{try{window.print()}catch(err){toast('Impossible d’ouvrir la fonction d’impression : '+err.message)}});
  preview.querySelector('#closeBilanPreview').addEventListener('click',closeBilanPreview);
  preview.querySelector('#printBilanNow').focus();
  preview.scrollTop=0;
 }catch(err){closeBilanPreview();toast('Impossible de préparer le bilan : '+err.message)}
}

function communityHTML(){return `<span class="badge rose">ENTRE NOUS</span><h1>Le Cercle Aligné</h1><p class="lead">Un espace d'échanges, de petits défis et de soutien mutuel. Les membres peuvent partager leurs photos ou leurs découvertes si elles le souhaitent. La participation est facultative.</p><div class="grid"><div class="card"><h3>Bienveillance</h3><p>On commente les idées, pas les corps. Aucun jugement, aucune comparaison.</p></div><div class="card"><h3>Choix du partage</h3><p>Aucune obligation de montrer son visage ni sa tenue. On peut participer avec des mots seulement.</p></div><div class="card"><h3>Pas de diagnostic collectif</h3><p>Les échanges ne remplacent ni un draping professionnel ni un rendez-vous individuel.</p></div></div><div class="community"><h2>Rejoindre la communauté WhatsApp</h2>${(LIVE?state.whatsappInviteUrl:CFG.whatsappInviteUrl)?`<p>Le groupe est facultatif. Avant de rejoindre : les autres membres d'un groupe peuvent voir votre numéro et les contenus que vous publiez.</p><a class="btn" target="_blank" rel="noopener noreferrer" href="${esc(LIVE?state.whatsappInviteUrl:CFG.whatsappInviteUrl)}">Rejoindre le Cercle Aligné ↗</a>`:`<p>Le lien d'accès sera ajouté après la création et la modération du groupe. Le programme reste accessible sans WhatsApp.</p><span class="badge gold">Communauté en préparation</span>`}</div><h2 style="margin-top:30px">Règles du Cercle</h2><p class="lead">Pas de capture ni de transfert des photos des autres. Pas de publicité ni de sollicitation privée sans accord. On respecte la confidentialité des échanges. Adeline anime la communauté sans garantir une réponse personnelle à chaque publication.</p>`}
function profileHTML(){const count=Object.values(state.entries).filter(e=>e.shared_with_adeline).length;
return `<span class="badge">CONFIDENTIALITÉ ET PRÉFÉRENCES</span><h1>Mon espace personnel</h1>
<div class="card"><h3>Mon prénom</h3><div class="field"><label for="newName">Prénom affiché</label><input id="newName" maxlength="80" value="${esc(state.displayName||'')}"></div><button class="btn small" id="updateName">Mettre à jour</button></div>
<div class="card" style="margin-top:16px"><h3>Je choisis ce que je partage</h3><p>Vos notes et photos sont privées par défaut. Le partage est indépendant pour chacune des 21 journées et peut être retiré à tout moment.</p><p><strong>Exercices actuellement partagés :</strong> ${count}/21.</p><button class="btn ghost" data-nav="day">Gérer mes partages</button></div>
<div class="card" style="margin-top:16px"><h3>Exporter mon carnet et mes photos</h3><p>Le fichier JSON contient vos réponses, vos notes et la liste de vos photos. Pour télécharger les images elles-mêmes, utilisez le bouton ci-dessous.</p><div class="actions"><button class="btn outline" id="export">Exporter mes textes (Markdown)</button><button class="btn outline" id="exportJSON">Exporter mes données (JSON)</button><button class="btn ghost" id="downloadPhotos">Télécharger mes photos</button></div></div>
<div class="card" style="margin-top:16px"><h3>Sécuriser mon compte</h3><p>Modifiez votre mot de passe depuis une session connectée.</p><div class="field"><label for="newPassword">Nouveau mot de passe (12 caractères minimum)</label><input type="password" id="newPassword" autocomplete="new-password" minlength="12"></div><button class="btn ghost" id="changePassword">Modifier le mot de passe</button></div>
<div class="card danger-card" style="margin-top:16px">
<h3>Demander la suppression de mon compte</h3>
<p>Vous pouvez demander la fermeture de votre compte et l'effacement de votre carnet, de vos réponses et de vos photos. Certaines informations relatives aux achats, notamment les factures, doivent être conservées pendant les délais légaux.</p>
<p>Pensez à exporter vos réponses et à télécharger vos photos avant de demander la suppression, si vous souhaitez en garder une copie. Votre demande sera examinée et traitée dans les délais prévus par la réglementation.</p>
<a class="btn outline" href="mailto:contact@alignerconseil.fr?subject=Demande%20de%20suppression%20de%20mon%20compte%20Mon%20Carnet%20Align%C3%A9">Demander la suppression par e-mail</a>
</div>
<div class="card" style="margin-top:16px"><h3>Ressources complémentaires</h3><button class="btn ghost" id="downloadGuide">Télécharger le guide et ses fiches</button></div>
<p class="footer-note">Pour vos données personnelles : <a href="mailto:contact@alignerconseil.fr">contact@alignerconseil.fr</a>. ${CFG.privacyUrl?`<a href="${esc(CFG.privacyUrl)}" target="_blank" rel="noopener">Politique de confidentialité</a>`:'Politique de confidentialité à publier avant la mise en ligne.'}</p>`}

function adminHTML(){if(!isDemo()&&state.role!=='admin')return '<div class="notice warning">Accès réservé à l’administratrice du programme.</div>';
 const rows=isDemo()?Object.values(state.entries).filter(e=>e.shared_with_adeline).map(e=>({...e,user_id:'demo',updated_at:new Date().toISOString()})):state.adminEntries;
 const total=isDemo()?1:state.totalMembers;
 const profiles=isDemo()?{demo:{display_name:'Participante de démonstration',email:'non disponible en mode démo'}}:state.adminProfiles;
 const filtered=rows.filter(e=>(state.entryFilter==='Tous'||String(e.day)===state.entryFilter)&&(`${profiles[e.user_id]?.display_name||''} ${profiles[e.user_id]?.email||''} ${D(e.day)?.title||''}`.toLocaleLowerCase('fr').includes(state.search.toLocaleLowerCase('fr'))));
 const photos=isDemo()?Object.values(state.photos).flat().map(p=>({...p,user_id:'demo'})):state.adminPhotos;
 const requests=state.requests;
 return `<span class="badge blue">ESPACE PROFESSIONNEL</span><h1>Tableau de bord Aligner Conseil</h1><p class="lead">Consultation des exercices explicitement partagés. Les notes et photos privées des participantes restent invisibles.</p><div class="grid"><div class="card"><div class="stat-label">ACCÈS ACTIFS</div><span class="stat-num">${total}</span><small>${isDemo()?'Démonstration : une participante fictive':'Inscriptions activées'}</small></div><div class="card"><div class="stat-label">EXERCICES PARTAGÉS</div><span class="stat-num">${rows.length}</span><small>Partages volontaires en cours</small></div><div class="card"><div class="stat-label">DEMANDES DE CONTACT</div><span class="stat-num">${requests.length}</span><small>Messages explicitement adressés à Adeline</small></div></div><h2 style="margin-top:35px">Demandes de contact</h2>${requests.length?requests.map(r=>`<div class="request-card"><strong>${esc(profiles[r.user_id]?.display_name||'Participante')} · Jour ${fmt(r.day)}</strong> · <small>${shortDate(r.created_at)}</small><p>${esc(r.message)}</p><label>Suivi : <select data-lead-status="${esc(r.id)}" aria-label="Statut de la demande"><option value="new" ${r.status==='new'?'selected':''}>Nouvelle</option><option value="in_progress" ${r.status==='in_progress'?'selected':''}>En cours</option><option value="done" ${r.status==='done'?'selected':''}>Traitée</option></select></label> ${r.contact_method==='phone'&&r.contact_phone?`<a href="tel:${esc(r.contact_phone)}">Appeler ${esc(r.contact_phone)}</a>`:r.contact_method==='sms'&&r.contact_phone?`<a href="sms:${esc(r.contact_phone)}">Envoyer un SMS au ${esc(r.contact_phone)}</a>`:profiles[r.user_id]?.email?`<a href="mailto:${esc(profiles[r.user_id].email)}">Répondre par email</a>`:''}</div>`).join(''):'<div class="empty">Aucune demande de contact pour le moment.</div>'}<h2 style="margin-top:35px">Exercices partagés</h2><div class="filters"><input class="search" id="adminSearch" type="search" value="${esc(state.search)}" placeholder="Chercher une participante ou un exercice"><select class="search" id="adminDay"><option value="Tous">Tous les jours</option>${DAYS.map(d=>`<option value="${d.day}" ${state.entryFilter===String(d.day)?'selected':''}>Jour ${fmt(d.day)} · ${esc(d.title)}</option>`).join('')}</select>${LIVE?'<button class="btn ghost" id="refreshAdmin">Actualiser</button>':''}</div>${filtered.length?filtered.map(r=>`<article class="admin-entry"><h3>Jour ${fmt(r.day)} · ${esc(D(r.day)?.title||'Exercice')}</h3><small>${esc(profiles[r.user_id]?.display_name||'Participante')} · ${esc(profiles[r.user_id]?.email||'')} · Partagé · ${shortDate(r.updated_at)}</small><dl>${D(r.day)?.prompts.map((prompt,i)=>`<dt>${esc(prompt)}</dt><dd>${esc(r.answers?.[i]||'Aucune réponse')}</dd>`).join('')||''}<dt>Notes personnelles</dt><dd>${esc(r.notes||'Aucune note')}</dd></dl><div class="photos">${photos.filter(p=>p.day===r.day&&p.user_id===r.user_id).map(p=>`<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(p.url)}" alt="Photo volontairement partagée"></a>`).join('')}</div></article>`).join(''):'<div class="empty">Aucun exercice correspondant, ou aucune participante n’a autorisé le partage.</div>'}<p class="footer-note">Tu peux lire les photos et les réponses uniquement lorsqu'un partage est actif. Aucun commentaire ne doit être publié ni photo réutilisée sans accord distinct. Les informations présentées ici ne constituent pas une autorisation de prospection commerciale.</p>`;
}
function lockedHTML(){const payment=new URLSearchParams(location.search).get('paiement');return `<div class="auth-wrap"><div class="auth-card"><img src="assets/logo_source.png" alt="Aligner Conseil"><span class="badge rose">PROGRAMME INTERACTIF · 27 €</span><h1>${payment==='succes'?'Votre paiement est en cours de confirmation':'21 jours pour une image qui me ressemble'}</h1><p class="lead">21 expériences, votre carnet privé avec photos et la possibilité de partager certains exercices avec Adeline.</p><div class="notice">${payment==='succes'?'L’accès est activé automatiquement dès réception de la confirmation sécurisée du paiement. Aucun accès n’est accordé sur la seule base du retour depuis Stripe.':'Achat unique à 27 €, sans abonnement. Après paiement vérifié, votre espace sera accessible depuis votre compte.'}</div><div class="checkout-consents">
<label class="switch-row"><input type="checkbox" id="acceptCgv"><span>J'ai lu et j'accepte les <a href="${esc(CFG.termsUrl||'#')}" target="_blank" rel="noopener">conditions générales de vente</a>.</span></label>
<label class="switch-row"><input type="checkbox" id="instantAccess"><span>Je demande expressément l'accès immédiat au programme numérique avant la fin du délai de rétractation et reconnais qu'une fois son exécution commencée, je perds mon droit de rétractation selon les conditions légales applicables.</span></label>
</div><div class="actions"><button class="btn pink" id="checkout">Commander et payer · 27 €</button><button class="btn ghost" id="verifyAccess">Vérifier mon accès</button></div><p class="footer-note">Paiement sécurisé géré par Stripe. ${CFG.termsUrl?`<a href="${esc(CFG.termsUrl)}" target="_blank" rel="noopener">Conditions de vente</a>`:'Les conditions de vente devront être publiées avant ouverture des paiements.'}</p><button class="btn outline" id="logout" style="margin-top:12px">Se déconnecter</button></div></div>`}
function authHTML(){
const recovery=state.authForm==='recovery';const forgot=state.authForm==='forgot';
return `<div class="auth-wrap"><div class="auth-card"><img src="assets/logo_source.png" alt="Aligner Conseil"><h1>${recovery?'Choisir un nouveau mot de passe':forgot?'Réinitialiser mon mot de passe':'Bienvenue dans votre carnet'}</h1><p class="muted">${recovery?'Votre lien de réinitialisation a été vérifié.':forgot?'Recevez un lien sécurisé par email.':'Connectez-vous pour retrouver vos 21 jours d’exercices et vos photos personnelles.'}</p>
${recovery?`<form id="resetForm"><div class="field"><label for="resetPassword">Nouveau mot de passe (12 caractères minimum)</label><input id="resetPassword" type="password" minlength="12" autocomplete="new-password" required></div><button class="btn full" type="submit">Enregistrer mon mot de passe</button></form>`:forgot?`<form id="forgotForm"><div class="field"><label for="email">Votre adresse email</label><input id="email" type="email" autocomplete="email" required></div><button class="btn full" type="submit">Envoyer le lien</button></form>`:`<div class="seg"><button id="authLogin" class="${state.authForm==='login'?'active':''}">Connexion</button><button id="authSignup" class="${state.authForm==='signup'?'active':''}">Créer un compte</button></div><form id="authForm">${state.authForm==='signup'?'<div class="field"><label for="displayName">Votre prénom</label><input id="displayName" autocomplete="given-name" required maxlength="80"></div>':''}<div class="field"><label for="email">Adresse email</label><input id="email" type="email" autocomplete="email" required></div><div class="field"><label for="password">Mot de passe (12 caractères minimum)</label><input id="password" type="password" minlength="12" autocomplete="${state.authForm==='login'?'current-password':'new-password'}" required></div><button class="btn full" type="submit">${state.authForm==='signup'?'Créer mon compte':'Me connecter'}</button></form><button class="text-button" id="forgot">Mot de passe oublié ?</button>`}
${forgot?'<button class="text-button" id="backLogin">Retour à la connexion</button>':''}<div id="authError" class="footer-note" role="status"></div><p class="footer-note">Vos exercices sont privés par défaut. Aucune photo n'est partagée sans votre choix.</p></div></div>`}

function openRequestDialog(initialService=''){
 if(document.querySelector('#requestDialog'))return;
 document.body.insertAdjacentHTML('beforeend',requestDialog(initialService));
 const dlg=document.querySelector('#requestDialog');
 const format=dlg.querySelector('#requestFormat');
 format.addEventListener('change',()=>{
  dlg.querySelector('#requestZoneWrap').classList.toggle('hidden',format.value!=='Présentiel');
  if(format.value!=='Présentiel')dlg.querySelector('#requestZone').value='';
 });
 dlg.querySelector('#requestContactMethod').addEventListener('change',e=>{const byPhone=e.target.value!=='email';dlg.querySelector('#requestPhoneWrap').classList.toggle('hidden',!byPhone);if(!byPhone)dlg.querySelector('#requestPhone').value='';});
 dlg.querySelector('#closeRequest').addEventListener('click',()=>dlg.remove());
 dlg.querySelector('#sendRequest').addEventListener('click',sendRequest);
 dlg.querySelector('#requestTopic').focus();
}
function requestDialog(initialService=''){
 const topics=[['','Choisissez un sujet'],['Bilan d’image personnalisé','Bilan d’image & posture personnalisé'],['Colorimétrie','Découvrir mes couleurs'],['Morphostyle','Coupes, volumes et style'],['Prise de parole','Prise de parole et présence'],['Présence Juste','Formule Présence Juste'],['Image Alignée','Formule Image Alignée'],['Visibilité','Formule Visibilité'],['Autre question','Une autre question']];
 return `<div id="requestDialog" class="auth-wrap contact-modal" style="position:fixed;inset:0;z-index:200;background:#233d3880"><div class="auth-card contact-card" role="dialog" aria-modal="true" aria-labelledby="dialogTitle"><span class="badge rose">ON EN PARLE ?</span><h2 id="dialogTitle">Et si on échangeait ?</h2><p>Choisissez ce qui vous intéresse. Je reçois votre demande dans mon espace professionnel et je peux vous répondre à l’adresse email de votre compte.</p><div class="field"><label for="requestTopic">Votre sujet</label><select id="requestTopic">${topics.map(([value,title])=>`<option value="${esc(value)}" ${value===initialService?'selected':''}>${esc(title)}</option>`).join('')}</select></div><div class="field"><label for="requestFormat">Quel format préférez-vous ?</label><select id="requestFormat"><option value="">Choisir</option><option value="Visio">En visio (partout en France)</option><option value="Présentiel">En présentiel</option><option value="À définir ensemble">À définir ensemble</option></select></div><div class="field hidden" id="requestZoneWrap"><label for="requestZone">Dans quel secteur ?</label><select id="requestZone"><option value="">Choisir</option><option value="Tours et alentours">Tours et alentours</option><option value="Blois et alentours">Blois et alentours</option><option value="Autre Centre-Val de Loire">Ailleurs en Centre-Val de Loire</option><option value="Autre secteur">Autre secteur (à discuter)</option></select></div><div class="field"><label for="requestContactMethod">Comment préférez-vous être recontactée ?</label><select id="requestContactMethod"><option value="email">Par email (adresse de mon compte)</option><option value="phone">Par téléphone</option><option value="sms">Par SMS</option></select></div><div class="field hidden" id="requestPhoneWrap"><label for="requestPhone">Votre numéro de téléphone</label><input id="requestPhone" type="tel" inputmode="tel" autocomplete="tel" maxlength="22" placeholder="06 12 34 56 78"></div><div class="field"><label for="requestMessage">Un détail à me préciser ? <small>(facultatif)</small></label><textarea id="requestMessage" maxlength="950" placeholder="Aucune obligation de rédiger un message."></textarea></div><label class="switch-row contact-consent"><input id="requestConsent" type="checkbox"><span>J’accepte qu’Aligner Conseil utilise les coordonnées que j’ai choisies et les informations de cette demande pour me recontacter à ce sujet uniquement. Je peux retirer mon accord en écrivant à contact@alignerconseil.fr.</span></label><p class="muted">Mes photos et mes exercices ne sont pas partagés par cet envoi. Aucun rendez-vous n’est réservé ni facturé automatiquement.</p><div class="actions"><button class="btn pink" id="sendRequest">Envoyer ma demande</button><button class="btn ghost" id="closeRequest">Pas maintenant</button></div><p class="status" id="requestStatus" role="status"></p></div></div>`;
}
function render(){if(LIVE&&state.authForm==='recovery'){root.innerHTML=authHTML();attachAuth();return}if(LIVE&&!state.user){root.innerHTML=authHTML();attachAuth();return}if(LIVE&&!state.enrolled&&state.role!=='admin'){root.innerHTML=lockedHTML();bindLocked();bindLogout();return}if(LIVE&&state.role==='admin'&&state.view!=='admin')state.view='admin';
 const html=state.view==='home'?homeHTML():state.view==='day'?dayHTML():state.view==='days'?listHTML():state.view==='community'?communityHTML():state.view==='bilan'?bilanHTML():state.view==='services'?servicesHTML():state.view==='profile'?profileHTML():adminHTML();root.innerHTML=layout(html);bindNavigation();if(state.view==='bilan')document.querySelector('#downloadBilan')?.addEventListener('click',exportBilan);if(state.view==='day')bindDay();if(state.view==='profile')bindProfile();if(state.view==='admin')bindAdmin();bindLogout();}
function bindNavigation(){document.querySelectorAll('[data-open-request]').forEach(b=>b.addEventListener('click',()=>openRequestDialog(b.dataset.openRequest||'')));document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>goto(b.dataset.nav==='day'?'days':b.dataset.nav)));document.querySelectorAll('[data-day]').forEach(b=>b.addEventListener('click',()=>goto('day',Number(b.dataset.day))));document.querySelectorAll('[data-scroll-target]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.scrollTarget)?.scrollIntoView({behavior:'smooth',block:'start'})));document.querySelectorAll('[data-phase]').forEach(b=>b.addEventListener('click',()=>{state.phase=b.dataset.phase;render()}));}
function bindDay(){document.querySelectorAll('[data-answer]').forEach(t=>t.addEventListener('input',()=>{const e=entry(state.day);e.answers??={};e.answers[t.dataset.answer]=t.value;state.entries[state.day]=e;document.querySelector('#saveStatus').textContent='Enregistrement en cours…';scheduleSave()}));document.querySelectorAll('[data-word]').forEach(inp=>inp.addEventListener('input',()=>{const x=entry(1);x.answers??={};x.answers.guided??={};x.answers.guided['word'+(Number(inp.dataset.word)+1)]=inp.value; x.answers.guided.three_words=[0,1,2].map(i=>document.querySelector('[data-word="'+i+'"]')?.value.trim()||'').join(', ');state.entries[1]=x;const status=document.querySelector('#wordsFeedback');if(status)status.textContent=startWordsValid()?'Vos trois mots sont enregistrés : vous pouvez poursuivre.':'Vous pouvez continuer et compléter vos mots plus tard.';const save=document.querySelector('#saveStatus');if(save)save.textContent='Enregistrement en cours…';scheduleSave()}));document.querySelectorAll('[data-guided]').forEach(el=>el.addEventListener('input',()=>{const x=entry(state.day);x.answers??={};x.answers.guided??={};x.answers.guided[el.dataset.guided]=el.value;state.entries[state.day]=x;document.querySelector('#saveStatus').textContent='Enregistrement en cours…';scheduleSave()}));document.querySelectorAll('[data-quick-option]').forEach(box=>box.addEventListener('change',()=>{const x=entry(state.day);x.answers??={};const selected=new Set(Array.isArray(x.answers.quick)?x.answers.quick:[]);const choice=Number(box.dataset.quickOption);if(box.checked)selected.add(choice);else selected.delete(choice);x.answers.quick=[...selected].sort((a,b)=>a-b);state.entries[state.day]=x;document.querySelector('#saveStatus').textContent='Enregistrement en cours…';scheduleSave()}));document.querySelector('[data-note]').addEventListener('input',e=>{let x=entry(state.day);x.notes=e.target.value;state.entries[state.day]=x;scheduleSave()});
 document.querySelector('#share').addEventListener('change',async e=>{const box=e.target; if(box.checked){if(!confirm('Partager avec Adeline les réponses, les notes et toutes les photos de ce jour ? Vous pourrez retirer cet accès à tout moment.')){box.checked=false;return}}const x=entry(state.day);x.shared_with_adeline=box.checked;state.entries[state.day]=x;state.dirty=true;clearTimeout(timer);await saveEntry(true);render()});
 document.querySelector('#save').addEventListener('click',()=>{clearTimeout(timer);saveEntry(true)});
 document.querySelector('#complete').addEventListener('click',async()=>{const x=entry(state.day);x.completed=!x.completed;state.entries[state.day]=x;state.dirty=true;clearTimeout(timer);await saveEntry(true);render()});
 document.querySelector('#photoUpload').addEventListener('change',async e=>{const files=[...(e.target.files||[])];if(!files.length)return;for(const f of files){if((state.photos[state.day]||[]).length>=4){toast('Maximum de 4 photos par journée.');break}if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>5*1024*1024){toast(`Fichier refusé : ${f.name}. JPG, PNG ou WebP de 5 Mo maximum.`);continue}try{if(isDemo())await demoAddPhoto(state.day,f);else{let path=`${state.user.id}/${state.day}/${crypto.randomUUID()}-${f.name.slice(0,90).replace(/[^a-zA-Z0-9_.-]/g,'_')}`;let {error}=await state.supabase.storage.from('carnet-prive').upload(path,f,{contentType:f.type,upsert:false});if(error)throw error;const out=await state.supabase.from('photo_assets').insert({user_id:state.user.id,day:state.day,storage_path:path,filename:f.name}).select('id').single();if(out.error){await state.supabase.storage.from('carnet-prive').remove([path]);throw out.error}const url=await signedUrl(path);(state.photos[state.day]??=[]).push({id:out.data.id,day:state.day,storage_path:path,url,name:f.name})}}catch(err){toast('Impossible d’ajouter cette photo : '+err.message)}}render()});
 document.querySelectorAll('[data-delete-photo]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('Supprimer définitivement cette photo ?'))return;const day=state.day;const p=(state.photos[day]||[]).find(p=>p.id===b.dataset.deletePhoto);if(!p)return;try{if(isDemo())await demoDeletePhoto(p.id);else{const del=await state.supabase.storage.from('carnet-prive').remove([p.storage_path]);if(del.error)throw del.error;const meta=await state.supabase.from('photo_assets').delete().eq('id',p.id).eq('user_id',state.user.id);if(meta.error)throw meta.error}state.photos[day]=state.photos[day].filter(x=>x.id!==p.id);render();toast('Photo supprimée.')}catch(err){toast(err.message)}}));
 document.querySelector('#request').addEventListener('click',()=>openRequestDialog());
}
async function sendRequest(){
 const dlg=document.querySelector('#requestDialog');if(!dlg)return;
 const topic=dlg.querySelector('#requestTopic').value;
 const format=dlg.querySelector('#requestFormat').value;
 const zone=dlg.querySelector('#requestZone').value;
 const extra=dlg.querySelector('#requestMessage').value.trim();
 const contactMethod=dlg.querySelector('#requestContactMethod').value;
 const contactPhone=dlg.querySelector('#requestPhone').value.trim();
 const consent=dlg.querySelector('#requestConsent').checked;
 const status=dlg.querySelector('#requestStatus');
 const btn=dlg.querySelector('#sendRequest');
 if(!topic){status.textContent='Choisissez ce qui vous intéresse.';return;}
 if(!format){status.textContent='Choisissez un format.';return;}
 if(format==='Présentiel'&&!zone){status.textContent='Choisissez votre secteur géographique.';return;}
 if(contactMethod!=='email'&&!/^\+?[0-9\s.()-]{9,22}$/.test(contactPhone)){status.textContent='Saisissez un numéro de téléphone valide.';return;}
 if(!consent){status.textContent='Votre accord est nécessaire pour vous recontacter.';return;}
 const message=`Demande de rappel depuis Mon Carnet Aligné\nSujet : ${topic}\nFormat souhaité : ${format}\nSecteur : ${format==='Présentiel'?zone:'Sans objet'}${extra?`\nPrécision : ${extra}`:''}`;
 if(message.length>1300){status.textContent='La précision est trop longue.';return;}
 btn.disabled=true;status.textContent='Envoi en cours…';
 try{
  if(isDemo())state.requests.unshift({id:crypto.randomUUID(),user_id:'demo',day:state.day,message,created_at:new Date().toISOString(),status:'new',contact_method:contactMethod,contact_phone:contactMethod==='email'?null:contactPhone});
  else{const {error}=await state.supabase.rpc('submit_callback_request',{p_day:state.day,p_message:message,p_consent:consent,p_contact_method:contactMethod,p_contact_phone:contactMethod==='email'?null:contactPhone});if(error)throw error;}
  persistDemo();dlg.remove();toast('Votre demande est bien enregistrée. Adeline pourra vous recontacter.');
 }catch(err){status.textContent='Envoi impossible : '+err.message;btn.disabled=false;}
}
function bindAdmin(){document.querySelectorAll('[data-lead-status]').forEach(el=>el.addEventListener('change',async()=>{if(isDemo()){const row=state.requests.find(r=>r.id===el.dataset.leadStatus);if(row)row.status=el.value;persistDemo();toast('Statut mis à jour.');return}const {error}=await state.supabase.from('lead_requests').update({status:el.value}).eq('id',el.dataset.leadStatus);if(error)toast('Mise à jour impossible : '+error.message);else toast('Statut mis à jour.')}));const search=document.querySelector('#adminSearch'); search?.addEventListener('input',e=>{state.search=e.target.value;const pos=search.selectionStart;render();const s=document.querySelector('#adminSearch');s?.focus();s?.setSelectionRange(pos,pos)});document.querySelector('#adminDay')?.addEventListener('change',e=>{state.entryFilter=e.target.value;render()});document.querySelector('#refreshAdmin')?.addEventListener('click',async()=>{try{await refreshAdmin();render();toast('Données actualisées.')}catch(e){toast(e.message)}})}
function exportNotes(){const lines=['# Mon carnet Aligné','Créé avec Aligner Conseil',''];for(const d of DAYS){const e=entry(d.day);lines.push(`## Jour ${fmt(d.day)} : ${d.title}`);for(let i=0;i<d.prompts.length;i++)lines.push(`**${d.prompts[i]}**\n${e.answers?.[i]||'Non renseigné'}\n`);lines.push(`**Notes**\n${e.notes||'Non renseigné'}\n`)}const blob=new Blob([lines.join('\n')],{type:'text/markdown;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='mon-carnet-aligne.md';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function bindLogout(){document.querySelector('#logout')?.addEventListener('click',async()=>{await state.supabase.auth.signOut();state.user=null;state.role='member';state.entries={};render()})}
function attachAuth(){
 document.querySelector('#authLogin')?.addEventListener('click',()=>{state.authForm='login';render()});
 document.querySelector('#authSignup')?.addEventListener('click',()=>{state.authForm='signup';render()});
 document.querySelector('#forgot')?.addEventListener('click',()=>{state.authForm='forgot';render()});
 document.querySelector('#backLogin')?.addEventListener('click',()=>{state.authForm='login';render()});
 document.querySelector('#forgotForm')?.addEventListener('submit',async ev=>{ev.preventDefault();const out=document.querySelector('#authError');out.textContent='Envoi en cours…';try{const {error}=await state.supabase.auth.resetPasswordForEmail(document.querySelector('#email').value.trim(),{redirectTo:location.origin+location.pathname});if(error)throw error;out.textContent='Si le compte existe, un email de réinitialisation vient d’être envoyé.';}catch(e){out.textContent=e.message}});
 document.querySelector('#resetForm')?.addEventListener('submit',async ev=>{ev.preventDefault();const out=document.querySelector('#authError');try{const {error}=await state.supabase.auth.updateUser({password:document.querySelector('#resetPassword').value});if(error)throw error;state.authForm='login';out.textContent='Mot de passe modifié.';await refreshLive();render();toast('Votre mot de passe a été mis à jour.')}catch(e){out.textContent=e.message}});
 document.querySelector('#authForm')?.addEventListener('submit',async ev=>{ev.preventDefault();const email=document.querySelector('#email').value.trim();const password=document.querySelector('#password').value;const output=document.querySelector('#authError');output.textContent='Connexion en cours…';try{let r;if(state.authForm==='signup')r=await state.supabase.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname,data:{display_name:document.querySelector('#displayName').value.trim()}}});else r=await state.supabase.auth.signInWithPassword({email,password});if(r.error)throw r.error;if(!r.data.user||!r.data.session){output.textContent='Si l’inscription a été créée, vérifiez votre boîte mail pour confirmer votre adresse.';return}state.user=r.data.user;state.view='home';await refreshLive();render()}catch(e){output.textContent=e.message}});
}
async function bindCheckout(){if(!CFG.termsUrl||!CFG.privacyUrl){toast('Les conditions de vente et la confidentialité doivent être publiées avant la vente.');return}if(!document.querySelector('#acceptCgv')?.checked||!document.querySelector('#instantAccess')?.checked){toast('Veuillez lire et accepter les deux confirmations avant le paiement.');return}const btn=document.querySelector('#checkout');if(btn)btn.disabled=true;try{const {data,error}=await state.supabase.functions.invoke('create-checkout',{body:{termsAccepted:true,immediateAccess:true,rightsAcknowledged:true}});if(error)throw error;if(data.already_active){await refreshLive();render();return}if(!data?.url||!data.url.startsWith('https://checkout.stripe.com/'))throw new Error('Adresse Stripe invalide');location.assign(data.url)}catch(e){toast('Paiement indisponible : '+e.message);if(btn)btn.disabled=false}}
function bindLocked(){document.querySelector('#checkout')?.addEventListener('click',bindCheckout);document.querySelector('#verifyAccess')?.addEventListener('click',async()=>{try{await refreshLive();render();if(!state.enrolled)toast('En attente de confirmation du paiement.')}catch(e){toast(e.message)}})}
function bindProfile(){
 document.querySelector('#export')?.addEventListener('click',exportNotes);
 document.querySelector('#downloadGuide')?.addEventListener('click',async()=>{if(!LIVE){toast('Le guide est disponible uniquement en version connectée.');return}try{const {data,error}=await state.supabase.storage.from('programme-prive').download('guide-et-fiches.pdf');if(error)throw error;downloadBlob('Aligner_Conseil_Guide_et_Fiches.pdf',data,'application/pdf')}catch(e){toast('Guide indisponible : '+e.message)}});
 document.querySelector('#exportJSON')?.addEventListener('click',()=>{const data={programme:'21 jours pour une image qui me ressemble',exported_at:new Date().toISOString(),entries:DAYS.map(d=>({day:d.day,title:d.title,...entry(d.day)})),photos:Object.values(state.photos).flat().map(p=>({day:p.day,filename:p.name}))};downloadBlob('mon-carnet-aligne.json',JSON.stringify(data,null,2),'application/json')});
 document.querySelector('#downloadPhotos')?.addEventListener('click',async()=>{const photos=Object.values(state.photos).flat();if(!photos.length){toast('Vous n’avez pas encore ajouté de photos.');return}if(!LIVE){toast('En démonstration, récupérez vos photos directement depuis ce navigateur.');return}toast('Téléchargement de vos photos en cours…');for(const p of photos){try{const {data,error}=await state.supabase.storage.from('carnet-prive').download(p.storage_path);if(error)throw error;downloadBlob('jour-'+fmt(p.day)+'-'+p.name,data,data.type||'application/octet-stream')}catch(e){toast('Une photo n’a pas pu être téléchargée : '+e.message)}}});
 document.querySelector('#updateName')?.addEventListener('click',async()=>{const name=document.querySelector('#newName').value.trim();if(name.length<1||name.length>80){toast('Prénom invalide.');return}if(isDemo()){state.displayName=name;toast('Prénom modifié en démonstration.');return}const {error}=await state.supabase.from('profiles').update({display_name:name}).eq('id',state.user.id);if(error)toast(error.message);else{state.displayName=name;toast('Prénom modifié.')}});
 document.querySelector('#changePassword')?.addEventListener('click',async()=>{const password=document.querySelector('#newPassword').value;if(password.length<12){toast('Le mot de passe doit contenir au moins 12 caractères.');return}if(isDemo()){toast('Indisponible en démonstration.');return}const {error}=await state.supabase.auth.updateUser({password});toast(error?error.message:'Mot de passe modifié.');document.querySelector('#newPassword').value=''});
 
}
function downloadBlob(name,bytes,type){const blob=bytes instanceof Blob?bytes:new Blob([bytes],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),10000)}

async function init(){if(isDemo()){restoreDemo();await demoPhotos();render();return}if(!LIVE){root.innerHTML='<div class="auth-wrap"><div class="auth-card"><h1>Configuration Supabase requise</h1><p>Renseignez config.js avec l’URL et la clé publique Supabase. Vous pouvez activer demoMode uniquement pour tester en local.</p></div></div>';return}try{await setupLive();render()}catch(e){root.innerHTML=`<div class="auth-wrap"><div class="auth-card"><h1>Impossible d’ouvrir le programme</h1><p>${esc(e.message)}</p><p>Vérifiez la configuration Supabase et les politiques d'accès.</p></div></div>`}}
init();
})();
