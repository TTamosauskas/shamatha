# Shamatha — ativação de assinaturas públicas R$ 180/mês

## Estado e decisão

Este documento acompanha a **branch de ativação**, criada depois da publicação do
PR #67. O proprietário decidiu que, após os testes de comprador/vendedor, **qualquer
novo aluno elegível** poderá assinar, sem restrição a uma conta piloto. Isto
significa **cobranças reais recorrentes para qualquer pessoa que conheça a URL**.
O fato de o site não ter sido divulgado **não é uma barreira de acesso**.

**Não executar parcialmente**: a branch habilita a interface e retira a trava
compilada, mas depende de **três controles privados independentes**, além de
conciliação, cancelamento, cron e RLS. No momento da preparação, ela é apenas
uma proposta em PR, sem deploy, sem migrar para cobrança obrigatória e sem
alterar os Secrets da produção.

## Interface exata — GitHub

1. PR #67 (site/base): https://github.com/TTamosauskas/shamatha/pull/67
   — incorporado à main, sem cobrar. Site: https://ttamosauskas.github.io/shamatha/
2. PR de ativação (criado a partir desta branch): revisar testes, pendências,
   diff de `assets/config.js`, `supabase/functions/shamatha-create-subscription/index.ts`
   e este procedimento. **Não dar merge antes de concluir tudo a seguir**.
3. O deploy da Edge Function NÃO é efetuado automaticamente por um merge
   neste repositório; é uma etapa separada no Supabase.

## Interface exata — Supabase

- Secrets para Edge Functions:
  https://supabase.com/dashboard/project/zglitbtwzntpchzhrdcy/settings/functions
  (Edge Functions → Secrets; informar **Key**, **Value**, clicar **Save**).
- Edge Functions:
  https://supabase.com/dashboard/project/zglitbtwzntpchzhrdcy/functions
- SQL Editor:
  https://supabase.com/dashboard/project/zglitbtwzntpchzhrdcy/sql/new
- Users / Authentication:
  https://supabase.com/dashboard/project/zglitbtwzntpchzhrdcy/auth/users

## Portas de segurança e sequência obrigatória

### 1. Confirmar proteção dos alunos existentes

Consultar o banco para verificar que todos os perfis anteriores terão isenção.
A ativação final de `enforce_payment=true` deve ocorrer ANTES do cadastro de
alunos sujeitos à cobrança. O script
`ops/BILLING_MVP_ACTIVATE_ONLY_AFTER_APPROVAL.sql` faz a isenção dos
perfis existentes na própria transação e interrompe se alguma falhar.

Não rodar esse script até que as verificações e o cancelamento funcionem,
pois ele retira acesso ao conteúdo de novos alunos sem pagamento aprovado.

### 2. Primeiro disponibilizar verificação e cancelamento

No painel de **Secrets**:
- `SHAMATHA_BILLING_RECONCILE_ENABLED` = `true`
- `SHAMATHA_MP_PRODUCTION_CANCEL_ENABLED` = `true`

Confirmar que as funções
`shamatha-reconcile-subscription` e `shamatha-cancel-subscription`
estão implantadas com JWT válido. A função de cancelamento precisa
continuar habilitada mesmo se a criação de novas assinaturas for pausada.

### 3. Implantar conciliação periódica ANTES de aceitar assinaturas

A função `shamatha-billing-periodic` usa `verify_jwt=false`
somente porque ela própria valida um segredo Bearer independente,
com pelo menos 32 caracteres, antes de tocar o banco.

- Definir `SHAMATHA_BILLING_CRON_SECRET` via Secrets.
- Definir `SHAMATHA_BILLING_PERIODIC_ENABLED=true`.
- Criar dois Secrets no **Supabase Vault**, exatamente
  `shamatha_billing_project_url` e `shamatha_billing_cron_secret`,
  com valores, respectivamente, da URL do projeto e do **mesmo**
  segredo Bearer da Edge Function. O valor NÃO deve ser salvo
  em Github, chat, logs ou editor de código público.
- Executar no SQL Editor, de forma separada,
  `ops/BILLING_PERIODIC_SCHEDULE_ONLY_AFTER_APPROVAL.sql`.
- Confirmar que existe 1 job
  `shamatha-billing-periodic-quarter-hour` e que executa
  sem erros. **Não usar o cron de produção para efetuar testes
  com credenciais de uma conta Mercado Pago de teste**.

Se essa etapa falhar, manter a criação de assinatura desligada.
A conciliação periódica é necessária para que cancelamentos,
renovações, recusas e estornos não dependam da próxima visita do aluno.

### 4. Preparar o backend de checkout, ainda com a criação DESLIGADA

