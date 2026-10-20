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

## Auditoria de ciclo real informado pelo vendedor ficticio — 19/10/2026

**Evidencia obtida apos publicacao do PR #54:** o editor principal consultou a fatura existente e compartilhou estes campos do Mercado Pago:

| Campo | UTC |
|---|---|
| Criacao da assinatura | `2026-10-19T18:21:38.000Z` |
| Inicio configurado de recorrencia | `2026-10-19T18:21:38.000Z` |
| Fim configurado da recorrencia | ausente |
| Primeiro debito | `2026-10-19T18:22:38.000Z` |
| Aprovacao da primeira fatura | `2026-10-19T18:22:39.000Z` |
| Proxima cobranca programada | `2026-11-19T18:22:38.000Z` |

A proxima cobranca programada ocorre **exatamente um mes calendárico apos a data de debito**. Essa coincidencia valida a consistencia da cadencia deste exemplo, mas nao e um campo contratual `paid_through`. O Mercado Pago descreve `next_payment_date` como proxima cobranca e `authorized_payments` como faturas/parcelas; nao documenta `next_payment_date` como data garantida de liberacao/bloqueio de acesso. O pagamento foi aprovado um segundo apos o debito; para futura implementacao deve haver decisao explicita sobre inicio da cobertura (ciclo agendado versus momento da aprovacao), efeitos de aprovacao tardia e cancelamento.

**Implementacao somente de testes:**
- `supabase/functions/_shared/mp-billing-cycle-audit.mjs` confere se uma fatura de R$ 180 aprovada pertence a assinatura mensal esperada e se `next_payment_date` coincide com o calendario UTC do debito. Se faltar data, houver divergencia, valor/status incorreto ou aprovacao tardia apos o proximo ciclo, devolve `needs_review` ou `billing_schedule_mismatch`.
- A auditoria retorna `candidateCycleStart` e `candidateCycleEnd` somente como datas **candidatas para revisao**, mantendo sempre `coveragePeriodVerified=false`, `paidThrough=null`, `grantsStudentAccess=false`.
- **16 testes** locais executados do arquivo `tests/mp-billing-cycle-audit.test.mjs` passaram, incluindo os campos do caso ficticio real, meses com 28, 29, 30 e 31 dias, passagem de ano, fuso UTC-3, data faltante, assinatura errada e cobranca recusada.
- O motor puro `billing-entitlement.mjs` agora exige a confirmacao separada `coveragePeriodVerified=true` **alem** de `verifiedByProvider=true` antes de considerar um intervalo como pago. Sem ela, o pagamento mesmo aprovado e a data prevista da proxima cobranca nao liberam acesso. **24 testes** locais de `tests/billing-entitlement.test.mjs` passaram.
- Nenhum motor foi integrado a `private.has_content_access()`, nenhum aluno foi alterado, e nao houve novo deploy de cobranca por causa destes testes.

**Politica de produto a confirmar antes da etapa de acesso:** se um aluno cancelar uma assinatura depois de pagar, conserva acesso ate o encerramento do periodo ja pago? A implementacao sintetica atual assume *sim*, mas a regra ainda precisa de aprovacao. Para vencimento, a regra acordada segue zero dias extras.

Referencias:
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/get-preapproval/get
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/get-authorized-payment/get
- https://www.mercadopago.com.br/developers/pt/docs/subscriptions/resources/glossary

## Execução do plano original em seis fases — revisão 19/10/2026

