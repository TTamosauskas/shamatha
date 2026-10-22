import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.10";
import { checkStudentCheckoutGate } from "../_shared/student-checkout-gates.mjs";

/**
 * Shamatha first-party student checkout, intentionally INERT on merge.
 * DO NOT DEPLOY/ENABLE before production payment reconciliation and RLS gates.
 * Never use the previously tested fake seller account or its credential here.
 *
 * Safe runtime contract: GET reports readiness; POST reserves ONE checkout
 * for the authenticated non-exempt student only. No grants or access writes.
 */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_ORIGIN = "https://ttamosauskas.github.io";
const BACK_URL = SITE_ORIGIN + "/shamatha/minha-assinatura.html?retorno_mp=1";
const MP_URL = "https://api.mercadopago.com";
const FAKE_SELLER_ID = "3778352536";
const AMOUNT_CENTS = 18000;

const headers = {
  "Access-Control-Allow-Origin": SITE_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
};
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}
function fail(reason: string, status = 400): never {
  throw Object.assign(new Error(reason), { status });
}
function isMPCheckout(url: unknown) {
  if(typeof url !== "string" || url.length > 2048)return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password &&
      /(^|\.)mercadopago\.(com|com\.br|com\.ar|com\.mx|com\.uy)$/.test(u.hostname);
  } catch { return false; }
}
function flags() {
  const productionEnabled = Deno.env.get("SHAMATHA_MP_PRODUCTION_BILLING_ENABLED") === "true";
  const launchApproved = Deno.env.get("SHAMATHA_MP_PRODUCTION_LAUNCH_APPROVED") === "true";
  const checkoutEnabled = Deno.env.get("SHAMATHA_MP_PRODUCTION_CHECKOUT_ENABLED") === "true";
  const sellerId = Deno.env.get("SHAMATHA_MP_PRODUCTION_SELLER_ID") || "";
  const token = Deno.env.get("SHAMATHA_MP_PRODUCTION_SELLER_TOKEN") || "";
  const sellerConfigured = /^\d+$/.test(sellerId) && sellerId !== FAKE_SELLER_ID &&
    token.length > 24;
  return { productionEnabled, launchApproved, checkoutEnabled, sellerConfigured, sellerId, token };
}
async function mp(path: string, token: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(MP_URL + path, {
      ...init,
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        ...(init.headers || {})
      },
      signal: controller.signal
    });
    if(!response.ok)fail("PROVIDER_HTTP_" + response.status, 502);
    return await response.json();
  } finally { clearTimeout(timer); }
}
async function identifyStudent(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  if(!/^Bearer\s+\S+$/i.test(authorization))fail("SESSION_REQUIRED",401);
  const jwt = authorization.replace(/^Bearer\s+/i,"");
  const { data, error } = await admin.auth.getUser(jwt);
  const user = data?.user;
  if(error || !user)fail("SESSION_INVALID",401);
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,role,access_status")
    .eq("id",user.id).maybeSingle();
  if(profileError || !profile)fail("PROFILE_UNAVAILABLE",403);
  const { data: exemption, error: exemptionError } = await admin.from("billing_exemptions")
    .select("user_id").eq("user_id",user.id).maybeSingle();
  if(exemptionError)fail("EXEMPTION_UNAVAILABLE",503);
  return { user, profile, isExempt: Boolean(exemption) };
}
async function existingState(userId: string) {
  const [subs, intents] = await Promise.all([
    admin.from("billing_subscriptions").select("id")
      .eq("user_id",userId).eq("environment","production").limit(1),
    admin.from("billing_checkout_intents")
      .select("id,state,checkout_url,mp_preapproval_id")
      .eq("user_id",userId).eq("environment","production")
      .in("state",["creating","created","needs_review"])
      .limit(1)
  ]);
  if(subs.error || intents.error)fail("BILLING_LOOKUP_UNAVAILABLE",503);
  return { hasSubscription: (subs.data || []).length > 0, intent: intents.data?.[0] || null };
}
async function getSeller(token: string, expectedId: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),10000);
  try {
    const response = await fetch("https://api.mercadolibre.com/users/me", {
      headers: {"Authorization":"Bearer "+token},signal:controller.signal
    });
    if(!response.ok)fail("SELLER_VERIFY_UNAVAILABLE",502);
    const seller=await response.json();
    if(String(seller?.id??"")!==expectedId)fail("SELLER_MISMATCH",403);
  } finally {clearTimeout(timer);}
}
async function checkout(req: Request) {
  const { user, profile, isExempt } = await identifyStudent(req);
  const config = flags();
  // Kill switches precede all provider network calls and database writes.
  const precheck = checkStudentCheckoutGate({
    ...config,
    role:profile.role,
    isVerifiedEmail:Boolean(user.email_confirmed_at),
    administrativeStatus:profile.access_status,
    isExempt,
    hasExistingSubscription:false
  });
  if(!precheck.allowed)fail(precheck.reason,403);
  const state = await existingState(user.id);
  if(state.hasSubscription)fail("EXISTING_SUBSCRIPTION",409);
  if(state.intent) {
    if(state.intent.state === "created" && isMPCheckout(state.intent.checkout_url)){
      // No second create: the existing payment flow can be resumed.
      return json({checkoutUrl:state.intent.checkout_url,reused:true,amountCents:AMOUNT_CENTS});
    }
    fail("CHECKOUT_REQUIRES_REVIEW",409);
  }
  await getSeller(config.token,config.sellerId);
  const { data: intent, error: insertError } = await admin.from("billing_checkout_intents")
    .insert({user_id:user.id,environment:"production",state:"creating",
      seller_id:config.sellerId})
    .select("id,idempotency_key").single();
  if(insertError || !intent)fail("CHECKOUT_RESERVATION_FAILED",409);
  try {
    const response=await mp("/preapproval",config.token,{
      method:"POST",
      headers:{"X-Idempotency-Key":intent.idempotency_key},
      body:JSON.stringify({
        reason:"Centro Pineal - Shamatha - mensalidade",
        external_reference:"shamatha:production:"+user.id+":"+intent.id,
        payer_email:user.email,
        auto_recurring:{frequency:1,frequency_type:"months",
          transaction_amount:180,currency_id:"BRL"},
        status:"pending",back_url:BACK_URL
      })
    });
    if(typeof response?.id!=="string" ||
      !/^[A-Za-z0-9_-]{12,64}$/.test(response.id) ||
      !isMPCheckout(response.init_point) ||
      String(response.collector_id??"")!==config.sellerId) {
      fail("CHECKOUT_UNEXPECTED_PROVIDER_RESPONSE",502);
    }
    const {error:updateError}=await admin.from("billing_checkout_intents").update({
      state:"created",mp_preapproval_id:response.id,
      checkout_url:response.init_point,updated_at:new Date().toISOString()
    }).eq("id",intent.id).eq("state","creating");
    if(updateError)fail("CHECKOUT_LOCAL_CONFIRMATION_FAILED",502);
    return json({checkoutUrl:response.init_point,reused:false,
      amountCents:AMOUNT_CENTS,environment:"production"});
  } catch(error) {
    // A failed/unknown result may still have created a subscription remotely.
    // NEVER retry automatically or issue a new checkout for this student.
    await admin.from("billing_checkout_intents").update({
      state:"needs_review",
      last_error_code:"PROVIDER_OR_CONFIRMATION_UNCERTAIN",
      updated_at:new Date().toISOString()
    }).eq("id",intent.id).eq("state","creating");
    throw error;
  }
}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
  const origin=req.headers.get("Origin");
  if(origin && origin!==SITE_ORIGIN)return json({error:"ORIGIN_FORBIDDEN"},403);
  if(!["GET","POST"].includes(req.method))return json({error:"METHOD_NOT_ALLOWED"},405);
  try {
    if(req.method==="GET"){
      const { user, profile, isExempt } = await identifyStudent(req);
      const config=flags();
      const state=await existingState(user.id);
      const gate=checkStudentCheckoutGate({
        ...config,
        role:profile.role,
        isVerifiedEmail:Boolean(user.email_confirmed_at),
        administrativeStatus:profile.access_status,
        isExempt,
        hasExistingSubscription:state.hasSubscription
      });
      return json({enabled:gate.allowed,
        reason:gate.reason,
        hasExistingSubscription:state.hasSubscription,
        amountCents:AMOUNT_CENTS,monthly:true,
        checkoutAlreadyStarted:Boolean(state.intent)});
    }
    const body=await req.json().catch(()=>({}));
    if(body?.action!=="create_checkout")fail("ACTION_REQUIRED",400);
    return await checkout(req);
  } catch(error) {
    const status=Number((error as {status?:number})?.status)||500;
    if(status>=500)console.error("student checkout unavailable",status);
    return json({error:status>=500?"CHECKOUT_TEMPORARILY_UNAVAILABLE":
      String((error as Error)?.message||"INVALID_REQUEST")},status);
  }
});
