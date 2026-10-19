# Shamatha — integracao de assinaturas recorrentes: etapas apos homologacao

**Data:** 19/10/2026
**Status:** plano tecnico de implementacao; NENHUMA fase de cobranca real autorizada.
**Branch:** `feat/mercadopago-sandbox-foundation` / PR #49, mantido em rascunho.

## Resultado verificado da homologacao

O editor principal concluiu o checkout ficticio com saldo em conta do COMPRADOR de teste. O painel autenticado informou:
- Vendedor ficticio conferido: ID `3778352536`.
- Assinatura ficticia: `c5b3cfd34ca740cb8d1b7687c5ad13b2`.
- Status: `authorized`.
- Uma fatura identificada.
- Pagamento de R$ 180,00 com status `approved`, confirmado pela leitura da API do Mercado Pago.
- Nenhuma liberacao de conteudo ou alteracao do cadastro.

Uma linha existe em `public.billing_sandbox_attempts` com estado `created`. Isso registra a criacao do checkout, NAO atualiza automaticamente o estado de pagamento em `public.billing_payments`; a confirmacao ocorreu pela consulta sob demanda da API. Nao inferir resultados de futuras renovacoes desse unico teste.

A pessoa proprietaria informou ter desabilitado novamente `SHAMATHA_MP_SANDBOX_CREATE_ENABLED`. **Esta flag evita novas criacoes de checkout, mas nao cancela a assinatura ficticia ja autorizada.** Cancelar pelo Mercado Pago apos concluir os testes de renovacao/cancelamento para evitar recorrencia indesejada na conta ficticia. Nao cancelar de forma automatica sem decisao explicita.

## Contrato funcional acordado

- R$ 180,00 BRL a cada mes.
- Clientes existentes na data de ativacao real devem ficar **isentos**, sem expiracao automatica, ate decisao posterior.
- Cliente novo pode cadastrar-se, mas so pode acessar conteudo depois de pagamento efetivamente aprovado e vinculacao segura a sua identidade.
- Sem tolerancia alem do instante `paid_through`. Se renovacao nao for confirmada, acesso cessa no vencimento, sem apagar historico e progresso.
- Estados visiveis no editor: **Isento**, **Ativa**, **Pendente**, **Atrasada**, **Pausada**, **Cancelada** (alem do controle independente de aprovacao administrativa, caso exista).
- Nao usar exclusivamente `preapproval.status = authorized`, URL de retorno, confirmacao no navegador ou webhook sem validacao como prova de pagamento.
- Todos os controles de conteudo devem ser reforcados no servidor/RLS, nao apenas no navegador.

## Sequencia de implementacao (sempre em PRs sem merge automatico)

### 1. Conciliacao de pagamento independente de webhooks

Criar servico de leitura autenticado com credenciais por ambiente. Para assinatura vinculada ao estudante:
1. Resolver `preapproval_id` a partir de registro servidor; validar `collector_id`, `external_reference`, identidade do usuario e BRL 180.
2. Consultar `/preapproval/{id}`, `/authorized_payments/search?preapproval_id=...`, `/authorized_payments/{id}` e, quando houver pagamento, `/v1/payments/{id}`.
3. Exigir resultado `approved` do pagamento real associado a fatura/assinatura esperada, cobranca BRL 180, e periodo comprovado. Se a API nao fornecer dados temporais confiaveis, nao inventar `paid_through`: colocar evento em revisao manual ate mapear os campos corretos.
4. Persistir em `billing_payments` idempotentemente pelos IDs da fatura e do pagamento; registrar atualizacoes de status tardias e estornos, sem duplicar periodo pago.
5. Calcular entitlement efetivo como `exempt OR (last_approved_paid_through > now AND eligible_subscription)`. Nao confiar cegamente em `access_status = active` persistido, que pode ficar obsoleto depois do vencimento.
6. Reconciliação agendada: procurar pagamentos renovados, falhados, disputados e cancelados, inclusive quando notificacoes se perderem. Registrar `last_checked_at` e falhas para auditoria.

### 2. Notificacoes Mercado Pago (Webhooks)