| Fase original | Estado atual | Próxima ação necessária |
|---|---|---|
| 1. Banco e preservação | Estrutura preparatória `billing_exemptions`, `billing_subscriptions`, `billing_payments`, `billing_webhook_events` aplicada. **2 de 2 perfis atuais isentos**, via migration `billing_existing_profiles_exemptions`. Perfis continuam com seu estado administrativo anterior; não há bloqueio financeiro. | Fazer snapshot final de TODOS os perfis anteriores ao go-live (inclusive novos que chegarem até então) antes de ligar controles |
| 2. Mercado Pago fictício | Checkout mensal de R$180 testado, identificação do vendedor fictício, confirmação e proteção contra tentativas duplicadas por editor/comprador | Validar criação vinculada a alunos reais de teste (identidade e status) **sem ativar produção** |
| 3. Confirmação de pagamentos | Consulta remota aprovada; 1 fatura e 1 pagamento idempotentes no livro de homologação. Receptor de webhook só em código, desativado | Confirmar o mecanismo documentado de notificações para `/preapproval`; testar webhook real, assinatura, retentativas e reconciliação automática |
| 4. Interface do aluno e editor | **PR #55** propõe coluna `Assinatura` (Isento, Ativa, Pendente, Atrasada, Pausada, Cancelada), somente leitura; teste determinístico de 9 casos aprovado | Publicar PR #55 apenas mediante autorização; depois preparar checkout de aluno, pendência e regularização sem efeitos live |
| 5. RLS e checagem automática | Motor isolado de acesso testado com confirmação de pagamento e cobertura, ainda não conectado à RLS; cron ainda não configurado | Definir fonte contratual de `paid_through`, testar scheduler sem credenciais públicas, políticas de conteúdo e rollback |
| 6. Homologação e ativação | Primeiro pagamento + idempotência homologados; simulações de expiração/renovação aprovadas | Simular e validar fluxo real de falha, renovação, cancelamento, estorno, inadimplência e reativação antes de autorização de produção |

**Nomes técnicos:** no banco foram usados prefixos `billing_*` para evitar ambiguidade de tabelas; correspondem conceitualmente a `subscriptions`, `subscription_payments` e `payment_webhook_events` do plano original. Não criar tabelas duplicadas com outros nomes.

**Isenção inicial aplicada diretamente ao Supabase:** migration `20261019221014_billing_existing_profiles_exemptions.sql` usou `INSERT ... SELECT FROM profiles ON CONFLICT DO NOTHING` e registrou os 2 perfis atuais (ambos editores), sem modificar `profiles` e sem ativar filtros de acesso. Não significa que todo usuário novo criado antes do go-live já estará isento: repetir o lote no momento da ativação, incluindo todos os perfis cadastrados até a data definida. A isenção persiste até decisão explícita posterior.

**PR #55** altera apenas interface/backend de leitura do editor; o repositório só recebeu a proposta e não há merge autorizado. O editor atualmente lista apenas `role=student`, e o projeto ainda não tem perfis `student`; por isso a coluna pode não ter linhas para exibir hoje. Futuramente, somente períodos efetivamente pagos (com data confiável) deverão figurar como `Ativa`; não confundir estado de assinatura com estado administrativo.

**Webhooks:** Mercado Pago explica que a configuração via `Suas integrações` não está disponível para Assinaturas; deve ser tratada na criação do pagamento. Para a assinatura `POST /preapproval` usada aqui, ainda não foi comprovado um parâmetro de URL de notificação nessa chamada. Não inventar `notification_url`; se a forma suportada depender de API distinta, adaptar com teste fictício. A checagem periódica automatizada com Supabase Cron + `pg_net` e segredo no Vault é documentada, mas ainda não foi instalada.

## Fase 4 — prévia de Minha assinatura preparada, sem integração de cobrança

Após o merge do PR #55 pelo proprietário (GitHub Pages publicado com sucesso), a tabela do editor contém a coluna `Assinatura` e lê as estruturas financeiras com RLS, independentemente do Estado administrativo.

O novo **PR #56** (ABERTO, NÃO MESCLADO) contém a página `minha-assinatura.html` como prévia de consulta exclusivamente do usuário autenticado. Ela consulta `profiles`, `billing_exemptions` e `billing_subscriptions` sob RLS, exibe Isento / Ativa / Pendente / Atrasada / Pausada / Cancelada, o estado administrativo e `paid_through` quando registrado. A mensalidade prevista aparece como R$ 180, mas a interface avisa que a cobrança real está desligada; o botão de pagamento/regularização está **desabilitado**. O cadastro/login principal ainda **não redireciona** para esta página.

A classificação de exibição passou em **13 testes unitários sintéticos**; nenhum login de aluno real foi usado. Isto **não implementa** checkout do estudante, criação da assinatura, recebimento de webhook, aprovação de pagamento ou proteção RLS do conteúdo. Não publicar/ativar a cobrança real ou o redirecionamento de cadastro como consequência do PR.

Validação depois de merge explícito do PR #56: abrir manualmente `https://ttamosauskas.github.io/shamatha/minha-assinatura.html` com sessão de teste e verificar texto/modal de pagamento indisponível. Como há atualmente apenas dois perfis de editor, o teste de apresentação com aluno autenticado exigiria uma conta de aluno de teste separada, que não foi criada.

