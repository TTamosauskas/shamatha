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
   servidor consulta a assinatura, **todas** as faturas (até o limite seguro do
   MVP) e cada pagamento individual pelo ID, validando vendedor, preço,
   moeda, ID e período mensal.
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

O MVP não promete Webhook imediato. Verificação ocorre no retorno ao
Shamatha e a cada login quando habilitada. Estornos feitos fora do site
podem ser percebidos apenas na próxima consulta; para operação contínua
será necessário monitoramento periódico em etapa separada.

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
