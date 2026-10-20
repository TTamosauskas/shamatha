# Shamatha — ensaio isolado da Fase 5 (sem modificar RLS)

**20/10/2026 — NÃO ATIVAR COBRANÇA REAL OU BLOQUEIO FINANCEIRO.** Este documento acompanha somente módulos JavaScript puros e testes locais/CI. Não contém SQL de ativação, deploy de Edge Function, trigger de cobrança nem alterações no cadastro dos alunos.

## Regra existente confirmada no banco

A função de produção atual `private.has_content_access()` é `STABLE SECURITY DEFINER`, com `search_path` vazio. Ela retorna verdadeiro apenas quando existe um perfil com `profiles.id = auth.uid()` e `profiles.access_status='approved'`. **Nenhuma consulta às tabelas financeiras faz parte da política atual**. Essa função **não foi alterada** nesta entrega.

As isenções efetivas são registros separados em `billing_exemptions`. Foram encontrados 2 perfis e 2 isenções anteriores; o snapshot final de todos os perfis existentes **antes da ativação futura** ainda será necessário. Uma conta nova, cadastrada depois desse marco, não deve receber isenção automática.

## Motor de análise preparado — totalmente desconectado

- `supabase/functions/_shared/billing-entitlement.mjs`: `evaluateBillingAccess`, política **candidata** sem efeitos colaterais, apenas para testes.
- `supabase/functions/_shared/mp-billing-cycle-audit.mjs`: `auditFirstMonthlyCycle` e `nextUtcCalendarMonth`, somente comparação do calendário de cobranças.
- `tests/billing-entitlement.test.mjs`: 34 ensaios de acesso administrativo, isenção, cancelamento, renovação, inadimplência, chargeback, reembolso, período exato e ausência de tolerância após vencimento.
- `tests/mp-billing-cycle-audit.test.mjs`: 16 ensaios de datas, meses curtos, vendedor, fatura, pagamento e ausência de comprovação contratual.

**Importante:** os testes demonstram a lógica dos modelos, não a validade de suas premissas em produção. Em particular, um parâmetro `coveragePeriodVerified=true` vindo do navegador, de Webhook ou de um booleano arbitrário **não prova nada** e **não pode alimentar o modelo**. Só um serviço controlado, com evidências do provedor e política contratual específica aprovada, poderia determinar datas de início/fim e produzir um período auditável.

O primeiro pagamento fictício foi aprovado no Mercado Pago em **19/10/2026**, com nova cobrança prevista para **19/11/2026** antes do cancelamento pelo comprador. A comparação de datas indica cadência mensal consistente, mas **a data da próxima cobrança não demonstra o fim do direito de acesso**. Por isso o auditor retorna `coveragePeriodVerified=false`, `paidThrough=null` e `grantsStudentAccess=false` até existir prova independente.

## Política de acesso proposta para decisão FUTURA — não autorizada ainda

1. **Aprovação administrativa vem primeiro:** perfis pendentes ou suspensos não acessam conteúdo. A política atual permanece intacta.
2. **Contas legadas:** um perfil previamente existente, com registro explícito em `billing_exemptions` e ainda aprovado administrativamente, mantém acesso. Não criar cobrança para quem é isento.
3. **Novos alunos não isentos:** não admitir com base apenas em `preapproval.status=authorized`, `next_payment_date` ou corpo de Webhook. Requerer pagamento efetivamente aprovado, não reembolsado/contestado, pertencente ao aluno, na moeda e no valor corretos, com período contratual de cobertura conhecido e auditado.
4. **Vencimento:** encerrar acesso exatamente no fim do período efetivamente pago, sem tolerância adicional. Rejeições ou cobranças futuras não renovam cobertura.
5. **Cancelamento:** a proposta a ser decidida é preservar acesso **somente** até o término de um período previamente pago e verificado. Essa regra ainda depende de aprovação e de confirmação com os termos comerciais.
6. **Operação:** usar conciliação servidor periódica para compensar atrasos/perdas de Webhook; processar reembolsos, chargebacks, falhas, pausas e reativações com idempotência e evidências.
7. **Segurança:** controlar e limitar privilégios de tabelas e funções privadas, preservar `search_path` seguro e evitar políticas acessíveis a qualquer usuário autenticado. Auditar `SECURITY DEFINER`, grants e testes end-to-end de RLS antes da mudança.
8. **Rollback:** planejar corte reversível; estado administrativo e isenções não podem ser sobrescritos por erros financeiros.

## Critérios de aprovação antes de tocar RLS

- Documentar pelo provedor a **fonte confiável do período de serviço** e vincular recibos à assinatura correta, inclusive cancelamentos.
- Confirmar o canal e a assinatura das notificações Mercado Pago para `POST /preapproval`, ou aprovar uma estratégia alternativa de consulta periódica monitorada.
- Exercitar end-to-end no sandbox: aprovada, recusada, renovação, inadimplência, cancelamento, estorno, reativação e isenção.
- Materializar as isenções de **todos** os perfis criados até o instante formal de go-live.
- Obter autorização expressa para rollout, regras contratuais, credenciais reais e migração de RLS.
- Executar ensaios de RLS que demonstrem contas isentas, contas pagas, contas com pagamento expirado, editor e suspensão administrativa.
- Publicar mecanismo de observabilidade e recuperação de falhas sem expor tokens ou dados financeiros do usuário.

## Questão técnica para o suporte Mercado Pago

O endpoint oficial `POST /preapproval` de assinatura **sem plano associado** documenta `external_reference`, `payer_email`, `auto_recurring` e `back_url`, mas não confirma `notification_url` na referência aberta. A documentação de Webhooks para Assinaturas afirma que a configuração pelo painel `Suas integrações` não está disponível e remete à criação do pagamento.

Solicitar explicitamente ao suporte do Mercado Pago, sem fornecer credenciais, dados do comprador ou IDs sensíveis:

- **Qual endpoint ou campo oficialmente suportado** recebe a URL de Webhook ao criar recorrência por `POST /preapproval` sem plano?
- Quais tópicos são efetivamente entregues (`subscription_preapproval`, `subscription_authorized_payment`, `payment`), em quais momentos, e como funciona a assinatura `x-signature` nesse fluxo?
- Qual é a configuração suportada no ambiente de homologação com vendedor de teste? O campo `live_mode` será sempre `false` ou pode variar conforme o token vendedor e a origem da notificação?
- **Qual recurso ou contrato confirma de modo auditável as datas de início e fim do período de serviço** referente a cada fatura aprovada? `next_payment_date` é apenas agendamento da próxima cobrança?
- Em cancelamento pelo pagador, uma fatura anteriormente aprovada mantém seu período de serviço até quando? E em reembolso/chargeback?

Fontes oficiais conferidas em 20/10/2026:

- https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/create-preapproval/post

**Este PR não ativa a Fase 5.** `private.has_content_access()`, todas as políticas RLS, `billing_subscriptions`, `billing_payments`, `profiles` e os dois usuários isentos ficam sem alterações.
