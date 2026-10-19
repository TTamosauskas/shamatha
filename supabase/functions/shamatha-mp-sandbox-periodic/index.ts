import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.10";
import { verifySandboxInvoices } from "../_shared/mercadopago-sandbox-invoices.mjs";

/**
 * STAGED, NOT DEPLOYED/SCHEDULED. Strictly fake seller + sandbox observation table.
 *
 * Future pg_cron + pg_net caller will use Authorization: Bearer <Vault secret>.
 * verify_jwt=false is required ONLY when using this independently verified
 * shared secret. Never configure CORS or reuse publishable/anon JWT for cron.
 * This function MUST NOT be scheduled until both a protected secret and
 * SHAMATHA_MP_SANDBOX_AUTO_RECONCILE_ENABLED=true are deliberately configured.
 *
 * No checkout, cancellation, real billing, paid_through, student access or RLS.
 */
const URL=Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MP_TOKEN=Deno.env.get("SHAMATHA_MP_SANDBOX_SELLER_TOKEN") || "";
const CRON_SECRET=Deno.env.get("SHAMATHA_MP_SANDBOX_CRON_SECRET") || "";
const ENABLED=Deno.env.get("SHAMATHA_MP_SANDBOX_AUTO_RECONCILE_ENABLED")==="true";
const SELLER_ID="3778352536";
const FAKEMERCHANT_URL="https://api.mercadolibre.com/users/me";
const MP_URL="https://api.mercadopago.com";
const admin=createClient(URL,SERVICE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const noCache={ "Cache-Control":"no-store", "Content-Type":"application/json" };
function response(code:number,body:unknown){return new Response(JSON.stringify(body),{status:code,headers:noCache});}
function fail(msg:string,code=503):never{throw Object.assign(new Error(msg),{status:code});}

async function equalSecret(expected:string,header:string):Promise<boolean>{
  if(!expected||expected.length<32||expected.length>256||header.length>300)return false;
  const match=/^Bearer ([A-Za-z0-9._~-]{32,256})$/.exec(header);
  if(!match)return false;
  const hash=async(s:string)=>new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
  const a=await hash(expected),b=await hash(match[1]);
  let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a[i]^b[i];
  return mismatch===0;
}

async function getProvider(url:string,stage:string):Promise<Record<string,any>>{
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  try{
    const result=await fetch(url,{
      headers:{"Authorization":"Bearer "+MP_TOKEN},signal:controller.signal
    });
    if(!result.ok){
      console.error("scheduled sandbox MP query failed",stage,result.status);
      fail("MERCADO_PAGO_QUERY_FAILED");
    }
    const data=await result.json();
    if(!data||typeof data!=="object"||Array.isArray(data))fail("INVALID_PROVIDER_RESPONSE");
    return data;
  }finally{clearTimeout(timeout);}
}

async function reconcile(attempt:{
  id:string;editor_id:string;payer_email:string;mp_preapproval_id:string;
}){
  if(!/^[a-zA-Z0-9_-]{12,64}$/.test(attempt.mp_preapproval_id||""))fail("INVALID_SUBSCRIPTION_ID");
  const subscription=await getProvider(MP_URL+"/preapproval/"+encodeURIComponent(attempt.mp_preapproval_id),"subscription");
  const invoices=await getProvider(MP_URL+"/authorized_payments/search?preapproval_id="+
    encodeURIComponent(attempt.mp_preapproval_id)+"&limit=10","invoices");
  if(!Array.isArray(invoices.results))fail("INVALID_INVOICES");
  const paymentsById:Record<string,unknown>={};
  for(const invoice of invoices.results){
    const paymentId=String(invoice?.payment?.id??"");
    if(!paymentId)continue;
    if(!/^\d{1,30}$/.test(paymentId))fail("INVALID_PAYMENT_ID");
    if(!paymentsById[paymentId]){
      paymentsById[paymentId]=await getProvider(MP_URL+"/v1/payments/"+paymentId,"payment");
    }
  }
  const audit=verifySandboxInvoices({
    subscription,invoiceSearch:invoices,paymentsById,attempt,expectedSellerId:SELLER_ID,
    checkedAt:new Date().toISOString()
  });
  // Atomic upsert per unique MP invoice ID; refresh status on every run.
  if(audit.rows.length){
    const {error}=await admin.from("billing_sandbox_invoice_observations")
      .upsert(audit.rows,{onConflict:"mp_invoice_id"});
    if(error)fail("INVOICE_LEDGER_WRITE_FAILED");
  }
  const {data:saved,error:attemptError}=await admin.from("billing_sandbox_attempts")
    .update({last_provider_status:audit.providerStatus,last_checked_at:audit.checkedAt})
    .eq("id",attempt.id).eq("editor_id",attempt.editor_id).eq("state","created")
    .select("id").maybeSingle();
  if(attemptError||!saved)fail("SANDBOX_ATTEMPT_UPDATE_FAILED");
  return {invoices:audit.rows.length,approvedPaymentsVerified:audit.approvedPaymentsVerified};
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return response(405,{error:"METHOD_NOT_ALLOWED"});
  // The most important no-billing gate: OFF until deliberate activation.
  if(!ENABLED)return response(503,{error:"SANDBOX_CRON_DISABLED"});
  if(!URL||!SERVICE_KEY||!MP_TOKEN||!CRON_SECRET)return response(503,{error:"SANDBOX_CRON_UNCONFIGURED"});
  if(req.headers.has("Origin"))return response(403,{error:"BROWSER_ORIGIN_NOT_ALLOWED"});
  if(!await equalSecret(CRON_SECRET,req.headers.get("Authorization")||"")){
    return response(401,{error:"INVALID_CRON_AUTH"});
  }
  try{
    const seller=await getProvider(FAKEMERCHANT_URL,"seller");
    if(String(seller.id??"")!==SELLER_ID)fail("NOT_FAKE_SELLER");
    const {data:attempts,error}=await admin.from("billing_sandbox_attempts")
      .select("id,editor_id,payer_email,mp_preapproval_id")
      .eq("state","created").order("created_at",{ascending:true}).limit(11);
    if(error||!attempts)fail("ATTEMPTS_READ_FAILED");
    // Prototype refuses incomplete pagination instead of silently skipping it.
    if(attempts.length>10)fail("TOO_MANY_ATTEMPTS_PAGINATION_REQUIRED");
    let invoices=0,approved=0;
    for(const attempt of attempts){
      const result=await reconcile(attempt);
      invoices+=result.invoices;approved+=result.approvedPaymentsVerified;
    }
    return response(200,{
      sandbox:true,checkedSubscriptions:attempts.length,
      observedInvoices:invoices,approvedPaymentsVerified:approved,
      grantsStudentAccess:false,paidThrough:null
    });
  }catch(error){
    const code=Number((error as {status?:number})?.status||503);
    console.error("sandbox cron reconciliation failed",String((error as Error)?.message||"error"));
    return response(code>=500?503:code,{error:"RECONCILIATION_REQUIRES_REVIEW"});
  }
});
