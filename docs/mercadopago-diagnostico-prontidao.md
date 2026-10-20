# Shamatha — diagnóstico de prontidão para cobrança (bloqueado por padrão)

**Verificado em 20/10/2026. Status: NÃO AUTORIZADO PARA PRODUÇÃO.**

Este documento acompanha exclusivamente o módulo puro `billing-launch-readiness.mjs`. Ele **não altera nenhuma tabela, secret, Edge Function, regra RLS ou conta de usuário**. Sua saída é um checklist auditável para revisão humana; `authorizesProductionBilling` é sempre `false`, mesmo quando todos os 12 requisitos recebem metadados de evidência.

## Estado comprovado nesta etapa

- **PR #63 mesclado em `main`**, com CI de 128 casos aprovado e GitHub Pages publicado.
- A produção mantém `private.has_content_access()` baseada em `profiles.access_status='approved'`, sem consultar estado de pagamento.
- **2 perfis existentes, 2 isenções explícitas** no banco. Ao ativar no futuro será obrigatório fazer snapshot final de todos os perfis cadastrados antes do corte, inclusive se novos alunos chegarem.
- **0** assinaturas e **0** pagamentos em produção. **0** eventos Webhook recebidos. **0** tentativas de checkout live.
- **1** assinatura fictícia cadastrada e posteriormente cancelada pelo comprador; **1** fatura fictícia com pagamento aprovado e preservado na observação privada, sem duplicação. Recorrências futuras dessa assinatura cancelada não deverão ocorrer.
- Conciliação autenticada por HMAC validou leitura de cancelamento, mas **não existe job `pg_cron` financeiro agendado**. O SQL de agendamento foi bloqueado anteriormente e não houve ativação.
- Receptor de Webhook preparado apenas em código; **não implantado**. O PR #49 continua aberto como draft e não deve ser mesclado.
- A fonte documental que permita provar `paidThrough` **ainda não foi definida**. `next_payment_date` é data de próxima cobrança, não evidência bastante do período de serviço.

## Doze condições de revisão obrigatórias

| Chave do diagnóstico | Situação em 20/10/2026 | Evidência ou ação faltante |
|---|---|---|
| `owner_explicit_go_live_authorization` | **Pendente** | Autorização futura específica do titular para cobranças live, escopo/rollback e prazo |
| `legacy_profiles_final_exemption_snapshot` | **Pendente** | Snapshot final no instante anterior ao go-live; primeira isenção de 2 perfis está concluída |
| `production_checkout_identity_and_idempotency_review` | **Pendente** | Teste de integração completo do checkout aluno em conta controlada, sem duplicatas |
| `mercadopago_subscription_webhook_delivery_verified` | **Pendente** | Confirmação formal de configuração da URL para `POST /preapproval` sem plano e entrega real de eventos |
| `webhook_hmac_and_replay_tested` | **Parcial** | Testes HMAC sintéticos concluídos, mas não houve delivery Webhook assinado real |
| `periodic_provider_reconciliation_and_alerts_tested` | **Parcial** | Execução manual HMAC aprovada no sandbox; Cron, métricas e alertas ainda ausentes |
| `contractual_paid_coverage_period_source_verified` | **Pendente** | Fonte contratual auditável do intervalo pago por fatura e cancelamento |
| `refund_chargeback_and_decline_lifecycle_tested` | **Pendente** | Cenários reais controlados em homologação; testes sintéticos não bastam |
| `cancel_renewal_reactivation_lifecycle_tested` | **Parcial** | Cancelamento comprovado; renovação e reativação ainda não observadas no provedor |
| `production_rls_dry_run_and_rollback_tested` | **Pendente** | Teste isolado sem alterar dados de usuários; política atual mantida intacta |
| `separate_production_credentials_and_environment_review` | **Pendente** | Segredos de produção distintos, credenciais validadas pelo responsável e rollback |
| `editor_and_student_end_to_end_acceptance` | **Pendente** | E2E de pagamento pendente, aprovado, falho e isento com alunos de teste |

A presença de URLs de relatórios ou testes sintéticos não transforma itens pendentes em `verified`. A função de diagnóstico exige `result="verified"`, uma referência específica no GitHub e timestamp RFC3339 recente, mas **não autentica a autoria da evidência** e jamais executa lançamento. A revisão deverá ser feita pelo responsável e por implementação futura com controles de acesso servidor, não via navegador ou Webhook.

## Investigação documental: Mercado Pago

Na [documentação oficial de Assinaturas](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks), a configuração pelo painel convencional **Suas integrações** é explicitamente excluída para Assinaturas. A página aponta a configuração durante a criação de pagamentos. Já a [API de criação `POST /preapproval`](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/create-preapproval/post), usada pelo Shamatha, **não documenta `notification_url` na referência publicada**.

Os tópicos para assinatura sem plano são `subscription_preapproval`, `subscription_authorized_payment` e `payment`; confira [informações adicionais sobre notificações](https://www.mercadopago.com.br/developers/pt/docs/split-payments/additional-content/your-integrations/notifications/additional-info). Não presumir que outro produto (Checkout Pro/Orders) possui o mesmo método de configuração.

### Pedido técnico a abrir no suporte Mercado Pago (sem segredos ou IDs pessoais)

Solicitar a documentação/campo exato para registrar uma URL Webhook HTTPS ao criar **Assinaturas sem plano pelo endpoint `POST /preapproval`**, a origem da chave secreta de assinatura correspondente ao vendedor fictício, quais dos três tópicos são emitidos nesse caso e exemplos de `x-signature` e payload assinados. Pedir também o recurso oficial que indica **início e fim do período contratual de serviço** para cada fatura de cobrança mensal aprovada, inclusive quando a assinatura foi cancelada pelo comprador. Registrar a resposta numa issue específica para posterior revisão.

**Não ligar nenhuma flag de produção, não alterar `private.has_content_access()`, não ativar o checkout do aluno e não fazer merge do PR #49.**

## Testes de prontidão

O novo módulo `supabase/functions/_shared/billing-launch-readiness.mjs` só aceita metadados de evidência compatíveis com o formato especificado e classifica os itens pendentes. Os 18 testes novos cobrem: ausência de evidências, URLs inválidas, datas expiradas e futuras, informações enviadas por clientes, status arbitrários, pedido de Webhook não comprovado e impossibilidade de conceder acesso ou habilitar cobrança mesmo com todas as informações declaradas como completas.

O GitHub Actions roda automaticamente `node --test tests/*.test.mjs`, sem tokens nem chamadas reais à API. O objetivo desta entrega é evitar aprovação prematura da Fase 5/6 — **não é implementação de cobrança**.
