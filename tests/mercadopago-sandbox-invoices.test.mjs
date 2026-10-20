import test from "node:test";
import assert from "node:assert/strict";
import { verifySandboxInvoices } from "../supabase/functions/_shared/mercadopago-sandbox-invoices.mjs";

const attempt={
 id:"0aca474d-af76-4cb4-a2b3-43b461a01db2",
 editor_id:"3f306f5e-6eac-471f-bd8f-e20c1e72ce42",
 mp_preapproval_id:"c5b3cfd34ca740cb8d1b7687c5ad13b2",
 payer_email:"test@example.com"
};
const subscription={
 id:attempt.mp_preapproval_id,collector_id:3778352536,
 external_reference:"sandbox:"+attempt.editor_id+":"+attempt.id,
 payer_email:attempt.payer_email,status:"authorized",
 auto_recurring:{transaction_amount:180,currency_id:"BRL",frequency:1,frequency_type:"months"}
};
const invoice={id:7033097180,preapproval_id:attempt.mp_preapproval_id,
  transaction_amount:180,currency_id:"BRL",status:"processed",
  debit_date:"2026-10-19T18:22:38Z",payment:{id:185024682360,status:"approved"}};
const payment={id:185024682360,status:"approved",collector_id:3778352536,
  transaction_amount:180,currency_id:"BRL",date_approved:"2026-10-19T18:22:39Z"};
const sample=()=>({
  subscription:structuredClone(subscription),
  invoiceSearch:{results:[structuredClone(invoice)],paging:{total:1}},
  paymentsById:{"185024682360":structuredClone(payment)},
  attempt:structuredClone(attempt),checkedAt:"2026-10-19T22:00:00Z"
});
test("one approved provider invoice produces one observed payment",()=>{
 const output=verifySandboxInvoices(sample());
 assert.equal(output.rows.length,1);
 assert.equal(output.approvedPaymentsVerified,1);
 assert.equal(output.rows[0].mp_invoice_id,"7033097180");
});
test("never determines coverage or student access",()=>{
 const result=verifySandboxInvoices(sample());
 assert.equal(result.coveragePeriodVerified,false);
 assert.equal(result.paidThrough,null);
 assert.equal(result.grantsStudentAccess,false);
});
test("rejects wrong merchant identity",()=>{
 const input=sample();input.subscription.collector_id=100;
 assert.throws(()=>verifySandboxInvoices(input),/SUBSCRIPTION_MISMATCH/);
});
test("rejects forged external reference",()=>{
 const input=sample();input.subscription.external_reference="sandbox:other";
 assert.throws(()=>verifySandboxInvoices(input),/SUBSCRIPTION_MISMATCH/);
});
test("rejects wrong payer email",()=>{
 const input=sample();input.subscription.payer_email="attacker@example.com";
 assert.throws(()=>verifySandboxInvoices(input),/PAYER_MISMATCH/);
});
test("rejects wrong subscription amount or currency",()=>{
 for(const updates of [{transaction_amount:1},{currency_id:"USD"},{frequency:2}]){
 const input=sample();Object.assign(input.subscription.auto_recurring,updates);
 assert.throws(()=>verifySandboxInvoices(input),/SUBSCRIPTION_MISMATCH/);
 }
});
test("rejects invoice of another subscription",()=>{
 const input=sample();input.invoiceSearch.results[0].preapproval_id="other";
 assert.throws(()=>verifySandboxInvoices(input),/INVOICE_MISMATCH/);
});
test("rejects altered invoice amount or currency",()=>{
 for(const patch of [{transaction_amount:20},{currency_id:"USD"}]){
 const input=sample();Object.assign(input.invoiceSearch.results[0],patch);
 assert.throws(()=>verifySandboxInvoices(input),/INVOICE_MISMATCH/);
 }
});
test("rejects duplicate invoices within batch",()=>{
 const input=sample();input.invoiceSearch.results.push(input.invoiceSearch.results[0]);
 assert.throws(()=>verifySandboxInvoices(input),/INVOICE_MISMATCH/);
});
test("rejects incomplete page rather than saving incomplete ledger",()=>{
 const input=sample();input.invoiceSearch.paging.total=11;
 assert.throws(()=>verifySandboxInvoices(input),/INVOICE_BATCH_UNSAFE/);
});
test("must refetch payment by ID before recording status",()=>{
 const input=sample();input.paymentsById={};
 assert.throws(()=>verifySandboxInvoices(input),/PAYMENT_NOT_FETCHED/);
});
test("rejects provider payment from another seller",()=>{
 const input=sample();input.paymentsById["185024682360"].collector_id=1;
 assert.throws(()=>verifySandboxInvoices(input),/PAYMENT_MISMATCH/);
});
test("rejects tampered provider payment amount",()=>{
 const input=sample();input.paymentsById["185024682360"].transaction_amount=10;
 assert.throws(()=>verifySandboxInvoices(input),/PAYMENT_MISMATCH/);
});
test("rejected payment is retained but not approved",()=>{
 const input=sample();input.paymentsById["185024682360"].status="rejected";
 const out=verifySandboxInvoices(input);
 assert.equal(out.approvedPaymentsVerified,0);
 assert.equal(out.rows[0].payment_status,"rejected");
});
test("invoice-side pending cannot be upgraded by payment-side approved",()=>{
 const input=sample();input.invoiceSearch.results[0].payment.status="pending";
 assert.equal(verifySandboxInvoices(input).rows[0].payment_approved_verified,false);
});
test("payment without ID does not manufacture approval",()=>{
 const input=sample();input.invoiceSearch.results[0].payment={};
 const out=verifySandboxInvoices(input);
 assert.equal(out.approvedPaymentsVerified,0);
 assert.equal(out.rows[0].mp_payment_id,null);
});
test("empty invoice list is valid and grants nothing",()=>{
 const input=sample();input.invoiceSearch={results:[],paging:{total:0}};
 const out=verifySandboxInvoices(input);
 assert.equal(out.rows.length,0);
 assert.equal(out.grantsStudentAccess,false);
});
test("invalid timestamps fail closed",()=>{
 const input=sample();input.checkedAt="2026-11-19";
 assert.throws(()=>verifySandboxInvoices(input),/INVALID_CHECK_TIME/);
});

