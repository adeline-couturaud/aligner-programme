const fs=require('node:fs'),path=require('node:path');

async function runReadinessTests(source) {
  let count=0;
  function assert(value,message){if(!value)throw new Error(message);count++}
  class MockResponse {
    constructor(body,opts={}){this.body=body;this.status=opts.status||200;}
    async json(){return this.body===null?null:JSON.parse(this.body)}
  }
  class MockParams { constructor(){this.values={}} set(k,v){this.values[k]=v} toString(){return 'fixture'} }
  const uid='00000000-0000-4000-8000-000000000001';
  const pid='price_1UboqaHM3OSYChuPVS1O1BQT';
  const defaultPrice={id:pid,livemode:true,active:true,currency:'eur',unit_amount:3700,type:'one_time',billing_scheme:'per_unit'};
  function boot(o={}){
    let handler,fetches=0,writes=0;
    const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'server_fixture',
      STRIPE_LIVE_SECRET_KEY:'rk_live_privatefixture',STRIPE_LIVE_PRICE_ID:pid,
      STRIPE_LIVE_WEBHOOK_SECRET:'whsec_privatefixture',...o.env};
    const client={
      auth:{getUser:async()=>o.invalidAuth?{error:{message:'invalid'}}:{data:{user:{id:uid,email:'fixture@example.invalid'}}}},
      from(table){assert(table==='profiles','Readiness may only read profiles');
        return {select:()=>({eq:()=>({single:async()=>({data:{role:o.role||'admin'},error:o.profileError?{}:null})})})}},
      rpc(){writes++;throw new Error('No RPC allowed')}
    };
    const fetchMock=async(url,opts)=>{
      fetches++;assert(opts.method===undefined||opts.method==='GET','Readiness cannot create Stripe objects');
      assert(url==='https://api.stripe.com/v1/prices/'+pid,'Only expected price may be queried');
      if(o.networkError)throw new Error('Secret must not appear in response '+env.STRIPE_LIVE_SECRET_KEY);
      return {ok:!o.stripeStatus,status:o.stripeStatus||200,json:async()=>({...defaultPrice,...o.price})};
    };
    const js=source.replace(/^import .*supabase.*;\s*$/m,'').replace('(data: unknown,','(data,').replace('(req: Request)','(req)');
    new Function('Deno','createClient','Response','fetch','AbortSignal','URLSearchParams',js)(
      {env:{get:k=>env[k]},serve:fn=>handler=fn},()=>client,MockResponse,fetchMock,
      {timeout:()=>({})},MockParams);
    return {
      call:body=>handler({method:o.method||'POST',
        headers:{get:k=>k==='origin'?(o.origin||'https://adeline-couturaud.github.io'):k==='authorization'?(o.noToken?'':'Bearer fixture'):null},
        json:async()=>body}),
      stats:()=>({fetches,writes})
    };
  }
  let t=boot(),r=await t.call({checkLiveConfiguration:true}),d=await r.json();
  assert(r.status===200&&d.ok===true,'Admin readiness succeeds');
  assert(Object.values(d.checks).every(x=>x===true),'Checks passed');
  assert(!JSON.stringify(d).includes('privatefixture'),'Never expose secrets');
  assert(t.stats().fetches===1&&t.stats().writes===0,'Single read, no writes');
  for(const o of [{role:'member'},{profileError:true},{invalidAuth:true},{noToken:true},{origin:'https://attacker.invalid'}]){
    t=boot(o);r=await t.call({checkLiveConfiguration:true});
    assert([401,403].includes(r.status),'Non-admin/auth/origin refused');
    assert(t.stats().fetches===0,'No Stripe lookup before admin authorization');
  }
  for(const env of [{STRIPE_LIVE_SECRET_KEY:''},{STRIPE_LIVE_SECRET_KEY:'pk_live_fixture'},
    {STRIPE_LIVE_SECRET_KEY:'sk_test_fixture'},{STRIPE_LIVE_PRICE_ID:'price_wrong'},
    {STRIPE_LIVE_WEBHOOK_SECRET:''}]){
    t=boot({env});d=await (await t.call({checkLiveConfiguration:true})).json();
    assert(d.ok===false&&t.stats().fetches===0,'Bad or missing config refused without network');
  }
  for(const price of [{unit_amount:2700},{currency:'usd'},{livemode:false},{active:false},{type:'recurring'},{billing_scheme:'tiered'},{id:'price_wrong'},{custom_unit_amount:{enabled:true}}]){
    t=boot({price});d=await (await t.call({checkLiveConfiguration:true})).json();
    assert(d.ok===false&&d.checks.stripe_price_verified===false,'Wrong tariff cannot pass');
  }
  for(const stripeStatus of [401,403,404,500]){
    t=boot({stripeStatus});d=await (await t.call({checkLiveConfiguration:true})).json();
    assert(d.ok===false&&!JSON.stringify(d).includes('privatefixture'),'Stripe errors safely reported');
  }
  t=boot({networkError:true});d=await (await t.call({checkLiveConfiguration:true})).json();
  assert(d.ok===false&&!JSON.stringify(d).includes('privatefixture'),'Network exception redacted');
  t=boot();r=await t.call({termsAccepted:true,immediateAccess:true,rightsAcknowledged:true});
  assert(r.status===503&&t.stats().fetches===0,'Public live payments stay closed');
  t=boot({role:'member'});r=await t.call({testOnly:true});
  assert(r.status===403,'Existing sandbox stays admin-only');
  assert(source.includes('const LIVE_RELEASE_APPROVED = false;'),'Release lock preserved');
  return count;
}


