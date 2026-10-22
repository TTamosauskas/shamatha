import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.10";
import { checkStudentCheckoutGate, priorSubscriptionCheckoutGate } from "../_shared/student-checkout-gates.mjs";

/**
 * PREPARATORY CODE ONLY — NOT DEPLOYED. PRODUCTION CHECKOUT DISABLED.
 * No MP charge should occur until owner explicitly approves go-live,
 * authenticated provider notifications, reconciliation and entitlement tests.
 *
 * POST requires authenticated, email-confirmed Supabase STUDENT account.
 * Never accepts user_id, buyer email, merchant token or amount from browser.
 */
const URL_SUPABASE = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PROD_TOKEN = Deno.env.get("SHAMATHA_MP_PRODUCTION_ACCESS_TOKEN") || "";
const PROD_SELLER_ID = Deno.env.get("SHAMATHA_MP_PRODUCTION_SELLER_ID") || "";
const PRODUCTION_ENABLED = Deno.env.get("SHAMATHA_BILLING_PRODUCTION_ENABLED") === "true";
const LAUNCH_APPROVED = Deno.env.get("SHAMATHA_BILLING_FINAL_LAUNCH_APPROVED") === "true";
const CHECKOUT_ENABLED = Deno.env.get("SHAMATHA_MP_PRODUCTION_CREATE_ENABLED") === "true";
const ORIGIN = "https://ttamosauskas.github.io";
const CHECKOUT_BACK_URL = ORIGIN + "/shamatha/minha-assinatura.html?checkout=return";
const AMOUNT_CENTS = 18000;
const TERMS_VERSION = "shamatha-r180-monthly-v1";
// Never allow the previously tested fake seller to receive production checkout requests.
const FAKE_SELLER_ID = "3778352536";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
function halt(reason: string, status = 400): never {
  throw Object.assign(new Error(reason), { status });
}
const admin = createClient(URL_SUPABASE, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function validMercadoPagoCheckout(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      /(^|\.)mercadopago\.(com|com\.br|com\.ar|com\.mx|com\.uy)$/.test(parsed.hostname);
  } catch { return false; }
}
function validSubscriptionId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{12,64}$/.test(id);
}
function validEmail(email: unknown): email is string {
  return typeof email === "string" && email.length <= 255 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
async function mpGet(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + PROD_TOKEN },
      signal: controller.signal
    });
    if (!res.ok) halt("PROVIDER_READ_ERROR", 502);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function requireStudent(req: Request) {
  const jwt = String(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) halt("AUTH_REQUIRED", 401);
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) halt("SESSION_INVALID", 401);
  const authUser = data.user;
  if (!validEmail(authUser.email)) halt("VERIFIED_EMAIL_REQUIRED", 403);
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,role,access_status").eq("id", authUser.id).maybeSingle();
  if (profileError || !profile) halt("PROFILE_NOT_FOUND", 403);
  return { authUser, profile };
}

async function existingOpenIntent(userId: string) {
  const { data, error } = await admin.from("billing_checkout_intents")
    .select("id,state,mp_preapproval_id,checkout_url,terms_version,terms_accepted_at")
    .eq("user_id", userId).eq("environment", "production")
    .in("state", ["creating", "created", "needs_review"]).maybeSingle();
  if (error) halt("INTENT_READ_FAILED", 503);
  return data;
}

