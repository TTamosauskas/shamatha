# Shamatha — Conciliação automática em homologação

Status em 20/10/2026: função Edge implantada em versão 3 com `verify_jwt=false` **somente porque valida assinaturas HMAC próprias**. A flag de conciliação continua DESATIVADA, e **nenhum Cron foi agendado**. Nenhuma cobrança, RLS ou permissão de alunos mudou.

## Histórico do primeiro teste: proteção JWT de gateway em 19/10/2026

Após o merge do PR #58, a versão 1 (e posteriormente a versão 2) foi implantada com `verify_jwt=true`. Um POST sem Authorization retornou **401 UNAUTHORIZED_NO_AUTH_HEADER** no gateway. Naquele momento não havia segredo configurado nem agendamento.

Em **20/10/2026**, após a criação dos segredos pelo proprietário, esse mecanismo foi **substituído pela verificação HMAC no handler** (`verify_jwt=false` na versão 3). O teste anterior fica registrado apenas como histórico e **não descreve a configuração atual**.

## Autenticação HMAC validada em 20/10/2026

O proprietário configurou os segredos `SHAMATHA_MP_SANDBOX_CRON_SECRET` em **Edge Function Secrets** e `shamatha_sandbox_cron_secret` no **Vault**. Uma checagem local validou que o segredo do Vault possui 32 caracteres. Como ele contém caracteres não aceitos pelo antigo token Bearer, a autenticação foi substituída por **assinatura HMAC-SHA256**. O segredo nunca aparece nos headers HTTP; só uma assinatura derivada e o timestamp.

A Edge Function `shamatha-mp-sandbox-periodic` usa o módulo `supabase/functions/_shared/mercadopago-sandbox-cron-auth.mjs`, e a requisição interna precisa enviar:

- `x-shamatha-ts`: segundos Unix, dez dígitos.
- `x-shamatha-signature`: HMAC-SHA256 hexadecimal de `shamatha-sandbox-periodic:v1\\nPOST\\n<TIMESTAMP>`, usando o segredo UTF-8 do Vault.
- Janela máxima: cinco minutos para trás ou à frente, sem alteração de método ou contexto.
- O handler exige a assinatura **antes** de verificar a flag de conciliação; o desvio da assinatura recebe 401 mesmo se o serviço estiver desativado.
- A função está em **`verify_jwt=false`**, já que o header é autenticado por HMAC próprio. **Não remover a validação HMAC.**
- Quatro testes via `pg_net` executados e verificados: sem assinatura **401 INVALID_CRON_AUTH**, HMAC incorreto **401 INVALID_CRON_AUTH**, HMAC válido com timestamp expirado em dez minutos **401 INVALID_CRON_AUTH**, HMAC correto usando o segredo apenas dentro do Vault **503 SANDBOX_CRON_DISABLED**. O último retorno comprova a autenticação interna e confirma a flag desativada, não uma execução do reconciliador.
- O verificador foi ensaiado em 10 testes locais de HMAC/timestamps; nenhum dado sensível foi registrado. Não houve chamada de GET ao Mercado Pago nestes testes.

### Agendamento FUTURO — SQL de referência, NÃO EXECUTAR nesta etapa

Depois de habilitar explicitamente `SHAMATHA_MP_SANDBOX_AUTO_RECONCILE_ENABLED=true` no painel e comprovar **uma conciliação assinada manual**, pode-se criar um job de seis em seis horas. Este exemplo consulta o segredo do Vault só no servidor do banco, assina o timestamp e envia **apenas o digest**. Não armazena o segredo no Cron nem em arquivo do GitHub.

~~~sql
-- NÃO EXECUTAR antes de validação de conciliação assinada com a flag habilitada.
select cron.schedule(
  'shamatha-sandbox-invoice-reconcile',
  '0 */6 * * *',
  $job$
  with stamp as (
    select floor(extract(epoch from clock_timestamp()))::bigint::text as ts
  ), secret as (
    select decrypted_secret as private_key
    from vault.decrypted_secrets
    where name = 'shamatha_sandbox_cron_secret'
  )
  select net.http_post(
    url := 'https://zglitbtwzntpchzhrdcy.supabase.co/functions/v1/shamatha-mp-sandbox-periodic',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-shamatha-ts',stamp.ts,
      'x-shamatha-signature',encode(extensions.hmac(
        'shamatha-sandbox-periodic:v1' || chr(10) || 'POST' || chr(10) || stamp.ts,
        secret.private_key,'sha256'
      ),'hex')
    ),
    timeout_milliseconds := 10000
  ) from stamp cross join secret;
  $job$
);
~~~