A documentacao oficial identifica `subscription_preapproval`, `subscription_authorized_payment` e `payment`; a documentacao de Assinaturas tambem contem um aviso de que a configuracao **via Suas integracoes** nao esta disponivel para Assinaturas. **Antes de ativar**, confirmar na interface e na API do vendedor ficticio o mecanismo realmente suportado e como configurar a URL/notificacoes na solucao de assinatura usada. Nao presumir que `notification_url` e aceito pelo `POST /preapproval` sem verificacao documental/empirica.

Recebedor dedicado, sem JWT de cliente (`verify_jwt=false`), mas **nunca** sem autenticacao da origem:
- Validar assinatura `x-signature`, `x-request-id`, timestamp, data ID, com o algoritmo e o segredo da configuracao efetiva; aceitar somente eventos comprovados.
- Limitar tamanho, formatos, eventos permitidos, timestamps, e implementar deteccao de replay/idempotencia em `billing_webhook_events`.
- Nao confiar no JSON recebido para definir pagamento ou garantir acesso; depois de validar origem, consultar a API MP novamente e conciliar pelo ID servidor.
- Responder em tempo adequado e reenfileirar falhas; registrar status `received / verified / processed / failed`.
- Em ambientes onde o webhook nao fornece assinatura verificavel, **nao processar concessao de acesso somente pela notificacao**: usar apenas como gatilho para leitura confirmada no provedor, com vinculo de recursos e monitoramento de falhas.
- Segredo do webhook distinto do Access Token, somente no cofre Supabase, nunca no GitHub ou navegador.

**NENHUM endpoint publico foi ativado por este documento.**

### 3. Vincular assinatura a conta do aluno e preparar isencoes

- Primeiro definir data/hora e snapshot de contas existentes na ativacao real, revisar os IDs com o titular e preencher `billing_exemptions` ANTES de modificar regra de acesso. Nao criar snapshot prematuro agora porque alunos adicionais podem ser cadastrados antes do lancamento.
- Fluxo de cadastro gera uma identidade Supabase primeiro; servidor associa pedido, pessoa, assinatura e `external_reference` imprevisivel/idempotente; nao aceitar ID de outro usuario informado pelo browser.
- Garantir RLS: usuario so le suas assinaturas, editor le conforme autorizacao; tabelas de webhook/tentativas inacessiveis ao cliente.
- Estender `private.has_content_access()` somente apos testes e autorizacao explicita. Regra preserva isencoes e aprovacao administrativa; expiracao sem tolerancia adicional.
- Nao alterar progresso nem dados dos alunos inadimplentes.

### 4. Interface de cadastro e operacao

- Redirecionar novos estudantes ao checkout, oferecer retomada de pagamento pendente, falhas e status da assinatura.
- Coluna Assinatura no editor e filtros: Isento / Ativa / Pendente / Atrasada / Pausada / Cancelada.
- Mostrar vencimento, data da ultima conciliacao e divergencias para o editor, sem revelar tokens ou dados completos dos cartoes.
- Permitir cancelamento e reativacao apenas com autorizacoes claras e confirmacao servidor.

### 5. Testes obrigatorios antes de lancamento

- Pagamento ficticio aprovado, recusado, em analise, cancelado e estornado.
- Renovacao mensal real em ambiente ficticio OU simulacao testada contra respostas validadas; nao inferir renovacao do primeiro pagamento.
- Notificacao duplicada, atrasada, adulterada, sem assinatura, repetida, falha e webhook perdido; nao permitir processamento nao verificado.
- Vencimento com zero dias de tolerancia, inclusive fuso horario e corrida concorrente entre renovacao e expiracao.
- Novo aluno aguardando pagamento e bloqueado por RLS; antigo aluno com isencao mantem acesso.
- Desabilitar billing por feature flag nao altera automaticamente contratos existentes no Mercado Pago.
- Conferir `productionBillingEnabled=false` ate aprovacao explicita de lancamento.

## Implantacao de conciliacao ficticia — 19/10/2026

