import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyProviderBuyer,verifyPayerEmailMembership}
  from '../supabase/functions/_shared/mp-live-buyer-proof.mjs';
const id='abcd1234efgh5678',email='aluno@example.com';
const page=(items,total=items.length,offset=0)=>({
  paging:{total,offset,limit:20},results:items
});
const matches=async({remote={id},items=[{id}],fetchPage=null}={})=>
  verifyProviderBuyer({remote,payerEmail:email,fetchPage:fetchPage||(
    async()=>page(items))});
test('documented GET without payer_email proves buyer by provider filtered search',async()=>{
  assert.equal(await matches(),true);
});
test('GET carrying the correct payer_email needs no search',async()=>{
  assert.equal(await matches({remote:{id,payer_email:email},fetchPage:async()=>{
    throw Error('Search should not happen');
  }}),true);
});
test('GET carrying different payer_email is rejected even if search would match',async()=>{
  await assert.rejects(()=>matches({remote:{id,payer_email:'intruder@example.com'}}),
    /PAYER_EMAIL_MISMATCH/);
});
test('absent preapproval in filtered search is not proof',async()=>{
  await assert.rejects(()=>matches({items:[{id:'1234567890abcdef'}]}),
    /PAYER_SUBSCRIPTION_NOT_FOUND/);
});
test('truncated provider result fails closed',async()=>{
  await assert.rejects(()=>matches({fetchPage:async()=>page([],1)}),
    /PAYER_SEARCH_TRUNCATED/);
});
test('duplicated subscription IDs in lookup are refused',async()=>{
  await assert.rejects(()=>matches({fetchPage:async()=>page([{id},{id}])}),
    /PAYER_SEARCH_INVALID_ID/);
});
test('search with wrong email in returned item fails closed',async()=>{
  await assert.rejects(()=>matches({items:[{id,payer_email:'other@example.com'}]}),
    /PAYER_SEARCH_WRONG_EMAIL/);
});
test('provider pagination iterates pages without approving truncated results',async()=>{
  const offsets=[];
  const list=[{id:'1234567890abcdef'},{id}];
  const ok=await verifyPayerEmailMembership({
    subscriptionId:id,payerEmail:email,pageSize:1,
    fetchPage:async({offset,limit,payerEmail})=>{
      assert.equal(payerEmail,email);assert.equal(limit,1);
      offsets.push(offset);return page(list.slice(offset,offset+1),2,offset);
    }
  });
  assert.equal(ok,true);
  assert.deepEqual(offsets,[0,1]);
});
test('pagination cannot silently drop current subscription',async()=>{
  await assert.rejects(()=>verifyPayerEmailMembership({
    subscriptionId:id,payerEmail:email,pageSize:1,
    fetchPage:async({offset})=>page(offset?[]:[{id}],2,offset)
  }),/PAYER_SEARCH_TRUNCATED/);
});
test('non-email and unexpectedly large search fail closed',async()=>{
  await assert.rejects(()=>verifyPayerEmailMembership({
    subscriptionId:id,payerEmail:'not-an-email',
    fetchPage:async()=>page([{id}])
  }),/PAYER_SEARCH_CONFIG_UNSAFE/);
  await assert.rejects(()=>matches({fetchPage:async()=>page([{id}],101)}),
    /PAYER_SEARCH_UNSAFE/);
});