test("fractional amount that rounds to R$180 is rejected",()=>{
 const a=sample();a.invoiceSearch.results[0].transaction_amount=180.004;
 assert.throws(()=>verifySandboxInvoices(a),/INVOICE_MISMATCH/);
 const b=sample();b.paymentsById["185024682360"].transaction_amount=180.004;
 assert.throws(()=>verifySandboxInvoices(b),/PAYMENT_MISMATCH/);
});
test("invoice not processed cannot pass approval despite approved payment",()=>{
 const input=sample();input.invoiceSearch.results[0].status="scheduled";
 const output=verifySandboxInvoices(input);
 assert.equal(output.rows[0].payment_approved_verified,false);
});
test("a payment cannot back two distinct invoice IDs",()=>{
 const input=sample();
 const other=structuredClone(input.invoiceSearch.results[0]);other.id=7033097181;
 input.invoiceSearch.results.push(other);
 input.invoiceSearch.paging.total=2;
 assert.throws(()=>verifySandboxInvoices(input),/PAYMENT_REUSED_ACROSS_INVOICES/);
});


test("buyer cancellation preserves the approved historical invoice",()=>{
 const input=sample();input.subscription.status="cancelled";
 const result=verifySandboxInvoices(input);
 assert.equal(result.providerStatus,"cancelled");
 assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].mp_invoice_id,"7033097180");
 assert.equal(result.rows[0].payment_approved_verified,true);
 assert.equal(result.approvedPaymentsVerified,1);
 assert.equal(result.paidThrough,null);
 assert.equal(result.grantsStudentAccess,false);
});
test("provider can spell canceled with one L without granting content",()=>{
 const input=sample();input.subscription.status="canceled";
 const result=verifySandboxInvoices(input);
 assert.equal(result.providerStatus,"canceled");
 assert.equal(result.rows.length,1);
 assert.equal(result.grantsStudentAccess,false);
});
test("reconciling the same canceled subscription twice produces identical invoice IDs",()=>{
 const input=sample();input.subscription.status="cancelled";
 const first=verifySandboxInvoices(input);
 const second=verifySandboxInvoices(input);
 assert.equal(first.rows.length,1);
 assert.equal(second.rows.length,1);
 assert.equal(first.rows[0].mp_invoice_id,second.rows[0].mp_invoice_id);
 assert.equal(first.rows[0].mp_payment_id,second.rows[0].mp_payment_id);
 assert.equal(first.grantsStudentAccess,false);
 assert.equal(second.grantsStudentAccess,false);
});
test("cancelled status never overrides account reference or seller validation",()=>{
 const input=sample();input.subscription.status="cancelled";
 input.subscription.external_reference="sandbox:forged-id";
 assert.throws(()=>verifySandboxInvoices(input),/SUBSCRIPTION_MISMATCH/);
});
test("cancellation followed by a pending renewal invoice does not mark renewal approved",()=>{
 const input=sample();input.subscription.status="cancelled";
 const upcoming=structuredClone(input.invoiceSearch.results[0]);
 upcoming.id=7033097181;
 upcoming.payment={};
 upcoming.status="scheduled";
 upcoming.debit_date="2026-11-19T18:22:38Z";
 input.invoiceSearch.results.push(upcoming);
 input.invoiceSearch.paging.total=2;
 const result=verifySandboxInvoices(input);
 assert.equal(result.rows.length,2);
 assert.equal(result.approvedPaymentsVerified,1);
 assert.equal(result.rows[1].payment_approved_verified,false);
 assert.equal(result.grantsStudentAccess,false);
});
test("paused subscription with previous payment still has no entitlement effect",()=>{
 const input=sample();input.subscription.status="paused";
 const result=verifySandboxInvoices(input);
 assert.equal(result.providerStatus,"paused");
 assert.equal(result.rows[0].payment_approved_verified,true);
 assert.equal(result.coveragePeriodVerified,false);
 assert.equal(result.grantsStudentAccess,false);
});
