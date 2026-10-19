// Supabase Edge Functions on *.supabase.co intentionally serve HTML as text/plain.
// The interactive sandbox interface lives in the static GitHub Pages file
// billing-sandbox.html (PR #50), rather than in an Edge Function.
Deno.serve((req: Request) => {
  if (req.method !== "GET") return new Response("Metodo nao permitido.", { status: 405 });
  const message = [
    "Painel Mercado Pago — Shamatha",
    "",
    "Este endereco nao hospeda mais a interface HTML.",
    "O Supabase nao permite exibir HTML no dominio padrao supabase.co.",
    "",
    "Pagina corrigida (disponivel apos aprovacao e publicacao do PR #50):",
    "https://ttamosauskas.github.io/shamatha/billing-sandbox.html",
    "",
    "PR de publicacao da pagina:",
    "https://github.com/TTamosauskas/shamatha/pull/50",
    "",
    "As assinaturas e cobrancas reais continuam desativadas."
  ].join("\n");
  return new Response(message, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    }
  });
});
