# Shamatha — publicação controlada, teste manual e divulgação

**Decisão do responsável em 23/10/2026:** não gastar dinheiro na homologação atual. O teste de cobrança real de R$ 180 será **manual, depois da publicação técnica e antes de divulgar a aplicação**. Esta decisão **não** autoriza cobrança agora nem disponibilização pública do checkout.

## Três portas distintas

### 1. Publicação técnica — sem ativação financeira

Objetivo: disponibilizar a versão estável do Shamatha no endereço de produção existente, sem permitir que a publicação faça uma cobrança. Publicação do código e habilitação do sistema financeiro são eventos distintos.

- Finalizar revisão e testes automatizados sem credenciais reais.
- Verificar privacidade e separação de permissões: aluno versus editor, aprovação administrativa, recuperação dos dados e continuidade dos alunos existentes.
- Antes de publicar, confirmar que `const PRELAUNCH_CHECKOUT_LOCKED = true` continua implantado em `shamatha-create-subscription`.
- Manter `billingUiEnabled`, `billingCheckoutEnabled`, `billingReconcileEnabled` e `billingCancelEnabled` como `false` no `assets/config.js`, e **sem** troca por valores públicos que indiquem checkout ativo.
- No banco, `private.billing_access_control.enforce_payment=false`, sem cron de cobrança, e todos os usuários presentes continuam isentos. A exigência de pagamento só será ativada em uma etapa posterior separada.
- Não habilitar `SHAMATHA_BILLING_PRODUCTION_ENABLED`, `SHAMATHA_BILLING_FINAL_LAUNCH_APPROVED`, `SHAMATHA_MP_PRODUCTION_CREATE_ENABLED`, nem quaisquer variáveis de cancelamento/conciliação/periodicidade.
- Revisar o que será publicado em `main` e obter autorização de publicação específica; **não considerar o simples "prossiga" para homologação como aprovação de faturamento**.
- Fazer teste de navegação e login no endereço publicado. Sem convite/divulgação para novos alunos, mantendo aprovação administrativa individual.

**Saída da etapa:** site publicado, checkout real ainda impossível. Não confundir com o teste financeiro.

### 2. Teste real manual privado — *depois de publicar, antes de divulgar*

O responsável fará pessoalmente **uma** contratação com conta de aluno controlada, depois de aprovar separadamente o risco de desembolso de **R$ 180 reais**. Esta autorização ainda NÃO foi dada. Não criar assinatura nem executar nenhuma API de escrita do Mercado Pago até ela ocorrer.

**Requisito de engenharia antes do teste:** preparar e revisar uma autorização de checkout no backend **somente para o ID da conta de aluno piloto**, isolada da liberação para o público. Nunca retirar a trava do checkout para todos os usuários a fim de viabilizar um único teste. A eventual alteração da trava compilada e das flags deve ocorrer apenas nesta revisão de piloto autorizada. O comportamento de cancelamento deve continuar acessível ao aluno piloto até o encerramento de futuras cobranças; não bloquear o cancelamento junto com o checkout durante um incidente.

No roteiro manual, o responsável verifica:

1. A conta de teste está autenticada com e-mail verificado, é `student`, não está isenta e não pode ser usada como editor.
2. A interface informa R$ 180 mensais, aceite dos termos, aprovação administrativa independente e renovação automática. Conferir o conteúdo dos termos antes de aceitar.
3. A criação produz no máximo uma assinatura; duas tentativas ou dois cliques não produzem duas cobranças. Conferir vendedor, pagador, preço e periodicidade no Mercado Pago.
4. Voltar do checkout não libera conteúdo por si só. Somente pagamento `approved`, vinculado ao vendedor e aluno certos e conciliado pelo servidor, dá cobertura financeira.
5. Com pagamento confirmado, conferir início e fim do período pago e aprovação administrativa. Aluno sem aprovação do editor ainda não deve ler o conteúdo, mesmo estando pago.
6. Cancelar futuras renovações no Shamatha e confirmar **no Mercado Pago** que a assinatura foi cancelada. Verificar que o mês já pago permanece acessível até o vencimento, salvo estorno/contestação.
7. Caso faça reembolso, confirmar no provedor; conciliar e conferir que o pagamento devolvido não mantém acesso. Não executar estorno como pré-condição automática: devolver dinheiro é outro ato financeiro que requer controle.
8. Anotar evidências **sem salvar números de cartão, tokens, e-mails privados ou comprovantes sensíveis** no GitHub.
9. Bloquear novamente a criação de checkout caso o piloto termine sem autorização para abertura pública. Inspecionar os registros de assinatura para garantir que a próxima renovação não ficará ativa por engano.

**Se qualquer passo falhar:** manter o público bloqueado; registrar o erro, suspender a criação de novas assinaturas e garantir que a assinatura piloto possa ser cancelada no provedor. Nenhuma divulgação.

### 3. Divulgação e cobrança pública — autorização posterior e independente

Somente depois da avaliação do teste manual, revisão dos termos, aprovação expressa de lançamento e verificação de que haverá suporte para pagamentos, cancelamentos e estornos:

