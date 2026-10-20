# Homologação: cancelamento pelo comprador e notificações — 20/10/2026

## Resultado observado diretamente na API do vendedor fictício

A assinatura de homologação `c5b3cfd34ca740cb8d1b7687c5ad13b2`, cancelada pelo comprador no Mercado Pago, foi lida **por uma execução única do conciliador HMAC** `shamatha-mp-sandbox-periodic`. A chamada retornou HTTP **200** e os dados gravados em `billing_sandbox_attempts` mostram:

- `last_provider_status=cancelled`;
- `last_checked_at=2026-10-20T11:39:42.898Z`;
- 1 assinatura fictícia consultada, 1 fatura observada, 1 pagamento aprovado verificado;
- mesma fatura `7033097180` e mesmo pagamento `185024682360` associados ao teste inicial;
- histórico preservado em `billing_sandbox_invoice_observations` sem linha duplicada;
- `grantsStudentAccess=false`, `paidThrough=null`: o ciclo financeiro não alterou direitos de acesso.

**Atenção:** a assinatura foi cancelada e não servirá para observar uma próxima renovação automática. Não criar outra assinatura ou pagamento de teste sem nova decisão explícita do titular.

## Testes de regressão

- 21 testes existentes do auditor de faturas foram mantidos.
- 6 testes foram acrescentados em `tests/mercadopago-sandbox-invoices.test.mjs`: cancelamento preserva fatura aprovada, status alternativo `canceled`, replay idempotente dos IDs, referência externa falsa continua rejeitada, futura fatura pendente não vira aprovada, pausa não dá acesso.
- **27 testes sintéticos aprovados, 0 falhas**, executados no módulo puro do auditor. Não substituem testes de provedor real ou verificação de assinatura de Webhook.
- Verificador isolado de assinatura Webhook e seus **10 testes sintéticos previamente executados** foram trazidos do PR #49 para esta branch. Não há endpoint Webhook instalado ou acionado.

## Webhook: barreira ainda aberta

A documentação de Assinaturas do Mercado Pago lista os tópicos `subscription_preapproval`, `subscription_authorized_payment` e `payment`. Entretanto, informa que configuração via painel **Suas integrações** não é aplicável a Assinaturas, e recomenda configurar notificações durante a criação do pagamento. A documentação do endpoint específico `POST /preapproval` usada na homologação não especifica `notification_url` de forma confirmada. **Não adicionar arbitrariamente esse campo nem supor que haverá entrega automática de Webhooks.**

O módulo `mercadopago-webhook-signature.mjs` é um verificador de assinatura digital HMAC sintético; ele sozinho **não** valida eventos reais, autenticação do vendedor, origem das mensagens, pagamento da fatura nem períodos de acesso. O receptor do PR #49 permanece **NÃO IMPLANTADO**; a conciliação via API autenticada continua a fonte verificada para o teste fictício.

Fontes:
- https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/create-preapproval/post
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/get-authorized-payment/get

## Próximas fases do plano

1. **Fase 3:** validar oficialmente o mecanismo de notificações/assinaturas; garantir verificação de HMAC e consulta da API antes de qualquer alteração. Um agendamento `pg_cron` de reconciliação ainda **não existe**; o SQL de criação foi bloqueado pela ferramenta e não foi executado. O teste manual HMAC já passou.
2. **Fase 4:** a coluna Assinatura do editor e a página Minha assinatura já estão publicadas em modo informativo. O redirecionamento ao checkout está desativado.
3. **Fase 5:** manter RLS de conteúdo e isenções como estão; motor de `paidThrough` continua isolado, faltando fonte contratual verificada.
4. **Fase 6:** recusada, inadimplência, renovação, reativação e estorno somente em testes sintéticos ou nova homologação fictícia expressamente autorizada, **sem cobrança real**.

## Controles de segurança verificados após cancelamento

| Recurso | Estado |
|---|---|
| Perfis | 2 |
| Isentos | 2 |
| Tentativas de checkout de produção | 0 |
| Assinaturas de produção | 0 |
| Pagamentos de produção | 0 |
| Faturas fictícias observadas | 1 |
| Eventos de Webhook registrados | 0 |
| Job financeiro agendado | 0 |

Nenhum aluno, autorização administrativa, progresso ou política de conteúdo foi modificado para produzir esta evidência. O PR #49 continua aberto e em rascunho; seu receptor de Webhooks não foi ativado.
