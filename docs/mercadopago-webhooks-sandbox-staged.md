# Shamatha — receptor de Webhooks de Assinaturas, somente código

Atualizado em 20/10/2026. **Não foi implantado um receptor público, não foi configurado Webhook no Mercado Pago e não houve novas assinaturas/cobranças.**

## O que a documentação oficial confirma

A página de Webhooks do Mercado Pago para Assinaturas lista os eventos `subscription_preapproval`, `subscription_authorized_payment` e `payment`. O mecanismo normal de configuração pelo painel **Suas integrações** não está disponível para Assinaturas; a mesma página aponta a configuração durante a criação de pagamentos.

Entretanto, o endpoint `POST /preapproval` empregado no projeto para gerar assinaturas mensais ainda não documenta claramente um campo `notification_url` na referência consultada. **Não presumir** que adicionar esse campo ao POST instalará as notificações, nem usar a chave de Webhook de outra integração como se correspondesse ao vendedor fictício. Confirmar formalmente com suporte/documentação específica do provedor, usando a configuração de Assinaturas sem plano associado, antes de ativar o receptor.

Documentação:

- https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/create-preapproval/post
- https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/your-integrations/notifications/additional-info

## Receptor proposto — sem deployment

`supabase/functions/shamatha-mp-sandbox-webhook/index.ts`, na branch de homologação, fica inerte sem as configurações `SHAMATHA_MP_SANDBOX_WEBHOOK_SECRET` e `SHAMATHA_MP_SANDBOX_WEBHOOK_ENABLED=true` (ambas ausentes/desligadas por padrão). Não basta fazer merge: a implantação precisa ser uma ação posterior, deliberada e revisada, depois de comprovar a origem das notificações.

Proteções propostas:

1. Aceita somente POST, sem CORS para navegador, corpo de até 16 KiB e sem parâmetros financeiros definidos pelo cliente.
2. Confere assinatura `x-signature` e `x-request-id` contra o `data.id` da URL pelo módulo HMAC isolado. Eventos com assinatura inválida recebem 401.
3. Valida o corpo estritamente para os três tópicos acima, com `live_mode=false`, `user_id=3778352536`, IDs de recurso e evento limitados, e `data.id` igual à URL assinada. **A forma real do corpo de sandbox precisa ser comprovada**; enquanto isso, falhar fechado é preferível.
4. Persiste somente campos saneados na tabela privada `billing_webhook_events`, com chave única por tópico + ID permanente do evento e `ignoreDuplicates=true`. Retransmissão do mesmo evento não cria duplicata.
5. Grava `processing_status=verified_requires_reconciliation`: isso confirma apenas validação de assinatura/formato, **não** o vínculo efetivo da fatura ao vendedor, ao aluno ou o período pago.
6. Não consulta/atualiza `profiles`, `billing_exemptions`, `billing_subscriptions`, `billing_payments`, acesso RLS ou progresso, e **nunca concede acesso**. Um conciliador servidor separado precisa consultar os detalhes da assinatura/fatura/pagamento na API do vendedor antes de qualquer interpretação de cobrança.

## Validação feita

- **18 testes sintéticos** do módulo `mercadopago-sandbox-webhook-payload.mjs` aprovados em executor JS isolado (não é teste de rede nem de integração Deno).
- O módulo HMAC `mercadopago-webhook-signature.mjs` e seus **10 testes sintéticos anteriores** estão na `main` depois do PR #61. Não houve reexecução end-to-end do verificador HMAC nesta entrega.
- Verificações estáticas: flag OFF por padrão, uso somente da tabela privada, assinatura antes da gravação, nenhum fetch de cobrança, nenhuma permissão de aluno e deduplicação por evento.
- Receptor **NÃO implantado**, a tabela privada segue com **zero notificações reais recebidas**.

## Próxima decisão técnica

Antes de implantação, comprovar a documentação ou obter a orientação do Mercado Pago sobre **entrega de notificações de Assinaturas criadas sem plano por `POST /preapproval`**, incluindo secret real correspondente, formato dos eventos e a convenção de assinatura no sandbox. A conciliação autenticada pela API já demonstrou detectar cancelamento, preservar histórico e não conceder acesso. Cron automático ainda não foi criado e só poderá ser tratado separadamente.

**Nenhuma alteração nesta entrega autoriza cobrar alunos ou ativar RLS financeiro.** O PR #49 continua rascunho e não deve ser mesclado automaticamente.