- Fazer revisão separada das flags privadas, da interface, do código de checkout e do acesso pago no banco; plano de retorno obrigatório.
- Executar `ops/BILLING_MVP_ACTIVATE_ONLY_AFTER_APPROVAL.sql` **apenas nesta etapa**, após confirmar a isenção de todas as contas já existentes.
- Agendar a conciliação automática somente depois de validar segredos, observabilidade, intervalos e tempo até expiração; não rodar automaticamente o SQL de cron pelo merge.
- Ativar checkout ao público somente depois de certificar os caminhos de cancelamento e suporte, não antes.
- Uma falha do Mercado Pago não deve conceder acesso fictício nem criar cobranças duplicadas.

## O que fazer *agora*, sem gastar

- Executar a suíte automatizada de testes e revisar falhas de cobrança, acesso, cancelamento, estorno, valores, IDs e datas.
- Usar apenas respostas simuladas/localmente ou um ambiente do Mercado Pago cujas contas e credenciais sejam **explicitamente de teste**, separadas dos Secrets produtivos existentes.
- Para testar assinaturas sem plano no Mercado Pago, a orientação publicada pelo provedor prevê **contas de teste vendedor e comprador** e, em determinados fluxos, **o token de produção da conta de teste**, não da conta vendedora real. Portanto o prefixo `APP_USR-` **sozinho não comprova** que uma credencial será gratuita ou corresponde à conta real. Não chamar `POST /preapproval` com os dois Secrets produtivos atuais para "simular".
- Não pedir ao proprietário cartão, token ou dados bancários no chat.

Referências oficiais:
- Teste de assinaturas com e sem plano: https://www.mercadopago.com.br/developers/pt/news/2023/11/16/Questions-on-how-to-test-your-integration--
- Teste de compra de assinaturas: https://www.mercadopago.com.br/developers/pt/docs/subscriptions/integration-test/payment-approval
- Cancelamento: https://www.mercadopago.com.br/developers/pt/docs/subscriptions/subscription-management

## Critérios de aprovação

| Portão | Sem cobrança agora | Autorização exigida |
| --- | --- | --- |
| Publicação técnica do site | Sim | Aprovação de publicação, sem cobrança |
| Teste manual privado de R$ 180 | **Não** — envolverá dinheiro real | Aprovação separada do teste e de qual conta pilotará |
| Divulgação + faturamento dos novos alunos | Não | Aprovação final separada após verificar o piloto |

**Estado do projeto na redação:** o PR #67 permanece rascunho, ainda não incorporado à `main`. A migração financeira preparatória está presente, mas a exigência de pagamento continua desligada e nenhuma cobrança real foi iniciada.


## Bloqueio técnico identificado antes do piloto financeiro privado

**Validação de prontidão em 27/10/2026:** o PR #67 segue em *draft*
e não foi mesclado em `main`. A trava `PRELAUNCH_CHECKOUT_LOCKED=true`
continua no código, as quatro flags públicas de billing continuam desligadas,
`private.billing_access_control.enforce_payment=false`, 2 perfis atuais
isentos, 0 assinaturas de produção, 0 pagamentos, 0 tarefas periódicas.

Há dois impedimentos concretos antes de o responsável poder pagar manualmente:

1. **Criação deve ser exclusiva do piloto:** antes de retirar a trava
   compilada, exigir no servidor um ID de usuário Supabase **exatamente igual**
   ao perfil `student` piloto, derivado da sessão autenticada e de
   configuração privada não controlada pelo navegador. Continuar negando
   a criação para todos os demais, inclusive editores e contas isentas.
   O fluxo pode ser habilitado por um caminho privado de UI para o piloto,
   mantendo o checkout público inativo. Testar negativas para outro UUID,
   sessões ausentes, perfis de editor, e-mail não verificado, usuário isento,
   clique duplo e chamadas paralelas.

2. **Bloqueio de acesso financeiro do piloto deve ser isolado:** quando
   `enforce_payment=false`, a política RLS atual requer aprovação
   administrativa, mas **não exige pagamento de nenhum aluno**. Logo
   simplesmente aprovar a conta piloto antes de pagar não demonstrará
   a eficácia do bloqueio por inadimplência. Projetar e testar um
   controle financeiro temporário aplicado **somente ao UUID do aluno
   piloto**, sem mudar o comportamento dos usuários existentes. Verificar
   acesso negado após aprovação administrativa mas antes de pagamento,
   acesso permitido após conciliação de uma fatura real integralmente
   aprovada e período válido, acesso negado após expiração/estorno, e
   preservação do mês quitado após cancelamento. Executar ensaios
   transacionais sem persistência e revisar a alteração antes de deploy.

O comprador piloto deve ser uma **conta de estudante nova**, e não
qualquer um dos 2 usuários anteriores, pois são editores isentos.
A conta do comprador e a conta vendedora devem ser identidades reais
**distintas**. Não inserir e-mail privado, UUID, token ou dados do
cartão no repositório, logs ou mensagens públicas.

**Execução:** somente depois da publicação técnica e de autorização
explícita do teste financeiro, o responsável entra com essa conta
de estudante, revisa `R$ 180/mês` e os termos, aceita, paga com
seu meio de pagamento real, aguarda prova de pagamento no backend,
confirma o conteúdo, cancela a renovação no Shamatha e confere
também o cancelamento no painel Mercado Pago. Guardar evidências
resumidas e confirmar que nenhuma segunda cobrança está ativa.
Não presumir que cancelar produz reembolso do primeiro pagamento.

**Importante:** publicar uma versão técnica com os controles de checkout
desligados e *depois* lançar um checkout-piloto isolado são operações
separadas. Nenhuma delas autoriza faturamento aberto ao público.
