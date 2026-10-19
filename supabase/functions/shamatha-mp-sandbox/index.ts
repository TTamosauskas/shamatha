import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.10";

// EXCLUSIVAMENTE HOMOLOGACAO: nao vincular esta funcao ao cadastro dos alunos.
// Nunca utilize credenciais da conta comercial real nesta funcao.
const URL_SUPABASE = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_ORIGIN = "https://ttamosauskas.github.io";
const ALLOWED_BACK_URL = SITE_ORIGIN + "/shamatha/?mp_sandbox=1";
const AMOUNT_BRL = 180.00;

const cors = {
  "Access-Control-Allow-Origin": SITE_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function isMercadoPagoCheckout(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      /(^|\.)mercadopago\.(com|com\.br|com\.ar|com\.mx|com\.uy)$/.test(parsed.hostname);
  } catch {
    return false;
  }
}
const admin = createClient(URL_SUPABASE, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function requireOwner(req: Request) {
  const jwt = String(req.headers.get("Authorization") || "")
    .replace(/^Bearer\s+/i, "").trim();
  if (!jwt) fail("Sessao ausente.", 401);
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) fail("Sessao invalida.", 401);
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,role,is_owner,access_status").eq("id", data.user.id).single();
  if (profileError || !profile || profile.role !== "editor" ||
      !profile.is_owner || profile.access_status !== "approved") {
    fail("Apenas o editor principal pode testar assinaturas.", 403);
  }
  return data.user.id;
}

async function createTestCheckout(editorId: string, email: string) {
  const payerEmail = email.trim().toLowerCase();
  if (!/^[a-z0-9._%+\-]+@testuser\.com$/.test(payerEmail)) {
    fail("Use somente o e-mail da conta COMPRADOR DE TESTE do Mercado Pago (@testuser.com).");
  }
  const enabled = Deno.env.get("SHAMATHA_MP_SANDBOX_CREATE_ENABLED") === "true";
  const token = Deno.env.get("SHAMATHA_MP_SANDBOX_SELLER_TOKEN") || "";
  if (!enabled || !token) fail("Homologacao desativada: credencial de teste e habilitacao sao necessarias.", 503);

  // Reusar uma tentativa existente impede a criacao acidental de assinaturas duplicadas.
  const { data: previous, error: findError } = await admin.from("billing_sandbox_attempts")
    .select("state,checkout_url,mp_preapproval_id")
    .eq("editor_id", editorId).eq("payer_email", payerEmail).maybeSingle();
  if (findError) fail("Estrutura de homologacao indisponivel.", 503);
  if (previous) {
    if (previous.state === "created" && previous.checkout_url) {
      return { sandbox: true, reused: true, checkoutUrl: previous.checkout_url,
        subscriptionId: previous.mp_preapproval_id, amountCents: 18000 };
    }
    fail("Ja existe tentativa pendente para este comprador de teste. Revise no Mercado Pago antes de tentar novamente.", 409);
  }

  const { data: attempt, error: insertError } = await admin.from("billing_sandbox_attempts")
    .insert({ editor_id: editorId, payer_email: payerEmail, state: "creating" })
    .select("id").single();
  if (insertError || !attempt) fail("Nao foi possivel reservar a tentativa; nenhuma cobranca foi solicitada.", 409);

  try {
    const response = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "X-Idempotency-Key": attempt.id
      },
      body: JSON.stringify({
        reason: "Shamatha - homologacao da assinatura mensal",
        external_reference: "sandbox:" + editorId + ":" + attempt.id,
        payer_email: payerEmail,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: AMOUNT_BRL,
          currency_id: "BRL"
        },
        back_url: ALLOWED_BACK_URL,
        status: "pending"
      })
    });
    if (!response.ok) {
      // Sem retry automatico: a resposta pode ter chegado apos criacao da assinatura.
      await admin.from("billing_sandbox_attempts").update({
        state: "needs_review", error_code: "HTTP_" + response.status,
        updated_at: new Date().toISOString()
      }).eq("id", attempt.id);
      fail("Mercado Pago retornou HTTP " + response.status + ". Revise a tentativa de teste.", 502);
    }
    const payload = await response.json();
    if (typeof payload.id !== "string" || !isMercadoPagoCheckout(payload.init_point)) {
      await admin.from("billing_sandbox_attempts").update({
        state: "needs_review", error_code: "INVALID_RESPONSE",
        updated_at: new Date().toISOString()
      }).eq("id", attempt.id);
      fail("Resposta incompleta do Mercado Pago. Revise a tentativa antes de repetir.", 502);
    }
    const { error: updateError } = await admin.from("billing_sandbox_attempts")
      .update({
        state: "created", mp_preapproval_id: payload.id,
        checkout_url: payload.init_point, updated_at: new Date().toISOString()
      }).eq("id", attempt.id);
    if (updateError) fail("Assinatura criada, mas seu registro local falhou. Nao tente novamente; solicite conciliacao.", 502);
    return { sandbox: true, reused: false, checkoutUrl: payload.init_point,
      subscriptionId: payload.id, amountCents: 18000 };
  } catch (error) {
    // Se houver timeout apos a criacao remota, preservar a tentativa para analise manual.
    await admin.from("billing_sandbox_attempts").update({
      state: "needs_review", error_code: "REVIEW_REQUIRED",
      updated_at: new Date().toISOString()
    }).eq("id", attempt.id).eq("state", "creating");
    throw error;
  }
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.headers.get("Origin") && req.headers.get("Origin") !== SITE_ORIGIN) {
    return json({ error: "Origem nao autorizada." }, 403);
  }
  try {
    if (!["GET", "POST"].includes(req.method)) return json({ error: "Metodo nao permitido." }, 405);
    const editorId = await requireOwner(req);
    if (req.method === "GET") {
      return json({
        sandbox: true,
        enabled: Deno.env.get("SHAMATHA_MP_SANDBOX_CREATE_ENABLED") === "true" &&
          Boolean(Deno.env.get("SHAMATHA_MP_SANDBOX_SELLER_TOKEN")),
        amountCents: 18000, currency: "BRL",
        productionBillingEnabled: false
      });
    }
    const body = await req.json().catch(() => ({}));
    if (body.mode !== "sandbox") fail("Esta funcao permite apenas mode=sandbox.");
    return json(await createTestCheckout(editorId, String(body.payerEmail || "")));
  } catch (error) {
    const status = Number((error as {status?: number})?.status || 500);
    if (status >= 500) console.error("sandbox checkout error", String((error as Error)?.message || error));
    return json({ error: status >= 500 ? "Falha no teste de assinatura. Consulte os logs da funcao." :
      String((error as Error)?.message || "Solicitacao invalida.") }, status);
  }
});