async function resumeExisting(intent: {
  id: string; state: string; mp_preapproval_id: string | null;
  checkout_url: string | null;
  terms_version: string | null; terms_accepted_at: string | null
}, userId: string, userEmail: string) {
  if (intent.state !== "created" ||
      intent.terms_version !== TERMS_VERSION || !intent.terms_accepted_at ||
      !validSubscriptionId(intent.mp_preapproval_id) ||
      !validMercadoPagoCheckout(intent.checkout_url)) {
    halt("EXISTING_ATTEMPT_REQUIRES_REVIEW", 409);
  }
  // Never hand back a paid/authorized link, and never create another subscription.
  const remote = await mpGet("https://api.mercadopago.com/preapproval/" +
    encodeURIComponent(intent.mp_preapproval_id));
  if (String(remote.id || "") !== intent.mp_preapproval_id ||
      String(remote.collector_id || "") !== PROD_SELLER_ID ||
      Number(remote.auto_recurring?.transaction_amount) !== 180 ||
      remote.auto_recurring?.currency_id !== "BRL" ||
      String(remote.external_reference ?? "") !== "shamatha:production:" + userId + ":" + intent.id ||
      String(remote.payer_email ?? "").toLowerCase() !== userEmail.toLowerCase()) {
    halt("EXISTING_CHECKOUT_NEEDS_REVIEW", 409);
  }
  if (remote.status !== "pending") {
    return { state: "awaiting_reconciliation", checkoutUrl: null, reused: true };
  }
  return { state: "pending", checkoutUrl: intent.checkout_url, reused: true };
}

async function verifiedSeller() {
  if (PROD_SELLER_ID === FAKE_SELLER_ID) halt("TEST_SELLER_PROHIBITED", 403);
  const me = await mpGet("https://api.mercadolibre.com/users/me");
  if (String(me?.id || "") !== PROD_SELLER_ID) halt("SELLER_ID_MISMATCH", 403);
}

async function markForReview(intentId: string, reason: string) {
  await admin.from("billing_checkout_intents").update({
    state: "needs_review",
    last_error_code: reason.slice(0, 80),
    updated_at: new Date().toISOString()
  }).eq("id", intentId).eq("state", "creating");
}

