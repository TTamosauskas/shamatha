# Shamatha — MVP: assinatura recorrente de R$ 180 e trilha protegida

## Escopo que entra no MVP

1. O aluno cadastra-se, confirma o e-mail e abre **Minha assinatura**.
2. Se não for isento e não tiver período pago vigente, poderá iniciar o checkout
   no Mercado Pago **apenas após a ativação explícita** dos switches.
3. O servidor usa a identidade do Supabase Auth e cria uma assinatura
   \`POST /preapproval\` com R$180, BRL, frequência mensal. Bloqueia duplicatas,
   vincula \`external_reference\` ao ID do usuário/intenção e rejeita vendedores errados.
4. O pagamento não libera a trilha com base no redirecionamento do navegador.
   O estudante pode solicitar reconciliação via Edge Function autenticada; o
   servidor consulta a assinatura, pagina o histórico (máximo 240 faturas)
   e consulta individualmente os pagamentos capazes de cobrir o período
   atual, validando vendedor, preço, moeda, ID e datas.
5. \`stages\` e \`progress\` usam a mesma função RLS já existente:
   com o novo switch ligado, somente **aprovados administrativamente E
   (isentos OU com pagamento confirmado e período vigente)** entram na trilha.
   Uma pessoa suspensa não passa pelo simples fato de pagar.
6. O cancelamento mantém um mês anteriormente quitado até seu fim. Pagamento
   recusado não abre um novo mês; reembolso/chargeback identificado na
   conciliação remove o período relacionado. Ao vencer, o acesso é revogado
   pela comparação temporal da RLS (sem depender de Webhook).

### Condição comercial escolhida para implementação, sujeita à aprovação antes da cobrança

Cada parcela de R$180 efetivamente aprovada cobre **um mês contado do débito
inicial**, ancorado no mesmo dia do mês seguinte (ou no último dia se ele
não existir). Horários UTC são utilizados no servidor para não permitir
alargamento artificial do mês. Pagamentos aprovados depois do fim do
próprio ciclo, débito deslocado, múltiplas faturas não reconciliadas,
paginação incompleta e divergência de titular entram em revisão manual e
**não geram cobertura**. Essa regra deve constar do texto contratual
aceito antes da contratação e ser revista pelo responsável.

O MVP não promete Webhook imediato. A verificação pode ocorrer no retorno
à conta, no login ou na rotina periódica preparada nesta branch; as funções estão implantadas com travas desligadas; nenhuma conciliação automática foi agendada. Estornos externos serão
detectados na próxima conciliação bem-sucedida, não instantaneamente.

## Status técnico desta branch

- \`shamatha-create-subscription\`: handler **implantado, com trava compilada de pré-lançamento**, todas as 3
  flags de autorização/checkout OFF por padrão, conexão de vendedor produção
  ausente do repositório.
- \`shamatha-reconcile-subscription\`: handler de verificação **implantado, com conciliação desligada por padrão**, \`SHAMATHA_BILLING_RECONCILE_ENABLED=false\` por padrão.
- \`assets/config.js\`: quatro flags públicas **false**. A interface fica
  informativa e não cria cobrança até ativação coordenada.
- \`20261023201342_billing_mvp_staged_gate.sql\`: migração preparatória
  que cria \`private.billing_access_control\` com \`enforce_payment=false\`,
  preserva a aprovação administrativa e cadastra como isentas as contas
  existentes. **Não ativar nesta migração.**
- \`ops/BILLING_MVP_ACTIVATE_ONLY_AFTER_APPROVAL.sql\`: transação de
  ativação manual **NÃO EXECUTADA**. Bloqueia temporariamente inserções
  de perfis, captura as últimas isenções, confere a cobertura de todos
  os perfis anteriores e só então liga \`enforce_payment=true\`.
- Reversão imediata da RLS financeira: voltar
  \`enforce_payment=false\` no controle privado sem modificar perfis,
  papéis ou isenções.

## Ordem correta do lançamento (não executar implicitamente por merge)

1. Revisar e mesclar o PR com CI concluída.
2. Aplicar e verificar a migração **desligada**. Checar que nenhum usuário
   antigo perdeu acesso e nenhum usuário foi aprovado automaticamente.
3. Implantar funções preparatórias com JWT ligado para login, reconciliação e cancelamento; a função periódica verifica segredo Bearer próprio;
   configurar individualmente os segredos de vendedor PRODUÇÃO apenas pelo
   Supabase Secrets (jamais no GitHub ou no chat).
4. Testar em um ambiente ou janela de homologação controlada, sem disparar
   cobrança real indevida: login antigo isento, usuário novo aprovado não
   isento sem mensalidade, simulação de aprovado, cancelado e recusado.
   Validar \`paid_through\` por fatura e rollback da RLS.
5. Obter aprovação **específica** para as primeiras cobranças reais de
   R$180/mês e para a política comercial. Capturar snapshot FINAL das
   isenções e ligar \`enforce_payment\` por transação controlada.
6. Só depois ativar sincronizadamente as flags de criação, reconciliação
   e checkout no site. Verificar login e conteúdo com conta real controlada.
7. Monitorar reembolsos/chargeback, erro de integração, expiração e
   e-mails de suporte. Fluxos com histórico acima de 240 faturas ou pagamento deslocado
   necessitam paginação/revisão manual antes de operação em escala.

**NENHUMA mudança do merge por si só ativa dinheiro, checkout, RLS
financeira ou modifica permissões.** A função atual do banco continua
administrativa até ativação controlada.

## Mercado Pago (referências)

- Criar assinatura: https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/create-preapproval/post
- Buscar faturas: https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/authorized-payment-search/get
- Obter fatura: https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/get-authorized-payment/get
- Obter assinatura: https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/get-preapproval/get
- Obter pagamento: https://www.mercadopago.com.br/developers/pt/reference/online-payments/payment/get-payment/get


## Revisão adicional — 22/10/2026 (continuação do desenvolvimento)

### Correções de segurança implementadas nesta branch

- O vendedor fictício `3778352536` é rejeitado por `shamatha-create-subscription` e `shamatha-reconcile-subscription`, inclusive se alguém habilitar as flags por engano.
- O conciliador rejeita um ID de assinatura retornado pela API que não coincida com o registro local.
- O login utiliza `gatedUser()` para consultar a permissão do servidor e direcionar novos alunos sem cobertura à página Minha assinatura, sem confiar apenas na aprovação administrativa.
- Foi adicionada uma Edge Function **não implantada**, `shamatha-cancel-subscription`, para cancelamento solicitado pelo próprio aluno, sem aceitar ID de assinatura do navegador. Ela compara assinatura, conta vendedora e referência de checkout na API do Mercado Pago, executa `PUT /preapproval/{id}` com `status=canceled` e preserva `paid_through` já verificado. Um eventual estorno deve ser analisado pelo conciliador.
- A interface apresenta **Cancelar renovação automática** quando o aluno tem assinatura de produção em estado cancelável **e** `billingCancelEnabled=true`. A flag pública e a flag independente do servidor `SHAMATHA_MP_PRODUCTION_CANCEL_ENABLED` estão desligadas. Esta operação não deve depender do kill switch que interrompe novas vendas.

### Pendências obrigatórias ANTES de qualquer cobrança real

1. **Webhook e/ou conciliação automática**: o login já solicita uma verificação atual quando configurado, mas renovações, reembolsos e chargebacks que ocorram fora de uma sessão ativa ainda exigem uma rotina periódica confiável ou um canal de notificações comprovado. Issue #65 continua aberta; não presumir que `POST /preapproval` admite `notification_url`.
2. **Limite de doze faturas**: o conciliador atual opera em modo fail-closed quando a API devolve mais de 12 faturas. Isto evita liberação sem auditoria, mas **impede renovação automática confiável após o limite**. Antes do go-live é necessário um modelo incremental, paginado e testado com preservação da âncora mensal original; nunca aumentar arbitrariamente o limite sem testar a ordenação e a paginação do provedor.
3. **Contrato**: o responsável precisa aprovar por escrito o período mensal ancorado no débito, cancelamento com conservação do período pago, regra de reembolso/disputa e ausência de tolerância após vencimento. A proposta técnica codificada não substitui aceite comercial.
4. **Testes funcionais**: testar no ambiente isolado com aluno novo, aluno antigo isento, vendedor real controlado, confirmação do primeiro pagamento, renovação, falha, cancelamento, reembolso, duplicação e rollback RLS. Testes sintéticos/estáticos isoladamente não liberam produção.
5. **Conexão**: colocar token de produção, seller ID e switches **somente em Supabase Edge Functions → Secrets**, nunca em código, issue, GitHub nem chat. Registrar evidência de que a conta produtiva pertence ao vendedor correto.
6. **Deploy e autorização**: preparar migração com `enforce_payment=false`, implantar funções inertes com autenticação, validar e obter aprovação expressa para a execução do SQL final e o acionamento das flags, sem mudar o estado de contas existentes antes do corte.

### Operações

Funções candidatas de produção: `shamatha-create-subscription` (criação travada em código), `shamatha-reconcile-subscription` (verificação por aluno), `shamatha-cancel-subscription` (cancelamento) e `shamatha-billing-periodic` (verificação recorrente protegida por segredo). As quatro foram implantadas em **23/10/2026**, sem habilitar cobranças ou agendamento.

Na ativação efetiva, operar e testar separadamente os quatro switches privados:
- `SHAMATHA_BILLING_PRODUCTION_ENABLED`, `SHAMATHA_BILLING_FINAL_LAUNCH_APPROVED`, `SHAMATHA_MP_PRODUCTION_CREATE_ENABLED` (criação).
- `SHAMATHA_BILLING_RECONCILE_ENABLED` (conciliação, independente da criação).
- `SHAMATHA_MP_PRODUCTION_CANCEL_ENABLED` (cancelamento, independente da criação).

Os switches públicos no site começam todos falsos: `billingUiEnabled`, `billingCheckoutEnabled`, `billingReconcileEnabled`, `billingCancelEnabled`. Não oferecer checkout ativo sem checar estado real do servidor e sem teste de acesso RLS.

Referências oficiais:
- https://www.mercadopago.com.br/developers/pt/docs/subscriptions/subscription-management
- https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks


## Desenvolvimento adicional — paginação e conciliação sem login

### Implementado no PR, ainda NÃO implantado
- `mp-live-invoice-pages.mjs` percorre páginas de
  `GET /authorized_payments/search` com limites, totais estáveis e detecção
  de dados ausentes ou repetidos. Consulta o histórico completo até
  **240 faturas** (limite de segurança; acima disso entra em revisão).
- `mp-live-monthly-evidence.mjs` valida toda a sequência histórica de datas
  sem conceder acesso a partir de pagamentos antigos não consultados.
  Somente a fatura que pode cobrir **o período atual** é checada por ID na API
  de pagamentos; a confirmação e possíveis estornos dessa fatura são
  reavaliados a cada execução. Divergência de ciclo, identificador,
  vendedor, valor ou moeda falha em modo seguro.
- `mp-live-reconciliation.ts` concentra a mesma verificação do aluno e da
  rotina periódica, evitando regras financeiras distintas.
- `shamatha-reconcile-subscription` continua um endpoint
  autenticado com JWT, sem aceitar identificadores financeiros do browser.
- `shamatha-billing-periodic` é uma nova Edge Function de **uso exclusivamente
  servidor-servidor**. Requer um segredo Bearer independente com no mínimo
  32 caracteres, verificado por digest antes de qualquer leitura privilegiada,
  além de **duas flags privadas** desligadas por padrão:
  `SHAMATHA_BILLING_PERIODIC_ENABLED` e
  `SHAMATHA_BILLING_RECONCILE_ENABLED`.
  Percorre até cinco assinaturas de produção por chamada, com uma rotação
  determinística a cada janela de 15 minutos. Retorna erro em qualquer
  falha parcial para permitir alarme operacional.
- `ops/BILLING_PERIODIC_SCHEDULE_ONLY_AFTER_APPROVAL.sql`: roteiro de
  `pg_cron + pg_net + Supabase Vault` para chamadas a cada 15 minutos.
  **É manual e NÃO foi executado**. Os segredos só devem entrar no Vault
  e em Supabase Edge Function Secrets, jamais no GitHub/chat.

### Capacidade e limites operacionais
- Cinco assinaturas a cada 15 minutos representam uma capacidade nominal de
  **480 verificações/dia**, antes de perdas por falha, concorrência ou
  alteração de cadastro. Monitorar volume e ajustar batch/cadência antes
  de escalar o serviço. Cada aluno pode provocar verificação adicional no login.
- A checagem periódica não substitui um Webhook certificado do Mercado Pago,
  mas reduz a dependência de login. Issue #65 permanece aberta para a
  configuração e assinatura de notificações.
- O limite de 240 faturas é intencional. Divergências de fatura deslocada,
  cobrança tardia, dados incompletos e históricos acima desse limite exigem
  auditoria e política comercial explícita; a aplicação não deve inventar
  um período pago.
- A reconciliação periódica está **preparada no repositório**: o sucesso
  dos testes unitários não demonstra ainda conexão de produção ou eventos
  reais de reembolso. O agendamento não foi criado em Supabase.

### Sequência pendente antes de habilitar
1. Proprietário aprova por escrito a política de cobrança mensal R$180,
   início/fim de cobertura, perda sem tolerância após vencimento, cancelamento,
   pagamento atrasado, estorno/chargeback e suporte.
2. Usar as credenciais da **conta vendedora de produção** do Mercado Pago,
   distintas do fake seller. Inserir token e ID somente em Supabase Secrets,
   sem copiá-los para o chat, GitHub ou arquivos públicos.
3. Revisar o PR e confirmar que a CI está verde; resolver a alternativa de
   checkout do PR #68 antes do merge.
4. Validar Edge Functions, RLS e login no ambiente controlado. Verificar pagamento
   aprovado real de valor controlado e comportamento de renovação/recusa/
   cancelamento/refund, com os riscos e custos conhecidos e explicitamente
   autorizados.
5. Implantar as funções com os switches OFF, aplicar a migração RLS com
   `enforce_payment=false` e validar rollback sem interromper contas antigas.
6. Somente com autorização específica: capturar isenções finais, habilitar
   a aplicação financeira, os endpoints e a rotina periódica; acompanhar
   logs de falha e frequência de reconciliação.

### Referências oficiais consultadas
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/authorized-payment-search/get
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/overview
- https://supabase.com/docs/guides/functions/schedule-functions


### Contratação novamente depois do cancelamento

O aluno pode criar nova assinatura **apenas quando** todas as assinaturas
anteriores de produção estiverem confirmadas como canceladas no banco e
todos os respectivos períodos pagos tiverem expirado. A rotina de cancelamento
retira a intenção de checkout anterior do estado aberto, depois de a API
confirmar o cancelamento. Uma reconciliação posterior também faz esta
limpeza ao constatar cancelamento direto no Mercado Pago.

- `priorSubscriptionCheckoutGate` bloqueia nova cobrança se qualquer
  assinatura ainda estiver pendente/autorizada/pausada ou com histórico
  inconsistente; também bloqueia caso haja cobertura paga vigente.
- O conciliador por login audita a assinatura mais recente. A rotina
  periódica usa o ID interno da assinatura selecionada e verifica cada
  contrato separadamente, inclusive um cancelado antigo ainda passível
  de estorno. Nenhuma dessas escolhas vem de parâmetros do navegador.
- A coexistência de múltiplos contratos **ativos** é proibida; solicitações
  anômalas entram em revisão manual. Testes verificam que cancelamento não
  causa dupla cobrança antes do fim do período já pago.


### Aceite contratual e retorno do checkout

- A página só envia a criação de assinatura após o aluno marcar a caixa
  de aceite. O navegador transmite apenas `acceptTerms=true` e a versão
  `shamatha-r180-monthly-v1`; o servidor autentica a conta e exige **ambos**
  os valores antes de criar qualquer assinatura. Nenhum valor, vendedor ou
  ID do estudante é aceito do corpo da requisição.
- A migração preparatória já aplicada adiciona à intenção de checkout
  `terms_version` e `terms_accepted_at`, preenchidos no servidor como
  evidência da versão e horário do aceite. O contrato **precisa ser revisto e
  aprovado pelo proprietário antes de se usar essa versão para cobranças**.
  Se o texto mudar substancialmente, criar uma nova versão antes do go-live.
- Ao voltar com `?checkout=return`, a interface solicita **uma** reconciliação
  autenticada se a flag estiver ativa. O redirecionamento e o parâmetro da
  URL não liberam o aluno; somente o pagamento comprovado altera cobertura.
  Em caso de atraso na confirmação, permanece disponível a verificação manual.


## Situação verificada em 23/10/2026 — preparação aplicada (SEM cobranças)

O responsável confirmou a proposta comercial de R$ 180/mês nesta conversa,
**exclusivamente para dar continuidade à homologação**. Isto **NÃO** é
aprovação final para iniciar cobranças de alunos. A ativação final exige
autorização explícita e novo checklist técnico.

O Supabase principal recebeu a migração `billing_mvp_staged_gate` com versão
**20261023201342**. A migração existente no PR foi renomeada para
`supabase/migrations/20261023201342_billing_mvp_staged_gate.sql`, para
manter o histórico SQL consistente.

Verificações realizadas por leitura de banco: `enforce_payment=false`,
2 perfis existentes, 2 isenções, 0 assinaturas de produção e 0 pagamentos.
A função de consulta `public.shamatha_my_content_access()` não pode ser
executada por `anon`; o papel `authenticated` só recebe um booleano
para o próprio usuário. Ninguém tem acesso direto à tabela privada de
controle financeiro. O novo `SECURITY DEFINER` público é deliberado,
sem parâmetros e consulta apenas `auth.uid()`; acompanhar o aviso do
advisor de segurança e reavaliar periodicamente.

Edge Functions implantadas e versões iniciais no Supabase principal:
- `shamatha-create-subscription`: `verify_jwt=true`, trava
  **compilada** `PRELAUNCH_CHECKOUT_LOCKED=true`, que não pode ser
  desfeita com variáveis de ambiente e retorna indisponibilidade antes
  de qualquer chamada de criação ao Mercado Pago.
- `shamatha-reconcile-subscription`: `verify_jwt=true`, depende de
  `SHAMATHA_BILLING_RECONCILE_ENABLED=true`, ainda não acionado.
- `shamatha-cancel-subscription`: `verify_jwt=true`, depende de
  `SHAMATHA_MP_PRODUCTION_CANCEL_ENABLED=true`.
- `shamatha-billing-periodic`: `verify_jwt=false` APENAS porque o
  código exige um segredo Bearer privado de no mínimo 32 caracteres
  e duas flags explicitamente ligadas ANTES de consultar o banco.
  **Nenhum cron foi criado nem autorizado.**

A configuração pública da página continua com as quatro flags OFF,
o PR #67 permanece rascunho, e a branch `main`/GitHub Pages não foi
atualizada por estes deploys. O PR #68 contém checkout alternativo,
não deve ser mesclado junto ao #67.

### Etapas manuais restantes para homologação integrada

1. Em **Supabase Dashboard → projeto Shamatha → Edge Functions → Secrets**,
   armazenar **sem enviar a ninguém**:
   `SHAMATHA_MP_PRODUCTION_ACCESS_TOKEN` (token de produção do vendedor) e
   `SHAMATHA_MP_PRODUCTION_SELLER_ID` (ID numérico da conta real),
   diferentes da conta vendedora fictícia. Confirmar se já constam lá;
   a conexão de administração não oferece inspeção de Secrets.
2. **Manter DESLIGADAS**: `SHAMATHA_BILLING_PRODUCTION_ENABLED`,
   `SHAMATHA_BILLING_FINAL_LAUNCH_APPROVED`,
   `SHAMATHA_MP_PRODUCTION_CREATE_ENABLED`,
   `SHAMATHA_BILLING_RECONCILE_ENABLED`,
   `SHAMATHA_MP_PRODUCTION_CANCEL_ENABLED` e
   `SHAMATHA_BILLING_PERIODIC_ENABLED`.
3. Revisar termos `shamatha-r180-monthly-v1` antes de cobrança real.
   Executar testes integrados com aluno controlado e vendedor verdadeiro
   sem utilizar checkout real indevidamente. Validar roteamento pós-cadastro,
   usuário antigo isento, tentativa de checkout bloqueado, autorização de
   conteúdo por RLS e cancelamento seguro.
4. Quando houver aprovação final **separada** para cobrança real,
   remover o bloqueio compilado no checkout por novo commit revisado,
   testar pagamento controlado, ativar reconciliador, capturar snapshot
   final de isenções e executar o SQL de ativação em transação.
   Só depois configurar o Cron via Vault e os switches do site.
5. Registrar e acompanhar falhas de reconciliação, chargebacks e estornos.

**Nenhum segredo de produção foi escrito no GitHub ou nesta conversa.
Nenhuma cobrança real ou migração de ativação foi executada.**


### Verificação read-only da configuração Mercado Pago — 23/10/2026

O responsável informou ter configurado `SHAMATHA_MP_PRODUCTION_ACCESS_TOKEN`
e `SHAMATHA_MP_PRODUCTION_SELLER_ID` no Supabase. Foi executada uma
verificação temporária, protegida por um segredo de uso único e acionada
apenas por `pg_net`, em uma Edge Function já existente.

- O Access Token **existe** no ambiente Edge Functions e uma chamada
  de leitura `GET https://api.mercadolibre.com/users/me` retornou
  um usuário válido (**token funcional**, sem demonstrar por si só que a
  credencial pertence ao ambiente *Produção*).