- Migration aplicada: `20261019204008_billing_sandbox_invoice_observations`, com tabela privada `public.billing_sandbox_invoice_observations` (RLS, nenhuma policy de cliente).
- Deploy ativo: `shamatha-mp-sandbox-reconcile`, `verify_jwt=true`. POST exige JWT do editor principal aprovado, body `{"mode":"sandbox-reconcile"}`; utiliza somente a credencial da conta **vendedora ficticia ID 3778352536**.
- Verifica a assinatura `GET /preapproval/{id}`, referencia original do checkout, frequencia mensal, valor BRL 180; consulta `GET /authorized_payments/search` e `GET /v1/payments/{id}` para comparar IDs, vendedor, moeda, valor e status. So depois grava faturas verificadas de modo idempotente.
- Nao escreve em tabelas de producao, nao cria checkout, nao altera acesso, e nao preenche `paid_through` sem prova de um periodo de cobertura confiavel.
- Frontend de acionamento preparado em **PR #53**, isolado da PR #49: adiciona botao de conciliacao em `billing-sandbox.html`. **Nao publicado** sem autorizacao.
- O editor principal deve publicar especificamente PR #53, clicar "Conciliar faturas de teste no Supabase" e enviar o resultado. Testes online autenticados da nova funcao estao **pendentes**; a verificacao da implantacao so garante status ACTIVE.
- A flag `SHAMATHA_MP_SANDBOX_CREATE_ENABLED` continua destinada apenas a novas criacoes e deve ficar `false` (informado pelo proprietario).

## Preparacao do webhook — DESABILITADA

- Receptor preparado na branch do PR #49 em `supabase/functions/shamatha-mp-sandbox-webhook/index.ts`. **NAO FOI IMPLANTADO NEM CONECTADO A NOTIFICACOES MERCADO PAGO.**
- Exige flag `SHAMATHA_MP_SANDBOX_WEBHOOK_ENABLED=true`, segredo da assinatura `SHAMATHA_MP_SANDBOX_WEBHOOK_SECRET` e assinatura HMAC-SHA256 validada via `x-signature`, `x-request-id`, `data.id`, timestamp com janela curta, limite de payload e comparacao com vendedor de teste. Registra apenas o evento sanitizado em `billing_webhook_events` para conciliacao posterior. Nunca libera acesso.
- Para usar, verificar primeiro no Mercado Pago **como as notificacoes da API /preapproval especifica sao configuradas**: a documentacao de Assinaturas ressalva que "via Suas integracoes" nao serve para assinaturas, e a API /preapproval nao lista `notification_url` como parametro documentado. Nao mandar campo nao suportado nem expor webhook ate esse ponto ser validado.
- Testar assinatura legitima, assinatura falsa, replay, atraso, notificacao duplicada, campo ID adulterado e conciliacao posterior. Se o provedor nao aceitar webhook para este fluxo, manter conciliacao manual/agendada como fonte de verdade.
- Nao considerar esse esboco de webhook aprovado para producao ate testes completos.

## Correcao da conciliacao apos teste do editor — 19/10/2026

O primeiro clique no botao de PR #53 retornou HTTP 502 ao navegador. Os logs da Edge Function, em `function_logs`, demonstraram: `sandbox reconciliation error Mercado Pago indisponivel (HTTP 400)`. A tentativa de pagamento anteriormente verificada continua valida; o erro e de uma chamada de leitura desta nova funcao, e nao de uma cobranca recusada. A tabela privada de observacoes continuou sem registros.

Correcao preparada e **implantada** na funcao `shamatha-mp-sandbox-reconcile` v2:
- Busca de faturas alinhada ao GET de homologacao comprovadamente funcional: `/authorized_payments/search?preapproval_id=...&limit=10`, removendo `offset=0` e alterando o limite de 20 para 10.
- Paginação limitada a 10 neste prototipo; mais faturas => erro explicito e sem gravacao incompleta.
- Logs diagnosticam so o estagio da consulta (`seller`, `subscription`, `invoices`, `payment`) e o codigo HTTP sem qualquer segredo. Uma nova falha pode ser atribuida ao estagio exato.
- Nao ha novas assinaturas, notificacoes, liberacao de aluno ou escrita no schema de producao.