async function runReadinessClientTests(clientSource) {
 let count=0;
 const assert=(ok,message)=>{if(!ok)throw new Error(message);count++};
 async function run(opts={}){
  const button={disabled:false},output={textContent:''};let calls=0;
  const doc={querySelector:id=>id==='#checkLivePaymentConfiguration'?button:output};
  const state={role:opts.member?'member':'admin',supabase:{functions:{invoke:async(name,args)=>{
    calls++;assert(name==='create-checkout','Correct endpoint');
    assert(JSON.stringify(args.body)==='{"checkLiveConfiguration":true}','Readiness only, never checkout');
    return opts.result||{data:{ok:true,checks:{api_key_configured:true,price_id_configured:true,webhook_secret_configured:true,stripe_price_verified:true},message:'Vérifié sans prélèvement.'}};
  }}}};
  const fn=new Function('state','isDemo','document',clientSource+';return checkLivePaymentConfiguration;')(state,()=>!!opts.demo,doc);
  await fn();return {button,output,calls};
 }
 let r=await run();assert(r.calls===1&&r.output.textContent.includes('37 €'),'Tariff result visible');
 assert(r.button.disabled===false,'Button re-enabled');
 r=await run({member:true});assert(r.calls===0,'Member cannot invoke from UI');
 r=await run({demo:true});assert(r.calls===0,'Demo cannot invoke');
 r=await run({result:{data:{ok:false,checks:{},message:'Clé absente'}}});
 assert(r.output.textContent.includes('À vérifier')&&r.output.textContent.includes('Clé absente'),'Failures clearly visible');
 r=await run({result:{error:{message:'Network error',context:{json:async()=>({error:'Session expirée'})}}}});
 assert(r.output.textContent.includes('Session expirée')&&!r.button.disabled,'Errors reported and retry possible');
 return count;
}

(async()=>{
const source=fs.readFileSync(path.resolve(__dirname,'../functions/create-checkout/index.ts'),'utf8');
const app=fs.readFileSync(path.resolve(__dirname,'../../app.js'),'utf8');
const start=app.indexOf('async function checkLivePaymentConfiguration(){');
const end=app.indexOf('\nasync function bindCheckout(',start);
if(start<0||end<0)throw new Error('Readiness UI not found');
const server=await runReadinessTests(source);
const client=await runReadinessClientTests(app.slice(start,end));
console.log('PASS: '+server+' server checks and '+client+' UI checks; no real payment.');
})().catch(error=>{console.error(error);process.exitCode=1;});