- `SHAMATHA_MP_PRODUCTION_SELLER_ID` também existe, mas **não consiste
  exclusivamente de dígitos**; não pode passar o validador do checkout.
- Nenhum valor de token, ID de usuário ou segredo temporário foi impresso,
  armazenado neste repositório ou entregue ao navegador.
- O código temporário de diagnóstico **foi retirado** por novo deploy da
  versão original da função `shamatha-billing-periodic`, sem Cron,
  e as flags de conciliação/criação continuam desligadas.
- **Ação manual pendente:** corrigir `SHAMATHA_MP_PRODUCTION_SELLER_ID`
  para o User ID numérico da **mesma conta** cujo token está no Secret,
  sem aspas, prefixos, letras ou espaços. Conferir o seletor *Produção*
  no painel Mercado Pago, pois a autenticação do token sozinha não
  prova ambiente produtivo.
- Após a correção, repetir a validação da igualdade entre `/users/me.id`
  e `SELLER_ID` antes de qualquer contratação real.

Nenhum pagamento real foi iniciado, nenhuma restrição RLS de pagamento
foi habilitada e nenhum segredo de produção foi exposto.


### Rechecagem Seller ID — 23/10/2026 (após correção do proprietário)

Uma segunda leitura foi executada no Supabase por rota diagnóstica efêmera,
protegida por segredo de uso único, sem alterações de conta ou cobranças:

- `SHAMATHA_MP_PRODUCTION_SELLER_ID` agora está em **formato numérico válido**.
- O token autentica `GET https://api.mercadolibre.com/users/me`, mas
  `String(me.id) !== SHAMATHA_MP_PRODUCTION_SELLER_ID`.
- Resposta do teste: **SELLER_MISMATCH**. Por isso, **não é seguro**
  iniciar checkout ou considerar vendedor produtivo verificado.
- A rota diagnóstica foi retirada e a função original
  `shamatha-billing-periodic` foi reimplantada com o agendador OFF.
- Recomendar conferência no painel Mercado Pago Developers: abrir a
  **mesma aplicação/conta** cujo Access Token foi cadastrado, conferir o
  **User ID do vendedor** (não Client ID ou Application ID), e garantir
  credenciais da seção **Produção**. Caso o token seja de outra aplicação,
  corrigir ambos os Secrets de forma coordenada.
- Referência oficial: resposta de assinaturas retorna
  `collector_id` como o **User ID do vendedor**,
  https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/get-preapproval/get

Pós-verificação: `enforce_payment=false`, nenhuma assinatura/pagamento
de produção, nenhum job periódico de billing. Exige novo teste com
**igualdade comprovada** antes de prosseguir ao checkout controlado.


### Revalidação concluída do par token/vendedor — 23/10/2026

