import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recoverExistingPendingPreapproval} from
  '../supabase/functions/_shared/mp-live-recover-pending.mjs';

const userId='11111111-2222-4333-8444-555555555555';
const intentId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const payerEmail='aluno@example.com';
const sellerId='998877665';
const sid='abcdef12345678900000000000000000';
const url='https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id='+sid;
const ref='shamatha:production:'+userId+':'+intentId;
const valid=()=>({
  id:sid,external_reference:ref,collector_id:Number(sellerId),
  status:'pending',init_point:url,
  auto_recurring:{frequency:1,frequency_type:'months',
    transaction_amount:'180',currency_id:'BRL'}
});
const page=(rows,total=rows.length,offset=0)=>({
  paging:{total,limit:20,offset},results:rows
});
async function lookup({
  rows=[{id:sid,external_reference:ref}],remote=valid(),
  fetchPage=null,fetchOne=null,...options
}={}){
  return recoverExistingPendingPreapproval({
    userId,intentId,payerEmail,sellerId,
    fetchPage:fetchPage||async()=>page(rows),
    fetchOne:fetchOne||async()=>remote,
    ...options
  });
}

test('read-only recovery identifies original pending invoice through payer-filtered search and GET',async()=>{
  let calls=0;
  const found=await lookup({fetchOne:async id=>{
    assert.equal(id,sid);calls++;return valid();
  }});
  assert.deepEqual(found,{id:sid,checkoutUrl:url,providerStatus:'pending'});
  assert.equal(calls,1);
});
test('no matching provider subscription stays blocked, never asks for new POST',async()=>{
  await assert.rejects(()=>lookup({rows:[]}),/RECOVERY_PREAPPROVAL_NOT_FOUND/);
});
test('ambiguous two provider subscriptions with same external reference must be reviewed',async()=>{
  await assert.rejects(()=>lookup({rows:[
    {id:sid,external_reference:ref},
    {id:'fedcba12345678900000000000000000',external_reference:ref}
  ]}),/RECOVERY_DUPLICATE_SUBSCRIPTIONS/);
});
test('other student or other checkout attempt does not match',async()=>{
  await assert.rejects(()=>lookup({rows:[{
    id:sid,external_reference:'shamatha:production:'+userId+':other-intent'
  }]}),/RECOVERY_PREAPPROVAL_NOT_FOUND/);
  await assert.rejects(()=>lookup({userId:'99999999-2222-4333-8444-555555555555'}),
    /RECOVERY_PREAPPROVAL_NOT_FOUND/);
});
test('seller or amount or frequency must match exactly',async()=>{
  for(const patch of [
    {collector_id:123},
    {auto_recurring:{...valid().auto_recurring,transaction_amount:179}},
    {auto_recurring:{...valid().auto_recurring,currency_id:'USD'}},
    {auto_recurring:{...valid().auto_recurring,frequency:2}}
  ])await assert.rejects(()=>lookup({remote:{...valid(),...patch}}),
    /MP_SUBSCRIPTION_PROOF_FAILED/);
});
test('only an original pending checkout may be reused',async()=>{
  for(const status of ['authorized','paused','canceled','rejected'])
    await assert.rejects(()=>lookup({remote:{...valid(),status}}),
      /MP_SUBSCRIPTION_PROOF_FAILED/);
});
test('provider getter returning a different ID is refused',async()=>{
  await assert.rejects(()=>lookup({remote:{
    ...valid(),id:'fedcba12345678900000000000000000'
  }}),/RECOVERY_PROVIDER_ID_CHANGED/);
});
test('invalid payment URL is never handed to the browser',async()=>{
  await assert.rejects(()=>lookup({remote:{...valid(),init_point:'https://evil.test/'+sid}}),
    /RECOVERY_INVALID_CHECKOUT_URL/);
  await assert.rejects(()=>lookup({remote:{...valid(),init_point:null}}),
    /RECOVERY_INVALID_CHECKOUT_URL/);
});
test('provider's explicit wrong payer email always fails even after matching search',async()=>{
  await assert.rejects(()=>lookup({remote:{...valid(),payer_email:'other@example.com'}}),
    /MP_SUBSCRIPTION_PROOF_FAILED/);
  await assert.rejects(()=>lookup({rows:[{
    id:sid,external_reference:ref,payer_email:'other@example.com'
  }]}),/RECOVERY_SEARCH_WRONG_BUYER/);
});
test('duplicate, incomplete and oversized provider results fail closed',async()=>{
  await assert.rejects(()=>lookup({rows:[
    {id:sid,external_reference:ref},{id:sid,external_reference:ref}
  ]}),/RECOVERY_SEARCH_INVALID_ID/);
  await assert.rejects(()=>lookup({fetchPage:async()=>page([],1)}),
    /RECOVERY_SEARCH_TRUNCATED/);
  await assert.rejects(()=>lookup({fetchPage:async()=>page([],101)}),
    /RECOVERY_SEARCH_UNSAFE/);
});
test('cursor pagination checks every page and validates exact reference',async()=>{
  const results=[{id:'11223344556677889900',external_reference:'other'},
    {id:sid,external_reference:ref}];
  const offsets=[];
  const found=await lookup({pageSize:1,fetchPage:async({offset,limit,payerEmail:email})=>{
    offsets.push(offset);
    assert.equal(limit,1);
    assert.equal(email,payerEmail);
    return page(results.slice(offset,offset+1),2,offset);
  }});
  assert.deepEqual(offsets,[0,1]);
  assert.equal(found.id,sid);
});
test('checkout source routes an existing review through GET-only recovery before any remote create',()=>{
  const src=readFileSync(new URL('../supabase/functions/shamatha-create-subscription/index.ts',
    import.meta.url),'utf8');
  assert.match(src,/before.state==="needs_review"/);
  assert.match(src,/return recoverExistingReview\(before,userId,userEmail\)/);
  const marker=src.indexOf('const before = await existingOpenIntent(userId)');
  const post=src.indexOf('method: "POST"',marker);
  assert.ok(marker>0&&post>marker);
  assert.match(src,/fetchPage:\(\{payerEmail,offset,limit\}\)=>mpGet/);
  assert.match(src,/fetchOne:id=>mpGet/);
  assert.match(src,/const \{data:saved,error:saveError\}=await admin.from\("billing_checkout_intents"\)/);
  assert.match(src,/\.eq\("state","needs_review"\)/);
});
