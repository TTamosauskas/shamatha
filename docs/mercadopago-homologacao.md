# Mercado Pago no Shamatha — homologacao isolada

Status: codigo de preparacao. **Nao integrado ao cadastro e nao habilitado em producao.**

## Regras aprovadas
- Assinatura: R$ 180,00 BRL, uma vez por mes.
- Novos alunos apos ativacao futura: acesso somente apos cobranca confirmada.
- Vencimento do periodo pago sem renovacao: zero dias de tolerancia.
- Usuarios existentes quando ocorrer a ativacao: isentos (snapshot ANTES de ligar a regra de acesso).
- Progresso e conteudo nao serao apagados quando um pagamento falhar.

## Arquitetura preparatoria nesta branch
- Migration: `supabase/migrations/20261019160000_billing_sandbox_foundation.sql`.
- Edge Function: `supabase/functions/shamatha-mp-sandbox/index.ts`.
- Pagina interna (apenas para editor principal): `billing-sandbox.html`.
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
1. Confirmar o projeto `zglitbtwzntpchzhrdcy` e fazer backup do schema.
2. Aplicar a migration preparatoria da branch. Conferir RLS e as novas tabelas.
   Ainda nao ativar qualquer policy financeira de leitura do conteudo.
3. Fazer deploy da Edge Function `shamatha-mp-sandbox` com `verify_jwt=true`.
4. Em Edge Functions > Secrets, adicionar:
   - `SHAMATHA_MP_SANDBOX_SELLER_TOKEN`: access token da CONTA FICTICIA vendedora.
   - `SHAMATHA_MP_SANDBOX_CREATE_ENABLED`: manter como `false` ate teste autorizado.
5. Verificar GET autenticado da funcao como editor principal, que deve retornar
   `productionBillingEnabled:false`, valor 18000 (centavos), e `enabled:false`.
6. Somente com tudo pronto, alterar `SHAMATHA_MP_SANDBOX_CREATE_ENABLED=true`.
7. Abrir `billing-sandbox.html` estando logado como editor principal, verificar
   a configuracao, informar comprador ficticio e criar checkout de teste.

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