## Fase 4 — avanço após publicação de Minha assinatura (19/10/2026)

**Confirmado:** PR #56 mesclado pelo proprietário; GitHub Pages publicou `minha-assinatura.html` com pagamento desativado. PR #55 havia publicado a coluna Assinatura no editor. Nenhum usuário novo foi criado por estes merges.

**PR #57 (ABERTO, SEM MERGE)** adiciona atalhos informativos para `Minha assinatura` a contas pendentes em `index.html` e a contas dentro de `app.html`. A página de destino continua só leitura, sem geração de checkout.

**Estrutura de checkout de alunos reservada no banco:** migration `20261019222450_billing_checkout_intents.sql` aplicada ao Supabase; tabela `billing_checkout_intents` com RLS e **nenhuma policy de cliente**, chave de idempotência, e índice único para uma tentativa não-finalizada por `(user_id,environment)`. Não cria cobrança ou muda acesso.

**Código preparatório criado somente no PR #49 (DRAFT)**:
- `supabase/functions/shamatha-create-subscription/index.ts` (NÃO IMPLANTADO no Supabase) será futuramente o único ponto servidor para criar assinatura de aluno;
- usa `admin.auth.getUser` e e-mail confirmado pelo próprio Supabase Auth, perfil `student`, recusa isentos e suspensos, não recebe e-mail/ID/valor do browser;
- configuração de recorrência mensal BRL 180; POST no Mercado Pago com `external_reference` e idempotency key da reserva; busca novamente a mesma tentativa antes de cogitar criar outra;
- em falha ambígua, marca `needs_review` e **não repete automaticamente** o POST;
- somente cria vínculo com `billing_subscriptions` em estado `pending`, `paid_through=null`; **não dá acesso**;
- ao tentar reutilizar o checkout, lê a assinatura do provedor e compara pagador, vendedor, referência e valor; se já autorizada, não devolve link de pagamento, aguarda conciliação.

**Três travas desligadas por padrão:** `SHAMATHA_BILLING_PRODUCTION_ENABLED`, `SHAMATHA_BILLING_FINAL_LAUNCH_APPROVED` e `SHAMATHA_MP_PRODUCTION_CREATE_ENABLED`. Além delas exige credencial/seller ID de produção, que **não foram configurados nesta etapa**. As travas não são substitutos de webhook, verificação de pagamentos, snapshot final de isenções ou aprovação humana; essa função não deve ser implantada antes da Fase 3 e homologação completa.

**Testes:** `tests/student-checkout-gates.test.mjs` valida bloqueio por todas as flags, perfil editor, isenção, e-mail não confirmado, conta suspensa/estado administrativo inválido, assinatura já vinculada e caso válido. Ainda não houve teste de integração de checkout de aluno ou chamadas de criação com credenciais reais.

**Mantenha separado:** cadastro antigo não redireciona automaticamente ao pagamento; links da PR #57 levam apenas à tela de consulta. Entrega de checkout ativo continua pendente de assinatura/autorização de webhook, reconciliação automática e revisão de RLS de conteúdo.

## Fase 3 — conciliação periódica de homologação preparada, NÃO ativada

Em 19/10/2026, após a publicação do **PR #57** pelo proprietário (GitHub Pages com deploy bem-sucedido), a próxima parte da Fase 3 foi adicionada ao **PR #49 (draft)**:

