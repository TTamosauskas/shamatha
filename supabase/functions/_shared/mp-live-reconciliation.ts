import { verifyLiveMonthlyPayments } from "./mp-live-monthly-evidence.mjs";
import { collectAuthorizedInvoicePages, currentCycleCandidatePaymentIds } from "./mp-live-invoice-pages.mjs";

/**
 * Shared server-only reconciliation. Caller MUST authorize the Supabase student
 * JWT or an independent secret for periodic batch execution. Browser never
 * supplies subscription ID, seller, price, paidThrough, or ownership.
 */
const stop=(code,status=409)=>{throw Object.assign(new Error(code),{status});};
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{12,80}$/.test(x);
export async function reconcileLiveStudent({sb,userId,email,token,seller,nowMs=Date.now(),subscriptionId=null}){
  if(!sb||!validId(userId)||!email||!token||!/^\d+$/.test(seller)||
      seller==='3778352536'||!Number.isFinite(nowMs))
    stop('BILLING_RECONCILIATION_NOT_CONFIGURED',503);
  const get=async path=>{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const res=await fetch('https://api.mercadopago.com'+path,{
        signal:controller.signal,
        headers:{Authorization:'Bearer '+token,Accept:'application/json'}
      });
      if(!res.ok)stop('MERCADOPAGO_READ_FAILED',502);
      return await res.json();
    }finally{clearTimeout(timeout);}
  };
  const subscriptionQuery=sb.from('billing_subscriptions')
    .select('id,mp_preapproval_id')
    .eq('user_id',userId).eq('environment','production')
    .order('created_at',{ascending:false})
    .order('id',{ascending:false}).limit(1);
  // The scheduled job reconciles each row independently. A student's own
  // login instead checks the most recent subscription in their account.
  if(subscriptionId){
    if(!validId(subscriptionId))stop('BAD_SUBSCRIPTION_REFERENCE',409);
    subscriptionQuery.eq('id',subscriptionId);
  }
  const [{data:profile,error:profileError},{data:sub,error:subError}]=await Promise.all([
    sb.from('profiles').select('id,role,access_status').eq('id',userId).maybeSingle(),
    subscriptionQuery.maybeSingle()
  ]);
  if(profileError||subError)stop('DATABASE_UNAVAILABLE',503);
  if(!profile||profile.role!=='student')stop('STUDENT_ONLY',403);
  if(!sub){
    if(subscriptionId)stop('SUBSCRIPTION_NOT_FOUND',404);
    return {state:'no_subscription',paidThrough:null,accessGranted:false};
  }
  if(!validId(sub.mp_preapproval_id))stop('BAD_SUBSCRIPTION_REFERENCE',409);
  const remote=await get('/preapproval/'+encodeURIComponent(sub.mp_preapproval_id));
  if(String(remote?.id??'')!==sub.mp_preapproval_id)
    stop('SUBSCRIPTION_ID_MISMATCH',409);
  const intentRef=String(remote?.external_reference??'');
  const prefix='shamatha:production:'+userId+':';
  if(!intentRef.startsWith(prefix))stop('SUBSCRIPTION_OWNER_MISMATCH',409);
  const intentId=intentRef.slice(prefix.length);
  if(!validId(intentId))stop('INVALID_CHECKOUT_REFERENCE',409);
  const {data:intent,error:intentError}=await sb.from('billing_checkout_intents')
    .select('id,user_id,mp_preapproval_id')
    .eq('id',intentId).eq('user_id',userId)
    .eq('environment','production').maybeSingle();
  if(intentError||!intent||String(intent.mp_preapproval_id)!==sub.mp_preapproval_id)
    stop('UNVERIFIED_CHECKOUT_LINK',409);

  const invoiceSearch=await collectAuthorizedInvoicePages({
    getPage:({limit,offset})=>get('/authorized_payments/search?preapproval_id='+
      encodeURIComponent(sub.mp_preapproval_id)+'&limit='+limit+'&offset='+offset),
    maxInvoices:240,pageSize:20
  });
  const paymentIds=currentCycleCandidatePaymentIds(invoiceSearch.results,nowMs);
  const paymentsById={};
  // No need to request historical payments outside the possible active period.
  // All invoice metadata remains validated and no historical evidence grants
  // CURRENT access. Recheck current payments on every on-demand/periodic run.
  for(const id of paymentIds)
    paymentsById[id]=await get('/v1/payments/'+encodeURIComponent(id));
  const audit=verifyLiveMonthlyPayments({
    userId,email:String(email).toLowerCase(),sellerId:seller,
    localSubscriptionId:intent.id,providerSubscription:remote,
    invoiceSearch,paymentsById,nowMs
  });
  for(const row of audit.rows){
    const {error}=await sb.from('billing_payments')
      .upsert({subscription_id:sub.id,...row},{onConflict:'mp_authorized_payment_id'});
    if(error)stop('PAYMENT_PERSIST_FAILED',503);
  }
  const active=audit.paidThrough&&Date.parse(audit.paidThrough)>nowMs;
  const display=remote.status==='paused'?'paused':
    ['cancelled','canceled'].includes(remote.status)?'cancelled':
    active?'active':audit.totalInvoices?'overdue':'pending';
  const {error:updateError}=await sb.from('billing_subscriptions').update({
    provider_status:String(remote.status),
    access_status:display,
    paid_through:audit.paidThrough,
    next_payment_at:remote.next_payment_date||null,
    last_checked_at:new Date(nowMs).toISOString(),
    updated_at:new Date(nowMs).toISOString()
  }).eq('id',sub.id).eq('user_id',userId);
  if(updateError)stop('SUBSCRIPTION_PERSIST_FAILED',503);
  // A provider-confirmed cancellation retires this open checkout intent,
  // permitting a new independent subscription AFTER the paid period expires.
  if(['canceled','cancelled'].includes(remote.status)){
    const {error:closeError}=await sb.from('billing_checkout_intents')
      .update({state:'cancelled',updated_at:new Date(nowMs).toISOString()})
      .eq('id',intent.id).eq('user_id',userId).eq('state','created');
    if(closeError)stop('CHECKOUT_CANCELLATION_STATE_FAILED',503);
  }
  return {
    state:display,paidThrough:audit.paidThrough,
    checkedInvoices:audit.rows.length,totalInvoices:audit.totalInvoices,
    grantsStudentAccess:false,verification:'provider_checked'
  };
}