**Validacao concluida no teste manual em 19/10/2026:** apos instalar a versao 2, o editor principal clicou em "Conciliar faturas de teste no Supabase" e a funcao retornou assinatura `authorized`, 1 fatura registrada/verificada e 1 pagamento aprovado confirmado. Consulta SQL subsequente confirmou:
- `public.billing_sandbox_invoice_observations`: **1 linha**, `mp_invoice_id=7033097180`, `mp_payment_id=185024682360`, `invoice_status=processed`, `payment_status=approved`, `payment_approved_verified=true`, `amount_cents=18000`, `currency=BRL`;
- assinatura `c5b3cfd34ca740cb8d1b7687c5ad13b2` e status remoto `authorized`;
- `billing_subscriptions=0`, `billing_payments=0`, `billing_webhook_events=0`; **nenhum acesso de aluno alterado**.
- Nova tabela continua com RLS ativo, sem policies de cliente.

Isso valida a conciliacao manual da **primeira cobranca de homologacao**. Ainda NAO valida duplicacao/repeticao do mesmo evento, renovacao, falha, reembolso, webhook, nem derivacao correta de `paid_through` para acesso de producao. Proximo teste seguro: executar a mesma conciliacao novamente e conferir que continua existindo apenas 1 fatura, sem novo checkout nem pagamento.

## Segundo teste: conciliação repetida e idempotência — APROVADO

Na segunda execução autenticada do botão `Conciliar faturas de teste no Supabase`, o editor recebeu `authorized`, **1 fatura** e **1 pagamento aprovado**, sem qualquer criação de cobrança.

Confirmação independente por SQL:
- `billing_sandbox_invoice_observations` tem 1 linha, 1 `mp_invoice_id` distinto (`7033097180`), 1 `mp_payment_id` distinto (`185024682360`) e 1 pagamento com `payment_approved_verified=true`;
- `created_at=2026-10-19 21:03:09.0443+00`, enquanto `last_checked_at=2026-10-19 21:09:51.385+00`. Houve atualização da observação existente, não inserção duplicada;
- `billing_subscriptions=0` e `billing_payments=0`.

**Limite da evidência:** idempotência do replay manual da mesma fatura está validada. Ainda não prova comportamento sob concorrência, retentativas de webhook, renovação ou múltiplas faturas.

## Testes de assinatura criptografica de Webhook — PREPARADOS, nao implantados

Consulta à documentação oficial Mercado Pago em 19/10/2026 confirmou uma restrição: **a configuração de Webhooks por "Suas integrações" não está disponível para Assinaturas**; a página orienta a configuração durante a criação do pagamento. A API utilizada neste teste foi `POST /preapproval`; a integração ainda precisa identificar o mecanismo compatível e documentado para receber notificações das cobranças automáticas antes de expor um endpoint. Não presumir suporte ao campo `notification_url` no `/preapproval`.

Adicionado módulo puro `supabase/functions/_shared/mercadopago-webhook-signature.mjs`, usado pelo código de receptor ainda desligado. Foram executados localmente **10 testes sintéticos de HMAC-SHA256**, todos aprovados (`node --test tests/mercadopago-webhook-signature.test.mjs`):
- notificação legitimamente assinada, normalização de ID;
- adulteração de `data.id` ou `x-request-id`;
- segredo errado, assinatura ausente/malformada;
- timestamp vencido/futuro fora da janela de 15 minutos;
- duplicação de campos de assinatura e caracteres injetados no manifesto.

O receptor preparado `shamatha-mp-sandbox-webhook` agora deduplica por ID imutável do evento, não por `x-request-id` variável. **O receptor não foi implantado nem configurado no Mercado Pago. Os testes são unitários sintéticos, não validam assinatura de uma notificação real.** Não compartilhar segredo nem ativar webhook até confirmar o formato real em testes.

## Motor de acesso — homologacao sintetica sem efeito nos alunos

