import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.10";

/**
 * Authenticated self-service cancellation of the student's OWN recurring
 * Mercado Pago subscription. No new charges and no immediate forfeiture of
 * a previously verified paid period. OFF by default until live validation.
 *
 * This operation MUST remain usable independently of the checkout kill switch
 * after launch, so students can stop future charges during an incident.
 */
const BASE = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TOKEN = Deno.env.get("SHAMATHA_MP_PRODUCTION_ACCESS_TOKEN") || "";
const SELLER = Deno.env.get("SHAMATHA_MP_PRODUCTION_SELLER_ID") || "";
const ENABLED = Deno.env.get("SHAMATHA_MP_PRODUCTION_CANCEL_ENABLED") === "true";
const ORIGIN = "https://ttamosauskas.github.io";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8"
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const stop = (reason: string, status = 409): never => {
  throw Object.assign(new Error(reason), { status });
};
const validId = (id: unknown) =>
  typeof id === "string" && /^[A-Za-z0-9_-]{12,80}$/.test(id);

async function provider(path: string, method: "GET"|"PUT", body?: object) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("https://api.mercadopago.com" + path, {
      method,
      headers: {
        Authorization: "Bearer " + TOKEN,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal
    });
    if (!response.ok) stop("MERCADOPAGO_CANCELLATION_UNAVAILABLE", 502);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.headers.get("Origin") && req.headers.get("Origin") !== ORIGIN)
    return json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!ENABLED || !BASE || !SERVICE || !TOKEN || !/^\d+$/.test(SELLER) ||
      SELLER === "3778352536")
    return json({ error: "CANCELLATION_NOT_CONFIGURED" }, 503);
  try {
    const jwt = (req.headers.get("Authorization") || "")
      .replace(/^Bearer\s+/i, "").trim();
    if (!jwt) stop("AUTH_REQUIRED", 401);
    const admin = createClient(BASE, SERVICE,
      { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: auth, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !auth?.user) stop("AUTH_INVALID", 401);
    const userId = auth.user.id;
    // Never read any browser-provided user, subscription, seller or amount.
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("role").eq("id", userId).maybeSingle();
    if (profileError || !profile || profile.role !== "student")
      stop("STUDENT_REQUIRED", 403);
    const { data: subscriptions, error: subError } = await admin
      .from("billing_subscriptions")
      .select("id,mp_preapproval_id,paid_through,provider_status")
      .eq("user_id", userId).eq("environment", "production")
      .order("created_at",{ascending:false}).limit(101);
    if (subError) stop("DATABASE_UNAVAILABLE", 503);
    if (!subscriptions?.length) stop("SUBSCRIPTION_NOT_FOUND", 404);
    if (subscriptions.length>100) stop("SUBSCRIPTION_HISTORY_REQUIRES_REVIEW",409);
    const open = subscriptions.filter(x=>!["canceled","cancelled"].includes(x.provider_status));
    if (open.length!==1) stop("SUBSCRIPTION_STATE_REQUIRES_REVIEW",409);
    const sub = open[0];
    if (!validId(sub.mp_preapproval_id)) stop("SUBSCRIPTION_ID_INVALID", 409);

    const remote = await provider(
      "/preapproval/" + encodeURIComponent(sub.mp_preapproval_id), "GET");
    if (String(remote?.id ?? "") !== sub.mp_preapproval_id ||
        String(remote?.collector_id ?? "") !== SELLER ||
        !remote?.external_reference ||
        !String(remote.external_reference).startsWith("shamatha:production:" + userId + ":"))
      stop("SUBSCRIPTION_OWNERSHIP_MISMATCH", 409);

    const intentId = String(remote.external_reference)
      .slice(("shamatha:production:" + userId + ":").length);
    const { data: intent, error: intentError } = await admin
      .from("billing_checkout_intents")
      .select("id,mp_preapproval_id")
      .eq("id", intentId).eq("user_id", userId)
      .eq("environment", "production").maybeSingle();
    if (intentError || !intent || intent.mp_preapproval_id !== sub.mp_preapproval_id)
      stop("UNVERIFIED_SUBSCRIPTION_LINK", 409);

    const canceled = ["canceled", "cancelled"].includes(remote.status);
    if (!canceled && !["pending", "authorized", "paused"].includes(remote.status))
      stop("SUBSCRIPTION_STATUS_REQUIRES_REVIEW", 409);
    if (!canceled) {
      const changed = await provider(
        "/preapproval/" + encodeURIComponent(sub.mp_preapproval_id),
        "PUT", { status: "canceled" });
      if (String(changed?.id ?? "") !== sub.mp_preapproval_id ||
          !["canceled", "cancelled"].includes(changed.status))
        stop("CANCELLATION_NOT_VERIFIED", 502);
    }

    // Retain the previously paid period. Only a separate server-side payment
    // reconciliation can remove or change it after a refund or chargeback.
    const { error: updateError } = await admin.from("billing_subscriptions")
      .update({ provider_status: "canceled", access_status: "cancelled",
        updated_at: new Date().toISOString() })
      .eq("id", sub.id).eq("user_id", userId)
      .eq("environment", "production");
    if (updateError) stop("CANCELLATION_REQUIRES_REVIEW", 503);
    // Remove the checkout's open-intent lock only AFTER provider confirms the
    // cancellation. The previous payment record/coverage is not rewritten.
    const {error:intentCloseError}=await admin.from("billing_checkout_intents")
      .update({state:"cancelled",updated_at:new Date().toISOString()})
      .eq("id",intent.id).eq("user_id",userId).eq("state","created");
    if(intentCloseError)stop("CHECKOUT_CANCELLATION_STATE_FAILED",503);
    return json({ canceled: true, recurringChargesStopped: true,
      paidThrough: sub.paid_through, accessRevokedImmediately: false });
  } catch (error) {
    const status = Number((error as {status?: number})?.status || 503);
    console.error("cancel subscription failed", String((error as Error)?.message || error).slice(0,100));
    return json({error: status >= 500 ? "CANCELLATION_REQUIRES_SUPPORT" :
      String((error as Error)?.message || "CANCELLATION_FAILED")}, status);
  }
});
