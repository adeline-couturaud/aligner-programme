const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=process.env.ACCESS_EMAIL_ROOT||path.resolve(__dirname,'../functions/stripe-webhook');
const src=fs.readFileSync(path.join(root,'access-email.js'),'utf8').replace(/export /g,'');
const uid='00000000-0000-4000-8000-000000000001',sid='cs_live_fixture';
let count=0;
function boot(o={}){
 const calls=[],window={};let pending=o.claim||{status:'claimed',token:'fixturetoken',payload:{to:['frozen@example.invalid'],subject:'Frozen payload'}};
 const db={auth:{admin:{getUserById:async id=>{calls.push(['auth',id]);return {data:{user:{id:uid,email:'confirmed@example.invalid',email_confirmed_at:'2026-11-18',...o.user}},error:o.authError}}}},
 rpc:async(name,args)=>{calls.push([name,args]);if(name==='claim_paid_access_email')return {data:pending,error:o.claimError};if(name==='finish_paid_access_email')return {data:!o.finishError,error:o.finishError};throw Error('Unexpected RPC')}};
 const fetchImpl=async(url,opts)=>{calls.push(['provider',url,opts]);if(o.networkError)throw Error('sensitive provider token');return {ok:!o.httpError,status:o.httpError||200,json:async()=>o.noId?{}:{id:'message-fixture'}}};
 const ctx={fetch:fetchImpl,AbortSignal};vm.createContext(ctx);vm.runInContext(src+';this.api={sendPaidAccessEmail,accessEmailPayload}',ctx);
 return {api:ctx.api,calls,run:args=>ctx.api.sendPaidAccessEmail({db,userId:uid,sessionId:sid,resendKey:'fixture-secret',fetchImpl,...args})};
}
(async()=>{
 let t=boot(),r=await t.run();assert.equal(r.status,'sent');const c=t.calls;
 assert.deepEqual(c.map(x=>x[0]),['auth','claim_paid_access_email','provider','finish_paid_access_email']);
 assert.equal(c[2][2].headers['Idempotency-Key'],'carnet-access/'+sid);
 assert.equal(c[2][2].body,JSON.stringify({to:['frozen@example.invalid'],subject:'Frozen payload'}));
 assert.equal(c[3][1].p_success,true);count+=5;
 for(const status of ['sent','skipped','review','not_queued']){t=boot({claim:{status}});assert.equal((await t.run()).status,status);assert(!t.calls.some(x=>x[0]==='provider'));count+=2}
 t=boot({claim:{status:'busy'}});await assert.rejects(()=>t.run(),/progress/);assert(!t.calls.some(x=>x[0]==='provider'));count+=2;
 for(const o of [{user:{email_confirmed_at:null}},{user:{id:'another-user'}},{authError:{message:'error'}},{user:{email:'a\r\nb@example.invalid'}}]){
  t=boot(o);await assert.rejects(()=>t.run(),/confirmed/);assert(!t.calls.some(x=>x[0]==='provider'||x[0]==='claim_paid_access_email'));count+=2;
 }
 t=boot();await assert.rejects(()=>t.run({sessionId:'cs_test_fixture'}),/live session/);assert.equal(t.calls.length,0);count+=2;
 t=boot();await assert.rejects(()=>t.run({resendKey:''}),/configured/);assert.equal(t.calls.length,0);count+=2;
 for(const o of [{httpError:429},{httpError:403},{networkError:true},{noId:true}]){
  t=boot(o);await assert.rejects(()=>t.run(),e=>!e.message.includes('fixture-secret')&&!e.message.includes('sensitive provider token'));
  const finish=t.calls.find(x=>x[0]==='finish_paid_access_email');assert.equal(finish[1].p_success,false);assert.equal(finish[1].p_provider_id,null);count+=3;
 }
 t=boot({claimError:{message:'error'}});await assert.rejects(()=>t.run(),/queue/);assert(!t.calls.some(x=>x[0]==='provider'));count+=2;
 t=boot({finishError:{message:'error'}});await assert.rejects(()=>t.run(),/state/);count++;
 const p=t.api.accessEmailPayload('verified@example.invalid');assert.equal(p.to[0],'verified@example.invalid');assert(p.text.includes('Point de départ'));assert(p.html.includes('viewport'));assert(p.html.includes('https://adeline-couturaud.github.io/aligner-programme/'));assert(!/chat.whatsapp|token=|password=/.test(p.html));count+=5;
 console.log('PASS: '+count+' assertions; confirmed recipient, frozen payload, deduplication key, cancellation states, send failure and safe retry. No network email sent.');
})().catch(e=>{console.error(e);process.exit(1)});