**A pendência anterior `SELLER_MISMATCH` foi resolvida.** Após o
responsável corrigir os segredos da mesma conta no Supabase, uma nova
verificação temporária e **somente de leitura** confirmou:

- `GET https://api.mercadolibre.com/users/me`: HTTP 200;
- o `id` retornado pela API **é idêntico** ao Secret
  `SHAMATHA_MP_PRODUCTION_SELLER_ID`;
- o Access Token possui o prefixo `APP_USR-` (aparência de credencial
  produtiva) e não `TEST-`. O token não foi exposto;
- o mecanismo de diagnóstico efêmero foi removido por novo deploy da
  versão original de `shamatha-billing-periodic`. Verificação posterior
  constatou que o código temporário não permaneceu implantado.

A checagem final do banco confirmou `enforce_payment=false`,
2 perfis/2 isenções, 0 assinaturas de produção, 0 pagamentos e 0
cron jobs de billing. As quatro flags da interface em `assets/config.js`
seguem `false`; PR #67 continua **draft, sem merge**.

**Próximo bloqueio:** executar homologação integrada controlada do ciclo
financeiro (aceite, criação de assinatura, fatura aprovada e recusada,
acesso, estorno, cancelamento e rollback), revisar os termos exibidos
ao aluno e obter autorização explícita adicional do responsável antes
de qualquer cobrança real ou aplicação de `enforce_payment=true`.


