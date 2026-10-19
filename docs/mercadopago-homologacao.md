# Mercado Pago no Shamatha — homologacao isolada

Status em 19/10/2026: schema preparatorio aplicado ao Supabase; Edge Function de teste publicada com JWT obrigatório, mas CRIACAO DE ASSINATURA DESABILITADA por falta de habilitacao e credencial. Site, cadastro e acesso antigos intactos. PR ainda em rascunho, sem merge.

## Regras aprovadas
- Assinatura: R$ 180,00 BRL, uma vez por mes.
- Novos alunos apos ativacao futura: acesso somente apos cobranca confirmada.
- Vencimento do periodo pago sem renovacao: zero dias de tolerancia.
- Usuarios existentes quando ocorrer a ativacao: isentos (snapshot ANTES de ligar a regra de acesso).
- Progresso e conteudo nao serao apagados quando um pagamento falhar.

## Arquitetura preparatoria nesta branch
- Migration: `supabase/migrations/20261019172827_billing_sandbox_foundation.sql`.
- Edge Function: `supabase/functions/shamatha-mp-sandbox/index.ts`.
- Pagina de homologacao servida pelo Supabase: `supabase/functions/shamatha-mp-test-ui/index.ts` (login efemero do editor, sem armazenar tokens).
- Nao foram modificados login, autorizacao, RLS das tabelas antigas ou UI de usuarios.

O SQL adiciona tabelas com RLS, sem escrita direta pelo cliente, mas NAO muda nenhuma
policy existente. As tabelas de teste guardam somente experimentos; nenhuma assinatura
real e criada pela migracao. Nao aplicar a migracao para outros projetos sem revisao.

## Acoes do titular da conta Mercado Pago
1. Acesse https://www.mercadopago.com.br/developers/panel/app e configure uma
   aplicacao separada para os testes Shamatha.
2. Em Contas de teste, crie/identifique duas contas do BRASIL: uma vendedora e
   outra compradora. Salve os acessos em um gerenciador de senhas.
3. Para TESTES de Assinaturas, a documentacao do MP descreve o uso de
   credenciais de producao da CONTA FICTICIA VENDEDORA. NAO use credenciais
   produtivas da conta comercial verdadeira.
   Referencia: https://www.mercadopago.com.br/developers/pt/news/2023/11/16/Questions-on-how-to-test-your-integration--
4. Confirme o email ficticio do COMPRADOR de teste (@testuser.com).
5. Nao envie tokens ou senhas no chat e nao adicione tokens ao repositorio.

## Preparacao Supabase, SOMENTE apos revisao da branch
1. FEITO: projeto `zglitbtwzntpchzhrdcy` confirmado; tabelas de billing criadas sem modificar policies existentes, via migration registrada como `20261019172827_billing_sandbox_foundation`.
2. FEITO: RLS conferida; auditoria apontou duas tabelas RLS sem policies de leitura, deliberadamente inacessiveis ao browser.
3. FEITO: deploy da Edge Function `shamatha-mp-sandbox` com `verify_jwt=true` (status ACTIVE).
4. PENDENTE, a cargo do titular: em Edge Functions > Secrets, adicionar:
   - `SHAMATHA_MP_SANDBOX_SELLER_TOKEN`: access token da CONTA FICTICIA vendedora.
   - `SHAMATHA_MP_SANDBOX_CREATE_ENABLED`: manter como `false` ate teste autorizado.
5. PENDENTE: verificar GET autenticado da funcao como editor principal, que deve retornar
   `productionBillingEnabled:false`, valor 18000 (centavos), e `enabled:false`.
6. Somente depois da validacao do comprador e vendedor ficticios, alterar `SHAMATHA_MP_SANDBOX_CREATE_ENABLED=true`.
7. FEITO: `shamatha-mp-test-ui` publicada separadamente. Abra `https://zglitbtwzntpchzhrdcy.supabase.co/functions/v1/shamatha-mp-test-ui`; autentique-se como editor principal do Shamatha. A senha sera enviada apenas ao Supabase Auth e o token so sera mantido em memoria nesta pagina. Verifique se o Access Token esta presente e confira se o ID do vendedor retornado eh o mesmo da conta vendedora de teste no Mercado Pago.
8. Depois de verificar os IDs e credenciais, altere `SHAMATHA_MP_SANDBOX_CREATE_ENABLED=true` no Supabase. Volte a pagina de homologacao, clique Verificar novamente e informe o e-mail comprador ficticio para criar UM link de teste.
9. Apos teste, volte `SHAMATHA_MP_SANDBOX_CREATE_ENABLED=false`. Nao use cartao real.

## Salvaguardas
- Test checkout exige JWT e editor principal aprovado.
- Token fica em variavel secreta do Supabase e nunca em paginas publicas.
- Email do pagador precisa ser `@testuser.com`.
- Somente o modo `sandbox` e aceito, com habilitacao separada por flag.
- Tentativas repetidas do mesmo comprador retornam o mesmo link ou pedem revisao,
  em vez de solicitar automaticamente nova assinatura.
- Nao ha webhook de cobranca nem desbloqueio financeiro neste prototipo.
- Nao conceder acesso a nenhum aluno com base apenas em `status=authorized`.
- Nunca supor que o retorno em `back_url` significa que o pagamento foi aprovado.