Em 19/10/2026, o motor puro `supabase/functions/_shared/billing-entitlement.mjs` foi adicionado ao PR #49, com `tests/billing-entitlement.test.mjs`. Executado localmente com Node.js 22, **22 testes passaram, 0 falharam**.

Testes incluem: primeira mensalidade aprovada, `authorized` sem pagamento, pagamento nao confirmado, recusado, pendente, chargeback, refund, troca de assinatura, valor ou moeda incorreta, usuario existente isento, suspensao administrativa, renovacao aprovada/recusada, periodo futuro, lacuna entre periodos, cancelamento, pausa, fuso horario, fronteira exata de vencimento e eventos duplicados.

- **Sem tolerancia:** `now < paidThrough`; no instante exato `now === paidThrough` o motor nega acesso.
- Somente intervalo `[periodStart, periodEnd)` de cobranca real aprovada e vinculada a assinatura permite acesso.
- Exige `verifiedByProvider=true`, status `approved`, R$180 BRL e assinatura correta.
- Preserva isencao somente quando concedida por servidor e sujeita ao requisito atual de aprovacao administrativa. Suspensao tem prioridade sobre isencao.
- *Proposta pendente de aprovacao*: pausa/cancelamento de assinatura nao remove acesso antes do fim ja efetivamente pago; depois disso bloqueia.
- Nao inferir `periodEnd` de `debit_date` ou `next_payment_date` sem demonstrar que sao datas corretas de cobertura para aquela fatura. Datas simuladas dos testes NAO SAO vencimentos reais.
- **NAO integrados:** RLS `private.has_content_access`, login, API, coluna editor e contratos reais continuam sem alteracao.

## Diagnostico dos periodos no Mercado Pago

Funcao `shamatha-mp-sandbox-reconcile` v3 implantada somente para homologacao. Ao consultar o vendedor ficticio devolve `cycleEvidence` com datas selecionadas do retorno de `/preapproval/{id}` e faturas, quando existirem. Nao entrega dados de cartao nem e-mails. Continua `paidThrough=null`, `coveragePeriodVerified=false` e `grantsStudentAccess=false`.

Interface preparada no **PR #54** (aberto, sem merge): depois de publicacao voluntaria do PR #54, o editor principal clica `Conciliar faturas de teste no Supabase` e confere os campos sem criar nova cobranca. A interpretacao dessas datas para periodo efetivamente pago continua pendente de validacao. Nao usar `next_payment_date` ou `debit_date` automaticamente como `paidThrough`.

## Webhooks de assinaturas — restricao documental conferida

A documentacao oficial do Mercado Pago estabelece que configuracao via `Suas integracoes` **nao se aplica a Assinaturas**, recomendando configurar durante a criacao de pagamentos; o endpoint atualmente usado `POST /preapproval` nao tem nesse fluxo uma URL de notificacao validada em teste. Os topicos `subscription_preapproval`, `subscription_authorized_payment` e `payment` sao documentados, porem nenhum evento de assinatura real foi recebido nesta implementacao.

O receptor assinado permanece somente no codigo do PR #49 e **NAO esta implantado**; precisa validar o mecanismo de emissao para este produto antes de ligar endpoint publico. Enquanto isso, a consulta autenticada manual de faturas e a conciliacao pelo provedor continuam as unicas provas no prototipo. Nao usar `IPN` sem assinatura como prova de pagamento.

Fontes:
- https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks
- https://www.mercadopago.com.br/developers/pt/docs/subscriptions/subscription-management
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/get-authorized-payment/get

## Gates obrigatorios antes de producao

[ ] Fluxo de conciliacao automatica confirmado
[ ] Webhooks autenticados e reprocessamento testados
[ ] Periodos de cobertura obtidos de fonte confiavel
[ ] Controles de acesso e isencoes aprovados
[ ] Cadastro/checkout/coluna editor testados
[ ] Reversao e monitoramento definidos
[ ] Credenciais reais configuradas separadamente, sem acesso da conta ficticia
[ ] Aprovacao explicita do proprietario para publicar e habilitar a cobranca real

## Referencias oficiais

- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/overview
- https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks
- https://supabase.com/docs/guides/functions/auth-headers
