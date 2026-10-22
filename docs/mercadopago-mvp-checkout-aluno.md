# Shamatha — MVP real de assinatura: primeiro componente funcional (checkout por aluno)

**Estado: PR preparado; NÃO implantado, NÃO libera pagamento real, NÃO muda acesso.**

## O que esta etapa implementa

- A página `minha-assinatura.html` mostra um botão de contratação **R$ 180/mês**. Ele vem desativado por padrão e só é habilitado caso a função autenticada devolva `enabled=true` após checagem de servidor.
- A nova função `shamatha-mp-student-checkout`, que **não está implantada**, reconhece somente o usuário Supabase logado, seu perfil, e sua isenção do banco. Não permite ID ou e-mail de outra pessoa no corpo.
- Para criar o checkout, exige perfil `student`, e-mail confirmado, aprovação administrativa `approved` ou `pending` (sem acesso até aprovação), não isento e sem assinatura de produção existente.
- Requer **três flags verdadeiras simultaneamente**: `SHAMATHA_MP_PRODUCTION_BILLING_ENABLED`, `SHAMATHA_MP_PRODUCTION_LAUNCH_APPROVED`, `SHAMATHA_MP_PRODUCTION_CHECKOUT_ENABLED`. Nenhuma é ativada neste PR.
- Usa exclusivamente `SHAMATHA_MP_PRODUCTION_SELLER_TOKEN` e `SHAMATHA_MP_PRODUCTION_SELLER_ID` separados do vendedor fictício `3778352536`; rejeita o ID desse vendedor de teste.
- Confere a conta vendedora no Mercado Livre com o token do **servidor** antes do POST ao provedor. Reserva uma tentativa em `billing_checkout_intents` com unicidade por estudante+ambiente e `X-Idempotency-Key`; não cria duplicatas ao tentar novamente.
- Cria `POST /preapproval` com referência fixa, mensalidade R$180 BRL, intervalo mensal, URL de retorno conhecida. Confere assinatura retornada, vendedor e URL HTTPS exclusiva Mercado Pago; retorna ao aluno apenas a URL.
- Se o MP falhar ou a gravação ficar incerta, a tentativa passa a `needs_review` e nenhuma repetição automática cria outra assinatura.
- O usuário que regressa do Mercado Pago **não ganha acesso pelo retorno do navegador**; é preciso verificar o pagamento na API por um reconciliador servidor próprio, ainda a implementar.

### O que falta para a primeira liberação real

1. **Reconciliador de aluno** para `GET /preapproval/{id}`, `GET /authorized_payments/search`, `GET /v1/payments/{id}`: verificar vendedor, e-mail, referência, valor, fatura e pagamento; persistir no banco `billing_subscriptions` e `billing_payments` com a associação e o período de serviço contratado.
2. Definir formalmente o período mensal coberto (proposta técnica: cada pagamento de R$180 válido cobre um mês de serviço, com renovação antes da expiração prorrogando o período; cancelamento não estorna automaticamente meses já pagos). Revisar meses curtos, pagamento atrasado, reembolso e chargeback.
3. **Snapshot completo de isenções no exato corte** para os usuários antigos. Até esse momento usuários antigos continuam conforme regra administrativa atual.
4. **RLS de conteúdo** e `private.has_content_access()` devem exigir `access_status='approved'` E (isenção ou pagamento servidor verificado com `period_start <= now < period_end`), sem confiança em `billing_subscriptions.access_status='active'` obsoleto. Testar com cinco contas novas sem pagamento, uma paga, duas isentas e um suspenso.
5. Fluxo completo no ambiente de teste da conta **de produção controlada** para confirmar identidade, aprovação e expiração; nenhuma cobrança de usuários até validação e aprovação explícita da ativação.

### Segurança do PR

O GitHub Pages é estático: ocultar uma etapa via JavaScript não impõe bloqueio real. O bloqueio só estará funcional depois que o banco aplicar a política RLS testada. **Não ligar as três flags nem publicar a função** até que o reconciliador, o teste RLS e o snapshot de isenções estejam prontos.

**Não mexer em `profiles.access_status` ou nos dois usuários isentos atuais. Não reutilizar a assinatura fictícia cancelada. Não mesclar o PR #49.**

### Referência oficial

- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/create-preapproval/post
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/authorized-payment-search/get
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/get-preapproval/get
