import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyLiveMonthlyPayments as verify} from '../supabase/functions/_shared/mp-live-monthly-evidence.mjs';
const u='11111111-2222-4333-8444-555555555555',intent='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const sid='abcd1234efgh5678',seller='888777666',email='student@example.com';
const inv=(id='10001',debit='2026-10-19T18:22:38Z',pay='90001')=>({
  id,preapproval_id:sid,transaction_amount:180,currency_id:'BRL',
  status:'processed',debit_date:debit,payment:{id:pay,status:'approved'}});
const pay=(id='90001',date='2026-10-19T18:22:40Z')=>({
  id,collector_id:seller,transaction_amount:180,currency_id:'BRL',status:'approved',date_approved:date});
const sample=()=>({userId:u,email,sellerId:seller,localSubscriptionId:intent,
  providerSubscription:{id:sid,collector_id:seller,
    external_reference:'shamatha:production:'+u+':'+intent,payer_email:email,
    status:'authorized',auto_recurring:{frequency:1,frequency_type:'months',
      transaction_amount:180,currency_id:'BRL'}},
  invoiceSearch:{results:[inv()],paging:{total:1}},paymentsById:{'90001':pay()}});
test('initial paid month ends one UTC calendar month later',()=>{
  const r=verify(sample());assert.equal(r.approvedPeriods,1);
  assert.equal(r.paidThrough,'2026-11-19T18:22:38.000Z');
});
test('cancelled retains last verified paid period',()=>{
  const a=sample();a.providerSubscription.status='cancelled';
  assert.equal(verify(a).paidThrough,'2026-11-19T18:22:38.000Z');
});
test('paused retains paid period but payment status is explicit',()=>{
  const a=sample();a.providerSubscription.status='paused';
  assert.equal(verify(a).providerStatus,'paused');
});
test('second approved invoice extends paid period',()=>{
  const a=sample();a.invoiceSearch.results.push(inv('10002','2026-11-19T18:22:38Z','90002'));
  a.invoiceSearch.paging.total=2;a.paymentsById['90002']=pay('90002','2026-11-19T18:22:40Z');
  assert.equal(verify(a).paidThrough,'2026-12-19T18:22:38.000Z');
});
test('rejected renewal does not extend paid period',()=>{
  const a=sample();let i=inv('10002','2026-11-19T18:22:38Z','90002');
  i.payment.status='rejected';a.invoiceSearch.results.push(i);a.invoiceSearch.paging.total=2;
  a.paymentsById['90002']={...pay('90002'),'status':'rejected'};
  assert.equal(verify(a).paidThrough,'2026-11-19T18:22:38.000Z');
});
test('refunded payment does not provide coverage',()=>{
  const a=sample();a.paymentsById['90001'].status='refunded';
  assert.equal(verify(a).paidThrough,null);
});
test('chargeback does not provide coverage',()=>{
  const a=sample();a.paymentsById['90001'].status='charged_back';
  assert.equal(verify(a).paidThrough,null);
});
test('scheduled invoice cannot provide coverage',()=>{
  const a=sample();a.invoiceSearch.results[0].status='scheduled';
  assert.equal(verify(a).paidThrough,null);
});
test('payment must be individually retrieved',()=>{
  const a=sample();a.paymentsById={};
  assert.throws(()=>verify(a),/PAYMENT_NOT_FETCHED/);
});
test('seller mismatch is rejected',()=>{
  const a=sample();a.providerSubscription.collector_id='1';
  assert.throws(()=>verify(a),/SUBSCRIPTION_MISMATCH/);
});
test('invoice from another subscription is rejected',()=>{
  const a=sample();a.invoiceSearch.results[0].preapproval_id='other';
  assert.throws(()=>verify(a),/INVOICE_MISMATCH/);
});
test('external reference bound to authenticated student is required',()=>{
  const a=sample();a.providerSubscription.external_reference='other';
  assert.throws(()=>verify(a),/SUBSCRIPTION_MISMATCH/);
});
test('payer email mismatch is rejected',()=>{
  const a=sample();a.providerSubscription.payer_email='another@example.com';
  assert.throws(()=>verify(a),/SUBSCRIPTION_MISMATCH/);
});
test('amount, currency must match fixed monthly price',()=>{
  const a=sample();a.invoiceSearch.results[0].transaction_amount=179;
  assert.throws(()=>verify(a),/INVOICE_MISMATCH/);
  const b=sample();b.paymentsById['90001'].currency_id='USD';
  assert.throws(()=>verify(b),/PAYMENT_MISMATCH/);
});
test('unknown provider state fails closed',()=>{
  const a=sample();a.providerSubscription.status='other';
  assert.throws(()=>verify(a),/UNKNOWN_SUBSCRIPTION_STATUS/);
});
test('duplicate invoice id fails',()=>{
  const a=sample();a.invoiceSearch.results.push(inv());a.invoiceSearch.paging.total=2;
  assert.throws(()=>verify(a),/INVOICE_MISMATCH/);
});
test('duplicate payment ID fails',()=>{
  const a=sample();a.invoiceSearch.results.push(inv('10002','2026-11-19T18:22:38Z'));
  a.invoiceSearch.paging.total=2;
  assert.throws(()=>verify(a),/DUPLICATE_PAYMENT/);
});
test('pagination truncation fails closed',()=>{
  const a=sample();a.invoiceSearch.paging.total=2;
  assert.throws(()=>verify(a),/INVOICE_BATCH_UNSAFE/);
});
test('shifted debit requires manual review',()=>{
  const a=sample();a.invoiceSearch.results.push(inv('10002','2026-11-20T18:22:38Z','90002'));
  a.invoiceSearch.paging.total=2;a.paymentsById['90002']=pay('90002','2026-11-20T18:22:40Z');
  assert.throws(()=>verify(a),/CYCLE_SHIFT_REVIEW/);
});
test('31st anchor clips February then restores March 31',()=>{
  const a=sample();a.invoiceSearch.results=[
    inv('10001','2027-01-31T12:00:00Z'),
    inv('10002','2027-02-28T12:00:00Z','90002'),
    inv('10003','2027-03-31T12:00:00Z','90003')];
  a.invoiceSearch.paging.total=3;a.paymentsById={
    '90001':pay('90001','2027-01-31T12:00:01Z'),
    '90002':pay('90002','2027-02-28T12:00:01Z'),
    '90003':pay('90003','2027-03-31T12:00:01Z')};
  assert.equal(verify(a).paidThrough,'2027-04-30T12:00:00.000Z');
});
test('payment approval after month boundary does not grant backdated coverage',()=>{
  const a=sample();a.paymentsById['90001'].date_approved='2026-11-19T18:22:38Z';
  assert.equal(verify(a).paidThrough,null);
});
test('empty invoice search returns no access period',()=>{
  const a=sample();a.invoiceSearch={results:[],paging:{total:0}};
  assert.equal(verify(a).paidThrough,null);
});
