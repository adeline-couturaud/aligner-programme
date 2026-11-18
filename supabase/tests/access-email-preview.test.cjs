const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const {stripTypeScriptTypes}=require('node:module');
const root=process.env.PREVIEW_ROOT||path.resolve(__dirname,'../functions/test-access-email');
const uid='00000000-0000-4000-8000-000000000001',origin='https://adeline-couturaud.github.io';
const template=fs.readFileSync(path.join(root,'access-email.js'),'utf8').replace(/export /g,'');
const source=fs.readFileSync(path.join(root,'index.ts'),'utf8').replace(/^import .*;\s*$/gm,'');
function boot(o={}){
 let handler;const sends=[];let authCalls=0,profileCalls=0;
 const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',RESEND_API_KEY:o.noKey?'':'re_fixture'};
 const client={auth:{getUser:async token=>{assert.equal(token,'fixture');authCalls++;return {data:{user:o.noUser?null:{id:uid,email:'admin@example.invalid',email_confirmed_at:'2026-11-18',user_metadata:{role:'admin'},...o.user}},error:o.authError}}},from(table){assert.equal(table,'profiles');return {select:()=>({eq:(key,id)=>{assert.equal(key,'id');assert.equal(id,uid);return {single:async()=>{profileCalls++;return {data:{role:o.member?'member':'admin'},error:o.profileError}}}}})}}};
 vm.runInNewContext(template+'\n'+stripTypeScriptTypes(source),{Deno:{env:{get:k=>env[k]},serve:f=>handler=f},Response,Request,AbortSignal,Date,createClient:()=>client,fetch:async(url,opts)=>{assert.equal(url,'https://api.resend.com/emails');sends.push(opts);if(o.network)throw Error('provider-secret');return {ok:!o.providerStatus,status:o.providerStatus||200,json:async()=>o.invalidResponse?{}:{id:'fixture-message'}}}});
 return {handler,sends,stats:()=>({authCalls,profileCalls})};
}
const req=(o={})=>new Request('https://fixture.invalid',{method:o.method||'POST',headers:{...(o.noOrigin?{}:{origin:o.origin||origin}),...(o.noAuth?{}:{authorization:'Bearer fixture'})},...((o.method&&o.method!=='POST')?{}:{body:o.raw||JSON.stringify(o.body||{confirmPreview:true})})});
(async()=>{
 let t=boot(),r=await t.handler(req({method:'OPTIONS',noAuth:true}));assert.equal(r.status,204);assert.equal(t.sends.length,0);
 for(const o of [{origin:'https://evil.invalid'},{noOrigin:true}]){t=boot();assert.equal((await t.handler(req(o))).status,403);assert.equal(t.stats().authCalls,0);assert.equal(t.sends.length,0)}
 t=boot();assert.equal((await t.handler(req({method:'GET'}))).status,405);assert.equal(t.sends.length,0);
 t=boot();assert.equal((await t.handler(req({noAuth:true}))).status,401);assert.equal(t.sends.length,0);
 for(const [o,status] of [[{authError:{}},401],[{noUser:true},401],[{member:true},403],[{profileError:{}},403],[{user:{email_confirmed_at:null}},400],[{user:{email:'admin\r\n@example.invalid'}},400],[{noKey:true},503]]){
  t=boot(o);assert.equal((await t.handler(req())).status,status);assert.equal(t.sends.length,0);
 }
 for(const q of [{raw:'invalid json'},{body:{confirmPreview:false}},{body:{}}]){t=boot();assert.equal((await t.handler(req(q))).status,400);assert.equal(t.sends.length,0)}
 t=boot();r=await t.handler(req({body:{confirmPreview:true,to:['attacker@example.invalid'],subject:'Injected',html:'Injected'}}));assert.equal(r.status,200);const result=await r.json();assert.equal(result.recipient,'admin@example.invalid');
 const send=t.sends[0],message=JSON.parse(send.body);assert.deepEqual(message.to,['admin@example.invalid']);assert.equal(message.subject,'[TEST] Votre Carnet Aligné est prêt');assert(message.text.startsWith('APERÇU DE TEST'));assert(message.html.includes('APERÇU DE TEST'));assert(!message.html.includes('Injected'));assert(send.headers['Idempotency-Key'].includes(uid));assert(!send.headers['Idempotency-Key'].includes('admin@'));
 await t.handler(req());assert.equal(t.sends[1].body,send.body);assert.equal(t.sends[1].headers['Idempotency-Key'],send.headers['Idempotency-Key']);
 for(const status of [403,409,429,500]){t=boot({providerStatus:status});r=await t.handler(req());assert.equal(r.status,502);assert(!(await r.text()).includes('re_fixture'))}
 t=boot({network:true});r=await t.handler(req());assert.equal(r.status,503);assert(!(await r.text()).includes('provider-secret'));
 t=boot({invalidResponse:true});assert.equal((await t.handler(req())).status,502);

 // Only an explicit administrator click sends an email; no arbitrary recipient is passed.
 const app=fs.readFileSync(process.env.PREVIEW_APP||path.join(root,'../../../app.js'),'utf8');
 const fn=app.slice(app.indexOf('async function sendAccessEmailPreview(){'),app.indexOf('async function checkLivePaymentConfiguration(){'));
 let invoked=0;const button={},output={};
 const state={role:'admin',supabase:{functions:{invoke:async(name,args)=>{invoked++;assert.equal(name,'test-access-email');assert.deepEqual(JSON.parse(JSON.stringify(args.body)),{confirmPreview:true});return {data:{ok:true,recipient:'admin@example.invalid',message:'Accepté'}}}}}};
 const ctx={state,isDemo:()=>false,document:{querySelector:s=>s==='#testAccessEmail'?button:output}};vm.createContext(ctx);vm.runInContext(fn+'this.sendPreview=sendAccessEmailPreview',ctx);
 assert.equal(invoked,0);await ctx.sendPreview();assert.equal(invoked,1);assert.equal(button.disabled,false);assert(output.textContent.includes('admin@example.invalid'));
 state.role='member';await ctx.sendPreview();assert.equal(invoked,1);
 state.role='admin';state.supabase.functions.invoke=async()=>({error:{message:'Erreur sûre'}});await ctx.sendPreview();assert.equal(button.disabled,false);assert(output.textContent.includes('Erreur sûre'));
 console.log('PASS: admin-only explicit preview; confirmed self-recipient; malicious recipient ignored; stable daily idempotency; provider errors sanitized; UI feedback and access preserved. All sends mocked.');
})().catch(e=>{console.error(e);process.exit(1)});