Implantar o novo `shamatha-create-subscription` do PR de ativação
com **`verify_jwt=true`**, contendo:

```ts
const PRELAUNCH_CHECKOUT_LOCKED = false;
```

As seguintes verificações privadas permanecem obrigatórias:

```
SHAMATHA_BILLING_PRODUCTION_ENABLED=true
SHAMATHA_BILLING_FINAL_LAUNCH_APPROVED=true
SHAMATHA_MP_PRODUCTION_CREATE_ENABLED=true
```

**Não colocar essas três flags em `true` ainda.** Confirmar que
`SHAMATHA_MP_PRODUCTION_ACCESS_TOKEN` e
`SHAMATHA_MP_PRODUCTION_SELLER_ID` correspondem à mesma conta
vendedora REAL. Não usar o Seller ID antigo fictício, contas de teste
ou valores vistos em exemplos da documentação.

### 5. Ativar cobertura obrigatória para NOVOS usuários

Após confirmar os passos anteriores, executar no SQL Editor o
arquivo `ops/BILLING_MVP_ACTIVATE_ONLY_AFTER_APPROVAL.sql`.
O script não altera o status de aprovação administrativa.
Alunos antigos continuam isentos; novos alunos precisam de
`access_status='approved'` **e** comprovante financeiro aprovado.
O pagamento pode ser iniciado antes da aprovação do editor, mas não
libera conteúdo sozinho.

Se a isenção não abranger todos os perfis atuais, **parar e corrigir**
antes de habilitar checkout.

### 6. Publicar a interface e autorizar a criação para TODOS

Depois do merge e deploy do PR de ativação, `assets/config.js`
passa a expor:

```js
billingUiEnabled: true,
billingCheckoutEnabled: true,
billingReconcileEnabled: true,
billingCancelEnabled: true,
```

Esse arquivo só altera a **interface**, não fornece permissão de
cobrança. Para finalmente permitir contratos de **R$ 180/mês**,
salvar os três controles privados listados no passo 4 com valor `true`.
Nesse momento, a criação fica aberta a **qualquer aluno novo**
com e-mail confirmado, sem isenção, status administrativo não
suspenso e aceite válido dos termos.

### 7. Teste manual e liberação de divulgação

Abrir o site e criar uma conta **somente depois** da ativação do RLS,
para ela não herdar isenção. Conferir em `minha-assinatura.html`:
- texto e aceite dos termos para cobrança mensal real R$ 180;
- checkout Mercado Pago no vendedor correto;
- registro remoto de uma assinatura e 1º pagamento;
- ausência de acesso somente pelo redirect `checkout=return`;
- período pago aprovado pelo servidor e aprovação administrativa;
- cancelar renovação e verificar no Mercado Pago;
- testagem de estorno, contestação e vencimento com provas;
- logs de erro e procedimento de suporte.

**Qualquer passo com cartão/PIX real pode movimentar R$ 180 ou mais ao longo
das renovações.** O cancelamento não garante reembolso do primeiro mês.
Se não puder conferir esses itens, não divulgar e manter checkout bloqueado.

### 8. Reversão e incidentes

Para impedir imediatamente **novas contratações**, no painel de
Secrets definir
`SHAMATHA_MP_PRODUCTION_CREATE_ENABLED=false`
(e também `SHAMATHA_BILLING_PRODUCTION_ENABLED=false`
se necessário).
Desativar `billingCheckoutEnabled` na interface e publicar a mudança
posteriormente.

**Não** desabilitar o cancelamento dos assinantes existentes
e **não** desligar a conciliação periódica sem um processo humano
de acompanhamento de estornos e renovações.

Rollback emergencial do requisito financeiro (libera
temporariamente acesso pelo fluxo administrativo; não cancela cobranças):

```sql
update private.billing_access_control
set enforce_payment=false,updated_at=now()
where singleton=true;
```

Cancelar a assinatura no Mercado Pago é independente de revogar acesso
no Shamatha. Não apagar históricos e não duplicar cobranças tentando
novamente quando a resposta do provedor for incerta.

## Verificação rápida

```sql
select
  (select enforce_payment from private.billing_access_control
   where singleton=true) as enforce_payment,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.billing_exemptions) as exemptions,
  (select count(*) from public.billing_subscriptions
   where environment='production') as production_subscriptions,
  (select count(*) from public.billing_payments) as payments,
  (select count(*) from cron.job
   where jobname='shamatha-billing-periodic-quarter-hour') as cron_jobs;
```

**Aviso:** nenhuma interface de Secrets no painel deve receber o token
de produção em arquivo do GitHub, screenshot ou chat.
