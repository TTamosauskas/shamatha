# Shamatha — decisão de cobertura mensal e prova de entrega de Webhooks

**22/10/2026 — Proposta técnica não autorizada para produção.** Este documento contém hipóteses contratuais, testes sintéticos e uma verificação de notificações a fazer no vendedor fictício. Nenhum lançamento, cobrança ou modificação de acesso é efetuado por este PR.

## 1. Mercado Pago: descoberta adicional relevante para a Issue #65

A página oficial [Tools disponíveis — MCP Server](https://www.mercadopago.com.br/developers/pt/docs/mcp-server/tools) descreve:

- `save_webhook`: registra/atualiza tópicos de notificação e URL de produção (`callback`) ou homologação (`callback_sandbox`) **de uma aplicação**;
- `notifications_history_diagnostics`: histórico/diagnóstico de entrega dos eventos para uma integração;
- `application_list`: identifica aplicações via OAuth.

Isso é **evidência de que existe uma operação oficial para configurar/diagnosticar Webhooks no nível da aplicação**. Porém **não comprova que notificações de Assinaturas sem plano por `POST /preapproval` serão efetivamente entregues dessa forma**: a mesma documentação de [Webhooks para Assinaturas](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks) contém a ressalva expressa que o método `Suas integrações` *não está disponível* para o produto Assinaturas. Portanto não declarar a Issue #65 resolvida e não substituir assinatura por pagamento único.

O MCP do Mercado Pago não está conectado aos instrumentos atuais deste projeto. **Não inserir token ou senha MP em repositório, issue ou chat** para tentar integrá-lo.

### Validação futura proposta, sem nova cobrança nem alteração de acessos

1. Identificar no painel de desenvolvedores a **aplicação exata** à qual pertencem o vendedor e a assinatura fictícia já cancelada. Não criar aplicação de produção alternativa como atalho.
2. Consultar a tela de Webhooks desse aplicativo, e se possível **apenas inspecionar** opções de URL de homologação e os tópicos `subscription_preapproval`, `subscription_authorized_payment` e `payment(s)`. O tópico de API para pagamentos normalmente é `payment`; a tela pode rotulá-lo como `payments`.
3. Verificar pelo painel, suporte ou `notifications_history_diagnostics` **se já existem notificações históricas** da assinatura cancelada: timestamps, tipo, status de entrega e resposta. Não confundir ausência de registro com falha do webhook; alguns testes não disparam eventos.
4. **Não cadastrar URL ativa do Shamatha nem revelar HMAC antes da revisão formal** do recebimento da modalidade assinatura. O receptor `shamatha-mp-sandbox-webhook` ainda não foi implantado.
5. Para simulação futura, se o provedor oferecer o botão **Simular**, confirmar se ele aceita `data.id` já existente e se a mensagem possui `x-signature` válida; validar formato/conta vendedor de teste sem criar uma nova assinatura. Uma simulação não prova a entrega automática de um evento real.
6. Registrar na Issue #65 evidência sem segredos: tela/caminho, tópico, `live_mode` redigido, eventual status e resultado do teste. Comparar com a ressalva oficial antes de autorizar implantação posterior.

A documentação oficial informa `save_webhook` como interface para aplicações; **não é autorização para executá-lo com URLs reais ou habilitar um receptor externo nesta etapa**.

## 2. Proposta contratual — mensalidade de R$ 180 (a decidir)

A referência [GET /preapproval/{id}](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/get-preapproval/get) indica `next_payment_date` como próximo débito. O [GET de cobrança autorizada](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/get-authorized-payment/get) expõe `debit_date`, fatura e pagamento. Não há campos explicitamente garantidos de `service_period_start/service_period_end` por fatura.

**Hipótese A — marco por data do débito inicial:** um pagamento de R$ 180 confirmado pela API, com conta, assinatura, fatura e pagamento vinculados, indicaria **um mês civil de serviço** contado a partir de um marco de ciclo explícito no contrato. O débito pode ser atrasado ou reprocessado: uma divergência exige revisão, não alteração automática do período.

**Hipótese B — marco por primeira aprovação:** o ciclo de serviço começaria quando o primeiro pagamento fosse aprovado, sem antecipação de conteúdo; as renovações seguiriam uma cadência mensal contratual. Isso pode divergir da programação do provedor e requer definição de como tratar atraso de pagamento.

**Decisões comerciais ainda necessárias:** (a) marco inicial; (b) regra para meses de 28, 29, 30 e 31 dias — ancoragem no dia original, sem drift; (c) se cancelamento conserva cobertura já quitada até o fim, como proposto; (d) chargeback, reembolso total/parcial, disputa e recuperação; (e) data de ativação comercial para novos cadastros e preservação integral das contas pré-existentes; (f) eventual pausa do serviço e ordem das avaliações administrativas.

Nenhuma dessas escolhas foi aprovada ou lançada. **`next_payment_date` nunca é, sozinho, prova de cobertura de serviço.**

## 3. Auditor isolado de hipóteses de ciclos

O módulo `supabase/functions/_shared/mp-contractual-coverage-candidates.mjs` calcula intervalos *hipotéticos* apenas a partir de faturas informadas como validadas por um servidor (não pelo browser), preservando:

- vínculo exato a `subscriptionId` e `sellerId`, preço fixo R$180 BRL;
- ID único de fatura e pagamento, status `processed/approved`, `providerVerifiedPayment=true`;
- rejeição de fatura reembolsada, disputada ou com chargeback;
- aprovações dentro do mês correspondente; recusa de débito deslocado, duplicatas e resposta parcial;
- ancoragem mensal no dia original (ex.: 31/jan → 28/fev → 31/mar);
- distinção entre assinatura `authorized`, `paused` e `cancelled/canceled` apenas para diagnóstico;
- no máximo 12 parcelas por avaliação, e falha fechada ao encontrar uma incongruência.

**Saída obrigatória:** `coveragePeriodVerified=false`, `paidThrough=null`, `grantsStudentAccess=false`, `changesRls=false`, `productionBillingEnabled=false`, mesmo quando há intervalos candidatos. Não alimentar a RLS, a coluna Assinatura do editor ou os registros `billing_subscriptions` com esses valores.

A função é uma **proposta técnica para avaliação**, não mecanismo que autorize conteúdo. O campo `providerVerifiedPayment` é apenas uma entrada de teste e não substitui comprovação criptográfica/autenticada no backend.

## 4. Gate antes de qualquer integração real

A Issue #65 permanece aberta até que se prove o canal de notificação e se aprove o texto contratual dos períodos pagos. Uma integração real deve usar evidência gerada pelo servidor, imutável e ligada ao aluno e à fatura, com política versionada e auditada. O próximo PR de implantação teria de ser separado, com teste de RLS, rollback, simulação de inadimplência e aprovação explícita do responsável.

Não criar nova assinatura fictícia, não implantar Webhooks, não agendar Cron, não habilitar flag de produção e não mesclar PR #49.
