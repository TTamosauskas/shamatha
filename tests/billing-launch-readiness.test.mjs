import test from 'node:test';
import assert from 'node:assert/strict';
import {auditBillingLaunchReadiness,REQUIRED_BILLING_GATES} from '../supabase/functions/_shared/billing-launch-readiness.mjs';

const NOW='2026-10-20T13:00:00Z';
const proof=(override={})=>({
  result:'verified',
  auditRef:'https://github.com/TTamosauskas/shamatha/pull/63',
  verifiedAt:'2026-10-20T12:00:00Z',
  ...override
});
const allProofs=()=>Object.fromEntries(REQUIRED_BILLING_GATES.map(x=>[x,proof()]));
const check=(evidence={})=>auditBillingLaunchReadiness({evidence,now:NOW});

test('no evidence means all gates unresolved, never authorizes billing',()=>{
  const r=check();
  assert.equal(r.gatesRequired,12);
  assert.equal(r.evidencePresent,0);
  assert.equal(r.gatesWithoutFreshEvidence.length,12);
  assert.equal(r.authorizesProductionBilling,false);
  assert.equal(r.grantsStudentAccess,false);
});
test('all self-reported evidence still never enables real billing',()=>{
  const r=check(allProofs());
  assert.equal(r.allEvidenceForHumanReview,true);
  assert.equal(r.authorizesProductionBilling,false);
  assert.equal(r.productionBillingEnabled,false);
});
test('all evidence still cannot edit RLS or legacy student permissions',()=>{
  const r=check(allProofs());
  assert.equal(r.changesRls,false);
  assert.equal(r.changesExistingUserAccess,false);
  assert.equal(r.grantsStudentAccess,false);
});
test('one missing gate yields unresolved owner signoff',()=>{
  const entries=allProofs();delete entries.owner_explicit_go_live_authorization;
  const r=check(entries);
  assert.equal(r.evidencePresent,11);
  assert.deepEqual(r.gatesWithoutFreshEvidence,['owner_explicit_go_live_authorization']);
});
test('unknown evidence keys are ignored',()=>{
  const r=check({featureFlag:true,arbitrary:proof()});
  assert.equal(r.evidencePresent,0);
});
test('mere flags and boolean indicators are never acceptable evidence',()=>{
  const entries=allProofs();
  entries.owner_explicit_go_live_authorization=true;
  assert.equal(check(entries).evidencePresent,11);
});
test('reviewer must explicitly mark status verified',()=>{
  const entries=allProofs();entries.owner_explicit_go_live_authorization=proof({result:'pending'});
  assert.equal(check(entries).evidencePresent,11);
});
test('evidence URL must be a specific repository issue/PR/run',()=>{
  for(const url of ['https://evil.example/pull/1','http://github.com/TTamosauskas/shamatha/pull/63',
    'https://github.com/another/repo/pull/63','https://github.com/TTamosauskas/shamatha',
    'https://github.com/TTamosauskas/shamatha/pull/0','javascript:alert(1)']){
    const entries=allProofs();entries.owner_explicit_go_live_authorization=proof({auditRef:url});
    assert.equal(check(entries).evidencePresent,11,url);
  }
});
test('unverified URL alone cannot count as evidence',()=>{
  const e={owner_explicit_go_live_authorization:{
    auditRef:'https://github.com/TTamosauskas/shamatha/pull/63'
  }};
  assert.equal(check(e).evidencePresent,0);
});
test('evidence timestamp must be RFC3339 with timezone',()=>{
  for(const when of ['2026-10-20','2026-10-20T12:00:00','invalid',null]){
    const entries=allProofs();
    entries.owner_explicit_go_live_authorization=proof({verifiedAt:when});
    assert.equal(check(entries).evidencePresent,11);
  }
});
test('future evidence is rejected',()=>{
  const entries=allProofs();
  entries.owner_explicit_go_live_authorization=proof({verifiedAt:'2026-10-20T13:00:01Z'});
  assert.equal(check(entries).evidencePresent,11);
});
test('evidence older than 30 days needs renewed review',()=>{
  const entries=allProofs();
  entries.owner_explicit_go_live_authorization=proof({verifiedAt:'2026-09-01T13:00:00Z'});
  assert.equal(check(entries).evidencePresent,11);
});
test('evidence exactly 30 days old remains within review window',()=>{
  const entries=allProofs();
  entries.owner_explicit_go_live_authorization=proof({verifiedAt:'2026-09-20T13:00:00Z'});
  assert.equal(check(entries).evidencePresent,12);
});
test('invalid audit clock throws rather than granting access',()=>{
  for(const now of ['2026-10-20','2026-10-20T13:00:00','garbage',null]){
    assert.throws(()=>auditBillingLaunchReadiness({now,evidence:allProofs()}),TypeError);
  }
});
test('immutability: modifying returned output does not change future audits',()=>{
  const result=check();
  result.gatesWithoutFreshEvidence.pop();
  assert.equal(check().gatesWithoutFreshEvidence.length,12);
  assert.equal(Object.isFrozen(REQUIRED_BILLING_GATES),true);
});
test('no client-supplied proof of payment can satisfy contractual coverage gate',()=>{
  const e={contractual_paid_coverage_period_source_verified:{
    coveragePeriodVerified:true,
    nextPaymentDate:'2026-11-19T18:22:38Z',
    paymentStatus:'approved'
  }};
  assert.equal(check(e).evidencePresent,0);
});
test('completed webhook inbox tests are not proof of actual MP notification delivery',()=>{
  const e={mercadopago_subscription_webhook_delivery_verified:proof({result:'pending'})};
  assert.equal(check(e).evidencePresent,0);
});
test('all 12 gates are distinct mandatory checks',()=>{
  assert.equal(new Set(REQUIRED_BILLING_GATES).size,12);
});