## Testes planejados
- GET com credenciais editor principal e feature desligada => enabled false.
- GET como aluno ou sem JWT => negado.
- POST com feature desligada => negado sem chamada Mercado Pago.
- POST com email fora de @testuser.com => negado.
- POST com comprador ficticio e feature ligada => checkout de teste.
- POST repetido => reuso de link; nenhuma duplicacao de assinatura.
- Mesmo com retorno do checkout => nenhum acesso liberado.
- Verificar no Mercado Pago evento de pagamento e detalhes da fatura.

## Fases posteriores — NAO implementadas nesta PR
- Webhook seguro de assinaturas e pagamentos + conferencia com API do Mercado Pago.
- Conciliacao periodica das cobrancas e estabelecimento de `paid_through`.
- Snapshot dos usuarios que ficarao isentos e regra de acesso por assinatura.
- Tela de pagamento no cadastro, tela Minha assinatura e coluna Assinatura no editor.
- Testes completos de inadimplencia, reembolso, renovacao e cancelamento.

ATENCAO: A documentacao de Webhooks de Assinaturas indica excecao na
configuracao via painel; verificar a configuracao especifica antes da fase seguinte:
https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks

## Alerta de credencial para assinatura Mercado Pago

Para o caso especifico **Assinatura sem plano, status pending**, o Mercado Pago orienta usar o Access Token da aba **Credenciais de producao da aplicacao criada DENTRO DA CONTA FICTICIA VENDEDORA**. Isso nao equivale ao token da conta comercial verdadeira, que jamais deve ser usado nesta etapa. Se a aplicacao foi criada apenas na conta comercial verdadeira, entrar na conta ficticia vendedora e criar outra aplicacao de teste.

Fonte: https://www.mercadopago.com.br/developers/pt/news/2023/11/16/Questions-on-how-to-test-your-integration--

Salvar secretos por https://supabase.com/dashboard/project/zglitbtwzntpchzhrdcy/settings/functions (ou projeto > Edge Functions > Secrets); nao compartilhar valor no chat ou em commits. A flag `SHAMATHA_MP_SANDBOX_CREATE_ENABLED` deve permanecer `false` ate a validacao inicial.

## Verificacao apos instalacao preparatoria

- `profiles`: 2 linhas; `stages`: 18 linhas.
- `billing_subscriptions`: 0 linhas; `billing_sandbox_attempts`: 0 linhas.
- `shamatha-mp-sandbox`: publicada, `verify_jwt: true`.
- Relatorio Supabase Security Advisor: `rls_enabled_no_policy` INFO nas tabelas internas `billing_sandbox_attempts` e `billing_webhook_events`, de forma intencional. Outros alertas sobre `pg_net` no schema public e Leaked Password Protection nao pertencem a esta integracao e devem ser avaliados separadamente.
- Nao houve teste de checkout nem chamada autenticada ainda.

## Adicao ao fluxo de homologacao — checagem do vendedor

A funcao `shamatha-mp-sandbox` agora verifica a identidade da conta que emitiu o Access Token pela API de leitura `/users/me`, sem revelar o token. O painel apresenta somente o ID e exige que ele seja explicitamente confirmado antes de permitir criar assinaturas. Se o ID nao corresponder ao VENDEDOR ficticio de teste (visivel no painel do Mercado Pago), PARE e confira a credencial.

**Link direto:** https://zglitbtwzntpchzhrdcy.supabase.co/functions/v1/shamatha-mp-test-ui

Deploy do painel: `verify_jwt=false` para permitir carregar somente o HTML, mas nenhuma operacao de conta/cobranca eh feita nesse endpoint; todas as verificacoes e criacoes passam pela funcao `shamatha-mp-sandbox` (JWT exigido e verificacao de editor principal). Login acontece diretamente via Supabase Auth e tokens nao sao persistidos.

ATENCAO: a pagina e a funcao estao implantadas, mas nao houve validacao interativa com um usuario autenticado nem chamada de criacao; o navegador ainda precisa confirmar o acesso.

## Correcao de exibicao do HTML — 19/10/2026

**Nao use o endereco da Edge Function `shamatha-mp-test-ui` como pagina.** Supabase Edge Functions no dominio padrao `supabase.co` convertem HTML para `text/plain`; a resposta de GET foi substituida por uma explicacao legivel.

A interface interativa deve ser hospedada em GitHub Pages, na pagina separada `billing-sandbox.html` preparada em **PR #50**: https://github.com/TTamosauskas/shamatha/pull/50. A PR #50 contem APENAS a pagina, sem alterar o app ou ativar pagamento. O futuro endereco, disponivel somente apos merge autorizado, eh: https://ttamosauskas.github.io/shamatha/billing-sandbox.html .

Ao publicar, usar o navegador nessa URL, entrar como editor principal, verificar vendedor, e seguir o roteiro de homologacao. Mantenha `SHAMATHA_MP_SANDBOX_CREATE_ENABLED=false` ate a comprovacao de que o ID e da conta ficticia vendedora.

Fonte: https://supabase.com/docs/guides/functions/http-methods
