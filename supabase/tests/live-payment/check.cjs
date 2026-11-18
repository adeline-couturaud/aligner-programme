const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {stripTypeScriptTypes}=require('node:module');
const sourceRoot=fs.existsSync(__dirname+'/create-checkout')?__dirname:require('node:path').resolve(__dirname,'../../functions');
const uid='00000000-0000-4000-8000-000000000001', testPrice='price_1UbMDDHqesE01MFcG9G1sX70';
function boot(kind,o={}){
 let handler,posts=0,writes=0,activations=0,emails=0,emailSent=false,frozenEmail; const live=!!o.live,pid=live?'price_livefixture':testPrice;
 const session={id:live?'cs_live_fixture':'cs_test_fixture',url:'https://checkout.stripe.com/fixture',livemode:live,mode:'payment',payment_status:'paid',amount_total:3700,currency:'eur',status:'complete',client_reference_id:uid,metadata:{user_id:uid,product_code:'mon-carnet-aligne-dressing'},line_items:{has_more:false,data:[{quantity:1,price:{id:pid,unit_amount:3700,currency:'eur',livemode:live}}]},...o.session};
 const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_testfixture',STRIPE_LIVE_SECRET_KEY:o.key||'sk_live_fixture',STRIPE_LIVE_WEBHOOK_SECRET:'whsec_livefixture',STRIPE_LIVE_PRICE_ID:pid,RESEND_API_KEY:'resend_fixture',CARNET_LIVE_SALES_ENABLED:o.enabled?'true':'false'};
 const consent={user_id:uid,cgv_accepted:true,immediate_start_requested:true,withdrawal_information_acknowledged:true};
 const client={auth:{getUser:async()=>({data:{user:{id:uid,email:'fixture@example.invalid'}}}),admin:{getUserById:async()=>({data:{user:{id:uid,email:'fixture@example.invalid',email_confirmed_at:'2026-11-18'}}})}},from(table){
 if(table==='profiles')return {select:()=>({eq:()=>({single:async()=>({data:{role:o.admin?'admin':'member'}})})})};
 if(table==='enrollments'&&kind==='create-checkout')return {select:()=>({eq:()=>({maybeSingle:async()=>({data:o.active?{status:'active'}:null})})})};
 if(table==='checkout_consents')return {insert:async()=>{writes++;return {}},select:()=>({eq:()=>({maybeSingle:async()=>({data:o.noConsent?null:consent})})})};
 throw Error('Unexpected table mutation '+table);
 },rpc:async(name,args)=>{
 if(name==='claim_paid_access_email'){assert(activations>0);frozenEmail??=args.p_payload;return {data:emailSent?{status:'sent'}:{status:'claimed',token:'fixture-token',payload:frozenEmail}}}
 if(name==='finish_paid_access_email'){emailSent=args.p_success;return {data:true}}
 assert.equal(name,'activate_paid_enrollment');assert.equal(args.p_total_cents,3700);assert.equal(args.p_user_id,uid);activations++;return o.rpcError?{error:{message:'fixture failure'}}:{data:{duplicate:!!o.duplicate}}}};
 let src=fs.readFileSync(sourceRoot+'/'+kind+'/index.ts','utf8').replace(/^import .*;\s*$/gm,'');
 if(kind==='stripe-webhook')src=fs.readFileSync(sourceRoot+'/stripe-webhook/access-email.js','utf8').replace(/export /g,'')+'\n'+src;
 assert.match(src,/const LIVE_RELEASE_APPROVED = false;/);if(o.approved)src=src.replace('const LIVE_RELEASE_APPROVED = false;','const LIVE_RELEASE_APPROVED = true;');
 vm.runInNewContext(stripTypeScriptTypes(src),{Deno:{env:{get:k=>env[k]},serve:f=>handler=f},createClient:()=>client,Request,Response,URLSearchParams,TextEncoder,Uint8Array,AbortSignal,crypto:crypto.webcrypto,console:{error(){},info(){}},fetch:async(url,opt)=>{
 if(url==='https://api.resend.com/emails'){assert(activations>0);assert.equal(opt.headers['Idempotency-Key'],'carnet-access/'+session.id);assert.deepEqual(JSON.parse(opt.body).to,['fixture@example.invalid']);emails++;return o.emailError?Response.json({error:'fixture'},{status:503}):Response.json({id:'email_fixture'});}
 assert.equal(opt.headers.authorization,'Bearer '+(live?(o.key||'sk_live_fixture'):'sk_test_fixture'));if(opt?.method==='POST'){posts++;return Response.json(session)}return Response.json(kind==='create-checkout'?{id:pid,active:true,livemode:live,currency:'eur',type:'one_time',billing_scheme:'per_unit',unit_amount:3700,...o.price}:session)}});
 return {handler,stats:()=>({posts,writes,activations}),emailCount:()=>emails};
}
const flags={termsAccepted:true,immediateAccess:true,rightsAcknowledged:true};
const checkout=(body=flags)=>new Request('https://fixture.invalid',{method:'POST',headers:{origin:'https://adeline-couturaud.github.io',authorization:'Bearer fixture'},body:JSON.stringify(body)});
function event(live=false,bad=false){const raw=JSON.stringify({livemode:live,type:'checkout.session.completed',data:{object:{id:live?'cs_live_fixture':'cs_test_fixture'}}}),ts=Math.floor(Date.now()/1000),sig=crypto.createHmac('sha256',live?'whsec_livefixture':'whsec_testfixture').update(ts+'.'+raw).digest('hex');return new Request('https://fixture.invalid',{method:'POST',headers:{'stripe-signature':`t=${ts},v1=${bad?'bad':sig}`},body:raw})}
(async()=>{
 for(const kind of ['create-checkout','stripe-webhook']){for(const gates of [{},{enabled:true},{approved:true}]){const t=boot(kind,{live:true,...gates});assert.equal((await t.handler(kind==='create-checkout'?checkout():event(true))).status,503);assert.deepEqual(t.stats(),{posts:0,writes:0,activations:0})}}
 let t=boot('create-checkout',{admin:true,active:true}),r=await t.handler(checkout({...flags,testOnly:true}));assert.equal(r.status,200);assert.equal((await r.json()).test_only,true);
 t=boot('create-checkout');assert.equal((await t.handler(checkout({...flags,testOnly:true}))).status,403);
 t=boot('create-checkout',{live:true,enabled:true,approved:true});r=await t.handler(checkout());assert.equal(r.status,200);assert.equal((await r.json()).test_only,false);assert.equal(t.stats().writes,1);
 for(const price of [{unit_amount:2700},{currency:'usd'},{livemode:false},{type:'recurring'},{active:false}]){t=boot('create-checkout',{live:true,enabled:true,approved:true,price});assert.equal((await t.handler(checkout())).status,503);assert.equal(t.stats().posts,0)}
 t=boot('create-checkout',{live:true,enabled:true,approved:true});assert.equal((await t.handler(checkout({}))).status,400);
 t=boot('stripe-webhook');r=await t.handler(event());assert.equal((await r.json()).enrollment_unchanged,true);assert.equal(t.stats().activations,0);
 t=boot('stripe-webhook',{live:true,enabled:true,approved:true});r=await t.handler(event(true));assert.equal(r.status,200);assert.equal(t.stats().activations,1);
 t=boot('stripe-webhook',{live:true,enabled:true,approved:true,duplicate:true});r=await t.handler(event(true));assert.equal((await r.json()).duplicate,true);
 for(const opts of [{noConsent:true},{rpcError:true}]){t=boot('stripe-webhook',{live:true,enabled:true,approved:true,...opts});assert.equal((await t.handler(event(true))).status,500)}
 t=boot('stripe-webhook',{live:true,enabled:true,approved:true});assert.equal((await t.handler(event(true,true))).status,400);assert.equal(t.stats().activations,0);
 t=boot('stripe-webhook',{live:true,enabled:true,approved:true,session:{amount_total:2700}});r=await t.handler(event(true));assert.equal((await r.json()).status,'not_applicable');assert.equal(t.stats().activations,0);
 for(const kind of ['create-checkout','stripe-webhook']){let t=boot(kind,{live:true,enabled:true,approved:true,key:'rk_live_fixture'});assert.equal((await t.handler(kind==='create-checkout'?checkout():event(true))).status,200);for(const key of ['pk_live_fixture','rk_test_fixture','sk_test_fixture']){t=boot(kind,{live:true,enabled:true,approved:true,key});assert.equal((await t.handler(kind==='create-checkout'?checkout():event(true))).status,503);assert.equal(t.stats().activations,0);assert.equal(t.stats().posts,0)}}
 t=boot('stripe-webhook');await t.handler(event());assert.equal(t.emailCount(),0);
 t=boot('stripe-webhook',{live:true,enabled:true,approved:true});await t.handler(event(true));await t.handler(event(true));assert.equal(t.emailCount(),1);assert.equal(t.stats().activations,2);
 t=boot('stripe-webhook',{live:true,enabled:true,approved:true,emailError:true});assert.equal((await t.handler(event(true))).status,500);assert.equal(t.stats().activations,1);
 console.log('PASS: restricted live keys accepted; public and test keys refused;  live gates closed; admin-only test preserved; simulated live checkout and signed fulfillment; bad price, consent, signature and RPC errors; test never activates access.');
})().catch(e=>{console.error(e);process.exit(1)});
