import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCreatedMonthlyPreapproval, verifiedMercadoPagoCheckoutUrl } from
  '../supabase/functions/_shared/mp-live-checkout-proof.mjs';

const userId='11111111-2222-4333-8444-555555555555';
const intentId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const sellerId='998877665',payerEmail='aluno@example.com',sid='abcd1234efgh5678';
const initPoint='https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id='+sid;
const remote=()=>({
  id:sid,collector_id:Number(sellerId),
  external_reference:'shamatha:production:'+userId+':'+intentId,
  payer_email:payerEmail,status:'pending',init_point:initPoint,
  auto_recurring:{frequency:1,frequency_type:'months',
    transaction_amount:180,currency_id:'BRL'}
});
const audit=(delta={},config={})=>verifyCreatedMonthlyPreapproval({
  remote:{...remote(),...delta},
  sellerId,userId,intentId,payerEmail,...config
});
test('complete real-looking monthly preapproval matches the authenticated student and seller',()=>{
  assert.deepEqual(audit(),{id:sid,status:'pending'});
  assert.equal(verifiedMercadoPagoCheckoutUrl(initPoint,sid),true);
});
test('buyer identity mismatch fails closed',()=>{
  assert.throws(()=>audit({payer_email:'other@example.com'}),/MP_SUBSCRIPTION_PROOF_FAILED/);
  assert.throws(()=>audit({external_reference:'shamatha:production:'+userId+':wrong'}),/MP_SUBSCRIPTION_PROOF_FAILED/);
  assert.throws(()=>audit({}, {userId:'another-student'}),/MP_SUBSCRIPTION_PROOF_FAILED/);
});
test('merchant identity mismatch or fake sandbox merchant fails closed',()=>{
  assert.throws(()=>audit({collector_id:12345}),/MP_SUBSCRIPTION_PROOF_FAILED/);
  assert.throws(()=>audit({}, {sellerId:'3778352536'}),/MP_SUBSCRIPTION_PROOF_FAILED/);
});
test('missing merchant, price, currency or frequency fails closed',()=>{
  const base=remote();
  for (const item of [
    {...base,collector_id:null},
    {...base,auto_recurring:{...base.auto_recurring,transaction_amount:179}},
    {...base,auto_recurring:{...base.auto_recurring,currency_id:'USD'}},
    {...base,auto_recurring:{...base.auto_recurring,frequency:7}},
    {...base,auto_recurring:{...base.auto_recurring,frequency_type:'days'}},
    {...base,auto_recurring:null},
    {...base,external_reference:null}
  ])assert.throws(()=>audit(item),/MP_SUBSCRIPTION_PROOF_FAILED/);
});
test('provider response must be pending on creation',()=>{
  for(const status of ['authorized','paused','canceled','rejected',null])
    assert.throws(()=>audit({status}),/MP_SUBSCRIPTION_PROOF_FAILED/);
});
test('authorized and cancelled states can be checked read-only on resume',()=>{
  assert.deepEqual(audit({status:'authorized'},{requirePending:false}),
    {id:sid,status:'authorized'});
  assert.deepEqual(audit({status:'canceled'},{requirePending:false}),
    {id:sid,status:'canceled'});
});
test('provider status not recognized cannot be resumed',()=>{
  assert.throws(()=>audit({status:'arbitrary'},{requirePending:false}),
    /MP_SUBSCRIPTION_PROOF_FAILED/);
});
test('redirect is HTTPS, belongs to Mercado Pago and points to this preapproval',()=>{
  const check=(url,id=sid)=>verifiedMercadoPagoCheckoutUrl(url,id);
  assert.ok(check(initPoint));
  assert.ok(!check('http://www.mercadopago.com.br/subscriptions/checkout?preapproval_id='+sid));
  assert.ok(!check('https://www.mercadopago.com.br.evil.test/subscriptions/checkout?preapproval_id='+sid));
  assert.ok(!check('https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=another'));
  assert.ok(!check('https://www.mercadopago.com.br/subscriptions/checkout'));
  assert.ok(!check('https://evil.com@mercadopago.com.br/subscriptions/checkout?preapproval_id='+sid));
  assert.ok(!check('javascript:alert(1)'));
  assert.ok(!check('https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id='+sid,'wrong'));
});
test('missing subscription ID or invalid payer ID cannot pass',()=>{
  assert.throws(()=>audit({id:'not a valid id'}),/MP_SUBSCRIPTION_PROOF_FAILED/);
  assert.throws(()=>audit({}, {payerEmail:''}),/MP_SUBSCRIPTION_PROOF_FAILED/);
});
