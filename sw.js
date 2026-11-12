/* Réseau uniquement : aucune mise en cache des exercices ou des réponses. */
'use strict';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||event.request.mode!=='navigate')return;
 const url=new URL(event.request.url);
 const scope=new URL(self.registration.scope);
 if(url.origin!==scope.origin||![scope.pathname,scope.pathname+'index.html'].includes(url.pathname))return;
 event.respondWith(fetch(event.request).catch(()=>new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0B493F"><title>Mon Carnet Aligné · Connexion nécessaire</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FFFEFD;color:#0B493F;font:18px/1.6 system-ui,sans-serif}main{max-width:440px;padding:28px}h1{font:32px/1.2 Georgia,serif}a{display:inline-block;background:#0B493F;color:white;padding:12px 20px;border-radius:12px;text-decoration:none}small{display:block;margin-top:24px;font-size:14px}</style></head><body><main><p>MON CARNET ALIGNÉ</p><h1>Une connexion est nécessaire</h1><p>Reconnectez-vous à Internet pour ouvrir votre carnet et retrouver votre progression.</p><a href="./">Réessayer</a><small>Si une réponse était en cours de saisie, vérifiez son enregistrement au retour de la connexion.</small></main></body></html>`,{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
