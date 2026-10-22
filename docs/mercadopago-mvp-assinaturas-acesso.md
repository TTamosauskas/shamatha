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
