# Shamatha — Conciliação automática em homologação

Status em 19/10/2026: **Edge Function implantada com JWT obrigatório, mas execução desativada e sem agendamento**. Nenhum checkout, bloqueio ou cobrança real foi ativado.

## Smoke test em Supabase

- PR #58 mesclado pelo proprietário, GitHub Pages publicado com sucesso.
- `shamatha-mp-sandbox-periodic` versão **1** implantada como ACTIVE com **`verify_jwt=true`**, mesmo contendo verificação adicional de segredo no handler. Esta é uma etapa intermediária intencional para impedir uso externo.
- Foi enviada **uma** chamada HTTP POST sem `Authorization` via `pg_net`. Resposta capturada: **HTTP 401**, `UNAUTHORIZED_NO_AUTH_HEADER`. Assim, a rejeição no gateway foi verificada sem executar código de conciliação nem acessar pagamentos.
- O Supabase tem `pg_cron` e `pg_net`, porém nenhum job denominado `shamatha-sandbox-invoice-reconcile` está cadastrado.
- **Nenhum segredo de cron correspondente foi configurado no Vault**; o conector disponível não expõe a configuração de Secrets de Edge Functions. O segredo deve ser configurado pelo proprietário no dashboard e espelhado no Vault de modo seguro, sem compartilhá-lo neste chat.
- A rotina só poderá chegar ao handler após a implantação futura com `verify_jwt=false`, quando o segredo customizado tiver sido instalado, testado e a flag `SHAMATHA_MP_SANDBOX_AUTO_RECONCILE_ENABLED=true` estiver explicitamente aprovada. **Não alterar a proteção JWT antes disso.**
- O teste de execução válida que consulta faturas na API do Mercado Pago **continua pendente**, assim como duplicação por job agendado, alertas e monitoramento. O smoke test HTTP 401 NÃO é validação de reconciliação automática.



## Por que este componente existe

O Mercado Pago lista eventos de subscription_preapproval, subscription_authorized_payment e payment, mas ressalva que configurar Webhooks de Assinaturas via “Suas integrações” não é suportado. A forma exata de entregar notificações na integração POST /preapproval ainda precisa ser homologada. O reconciliador periódico verifica as faturas diretamente na API, independentemente de uma notificação, para lidar com atrasos ou perdas.

## Código preparado

- Auditor puro: supabase/functions/_shared/mercadopago-sandbox-invoices.mjs. Verifica vendedor fictício 3778352536, preapproval_id, external_reference, e-mail quando informado, valor R$180 BRL, frequência mensal, pertença de cada fatura à assinatura e pagamento obtido via GET /v1/payments/{id}. Rejeita lotes incompletos acima de 10 faturas. **21 testes sintéticos aprovados**, inclusive cobrança recusada, vínculo falsificado e tentativa de reutilização de IDs.
- Função de agendamento: supabase/functions/shamatha-mp-sandbox-periodic/index.ts. **Na main pelo PR #58, instalada no Supabase com execução desativada e gateway JWT obrigatório.** Nenhum pedido de pagamento e nenhuma alteração de acesso. Se futuramente habilitada, fará a conciliação dos registros da conta fictícia apenas em billing_sandbox_invoice_observations e atualizará last_checked_at de billing_sandbox_attempts.
- Nunca determina o período de acesso: coveragePeriodVerified=false, paidThrough=null, grantsStudentAccess=false.
- Proteção de chamada: cabeçalho Authorization: Bearer com SHAMATHA_MP_SANDBOX_CRON_SECRET de alta entropia, distinto do token do Mercado Pago e da service_role. A função exige a flag SHAMATHA_MP_SANDBOX_AUTO_RECONCILE_ENABLED=true; por padrão fica desativada. Não adiciona CORS para navegador.
- O protótipo recusa mais de 10 assinaturas ou mais de 10 faturas, em vez de ignorar silenciosamente registros. Deve ganhar paginação e monitoramento antes de produção.

## Etapas futuras de implantação (não executar sem aprovação)

1. **Já feito:** instalar a função isolada com `verify_jwt=true` e demonstrar rejeição HTTP 401 sem autenticação. **Pendente:** configurar segredo de cron no Vault e nos Secrets da Edge Function; testar também o segredo incorreto e o correto em chamada manual; só então mudar `verify_jwt=false` pois o próprio handler validará `Authorization` com um segredo forte. Não publicar endpoint sem essa proteção.
2. Criar uma única senha cron aleatória e guardá-la tanto no Supabase Vault quanto em Secrets da Edge Function. Guardar URL do projeto e chave publishable no Vault. Não escrever tokens reais ou segredos no repositório.
3. Verificar suporte e configuração de pg_cron + pg_net no Supabase. Agendar inicialmente a cada 6 horas, após os testes manuais, com chamada HTTP POST interna e autenticação. Registrar falhas, expiração de requisições, limites e alertas.
4. Testar repetição idempotente (mesma fatura deve permanecer única), simulação de erro da API, retorno de falha e perda de notificação.
5. Validar separadamente uma função de produção, isenções, períodos de cobertura, webhook real e política de acesso antes de qualquer cobrança.

**Não há agendamento ativo; a função foi implantada somente em modo bloqueado.** A conciliação manual da conta fictícia permanece aprovada. O Mercado Pago poderá cobrar novamente a assinatura fictícia em sua próxima recorrência independentemente deste job.

Documentação oficial:
- https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/create-preapproval/post
- https://supabase.com/docs/guides/functions/schedule-functions
