import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.10";
import { verifyMercadoPagoSignature } from "../_shared/mercadopago-webhook-signature.mjs";
import { validateSandboxWebhook } from "../_shared/mercadopago-sandbox-webhook-payload.mjs";

// STAGED ONLY: DO NOT DEPLOY until an official delivery path and secret for
// POST /preapproval notifications is confirmed for the fake seller.
// Inbound HMAC + strict private inbox ONLY. No production access grants.
const URL_SUPABASE = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TEST_SECRET = Deno.env.get("SHAMATHA_MP_SANDBOX_WEBHOOK_SECRET") || "";
const enabled = Deno.env.get("SHAMATHA_MP_SANDBOX_WEBHOOK_ENABLED") === "true";
const TEST_SELLER_ID = "3778352536";
const MAX_BODY = 16384;
const admin = createClient(URL_SUPABASE, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function reply(status: number, message: string): Response {
  return Response.json({ ok: status >= 200 && status < 300, message }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}
function numericOrSubscriptionId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

async function bodyLimited(req: Request): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  let received = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      received += part.value.byteLength;
      if (received > MAX_BODY) throw new Error("payload_too_large");
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, "method_not_allowed");
  if (!enabled || !TEST_SECRET || !SERVICE_KEY || !URL_SUPABASE) {
    return reply(503, "sandbox_webhook_disabled");
  }
  if (req.headers.has("Origin")) return reply(403, "browser_origin_not_allowed");
  let dataId = "";
  try {
    const url = new URL(req.url);
    dataId = url.searchParams.get("data.id") || "";
    if (!numericOrSubscriptionId(dataId)) return reply(400, "invalid_data_id");
    if (!await verifyMercadoPagoSignature({
      header: req.headers.get("x-signature") || "",
      requestId: req.headers.get("x-request-id") || "",
      dataId,
      secret: TEST_SECRET
    })) return reply(401, "invalid_signature");
  } catch (e) {
    console.error("webhook signature parse failure", String((e as Error)?.message || e));
    return reply(401, "invalid_signature");
  }
  let payload: Record<string, any>;
  try {
    const raw = await bodyLimited(req);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return reply(400, "invalid_payload");
    }
    payload = parsed;
  } catch (e) {
    return reply((e as Error)?.message === "payload_too_large" ? 413 : 400, "invalid_payload");
  }
  // The signature authenticates query data.id, not the notification status.
  // Sanitize body and enforce sandbox merchant before storing an inbox hint.
  let event: ReturnType<typeof validateSandboxWebhook>;
  try {
    event = validateSandboxWebhook({
      payload, dataId, sellerId: TEST_SELLER_ID
    });
  } catch (e) {
    const reason = String((e as Error)?.message || "INVALID_PAYLOAD");
    if (reason === "SELLER_MISMATCH" || reason === "NOT_SANDBOX_EVENT") {
      return reply(403, "not_sandbox_seller");
    }
    return reply(400, "invalid_notification");
  }

  // A verified inbox event remains PENDING until the provider API is queried.
  // Deduplicate retries by permanent event id, not HTTP x-request-id.
  const { error } = await admin.from("billing_webhook_events").upsert(event, { onConflict: "event_key", ignoreDuplicates: true });
  if (error) {
    console.error("sandbox webhook persistence failed", error.code || "unknown");
    return reply(503, "event_persistence_failed");
  }
  return reply(200, "recorded_for_reconciliation");
});
