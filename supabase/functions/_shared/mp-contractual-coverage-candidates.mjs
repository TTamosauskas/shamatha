/**
 * Pure, sandbox-style audit of hypothetical monthly service boundaries.
 *
 * NOT a contract, billing period, charge scheduler or entitlement engine.
 * The Mercado Pago provider debit date does not establish service coverage.
 * No real student or subscription record may be changed based on this output.
 */
const RFC3339=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const ID=/^[A-Za-z0-9_-]{1,80}$/;
const STATES=new Set(['authorized','pending','paused','cancelled','canceled']);
const FINITE_UTC_MS=8.64e15;
function dateValue(value) {
  if(typeof value!=='string'||!RFC3339.test(value))return null;
  const at=Date.parse(value);
  return Number.isFinite(at)&&Math.abs(at)<FINITE_UTC_MS?at:null;
}
const validId=x=>typeof x==='string'&&ID.test(x);
function dateAtAnchorMonth(anchorMs,monthOffset){
  const d=new Date(anchorMs),day=d.getUTCDate();
  const first=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+monthOffset,1));
  const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+monthOffset+1,0));
  first.setUTCDate(Math.min(day,last.getUTCDate()));
  first.setUTCHours(d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds(),d.getUTCMilliseconds());
  return first.getTime();
}
const baseline=(reason)=>({
  outcome:'needs_contractual_review',
  reason,
  policyStatus:'contractual_policy_not_approved',
  coveragePeriodVerified:false,
  paidThrough:null,
  grantsStudentAccess:false,
  changesRls:false,
  productionBillingEnabled:false,
  hypotheticalCycles:[]
});

/**
 * Computes only *hypothetical* monthly billing-cycle candidates from an
 * externally supplied first debit anchor and individually verified invoices.
 *
 * This logic intentionally cannot issue a coveragePeriodVerified assertion;
 * even perfectly aligned paid months require an independent contract decision.
 * Do NOT use this module to populate an entitlement record or UI "Ativa".
 */
export function auditHypotheticalMonthlyCoverage({
  subscriptionId, sellerId, providerStatus, firstDebitAt, invoices=[]
}={}) {
  const result=baseline('missing_or_untrusted_billing_inputs');
  const anchor=dateValue(firstDebitAt);
  if(!validId(subscriptionId)||!validId(sellerId)||anchor===null||
     !STATES.has(providerStatus)||!Array.isArray(invoices)||invoices.length>12)
    return result;
  if(invoices.length===0)return {...result,reason:'no_provider_verified_invoices'};
  const seenInvoices=new Set(),seenPayments=new Set(),cycles=[];
  for(let i=0;i<invoices.length;i++){
    const invoice=invoices[i]||{};
    const debit=dateValue(invoice.debitAt);
    const approval=dateValue(invoice.approvedAt);
    if(!validId(invoice.invoiceId)||!validId(invoice.paymentId)||
       seenInvoices.has(invoice.invoiceId)||seenPayments.has(invoice.paymentId))
      return {...result,reason:'duplicate_or_invalid_invoice_payment_identity'};
    seenInvoices.add(invoice.invoiceId);seenPayments.add(invoice.paymentId);
    if(invoice.subscriptionId!==subscriptionId||
       invoice.sellerId!==sellerId||
       invoice.invoiceStatus!=='processed'||
       invoice.paymentStatus!=='approved'||
       invoice.providerVerifiedPayment!==true||
       invoice.amountCents!==18000||
       invoice.currency!=='BRL'||
       invoice.refunded===true||invoice.chargeback===true||
       invoice.disputed===true)
      return {...result,reason:'missing_or_disputed_provider_payment_proof'};
    const expectedStart=dateAtAnchorMonth(anchor,i);
    const expectedEnd=dateAtAnchorMonth(anchor,i+1);
    // Exact match is conservative. Real provider retries/debit shifts require
    // human review and must not silently shift a contractual billing cycle.
    if(debit===null||approval===null||debit!==expectedStart||
       approval<debit||approval>=expectedEnd||expectedEnd<=expectedStart)
      return {...result,reason:'cycle_dates_need_independent_review'};
    cycles.push({
      invoiceId:invoice.invoiceId,
      paymentId:invoice.paymentId,
      hypotheticalStart:new Date(expectedStart).toISOString(),
      hypotheticalEnd:new Date(expectedEnd).toISOString(),
      basis:'invoice_debit_and_calendar_anchor_not_contractual'
    });
  }
  return {
    ...result,
    outcome:'billing_cycle_hypothesis_only',
    reason:'provider_charge_cadence_is_not_service_coverage',
    hypotheticalCycles:cycles
  };
}
