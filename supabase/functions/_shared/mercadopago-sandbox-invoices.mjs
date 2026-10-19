/**
 * Pure Mercado Pago invoice verification for the fake seller, never granting access.
 * No network calls, no credentials. Provider objects MUST be fetched by a server.
 * An approved invoice does not establish a paid-through entitlement.
 */
const exact180=(x)=>typeof x==="number"&&Number.isFinite(x)&&Math.round(x*100)===18000;
const numericId=(x)=>{const value=String(x??"");return /^\d{1,30}$/.test(value)?value:null};
const safeStatus=(x)=>typeof x==="string"&&/^[a-z_]{1,48}$/i.test(x)?x:"unknown";
const toDate=(x)=>typeof x==="string"&&Number.isFinite(Date.parse(x))
  ?new Date(x).toISOString():null;
export function verifySandboxInvoices({subscription,invoiceSearch,paymentsById={},attempt,expectedSellerId="3778352536",checkedAt}={}) {
  if (!attempt||!attempt.id||!attempt.editor_id||
      !/^[a-zA-Z0-9_-]{12,64}$/.test(String(attempt.mp_preapproval_id||""))) {
    throw new Error("INVALID_ATTEMPT");
  }
  const subscriptionId=attempt.mp_preapproval_id;
  const reference="sandbox:"+attempt.editor_id+":"+attempt.id;
  if (String(subscription?.id??"")!==subscriptionId||
      String(subscription?.collector_id??"")!==String(expectedSellerId)||
      String(subscription?.external_reference??"")!==reference||
      !exact180(subscription?.auto_recurring?.transaction_amount)||
      subscription?.auto_recurring?.currency_id!=="BRL"||
      Number(subscription?.auto_recurring?.frequency)!==1||
      subscription?.auto_recurring?.frequency_type!=="months") {
    throw new Error("SUBSCRIPTION_MISMATCH");
  }
  if (attempt.payer_email&&subscription.payer_email&&
      attempt.payer_email.toLowerCase()!==String(subscription.payer_email).toLowerCase()){
    throw new Error("PAYER_MISMATCH");
  }
  if (!invoiceSearch||!Array.isArray(invoiceSearch.results)||invoiceSearch.results.length>10||
      Number(invoiceSearch.paging?.total??invoiceSearch.results.length)>10){
    throw new Error("INVOICE_BATCH_UNSAFE");
  }
  const checked=toDate(checkedAt);
  if(!checked)throw new Error("INVALID_CHECK_TIME");
  const rows=[],observed=new Set();
  for(const invoice of invoiceSearch.results){
    const invoiceId=numericId(invoice?.id);
    if(String(invoice?.preapproval_id??"")!==subscriptionId||
       !invoiceId||observed.has(invoiceId)||
       !exact180(invoice?.transaction_amount)||
       invoice?.currency_id!=="BRL"){
      throw new Error("INVOICE_MISMATCH");
    }
    observed.add(invoiceId);
    const paymentId=numericId(invoice?.payment?.id);
    const payment=paymentId?paymentsById[paymentId]:null;
    if(paymentId&&!payment)throw new Error("PAYMENT_NOT_FETCHED");
    let status=null,approved=false,approvedAt=null;
    if(payment){
      if(numericId(payment.id)!==paymentId||
         String(payment.collector_id??"")!==String(expectedSellerId)||
         !exact180(payment.transaction_amount)||payment.currency_id!=="BRL"){
        throw new Error("PAYMENT_MISMATCH");
      }
      status=safeStatus(payment.status);
      approved=status==="approved"&&invoice?.payment?.status==="approved";
      approvedAt=approved?toDate(payment.date_approved):null;
    }
    rows.push({
      attempt_id:attempt.id,
      mp_invoice_id:invoiceId,
      mp_payment_id:paymentId,
      invoice_status:safeStatus(invoice.status),
      payment_status:status,
      payment_approved_verified:approved,
      amount_cents:18000,
      currency:"BRL",
      debit_date:toDate(invoice.debit_date),
      payment_approved_at:approvedAt,
      last_checked_at:checked
    });
  }
  return {
    subscriptionId,
    providerStatus:safeStatus(subscription.status),
    checkedAt:checked,
    rows,
    approvedPaymentsVerified:rows.filter(row=>row.payment_approved_verified).length,
    coveragePeriodVerified:false,
    paidThrough:null,
    grantsStudentAccess:false
  };
}
