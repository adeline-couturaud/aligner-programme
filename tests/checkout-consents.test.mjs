import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

test('checkout records information about withdrawal rights without a waiver', async () => {
  const previousDeno=globalThis.Deno, previousFetch=globalThis.fetch;
  let handler, recorded, stripeValues;
  const client={auth:{getUser:async()=>({data:{user:{id:'11111111-1111-4111-8111-111111111111',email:'customer@example.test'}}})},from(table){
    if(table==='enrollments')return {select:()=>({eq:()=>({maybeSingle:async()=>({data:null})})})};
    assert.equal(table,'checkout_consents');return {insert:async data=>{recorded=data;return {error:null}}};
  }};
  globalThis.testCheckoutClient=client;
  globalThis.Deno={env:{get:key=>({STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_PRICE_ID:'price_fixture',SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'server-only'}[key])},serve:fn=>{handler=fn}};
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://api.stripe.com/v1/checkout/sessions');
    stripeValues=new URLSearchParams(options.body);
    return Response.json({id:'cs_test_fixture',url:'https://checkout.stripe.com/c/pay/cs_test_fixture'});
  };
  try{
    let source=await readFile(new URL('../supabase/functions/create-checkout/index.ts',import.meta.url),'utf8');
    source=source.replace(/import \{ createClient \} from "npm:@supabase\/supabase-js@2";/,'const createClient=()=>globalThis.testCheckoutClient;');
    await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
    const res=await handler(new Request('https://function.example.test',{method:'POST',headers:{origin:'https://adeline-couturaud.github.io',authorization:'Bearer test-user-jwt'},body:JSON.stringify({termsAccepted:true,immediateAccess:true,rightsAcknowledged:true})}));
    assert.equal(res.status,200);
    assert.equal(recorded.withdrawal_information_acknowledged,true);
    assert.equal('withdrawal_loss_acknowledged' in recorded,false);
    assert.equal(recorded.terms_version,'2026-10-28-droit-retractation');
    assert.equal(stripeValues.get('metadata[withdrawal_right_waived]'),'false');
    assert.equal(stripeValues.get('metadata[withdrawal_information_acknowledged]'),'true');
    assert.match((await res.json()).url,/^https:\/\/checkout.stripe.com\//);
  }finally{globalThis.Deno=previousDeno;globalThis.fetch=previousFetch;delete globalThis.testCheckoutClient;}
});