- Novo auditor puro `supabase/functions/_shared/mercadopago-sandbox-invoices.mjs` e `tests/mercadopago-sandbox-invoices.test.mjs`: **21 testes sintéticos executados, 21 aprovados**. Rejeita discrepâncias entre assinatura, referência externa, vendedor fictício 3778352536, e-mail quando disponível, valor/moeda, ID de fatura, ID de pagamento, estados de fatura e pagamento, e lotes acima de 10 faturas. Nenhum cálculo de período pago.
- Função `supabase/functions/shamatha-mp-sandbox-periodic/index.ts`: código de conciliação agendável da conta fictícia, **somente no PR #49**. Não faz POST de pagamento, criação ou cancelamento de assinatura. Lê a API MP, verifica cada item e atualiza apenas `billing_sandbox_invoice_observations` e `billing_sandbox_attempts.last_checked_at`. Reutiliza IDs únicos para evitar duplicação. Não altera `billing_payments`, `billing_subscriptions`, `profiles` ou RLS.
- A função é protegida por segredo interno exclusivo `SHAMATHA_MP_SANDBOX_CRON_SECRET` e trava `SHAMATHA_MP_SANDBOX_AUTO_RECONCILE_ENABLED`, desligada por padrão. **Nenhuma senha cron foi criada/configurada; a função NÃO foi implantada.**
- `pg_cron` e `pg_net` já estão habilitados neste Supabase, mas **nenhum job `shamatha-sandbox-invoice-reconcile` foi cadastrado**. O acionamento permanece manual através do painel de homologação.
- O documento `docs/mercadopago-reconciliacao-automatica.md` registra limites e sequência futura de configuração do segredo Vault/Edge Function, monitoramento e cron.
- O Webhook do Mercado Pago **não foi implantado**. A documentação oficial de Assinaturas não permite configuração convencional via `Suas integrações`; validar o mecanismo de envio para o fluxo real `POST /preapproval` antes de colocar endpoint público. A verificação periódica será o plano de recuperação de notificações perdidas, e não prova de `paid_through`.

**Evidência de não ativação:** no banco, `billing_exemptions=2`, `billing_checkout_intents=0`, `billing_subscriptions=0`, `billing_payments=0`, `billing_webhook_events=0`, `billing_sandbox_invoice_observations=1`. Nenhum acesso foi modificado nesta fase.

## Smoke test da rotina de conciliação periódica — execução ainda bloqueada

**19/10/2026:** o proprietário mesclou o PR #58 e o GitHub Pages publicou a alteração. A função `shamatha-mp-sandbox-periodic` foi **implantada no Supabase, versão 1, `verify_jwt=true`**, mas NÃO há job financeiro agendado e NÃO foi habilitada a flag de reconciliação automática.

Um HTTP POST sem Authorization, realizado uma única vez via `pg_net`, retornou **HTTP 401 / UNAUTHORIZED_NO_AUTH_HEADER**. Isso demonstra bloqueio no gateway e não valida o handler com segredo, consultas autenticadas ao MP ou gravação de faturas.

- O banco mantém `2` perfis isentos, `1` fatura fictícia, `0` assinaturas e `0` pagamentos em produção; `0` eventos webhook.
- Os nomes previstos para segredos de Cron estão ausentes do Supabase Vault. **O conector não permite configurar Secrets da Edge Function**; a configuração precisa ser feita pelo proprietário no dashboard, sem compartilhar os valores por chat/repositório.
- `verify_jwt=true` continuará ativado até que exista e seja testada autenticação via segredo interno separado e forte, com Vault+Edge Function preparados. Somente depois alterar a política de JWT e agendar `pg_cron` em homologação.
- O **PR #59**, aberto e sem merge, documenta precisamente a implantação bloqueada, o teste 401 e os passos restantes. O PR #49 permanece draft e NÃO deve ser mesclado por consequência.

## Cron de homologação — autenticação HMAC concluída em 20/10/2026

O proprietário configurou uma senha cron no Vault e em Edge Function Secrets. A antiga autenticação Bearer não aceitava os caracteres usados no segredo; a função `shamatha-mp-sandbox-periodic` v3 foi implantada com **HMAC-SHA256 e timestamp de 5 minutos**, usando `verify_jwt=false` com autenticação própria estrita.

Testes internos via `pg_net`: sem HMAC 401, HMAC incorreto 401, HMAC expirado 401, HMAC assinado com o segredo do Vault **503 SANDBOX_CRON_DISABLED**. A última resposta comprova autenticidade e também a flag desligada. **Nenhuma consulta ao MP foi executada nesses testes.** O job de conciliação não existe, e não foi modificada a segurança/acesso dos alunos.

**PR #60** aberto, sem merge, sincroniza o código do repositório com o deploy e documenta como agendar apenas depois de autorização explícita para a conciliação fictícia. São **10 testes criptográficos locais aprovados**. Próximo passo: habilitar somente `SHAMATHA_MP_SANDBOX_AUTO_RECONCILE_ENABLED=true` e testar **uma execução assinada manual** da função na conta vendedora fictícia; não confundir isso com habilitar checkout ou billing de produção.

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
