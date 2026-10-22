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
à conta, no login ou na rotina periódica preparada nesta branch; nenhum
desses recursos está implantado em produção. Estornos externos serão
detectados na próxima conciliação bem-sucedida, não instantaneamente.

## Status técnico desta branch

- \`shamatha-create-subscription\`: handler **não implantado**, todas as 3
  flags de autorização/checkout OFF por padrão, conexão de vendedor produção
  ausente do repositório.
- \`shamatha-reconcile-subscription\`: handler de verificação **não
  implantado**, \`SHAMATHA_BILLING_RECONCILE_ENABLED=false\` por padrão.
- \`assets/config.js\`: três flags públicas **false**. A interface fica
  informativa e não cria cobrança até ativação coordenada.
- \`20261022110000_billing_mvp_staged_gate.sql\`: migração preparatória
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
3. Implantar as duas Edge Functions em modo **desativado**, com JWT ligado;
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
   e-mails de suporte. Fluxos com 12+ faturas ou pagamento deslocado
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

Funções candidatas de produção: `shamatha-create-subscription` (criação), `shamatha-reconcile-subscription` (consulta autenticada por aluno), `shamatha-cancel-subscription` (cancelamento autenticado por aluno). Todas devem permanecer **não implantadas** até validação integrada.

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
