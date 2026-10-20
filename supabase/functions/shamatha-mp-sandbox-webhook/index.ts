import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.10";
import { verifyMercadoPagoSignature } from "../_shared/mercadopago-webhook-signature.mjs";

// CODIGO PREPARADO, NAO IMPLANTAR antes de configurar e testar webhook REAL de
// assinatura na conta vendedora FICTICIA. Sem efeitos sobre alunos/assinaturas reais.
// A configuracao de assinatura pode diferir da de outros produtos Mercado Pago.
const URL_SUPABASE = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TEST_SECRET = Deno.env.get("SHAMATHA_MP_SANDBOX_WEBHOOK_SECRET") || "";
const enabled = Deno.env.get("SHAMATHA_MP_SANDBOX_WEBHOOK_ENABLED") === "true";
const TEST_SELLER_ID = "3778352536";
const MAX_BODY = 16384;
const MAX_AGE_MS = 15 * 60 * 1000;
const types = new Set(["payment", "subscription_preapproval", "subscription_authorized_payment"]);
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
  const type = String(payload.type || "");
  if (!types.has(type) || String(payload.data?.id ?? "").toLowerCase() !== dataId.toLowerCase()) {
    return reply(400, "event_type_or_id_mismatch");
  }
  if (payload.user_id && String(payload.user_id) !== TEST_SELLER_ID) {
    return reply(403, "not_test_seller");
  }
  const eventId = String(payload.id ?? "");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(eventId)) return reply(400, "invalid_event_id");

  // Somente registra alerta validado: nao confia em status recebido e NUNCA
  // libera acesso. Conciliacao posterior consulta as faturas e pagamentos na API.
  // Retentativas do mesmo evento podem ter x-request-id diferente. Deduplicar
  // pelo ID permanente da notificacao, nao pelo ID da chamada HTTP.
  const eventKey = "sandbox:" + type + ":" + eventId;
  const sanitized = {
    type,
    action: String(payload.action || "").slice(0, 96),
    data: { id: dataId },
    event_id: eventId,
    test_seller_id: TEST_SELLER_ID
  };
  const { error } = await admin.from("billing_webhook_events").upsert({
    event_key: eventKey,
    event_type: type,
    provider_resource_id: dataId,
    payload: sanitized,
    processing_status: "verified_requires_reconciliation"
  }, { onConflict: "event_key", ignoreDuplicates: true });
  if (error) {
    console.error("sandbox webhook persistence failed", error.code || "unknown");
    return reply(503, "event_persistence_failed");
  }
  return reply(200, "recorded_for_reconciliation");
});