### Homologação segura ampliada — validação de checkout e estornos — 23/10/2026

Após a confirmação de que o token Mercado Pago e o Seller ID são da mesma
conta, foi feita uma revisão adicional **sem disparar cobranças**.

1. `mp-live-checkout-proof.mjs` verifica na resposta de `POST /preapproval`
   a identidade do vendedor (`collector_id`), referência única
   `shamatha:production:<userId>:<intentId>`, e-mail do aluno,
   **R$ 180 BRL**, recorrência **1 mês** e status inicialmente
   `pending`. O link HTTPS deve pertencer ao Mercado Pago e carregar
   exatamente o mesmo `preapproval_id`. A tentativa é mantida em
   `needs_review` quando a resposta de criação é parcial ou divergente;
   nunca é apresentada ao navegador nem reconhecida como pagamento.
   A retomada de checkout anterior também valida essas propriedades.
2. `mp-live-monthly-evidence.mjs`: um pagamento cuja API ainda retorne
   `status=approved` **não libera cobertura** se `status_detail`
   indicar estorno parcial, `transaction_amount_refunded > 0`, houver
   registros de `refunds` ou a fatura indicar estorno parcial. Os
   demais estados inválidos mantêm bloqueio. O valor faturado deve estar
   integralmente quitado.
3. O PostgreSQL principal foi auditado de forma **somente leitura**:
   as políticas de `stages`, `progress`, `live_classes`, `settings`
   e leitura privada de lembretes usam
   `private.has_content_access()`. O requisito financeiro ainda está
   desligado na tabela privada, portanto nenhuma conta antiga foi
   bloqueada.
