import test from 'node:test';
import assert from 'node:assert/strict';
import { auditHypotheticalMonthlyCoverage as audit } from
  '../supabase/functions/_shared/mp-contractual-coverage-candidates.mjs';

const subscriptionId='test-sandbox-preapproval';
const sellerId='3778352536';
const invoice=(id,when,approved,overrides={})=>({
  invoiceId:'invoice-'+id,
  paymentId:'payment-'+id,
  subscriptionId,sellerId,
  invoiceStatus:'processed',paymentStatus:'approved',
  providerVerifiedPayment:true,
  amountCents:18000,currency:'BRL',
  debitAt:when,approvedAt:approved,
  ...overrides
});
const base=(overrides={})=>({
  subscriptionId,sellerId,providerStatus:'authorized',
  firstDebitAt:'2026-10-19T18:22:38Z',
  invoices:[invoice('one','2026-10-19T18:22:38Z','2026-10-19T18:22:39Z')],
  ...overrides
});
const first=()=>audit(base());

test('verified first charge aligns to hypothesis but never creates paid through',()=>{
  const r=first();
  assert.equal(r.outcome,'billing_cycle_hypothesis_only');
  assert.equal(r.hypotheticalCycles[0].hypotheticalStart,'2026-10-19T18:22:38.000Z');
  assert.equal(r.hypotheticalCycles[0].hypotheticalEnd,'2026-11-19T18:22:38.000Z');
  assert.equal(r.coveragePeriodVerified,false);
  assert.equal(r.paidThrough,null);
  assert.equal(r.grantsStudentAccess,false);
});
test('paid recurring month produces separate non-authorizing candidate',()=>{
  const r=audit(base({invoices:[
    invoice('one','2026-10-19T18:22:38Z','2026-10-19T18:22:39Z'),
    invoice('two','2026-11-19T18:22:38Z','2026-11-19T18:22:40Z')
  ]}));
  assert.equal(r.hypotheticalCycles.length,2);
  assert.equal(r.hypotheticalCycles[1].hypotheticalEnd,'2026-12-19T18:22:38.000Z');
  assert.equal(r.paidThrough,null);
});
test('canceled subscription can retain historical candidate, but not access',()=>{
  const r=audit(base({providerStatus:'cancelled'}));
  assert.equal(r.hypotheticalCycles.length,1);
  assert.equal(r.grantsStudentAccess,false);
  assert.equal(r.coveragePeriodVerified,false);
});
test('paused state does not grant access',()=>{
  const r=audit(base({providerStatus:'paused'}));
  assert.equal(r.hypotheticalCycles.length,1);
  assert.equal(r.grantsStudentAccess,false);
});
test('subscription authorized with no paid invoice creates no candidate',()=>{
  const r=audit(base({invoices:[]}));
  assert.equal(r.reason,'no_provider_verified_invoices');
  assert.equal(r.hypotheticalCycles.length,0);
});
test('refund invalidates proposed candidate',()=>{
  const r=audit(base({invoices:[invoice('one','2026-10-19T18:22:38Z','2026-10-19T18:22:39Z',{refunded:true})]}));
  assert.equal(r.hypotheticalCycles.length,0);
  assert.equal(r.reason,'missing_or_disputed_provider_payment_proof');
});
test('chargeback invalidates proposed candidate',()=>{
  const r=audit(base({invoices:[invoice('one','2026-10-19T18:22:38Z','2026-10-19T18:22:39Z',{chargeback:true})]}));
  assert.equal(r.hypotheticalCycles.length,0);
});
test('disputed payment invalidates proposed candidate',()=>{
  const r=audit(base({invoices:[invoice('one','2026-10-19T18:22:38Z','2026-10-19T18:22:39Z',{disputed:true})]}));
  assert.equal(r.hypotheticalCycles.length,0);
});
test('invoice from another subscription fails closed',()=>{
  const r=audit(base({invoices:[invoice('one','2026-10-19T18:22:38Z','2026-10-19T18:22:39Z',{subscriptionId:'other'})]}));
  assert.equal(r.outcome,'needs_contractual_review');
});
test('payment from another seller fails closed',()=>{
  const r=audit(base({invoices:[invoice('one','2026-10-19T18:22:38Z','2026-10-19T18:22:39Z',{sellerId:'other'})]}));
  assert.equal(r.hypotheticalCycles.length,0);
});
test('wrong amount, currency and status fail closed',()=>{
  for(const patch of [
    {amountCents:999}, {currency:'USD'}, {paymentStatus:'rejected'},
    {invoiceStatus:'scheduled'},{providerVerifiedPayment:false}
  ]){
    const r=audit(base({invoices:[invoice('one','2026-10-19T18:22:38Z','2026-10-19T18:22:39Z',patch)]}));
    assert.equal(r.hypotheticalCycles.length,0);
  }
});
test('duplicate invoice or payment id is rejected',()=>{
  for(const copy of [
    invoice('one','2026-11-19T18:22:38Z','2026-11-19T18:22:39Z'),
    invoice('two','2026-11-19T18:22:38Z','2026-11-19T18:22:39Z',{paymentId:'payment-one'})
  ]){
    const r=audit(base({invoices:[
      invoice('one','2026-10-19T18:22:38Z','2026-10-19T18:22:39Z'),copy
    ]}));
    assert.equal(r.reason,'duplicate_or_invalid_invoice_payment_identity');
  }
});
test('invalid date without timezone produces no candidate',()=>{
  const r=audit(base({firstDebitAt:'2026-10-19T18:22:38'}));
  assert.equal(r.hypotheticalCycles.length,0);
});
test('debit schedule mismatch requires independent review',()=>{
  const r=audit(base({invoices:[invoice('one','2026-10-20T18:22:38Z','2026-10-20T18:22:39Z')]}));
  assert.equal(r.reason,'cycle_dates_need_independent_review');
});
test('approval before debit is not valid',()=>{
  const r=audit(base({invoices:[invoice('one','2026-10-19T18:22:38Z','2026-10-19T18:22:37Z')]}));
  assert.equal(r.hypotheticalCycles.length,0);
});
test('delayed approval beyond hypothetical next cycle needs review',()=>{
  const r=audit(base({invoices:[invoice('one','2026-10-19T18:22:38Z','2026-11-19T18:22:38Z')]}));
  assert.equal(r.reason,'cycle_dates_need_independent_review');
});
test('31st anchor clips February but returns to March 31',()=>{
  const r=audit(base({
    firstDebitAt:'2027-01-31T12:00:00Z',
    invoices:[
      invoice('one','2027-01-31T12:00:00Z','2027-01-31T12:00:01Z'),
      invoice('two','2027-02-28T12:00:00Z','2027-02-28T12:00:01Z'),
      invoice('three','2027-03-31T12:00:00Z','2027-03-31T12:00:01Z')
    ]
  }));
  assert.equal(r.hypotheticalCycles.length,3);
  assert.equal(r.hypotheticalCycles[0].hypotheticalEnd,'2027-02-28T12:00:00.000Z');
  assert.equal(r.hypotheticalCycles[1].hypotheticalEnd,'2027-03-31T12:00:00.000Z');
  assert.equal(r.hypotheticalCycles[2].hypotheticalEnd,'2027-04-30T12:00:00.000Z');
});
test('leap year February 29 is derived from January 31 anchor',()=>{
  const r=audit(base({
    firstDebitAt:'2028-01-31T05:00:00Z',
    invoices:[invoice('one','2028-01-31T05:00:00Z','2028-01-31T05:00:01Z')]
  }));
  assert.equal(r.hypotheticalCycles[0].hypotheticalEnd,'2028-02-29T05:00:00.000Z');
});
test('timezone offset resolves to UTC anchor without authorizing service',()=>{
  const r=audit(base({
    firstDebitAt:'2026-10-19T15:22:38-03:00',
    invoices:[invoice('one','2026-10-19T18:22:38Z','2026-10-19T18:22:39Z')]
  }));
  assert.equal(r.hypotheticalCycles.length,1);
  assert.equal(r.paidThrough,null);
});
test('unknown provider subscription state is never treated as paid',()=>{
  assert.equal(audit(base({providerStatus:'unsupported'})).hypotheticalCycles.length,0);
});
test('no more than 12 invoice proofs are examined per run',()=>{
  const invoices=Array.from({length:13},(_,i)=>invoice(String(i),
   '2026-10-19T18:22:38Z','2026-10-19T18:22:39Z'));
  const r=audit(base({invoices}));
  assert.equal(r.hypotheticalCycles.length,0);
});
test('partial evidence failure discards all candidates atomically',()=>{
  const r=audit(base({invoices:[
    invoice('one','2026-10-19T18:22:38Z','2026-10-19T18:22:39Z'),
    invoice('two','2026-11-19T18:22:38Z','2026-11-19T18:22:39Z',{currency:'USD'})
  ]}));
  assert.equal(r.hypotheticalCycles.length,0);
});
test('all results always deny changing live billing and RLS',()=>{
  for(const input of [base(),base({invoices:[]}),base({providerStatus:'unsupported'})]){
    const r=audit(input);
    assert.equal(r.productionBillingEnabled,false);
    assert.equal(r.changesRls,false);
    assert.equal(r.grantsStudentAccess,false);
    assert.equal(r.coveragePeriodVerified,false);
    assert.equal(r.paidThrough,null);
  }
});
