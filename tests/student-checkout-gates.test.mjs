import test from 'node:test';
import assert from 'node:assert/strict';
import {checkStudentCheckoutGate,priorSubscriptionCheckoutGate} from '../supabase/functions/_shared/student-checkout-gates.mjs';

const input=(overrides={})=>({
  productionEnabled:true, launchApproved:true, checkoutEnabled:true, sellerConfigured:true,
  role:'student', isVerifiedEmail:true, administrativeStatus:'pending',
  isExempt:false, hasExistingSubscription:false,...overrides
});
test('production flags are OFF by default',()=>assert.equal(checkStudentCheckoutGate().reason,'PRODUCTION_DISABLED'));
test('production disabled refuses eligible student',()=>assert.equal(checkStudentCheckoutGate(input({productionEnabled:false})).reason,'PRODUCTION_DISABLED'));
test('checkout disabled refuses eligible student',()=>assert.equal(checkStudentCheckoutGate(input({checkoutEnabled:false})).reason,'CHECKOUT_DISABLED'));
test('missing or unverified seller rejects checkout',()=>assert.equal(checkStudentCheckoutGate(input({sellerConfigured:false})).reason,'SELLER_NOT_CONFIGURED'));
test('editor and owner accounts cannot generate student checkout',()=>{for(const role of ['editor','owner',null])assert.equal(checkStudentCheckoutGate(input({role})).reason,'STUDENT_REQUIRED')});
test('email must be verified by Supabase Auth',()=>assert.equal(checkStudentCheckoutGate(input({isVerifiedEmail:false})).reason,'EMAIL_NOT_CONFIRMED'));
test('suspended student cannot pay to bypass administrative block',()=>assert.equal(checkStudentCheckoutGate(input({administrativeStatus:'suspended'})).reason,'ACCOUNT_SUSPENDED'));
test('old exempt account never gets a new charge',()=>assert.equal(checkStudentCheckoutGate(input({isExempt:true})).reason,'ALREADY_EXEMPT'));
test('existing provider subscription must be reconciled, not duplicated',()=>assert.equal(checkStudentCheckoutGate(input({hasExistingSubscription:true})).reason,'EXISTING_SUBSCRIPTION'));
test('pending administrative approval can start checkout only when rollout is enabled',()=>assert.deepEqual(checkStudentCheckoutGate(input()),{allowed:true,reason:'ELIGIBLE_FOR_CHECKOUT_ONLY'}));
test('all guards are boolean strict, not string based',()=>{for(const value of ['true',1,null])assert.equal(checkStudentCheckoutGate(input({productionEnabled:value})).allowed,false)});
test('an approved student still needs both flags',()=>assert.equal(checkStudentCheckoutGate(input({administrativeStatus:'approved',checkoutEnabled:false})).allowed,false));

test('final launch approval is an independent kill switch',()=>assert.equal(checkStudentCheckoutGate(input({launchApproved:false})).reason,'LAUNCH_NOT_APPROVED'));
test('string launch approval does not enable billing',()=>assert.equal(checkStudentCheckoutGate(input({launchApproved:'true'})).allowed,false));

test('unknown administrative status fails closed',()=>assert.equal(checkStudentCheckoutGate(input({administrativeStatus:'arbitrary'})).reason,'ACCOUNT_STATUS_UNRECOGNIZED'));

test('cancelled subscription with expired coverage permits a new contract',()=>{
  assert.equal(priorSubscriptionCheckoutGate([
    {provider_status:'canceled',paid_through:'2026-10-20T00:00:00Z'}
  ],Date.parse('2026-10-22T00:00:00Z')).allowed,true);
});
test('cancelled subscription does not double bill during previously paid period',()=>{
  assert.equal(priorSubscriptionCheckoutGate([
    {provider_status:'canceled',paid_through:'2026-11-20T00:00:00Z'}
  ],Date.parse('2026-10-22T00:00:00Z')).reason,'PREVIOUS_COVERAGE_STILL_ACTIVE');
});
test('pending, authorized and paused subscriptions prohibit second checkout',()=>{
  for(const provider_status of ['pending','authorized','paused','unexpected']){
    assert.equal(priorSubscriptionCheckoutGate([
      {provider_status,paid_through:null}
    ]).reason,'EXISTING_SUBSCRIPTION_REQUIRES_RECONCILIATION');
  }
});
test('multiple past cancellations all require expired paid periods',()=>{
  const now=Date.parse('2026-10-22T00:00:00Z');
  assert.equal(priorSubscriptionCheckoutGate([
    {provider_status:'cancelled',paid_through:null},
    {provider_status:'canceled',paid_through:'2026-10-20T00:00:00Z'}
  ],now).allowed,true);
  assert.equal(priorSubscriptionCheckoutGate([
    {provider_status:'cancelled',paid_through:'2026-11-20T00:00:00Z'},
    {provider_status:'canceled',paid_through:'2026-10-20T00:00:00Z'}
  ],now).allowed,false);
});
test('corrupt coverage timestamp and oversized history fail closed',()=>{
  assert.equal(priorSubscriptionCheckoutGate([
    {provider_status:'cancelled',paid_through:'invalid'}
  ]).reason,'COVERAGE_DATE_REQUIRES_REVIEW');
  assert.equal(priorSubscriptionCheckoutGate(new Array(101).fill({
    provider_status:'canceled',paid_through:null
  })).allowed,false);
});
