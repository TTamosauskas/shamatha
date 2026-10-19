import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.10";

// EXCLUSIVAMENTE HOMOLOGACAO. Nenhuma fatura e criada aqui.
// NAO grava em billing_subscriptions/billing_payments ou altera acesso.
const PROJECT_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MP_TOKEN = Deno.env.get("SHAMATHA_MP_SANDBOX_SELLER_TOKEN") || "";
const TEST_SELLER_ID = "3778352536"; // ID ficticio confirmado pelo proprietario.
const ORIGIN = "https://ttamosauskas.github.io";
const MP_API = "https://api.mercadopago.com";
const headers = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers });
}
function abort(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const admin = createClient(PROJECT_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function ownerId(req: Request): Promise<string> {
  const jwt = String(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) abort("Sessao de editor ausente.", 401);
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) abort("Sessao de editor invalida.", 401);
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("role,is_owner,access_status").eq("id", data.user.id).single();
  if (profileError || !profile || profile.role !== "editor" ||
      profile.is_owner !== true || profile.access_status !== "approved") {
    abort("Apenas o editor principal pode conciliar a homologacao.", 403);
  }
  return data.user.id;
}

async function fetchMP(path: string, seller = false): Promise<Record<string, any>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const url = seller ? "https://api.mercadolibre.com/users/me" : MP_API + path;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: "Bearer " + MP_TOKEN },
      signal: controller.signal
    });
    if (!response.ok) abort("Mercado Pago indisponivel (HTTP " + response.status + ").", 502);
    const result = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      abort("Resposta do Mercado Pago invalida.", 502);
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function validId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{12,64}$/.test(id);
}
function numericId(value: unknown): string | null {
  const s = String(value ?? "");
  return /^\d{1,30}$/.test(s) ? s : null;
}
function exactBRL180(value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && Math.round(n * 100) === 18000;
}
function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
function shortStatus(value: unknown): string {
  const s = String(value ?? "unknown");
  return /^[a-z0-9_-]{1,64}$/i.test(s) ? s : "unknown";
}

type InvoiceRow = {
  attempt_id: string;
  mp_invoice_id: string;
  mp_payment_id: string | null;
  invoice_status: string;
  payment_status: string | null;
  payment_approved_verified: boolean;
  amount_cents: number;
  currency: "BRL";
  debit_date: string | null;
  payment_approved_at: string | null;
  last_checked_at: string;
};