async function startCheckout(userId: string, userEmail: string) {
  const before = await existingOpenIntent(userId);
  if (before) return resumeExisting(before,userId,userEmail);

  // One cancelled, fully expired subscription can be replaced. Never create
  // another live subscription or charge twice for overlapping paid coverage.
  const { data: linked, error: subscriptionError } = await admin.from("billing_subscriptions")
    .select("mp_preapproval_id,provider_status,paid_through")
    .eq("user_id", userId).eq("environment", "production")
    .limit(101);
  if (subscriptionError) halt("SUBSCRIPTIONS_READ_FAILED", 503);
  const priorGate = priorSubscriptionCheckoutGate(linked || []);
  if (!priorGate.allowed) halt(priorGate.reason, 409);

  // Unique partial index: exactly one open checkout per student and environment,
  // including under concurrent tab requests. No remote call on unique conflict.
  const { data: intent, error: reservationError } = await admin.from("billing_checkout_intents")
    .insert({ user_id: userId, environment: "production", state: "creating",
      terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString() })
    .select("id,idempotency_key").single();
  if (reservationError || !intent) {
    const concurrent = await existingOpenIntent(userId);
    if (concurrent) return resumeExisting(concurrent,userId,userEmail);
    halt("CHECKOUT_RESERVATION_FAILED", 409);
  }

  let errorCode = "REMOTE_CREATION_REQUIRES_REVIEW";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
      response = await fetch("https://api.mercadopago.com/preapproval", {
        method: "POST",
        signal: controller.signal,
      headers: {
        Authorization: "Bearer " + PROD_TOKEN,
        "Content-Type": "application/json",
        "X-Idempotency-Key": String(intent.idempotency_key)
      },
      body: JSON.stringify({
        reason: "Shamatha - assinatura mensal",
        external_reference: "shamatha:production:" + userId + ":" + intent.id,
        payer_email: userEmail,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: AMOUNT_CENTS / 100,
          currency_id: "BRL"
        },
        back_url: CHECKOUT_BACK_URL,
        status: "pending"
      })
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      errorCode = "MP_CREATE_HTTP_" + response.status;
      halt("PROVIDER_CREATION_REQUIRES_REVIEW", 502);
    }
    const remote = await response.json();
    if (!validSubscriptionId(remote?.id) || !validMercadoPagoCheckout(remote?.init_point)) {
      errorCode = "MP_INVALID_SUBSCRIPTION_RESPONSE";
      halt("PROVIDER_CREATION_REQUIRES_REVIEW", 502);
    }

    // Persist identity link as pending. Only provider-verified invoices may
    // later advance access_status and paid_through via a separate reconciler.
    const { error: subscriptionInsertError } = await admin.from("billing_subscriptions").insert({
      user_id: userId,
      environment: "production",
      mp_preapproval_id: remote.id,
      provider_status: "pending",
      access_status: "pending",
      amount_cents: AMOUNT_CENTS,
      currency: "BRL",
      paid_through: null
    });
    if (subscriptionInsertError) {
      errorCode = "LOCAL_SUBSCRIPTION_LINK_FAILED";
      halt("SUBSCRIPTION_LINK_REQUIRES_REVIEW", 502);
    }

    const { data: savedIntent, error: savedError } = await admin.from("billing_checkout_intents").update({
      state: "created",
      mp_preapproval_id: remote.id,
      checkout_url: remote.init_point,
      seller_id: PROD_SELLER_ID,
      updated_at: new Date().toISOString()
    }).eq("id", intent.id).eq("state", "creating")
      .select("id").maybeSingle();
    if (savedError || !savedIntent) {
      errorCode = "LOCAL_CHECKOUT_SAVE_FAILED";
      halt("CHECKOUT_SAVE_REQUIRES_REVIEW", 502);
    }
    return { state: "pending", checkoutUrl: remote.init_point, reused: false };
  } catch (error) {
    // Timeouts and uncertain provider outcomes must NOT be retried automatically.
    await markForReview(intent.id, errorCode);
    throw error;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.headers.get("Origin") && req.headers.get("Origin") !== ORIGIN) {
    return json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
  }
  try {
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

    // Kill switches checked BEFORE any paid provider request or database write.
    const operational = checkStudentCheckoutGate({
      productionEnabled: PRODUCTION_ENABLED,
      launchApproved: LAUNCH_APPROVED,
      checkoutEnabled: CHECKOUT_ENABLED,
      sellerConfigured: !!PROD_TOKEN && /^\d+$/.test(PROD_SELLER_ID) && PROD_SELLER_ID !== FAKE_SELLER_ID,
      role: "student", isVerifiedEmail: true
    });
    if (!operational.allowed) halt(operational.reason, 503);
    if (!URL_SUPABASE || !SERVICE_KEY) halt("SERVER_NOT_CONFIGURED", 503);

    const { authUser, profile } = await requireStudent(req);
    const { data: exemption, error: exemptError } = await admin.from("billing_exemptions")
      .select("user_id").eq("user_id", authUser.id).maybeSingle();
    if (exemptError) halt("EXEMPTION_READ_FAILED", 503);
    const eligibility = checkStudentCheckoutGate({
      productionEnabled: PRODUCTION_ENABLED,
      launchApproved: LAUNCH_APPROVED,
      checkoutEnabled: CHECKOUT_ENABLED,
      sellerConfigured: !!PROD_TOKEN && /^\d+$/.test(PROD_SELLER_ID) && PROD_SELLER_ID !== FAKE_SELLER_ID,
      role: profile.role,
      isVerifiedEmail: !!authUser.email_confirmed_at,
      administrativeStatus: profile.access_status,
      isExempt: !!exemption
    });
    if (!eligibility.allowed) halt(eligibility.reason, 403);

    // The ONLY accepted user-controlled input is an explicit acceptance of
    // this exact contract version. Never read identity, price or seller from it.
    const consent=await req.json().catch(()=>null);
    if(consent?.acceptTerms!==true || consent?.termsVersion!==TERMS_VERSION)
      halt("SUBSCRIPTION_TERMS_ACCEPTANCE_REQUIRED", 400);
    await verifiedSeller();
    const checkout = await startCheckout(authUser.id, String(authUser.email).toLowerCase());
    return json({
      productionBillingEnabled: true,
      amountCents: AMOUNT_CENTS,
      currency: "BRL",
      ...checkout,
      grantsStudentAccess: false
    });
  } catch (error) {
    const status = Number((error as { status?: number })?.status || 500);
    if (status >= 500) console.error("student checkout blocked or failed", String((error as Error).message || error));
    return json({ error: status >= 500
      ? "CHECKOUT_UNAVAILABLE_CONTACT_EDITOR"
      : String((error as Error).message || "INVALID_REQUEST") }, status);
  }
});
