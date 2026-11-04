// A payment error must never be presented as proof that no provider
// subscription exists. Conversely, a rejected eligibility check must not
// be described as a "previous subscription". Classification is display-only:
// no retries, mutations, or provider calls happen here.
export function classifyCheckoutFailure({code='',status=0}={}){
  const reason=String(code||'').slice(0,100).toUpperCase();
  const httpStatus=Number(status)||0;
  const result=(message,kind)=>({message,kind,allowRetry:false});
  if(reason==='ACCOUNT_SESSION_CHANGED'||reason==='AUTH_REQUIRED'||
     reason==='SESSION_INVALID'||httpStatus===401){
    return result('A sessão mudou ou expirou. Volte à tela de acesso e entre novamente com a conta do aluno. Nenhuma nova contratação foi solicitada por esta tentativa.', 'session');
  }
  if(reason==='STUDENT_REQUIRED'){
    return result('Esta sessão não pertence a uma conta de aluno. Saia do editor e entre com uma conta de aluno para assinar.', 'eligibility');
  }
  if(reason==='ALREADY_EXEMPT'){
    return result('Esta conta já tem isenção financeira. Não é necessário contratar uma assinatura.', 'eligibility');
  }
  if(reason==='EMAIL_NOT_CONFIRMED'||reason==='VERIFIED_EMAIL_REQUIRED'){
    return result('Confirme o e-mail da conta antes de contratar a assinatura.', 'eligibility');
  }
  if(reason==='ACCOUNT_SUSPENDED'){
    return result('Esta conta está suspensa. Entre em contato com o editor antes de contratar.', 'eligibility');
  }
  if(reason==='ACCOUNT_STATUS_UNRECOGNIZED'||reason==='PROFILE_NOT_FOUND'){
    return result('O cadastro ainda não está pronto para contratar. Peça ao editor que verifique sua situação.', 'eligibility');
  }
  if(reason==='ORIGIN_NOT_ALLOWED'){
    return result('Abra a página pelo endereço oficial do Shamatha e tente novamente após entrar em sua conta.', 'configuration');
  }
  if(reason==='SELLER_ID_MISMATCH'||reason==='TEST_SELLER_PROHIBITED'||
     reason==='SELLER_NOT_CONFIGURED'){
    return result('Não foi possível validar a conta vendedora do Mercado Pago. O administrador precisa verificar a configuração antes de receber assinaturas.', 'configuration');
  }
  if(['PRODUCTION_DISABLED','LAUNCH_NOT_APPROVED','CHECKOUT_DISABLED',
      'CHECKOUT_AWAITING_FINAL_LAUNCH','SERVER_NOT_CONFIGURED'].includes(reason)){
    return result('A contratação está temporariamente desativada pelo administrador. Não houve liberação de um novo checkout.', 'configuration');
  }
  if(reason==='SUBSCRIPTION_TERMS_ACCEPTANCE_REQUIRED'){
    return result('Confirme o aceite das condições da assinatura e atualize a situação da conta.', 'consent');
  }
  if(reason==='EXISTING_SUBSCRIPTION_AWAITING_VERIFICATION'){
    return result('Uma assinatura anterior foi identificada, mas ainda não está confirmada. Use Verificar pagamento; não contrate outra assinatura.', 'review');
  }
  if(reason==='EXISTING_ATTEMPT_REQUIRES_REVIEW'||reason==='EXISTING_CHECKOUT_NEEDS_REVIEW'||
     reason.startsWith('RECOVERY_')||reason==='PROVIDER_CREATION_REQUIRES_REVIEW'||
     reason==='REMOTE_CREATION_REQUIRES_REVIEW'||
     reason==='SUBSCRIPTION_LINK_REQUIRES_REVIEW'||
     reason==='CHECKOUT_SAVE_REQUIRES_REVIEW'||httpStatus===409){
    return result('Uma tentativa de assinatura precisa ser verificada. Não faça outra contratação antes de o editor confirmar o estado no Mercado Pago.', 'review');
  }
  if(httpStatus===403){
    return result('A conta não foi autorizada a contratar neste momento. Atualize a situação e, se persistir, informe ao editor o código do erro: '+(reason||'HTTP 403')+'.', 'eligibility');
  }
  if(httpStatus>=500){
    return result('O servidor não conseguiu preparar o checkout. O estado da tentativa é incerto: não repita a contratação até verificar com o editor.', 'review');
  }
  if(httpStatus>=400){
    return result('O checkout recusou a solicitação. Atualize a situação e, se persistir, informe ao editor o código: '+(reason||'HTTP '+httpStatus)+'.', 'configuration');
  }
  return result('Não foi possível se comunicar com o checkout. Não é possível confirmar se houve uma tentativa anterior. Confira sua conexão, atualize a situação e, se persistir, procure o editor antes de tentar contratar novamente.', 'network');
}

export async function readCheckoutFailure(error){
  let code=String(error?.code||error?.message||'').slice(0,100);
  let status=Number(error?.context?.status||error?.status)||0;
  const response=error?.context;
  if(response&&typeof response.clone==='function'){
    try{
      const body=await response.clone().json();
      if(typeof body?.error==='string')code=body.error;
    }catch(_error){/* Never throw while presenting a billing error. */}
  }
  return classifyCheckoutFailure({code,status});
}
