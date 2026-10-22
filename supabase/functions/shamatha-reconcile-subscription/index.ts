import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.10";
import { verifyLiveMonthlyPayments } from "../_shared/mp-live-monthly-evidence.mjs";

/**
 * Authenticated, on-demand reconciliation of the CURRENT student's provider
 * invoices. No browser-supplied IDs, amounts, paid-through or access flags.
 * No checkout or charges. Disabled by default until the entire MVP is tested.
 */
const BASE=Deno.env.get('SUPABASE_URL')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const TOKEN=Deno.env.get('SHAMATHA_MP_PRODUCTION_ACCESS_TOKEN')||'';
const SELLER=Deno.env.get('SHAMATHA_MP_PRODUCTION_SELLER_ID')||'';
const ENABLED=Deno.env.get('SHAMATHA_BILLING_RECONCILE_ENABLED')==='true';
const ORIGIN='https://ttamosauskas.github.io';
const headers={
  'Access-Control-Allow-Origin':ORIGIN,
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Cache-Control':'no-store','Content-Type':'application/json'
};
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers});
const stop=(reason,status=409)=>{throw Object.assign(new Error(reason),{status})};
const sb=createClient(BASE,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{12,80}$/.test(x);
async function get(url){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const res=await fetch(url,{signal:controller.signal,
      headers:{Authorization:'Bearer '+TOKEN,'Accept':'application/json'}});
    if(!res.ok)stop('MERCADOPAGO_READ_FAILED',502);
    return await res.json();
  }finally{clearTimeout(timeout)}
}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.headers.get('Origin')&&req.headers.get('Origin')!==ORIGIN)
    return json({error:'ORIGIN_NOT_ALLOWED'},403);
  if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  if(!ENABLED||!BASE||!SERVICE||!TOKEN||!/^\d+$/.test(SELLER)||SELLER==='3778352536')
    return json({error:'BILLING_RECONCILIATION_DISABLED'},503);
  try{
    const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!jwt)stop('AUTH_REQUIRED',401);
    const {data:{user},error:authError}=await sb.auth.getUser(jwt);
    if(authError||!user||!user.email_confirmed_at)stop('SESSION_NOT_VERIFIED',401);
    const [{data:profile,error:profileError},{data:subList,error:subError}]=await Promise.all([
      sb.from('profiles').select('id,role,access_status,email').eq('id',user.id).maybeSingle(),
      sb.from('billing_subscriptions').select('id,mp_preapproval_id')
        .eq('user_id',user.id).eq('environment','production').limit(3)
    ]);
    if(profileError||subError)stop('DATABASE_UNAVAILABLE',503);
    if(!profile||profile.role!=='student')stop('STUDENT_ONLY',403);
    if(!subList?.length)return json({state:'no_subscription',paidThrough:null,accessGranted:false});
    if(subList.length!==1)stop('MULTIPLE_SUBSCRIPTIONS_REVIEW',409);
    const sub=subList[0];
    if(!validId(sub.mp_preapproval_id))stop('BAD_SUBSCRIPTION_REFERENCE',409);
    // Get subscription, exhaustive first <=12 invoices and each payment by ID.
    const remote=await get('https://api.mercadopago.com/preapproval/'+encodeURIComponent(sub.mp_preapproval_id));
    if(String(remote?.id??'')!==sub.mp_preapproval_id)
      stop('SUBSCRIPTION_ID_MISMATCH',409);
    const search=await get('https://api.mercadopago.com/authorized_payments/search?preapproval_id='+
      encodeURIComponent(sub.mp_preapproval_id)+'&limit=12&offset=0');
    if(!Array.isArray(search?.results))stop('INVALID_PROVIDER_INVOICES',502);
    const paymentsById={};
    for(const invoice of search.results){
      const id=String(invoice?.payment?.id??'');
      if(id&&!/^\d{1,30}$/.test(id))stop('INVALID_PAYMENT_ID',409);
      if(id&&!paymentsById[id])
        paymentsById[id]=await get('https://api.mercadopago.com/v1/payments/'+id);
    }
    const intentRef=String(remote?.external_reference||'');
    const prefix='shamatha:production:'+user.id+':';
    if(!intentRef.startsWith(prefix))stop('SUBSCRIPTION_OWNER_MISMATCH',409);
    const intentId=intentRef.slice(prefix.length);
    const {data:intent,error:intentError}=await sb.from('billing_checkout_intents')
      .select('id,user_id,mp_preapproval_id')
      .eq('id',intentId).eq('user_id',user.id).eq('environment','production').maybeSingle();
    if(intentError||!intent||String(intent.mp_preapproval_id)!==sub.mp_preapproval_id)
      stop('UNVERIFIED_CHECKOUT_LINK',409);
    const audit=verifyLiveMonthlyPayments({
      userId:user.id,email:String(user.email).toLowerCase(),
      sellerId:SELLER,localSubscriptionId:intent.id,
      providerSubscription:remote,invoiceSearch:search,paymentsById
    });
    // Only server-verified payment facts reach tables used by the RLS gate.
    for(const row of audit.rows){
      const {error}=await sb.from('billing_payments')
        .upsert({subscription_id:sub.id,...row},
          {onConflict:'mp_authorized_payment_id'});
      if(error)stop('PAYMENT_PERSIST_FAILED',503);
    }
    const now=Date.now();
    const active=audit.paidThrough&&Date.parse(audit.paidThrough)>now;
    const display=remote.status==='paused'?'paused':
      ['cancelled','canceled'].includes(remote.status)?'cancelled':
      active?'active':audit.rows.length?'overdue':'pending';
    const {error:updateError}=await sb.from('billing_subscriptions').update({
      provider_status:String(remote.status),
      access_status:display,
      paid_through:audit.paidThrough,
      next_payment_at:remote.next_payment_date||null,
      last_checked_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    }).eq('id',sub.id).eq('user_id',user.id);
    if(updateError)stop('SUBSCRIPTION_PERSIST_FAILED',503);
    return json({state:display,paidThrough:audit.paidThrough,
      checkedInvoices:audit.rows.length,
      grantsStudentAccess:false,verification:'provider_checked'});
  }catch(err){
    const status=Number(err?.status||503);
    console.error('billing student reconciliation failed',String(err?.message||err).slice(0,120));
    return json({error:status>=500?'BILLING_VERIFICATION_UNAVAILABLE':
      String(err?.message||'INVALID_REQUEST')},status);
  }
});