Antes de agendar: verificar log de faturas, idempotência, status e resposta HTTP, ajustar paginação e instrumentar alertas; aprovar explicitamente o início das consultas periódicas. O conciliador consulta apenas o vendedor fictício, não produz `paidThrough` nem libera acesso.

## Por que este componente existe

O Mercado Pago lista eventos de subscription_preapproval, subscription_authorized_payment e payment, mas ressalva que configurar Webhooks de Assinaturas via “Suas integrações” não é suportado. A forma exata de entregar notificações na integração POST /preapproval ainda precisa ser homologada. O reconciliador periódico verifica as faturas diretamente na API, independentemente de uma notificação, para lidar com atrasos ou perdas.

## Código preparado

- Auditor puro: supabase/functions/_shared/mercadopago-sandbox-invoices.mjs. Verifica vendedor fictício 3778352536, preapproval_id, external_reference, e-mail quando informado, valor R$180 BRL, frequência mensal, pertença de cada fatura à assinatura e pagamento obtido via GET /v1/payments/{id}. Rejeita lotes incompletos acima de 10 faturas. **21 testes sintéticos aprovados**, inclusive cobrança recusada, vínculo falsificado e tentativa de reutilização de IDs.
- Função de agendamento: supabase/functions/shamatha-mp-sandbox-periodic/index.ts. **Na main pelo PR #58, atualizada para HMAC no servidor (v3) e sem Cron.** Nenhum pedido de pagamento e nenhuma alteração de acesso. Se futuramente habilitada, fará a conciliação dos registros da conta fictícia apenas em billing_sandbox_invoice_observations e atualizará last_checked_at de billing_sandbox_attempts.
- Nunca determina o período de acesso: coveragePeriodVerified=false, paidThrough=null, grantsStudentAccess=false.
- Proteção de chamada: HMAC-SHA256 do timestamp com SHAMATHA_MP_SANDBOX_CRON_SECRET; segredo nunca sai do Vault/Edge Functions. A função exige a flag SHAMATHA_MP_SANDBOX_AUTO_RECONCILE_ENABLED=true; por padrão fica desativada. Não adiciona CORS para navegador.
- O protótipo recusa mais de 10 assinaturas ou mais de 10 faturas, em vez de ignorar silenciosamente registros. Deve ganhar paginação e monitoramento antes de produção.

## Próximas etapas (não executar sem autorização)

1. **Concluído:** segredo cadastrado no Vault e na Edge Function, módulo HMAC implantado, `verify_jwt=false` com verificação própria e testes negativos/positivos realizados com a flag desligada.
2. **Pendente:** habilitar `SHAMATHA_MP_SANDBOX_AUTO_RECONCILE_ENABLED=true` **somente na função fictícia**, após autorização para iniciar consultas remotas. Isso não habilita criação de assinaturas, nem pagamento real.
3. Fazer uma única chamada HMAC assinada via `pg_net` sem agendamento e verificar diretamente a mesma fatura já cadastrada, sem duplicações ou alterações no acesso de alunos. Corrigir divergências se houver.
4. Após sucesso, avaliar alertas/monitoramento, paginação e um Cron de seis em seis horas; não criar job antes da verificação manual.
5. Separadamente, concluir Webhooks, períodos de cobertura e verificação do controle de acesso antes de qualquer publicação financeira.

**Não há agendamento ativo; a função foi implantada com autenticação HMAC e conciliação desativada.** A conciliação manual da conta fictícia permanece aprovada. O Mercado Pago poderá cobrar novamente a assinatura fictícia em sua próxima recorrência independentemente deste job.

Documentação oficial:
- https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/create-preapproval/post
- https://supabase.com/docs/guides/functions/schedule-functions