4. Functions de checkout, conciliação do aluno e conciliação periódica
   foram redeployadas **com travas preservadas**. Não houve criação
   de agendamento, usuário de teste produtivo, assinatura ou pagamento.
5. CI após os testes de segurança: **260 testes passaram, 0 falharam**
   (GitHub Actions run `40023676197`). Isto verifica código e
   fluxos simulados, **não** o ciclo financeiro de ponta a ponta na
   conta Mercado Pago com pagamento real.

**Bloqueios restantes antes de go-live:** testes controlados com aluno
não isento e meios de pagamento de homologação, prova da fatura e do
pagamento real sem concessão por callback, cancelamento, estorno,
revogação no vencimento, revisão do texto contratual e uma autorização
expressa separada para ativar a cobrança e executar a transação RLS.

Referências consultadas:
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/create-preapproval/post
- https://www.mercadopago.com.br/developers/pt/docs/subscriptions/integration-configuration/subscription-no-associated-plan/authorized-payments
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/response-handling/query-results?scope=prod


### Homologação sem cobrança — reconciliação de titularidade e prova RLS

**Data: 23/10/2026.** A documentação oficial do Mercado Pago demonstra que as
respostas de `POST /preapproval` e `GET /preapproval/{id}` podem omitir
`payer_email` apesar de sua exigência no formulário de criação. A versão
anterior poderia rejeitar uma contratação legítima depois da criação remota
e impedir o aluno de conciliar um pagamento válido.

