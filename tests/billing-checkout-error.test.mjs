import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCheckoutFailure, readCheckoutFailure } from '../assets/billing-checkout-error.mjs';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../minha-assinatura.html',import.meta.url),'utf8');

test('server 403 student-required is not misrepresented as pending provider contract',()=>{
  const v=classifyCheckoutFailure({code:'STUDENT_REQUIRED',status:403});
  assert.match(v.message,/conta de aluno/);
  assert.doesNotMatch(v.message,/tentativa anterior|assinatura pendente/);
  assert.equal(v.allowRetry,false);
});
test('unconfirmed email, exempt students and suspended accounts get distinct explanations',()=>{
  for(const [code,fragment] of [
    ['EMAIL_NOT_CONFIRMED',/Confirme o e-mail/],
    ['ALREADY_EXEMPT',/isenção financeira/],
    ['ACCOUNT_SUSPENDED',/suspensa/]
  ])assert.match(classifyCheckoutFailure({code,status:403}).message,fragment);
});
test('production switch and seller mismatch show actionable non-provider errors',()=>{
  for(const code of ['PRODUCTION_DISABLED','LAUNCH_NOT_APPROVED','CHECKOUT_DISABLED'])
    assert.match(classifyCheckoutFailure({code,status:503}).message,/desativada pelo administrador/);
  assert.match(classifyCheckoutFailure({code:'SELLER_ID_MISMATCH',status:403}).message,/conta vendedora/);
});
test('provider-ambiguous and existing intent errors strictly prohibit second charge',()=>{
  for(const code of [
    'EXISTING_ATTEMPT_REQUIRES_REVIEW',
    'EXISTING_CHECKOUT_NEEDS_REVIEW',
    'RECOVERY_PRIOR_SUBSCRIPTION_REQUIRES_REVIEW',
    'PROVIDER_CREATION_REQUIRES_REVIEW'
  ]){
    const x=classifyCheckoutFailure({code,status:409});
    assert.match(x.message,/Não faça outra contratação/);
    assert.equal(x.allowRetry,false);
  }
});
test('unclassified network failures never assert a subscription does or does not exist',()=>{
  const x=classifyCheckoutFailure({});
  assert.match(x.message,/Não é possível confirmar/);
  assert.doesNotMatch(x.message,/Nenhuma nova cobrança foi iniciada/);
});
test('backend error JSON is read from Response clone, not user-injected strings',async()=>{
  const response=new Response(JSON.stringify({error:'STUDENT_REQUIRED'}),{
    status:403,headers:{'Content-Type':'application/json'}
  });
  const error={context:response};
  const x=await readCheckoutFailure(error);
  assert.match(x.message,/conta de aluno/);
  assert.equal(response.bodyUsed,false);
});
test('failed JSON or nonstandard errors fall back safely',async()=>{
  const x=await readCheckoutFailure({context:new Response('bad gateway',{status:502})});
  assert.match(x.message,/estado da tentativa é incerto/);
  const y=await readCheckoutFailure(new TypeError('Failed to fetch'));
  assert.match(y.message,/Não foi possível se comunicar/);
});
test('checkout validates same authenticated Supabase user before invoking billable endpoint',()=>{
  const auth=html.indexOf("await sb.auth.getUser()",html.indexOf("el('startSubscription').addEventListener"));
  const match=html.indexOf('identity.user.id!==authenticatedProfile.id',auth);
  const invoke=html.indexOf("sb.functions.invoke('shamatha-create-subscription'",auth);
  assert.ok(auth>0&&match>auth&&invoke>match);
  assert.match(html,/identity\.user\.email_confirmed_at/);
});
test('never relabel a subscription-creating POST as merely checking a prior attempt',()=>{
  assert.doesNotMatch(html,/textContent='Verificar tentativa anterior'/);
  assert.match(html,/el\('startSubscription'\)\.disabled=true/);
  assert.match(html,/showCheckoutModalError\(message,failure.kind==='review'\)/);
  assert.match(html,/Atualize a situação antes de tentar novamente/);
});
