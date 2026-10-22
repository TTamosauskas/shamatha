/**
 * Verifies live Mercado Pago subscription, invoices, and individually fetched
 * payments. MUST receive provider responses from authenticated server calls.
 * Coverage is a Shamatha contractual calendar-month policy, not an MP field.
 */
const validId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{12,80}$/.test(x);
const numeric=x=>/^\d{1,30}$/.test(String(x??''))?String(x):null;
const exactly180=x=>Number(x)===180 && x!==null && x!==undefined && String(x).trim()!=='';
const toTime=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
const nextFromAnchor=(anchor,n)=>{
  const a=new Date(anchor),y=a.getUTCFullYear(),m=a.getUTCMonth(),d=a.getUTCDate();
  const first=new Date(Date.UTC(y,m+n,1));
  const endDay=new Date(Date.UTC(y,m+n+1,0)).getUTCDate();
  first.setUTCDate(Math.min(d,endDay));
  first.setUTCHours(a.getUTCHours(),a.getUTCMinutes(),a.getUTCSeconds(),a.getUTCMilliseconds());
  return first.getTime();
};
export function verifyLiveMonthlyPayments({
  userId,email,sellerId,localSubscriptionId,providerSubscription,
  invoiceSearch,paymentsById={}
}={}){
  if(!validId(userId)||!validId(localSubscriptionId)||!/^\d+$/.test(String(sellerId??''))||
      typeof email!=='string'||!email.includes('@'))throw Error('INVALID_OWNER');
  const s=providerSubscription;
  if(!s||!validId(String(s.id??''))||
      String(s.collector_id)!==String(sellerId)||
      String(s.external_reference)!=='shamatha:production:'+userId+':'+localSubscriptionId||
      String(s.payer_email||'').toLowerCase()!==email.toLowerCase()||
      !exactly180(s.auto_recurring?.transaction_amount)||
      s.auto_recurring?.currency_id!=='BRL'||
      Number(s.auto_recurring?.frequency)!==1||
      s.auto_recurring?.frequency_type!=='months')throw Error('SUBSCRIPTION_MISMATCH');
  if(!['pending','authorized','paused','cancelled','canceled'].includes(s.status))throw Error('UNKNOWN_SUBSCRIPTION_STATUS');
  const raw=invoiceSearch?.results, total=Number(invoiceSearch?.paging?.total ?? raw?.length);
  if(!Array.isArray(raw)||raw.length>12||total!==raw.length||total>12)throw Error('INVOICE_BATCH_UNSAFE');
  const seen=new Set(),seenPay=new Set();
  const all=raw.map(invoice=>{
    const id=numeric(invoice?.id),paymentId=numeric(invoice?.payment?.id),debit=toTime(invoice?.debit_date);
    if(!id||seen.has(id)||String(invoice.preapproval_id)!==String(s.id)||
      !exactly180(invoice.transaction_amount)||invoice.currency_id!=='BRL'||debit===null)
      throw Error('INVOICE_MISMATCH');
    seen.add(id);
    if(paymentId&&seenPay.has(paymentId))throw Error('DUPLICATE_PAYMENT');
    if(paymentId)seenPay.add(paymentId);
    const payment=paymentId?paymentsById[paymentId]:null;
    if(paymentId&&!payment)throw Error('PAYMENT_NOT_FETCHED');
    if(payment&&(numeric(payment.id)!==paymentId||
       String(payment.collector_id)!==String(sellerId)||
       !exactly180(payment.transaction_amount)||payment.currency_id!=='BRL'))
       throw Error('PAYMENT_MISMATCH');
    const status=String(payment?.status||'pending').toLowerCase();
    const approved=!!payment&&status==='approved'&&invoice.payment?.status==='approved'&&invoice.status==='processed';
    const approvedAt=toTime(payment?.date_approved);
    return {id,paymentId,debit,status,approved:approved&&approvedAt!==null,approvedAt};
  }).sort((a,b)=>a.debit-b.debit);
  const anchor=all[0]?.debit??null,rows=[];
  for(let i=0;i<all.length;i++){
    const a=all[i];
    const start=nextFromAnchor(anchor,i),end=nextFromAnchor(anchor,i+1);
    // Any shifted debit/retry requires manual review; never infer more coverage.
    if(a.debit!==start||end<=start)throw Error('CYCLE_SHIFT_REVIEW');
    const valid=a.approved&&a.approvedAt>=a.debit&&a.approvedAt<end;
    rows.push({
      mp_authorized_payment_id:a.id,mp_payment_id:a.paymentId,
      provider_status:a.status,amount_cents:18000,currency:'BRL',
      period_start:valid?new Date(start).toISOString():null,
      period_end:valid?new Date(end).toISOString():null,
      confirmed_at:valid?new Date(a.approvedAt).toISOString():null
    });
  }
  return {providerStatus:s.status,rows,
    approvedPeriods:rows.filter(x=>x.period_end).length,
    paidThrough:rows.filter(x=>x.period_end)
      .map(x=>x.period_end).sort().at(-1)??null};
}