async function reconcileOne(attempt: {
  id: string;
  editor_id: string;
  mp_preapproval_id: string | null;
  payer_email: string;
}) {
  const id = attempt.mp_preapproval_id;
  if (!validId(id)) abort("Tentativa sem ID valido do Mercado Pago.", 409);
  const sub = await fetchMP("/preapproval/" + encodeURIComponent(id));
  if (String(sub.id ?? "") !== id || String(sub.collector_id ?? "") !== TEST_SELLER_ID) {
    abort("Assinatura nao pertence ao vendedor ficticio verificado.", 403);
  }
  const reference = "sandbox:" + attempt.editor_id + ":" + attempt.id;
  if (String(sub.external_reference ?? "") !== reference) {
    abort("Assinatura sem referencia original ao checkout ficticio.", 409);
  }
  if (sub.payer_email && String(sub.payer_email).toLowerCase() !== attempt.payer_email.toLowerCase()) {
    abort("Pagador da assinatura difere do comprador ficticio registrado.", 409);
  }
  if (!exactBRL180(sub.auto_recurring?.transaction_amount) ||
      sub.auto_recurring?.currency_id !== "BRL" ||
      Number(sub.auto_recurring?.frequency) !== 1 ||
      sub.auto_recurring?.frequency_type !== "months") {
    abort("Assinatura tem valor, moeda ou frequencia inesperados.", 409);
  }

  const payload = await fetchMP("/authorized_payments/search?preapproval_id=" +
    encodeURIComponent(id) + "&limit=20&offset=0");
  if (!Array.isArray(payload.results)) abort("Lista de faturas invalida.", 502);
  if (Number(payload.paging?.total ?? payload.results.length) > 20) {
    abort("Mais de 20 faturas; concilie com paginacao antes de gravar.", 409);
  }
  const now = new Date().toISOString();
  const rows: InvoiceRow[] = [];
  for (const invoice of payload.results) {
    if (String(invoice?.preapproval_id ?? "") !== id) {
      abort("Fatura retornada nao pertence a assinatura.", 409);
    }
    const invoiceId = numericId(invoice?.id);
    if (!invoiceId || !exactBRL180(invoice?.transaction_amount) ||
        invoice?.currency_id !== "BRL") {
      abort("Fatura inesperada ou com valor diferente de R$ 180 BRL.", 409);
    }
    const paymentId = numericId(invoice?.payment?.id);
    let paymentStatus: string | null = null;
    let approved = false;
    let approvedAt: string | null = null;
    if (paymentId) {
      const payment = await fetchMP("/v1/payments/" + encodeURIComponent(paymentId));
      if (numericId(payment?.id) !== paymentId ||
          !exactBRL180(payment?.transaction_amount) ||
          payment?.currency_id !== "BRL" ||
          String(payment?.collector_id ?? "") !== TEST_SELLER_ID) {
        abort("Pagamento nao corresponde a fatura ou vendedor ficticio.", 409);
      }
      paymentStatus = shortStatus(payment.status);
      approved = paymentStatus === "approved" &&
        String(invoice.payment?.status || "") === "approved";
      approvedAt = approved ? validDate(payment.date_approved) : null;
    }
    rows.push({
      attempt_id: attempt.id,
      mp_invoice_id: invoiceId,
      mp_payment_id: paymentId,
      invoice_status: shortStatus(invoice.status),
      payment_status: paymentStatus,
      payment_approved_verified: approved,
      amount_cents: 18000,
      currency: "BRL",
      debit_date: validDate(invoice.debit_date),
      payment_approved_at: approvedAt,
      last_checked_at: now
    });
  }
  // So grava DEPOIS de verificar assinatura, faturas e pagamentos no provedor.
  // Idempotencia por ID unico de fatura: repeticao atualiza o mesmo registro.
  if (rows.length) {
    const { error } = await admin.from("billing_sandbox_invoice_observations")
      .upsert(rows, { onConflict: "mp_invoice_id" });
    if (error) abort("Nao foi possivel registrar as faturas verificadas.", 502);
  }
  const { error: attemptError } = await admin.from("billing_sandbox_attempts")
    .update({ last_provider_status: shortStatus(sub.status), last_checked_at: now })
    .eq("id", attempt.id).eq("editor_id", attempt.editor_id);
  if (attemptError) abort("Nao foi possivel atualizar a consulta da assinatura.", 502);
  return {
    subscriptionId: id,
    subscriptionStatus: shortStatus(sub.status),
    observedInvoices: rows.length,
    approvedPaymentsVerified: rows.filter(x => x.payment_approved_verified).length,
    checkedAt: now,
    paidThrough: null,
    grantsStudentAccess: false
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.headers.get("Origin") && req.headers.get("Origin") !== ORIGIN) {
    return reply({ error: "Origem nao autorizada." }, 403);
  }
  try {
    if (req.method !== "POST") return reply({ error: "Metodo nao permitido." }, 405);
    if (!MP_TOKEN || !PROJECT_URL || !SERVICE_KEY) abort("Conciliacao de teste nao configurada.", 503);
    const editor = await ownerId(req);
    const body = await req.json().catch(() => ({}));
    if (body?.mode !== "sandbox-reconcile") abort("Modo de homologacao invalido.");
    const seller = await fetchMP("", true);
    if (String(seller.id ?? "") !== TEST_SELLER_ID) {
      abort("Credencial nao corresponde ao vendedor de teste autorizado.", 403);
    }
    // Somente tentativas do proprio editor; nenhuma ID de aluno fornecida pelo cliente.
    const { data, error } = await admin.from("billing_sandbox_attempts")
      .select("id,editor_id,mp_preapproval_id,payer_email")
      .eq("editor_id", editor).eq("state", "created")
      .order("created_at", { ascending: false }).limit(10);
    if (error) abort("Consulta das assinaturas ficticias indisponivel.", 502);
    if (!data || !data.length) return reply({
      sandbox: true, checked: 0, results: [], grantsStudentAccess: false
    });
    const results = [];
    for (const attempt of data) results.push(await reconcileOne(attempt));
    return reply({ sandbox: true, checked: results.length, results,
      grantsStudentAccess: false, productionBillingEnabled: false });
  } catch (error) {
    const status = Number((error as { status?: number })?.status || 500);
    if (status >= 500) console.error("sandbox reconciliation error", String((error as Error)?.message || error));
    return reply({ error: status >= 500
      ? "Erro na conciliacao ficticia. Consulte logs da funcao."
      : String((error as Error)?.message || "Solicitacao invalida.") }, status);
  }
});