- Adicionado `mp-live-buyer-proof.mjs`: quando `payer_email` aparece
  e coincide, usa-se esse valor; quando ausente, consulta-se
  **GET /preapproval/search?payer_email=<e-mail autenticado>** com
  autenticação do vendedor, paginação controlada (até 100 resultados)
  e exigência do ID exato da assinatura. Resposta inconsistente,
  vazia, truncada, não filtrada ou sem contrato correspondente **nega
  acesso**, sem atribuir assinatura ao usuário por mera referência de URL.
  Um resultado ainda não indexado no provedor também falha fechado e
  exige revisão/reconciliação posterior.
- O checkout inicial, sua retomada e a conciliação de faturas usam a
  mesma prova independente, quando o fornecedor não incluir o e-mail.
  `verifyLiveMonthlyPayments` ainda rejeita e-mail explícito errado,
  mesmo que outra prova seja marcada verdadeira. Ao criar ou liberar,
  continuam obrigatórias provas do vendedor, preço, moeda, ciclo,
  ID e aprovação individual do pagamento.
- Banco em produção verificado **por consultas de leitura**: a função
  `public.shamatha_my_content_access()` retornou `true` para uma
  identidade administrativa aprovada e `false` para um UUID sem
  perfil. Nenhum usuário, pagamento ou contrato de teste foi inserido.
- As três Edge Functions dependentes foram reimplantadas após os testes,
  com checkout **travado em código** e conciliação periódica **OFF**.
  A chamada HTTP inofensiva ao agendador retornou HTTP **503**
  `BILLING_PERIODIC_DISABLED`, comprovando o bloqueio em execução.
- Último teste automático após estas correções:
  **274 testes, 274 passaram, 0 falhas** no GitHub Actions
  [40027030393](https://github.com/TTamosauskas/shamatha/actions/runs/40027030393).
- A preparação não equivale ao teste financeiro de ponta a ponta:
  nenhuma criação `POST /preapproval` de produção, cobrança, estorno
  ou cancelamento real foi executado.

**Pendente antes do go-live:** homologação controlada com aluno comprador
não isento, teste de assinatura/pagamento e estorno, revisão jurídica das
condições exibidas e autorização adicional e explícita do responsável.
Ainda não ativar `enforce_payment`, flags públicas nem cron.

Fontes Mercado Pago:
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/create-preapproval/post
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/get-preapproval/get
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/search-preapproval/get
