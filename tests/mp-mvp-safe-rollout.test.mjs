import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const cfg=read('assets/config.js');
const rls=read('supabase/migrations/20261023201342_billing_mvp_staged_gate.sql');
const activate=read('ops/BILLING_MVP_ACTIVATE_ONLY_AFTER_APPROVAL.sql');
const checkout=read('supabase/functions/shamatha-create-subscription/index.ts');
const reconcile=read('supabase/functions/shamatha-reconcile-subscription/index.ts');
const core=read('supabase/functions/_shared/mp-live-reconciliation.ts');
const periodic=read('supabase/functions/shamatha-billing-periodic/index.ts');
const cancel=read('supabase/functions/shamatha-cancel-subscription/index.ts');
const ui=read('minha-assinatura.html');
test('cancellation has its own disabled-by-default flag, independent of checkout',()=>{
  assert.match(cfg,/billingCancelEnabled: false/);
  assert.match(cancel,/SHAMATHA_MP_PRODUCTION_CANCEL_ENABLED/);
  assert.match(cancel,/shamatha:production:/);
  assert.match(cancel,/UNVERIFIED_SUBSCRIPTION_LINK/);
  assert.match(cancel,/\{ status: "canceled" \}/);
  assert.doesNotMatch(cancel,/req\.json\(/);
  assert.match(ui,/shamatha-cancel-subscription/);
  assert.match(ui,/Cancelar renovação automática/);
});
test('three public-facing feature switches default false',()=>{
  for(const key of ['billingUiEnabled','billingCheckoutEnabled','billingReconcileEnabled'])
    assert.match(cfg,new RegExp(key+': false'));
});
test('database enforcement is OFF even after preparatory migration',()=>{
  assert.match(rls,/enforce_payment boolean not null default false/);
  assert.match(rls,/values \(true,false\)/);
});
test('old students are snapshotted into exemptions by preparatory migration',()=>{
  assert.match(rls,/insert into public\.billing_exemptions/);
  assert.match(rls,/select id,/);
});
test('last-chance legacy snapshot and DB switch require separate manual transaction',()=>{
  assert.match(activate,/lock table public\.profiles in share mode/i);
  assert.match(activate,/on conflict \(user_id\) do nothing/);
  assert.match(activate,/set enforce_payment=true/);
});
test('RLS requires approved admin status and current paid invoice if non-exempt',()=>{
  assert.match(rls,/p\.access_status='approved'/);
  assert.match(rls,/public\.billing_exemptions/);
  assert.match(rls,/s\.environment='production'/);
  assert.match(rls,/s\.paid_through > now\(\)/);
  assert.match(rls,/b\.provider_status='approved'/);
  assert.match(rls,/b\.period_start<=now\(\)/);
  assert.match(rls,/b\.period_end>now\(\)/);
});
test('paid period cannot be decided solely by stored subscription state',()=>{
  assert.match(rls,/public\.billing_payments b/);
  assert.doesNotMatch(rls,/s\.access_status='active'/);
});
test('production checkout has immutable code lock until a separate final launch',()=>{
  assert.match(checkout,/const PRELAUNCH_CHECKOUT_LOCKED = true/);
  assert.match(checkout,/if \(PRELAUNCH_CHECKOUT_LOCKED\) halt\("CHECKOUT_AWAITING_FINAL_LAUNCH", 503\)/);
});
test('student checkout blocked without independently set provider secrets and flags',()=>{
  for(const key of [
    'SHAMATHA_MP_PRODUCTION_ACCESS_TOKEN',
    'SHAMATHA_MP_PRODUCTION_SELLER_ID',
    'SHAMATHA_BILLING_PRODUCTION_ENABLED',
    'SHAMATHA_BILLING_FINAL_LAUNCH_APPROVED',
    'SHAMATHA_MP_PRODUCTION_CREATE_ENABLED'
  ])assert.ok(checkout.includes(key));
});
test('fake seller can never be used as a production seller',()=>{
  assert.match(checkout,/FAKE_SELLER_ID = "3778352536"/);
  assert.match(checkout,/PROD_SELLER_ID !== FAKE_SELLER_ID/);
  assert.match(checkout,/TEST_SELLER_PROHIBITED/);
  assert.match(reconcile,/SELLER==='3778352536'/);
});
test('reconciliation refuses a provider subscription identity mismatch',()=>{
  assert.match(core,/SUBSCRIPTION_ID_MISMATCH/);
  assert.match(core,/remote\?\.id/);
});
test('student payment verification blocked independently of checkout switch',()=>{
  assert.match(reconcile,/SHAMATHA_BILLING_RECONCILE_ENABLED/);
  assert.match(reconcile,/sb\.auth\.getUser\(jwt\)/);
});
test('server reconciler verifies each payment by provider ID',()=>{
  assert.match(reconcile,/reconcileLiveStudent/);
  assert.match(core,/\/v1\/payments\//);
  assert.match(core,/verifyLiveMonthlyPayments/);
  assert.match(core,/collectAuthorizedInvoicePages/);
  assert.match(core,/currentCycleCandidatePaymentIds/);
});
test('batch reconciliation is secret-authenticated, independently gated and has a rotating scan',()=>{
  assert.match(periodic,/SHAMATHA_BILLING_PERIODIC_ENABLED/);
  assert.match(periodic,/SHAMATHA_BILLING_CRON_SECRET/);
  assert.match(periodic,/authorizedBearer/);
  assert.match(periodic,/crypto\.subtle\.digest/);
  assert.match(periodic,/rotatingBillingBatchOffset/);
  assert.match(periodic,/reconcileLiveStudent/);
  assert.doesNotMatch(periodic,/req\.json\(/);
});
test('only explicit versioned consent is accepted from browser; price and identity are server owned',()=>{
  assert.match(checkout,/const consent=await req\.json\(\)/);
  assert.match(checkout,/consent\?\.acceptTerms!==true/);
  assert.match(checkout,/consent\?\.termsVersion!==TERMS_VERSION/);
  assert.match(checkout,/terms_accepted_at: new Date\(\)\.toISOString\(\)/);
  assert.match(checkout,/amountCents: AMOUNT_CENTS/);
  assert.match(rls,/add column if not exists terms_version text/);
  assert.match(rls,/add column if not exists terms_accepted_at timestamptz/);
  assert.match(ui,/acceptTerms:true,termsVersion:TERMS_VERSION/);
  assert.match(ui,/const TERMS_VERSION='shamatha-r180-monthly-v1'/);
});
test('return from Mercado Pago is never treated as paid; server reconciliation required',()=>{
  assert.match(ui,/checkoutReturnHandled/);
  assert.match(ui,/new URLSearchParams\(location\.search\)\.get\('checkout'\)==='return'/);
  assert.match(ui,/shamatha-reconcile-subscription/);
});
test('my subscription page gates checkout behind user acceptance',()=>{
  assert.match(ui,/billingCheckoutEnabled===true/);
  assert.match(ui,/acceptTerms/);
  assert.match(ui,/shamatha-create-subscription/);
});
test('HTML inline module parses after removing module import',()=>{
  const script=ui.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const code=script.replace(/^import \{ formatSubscriptionState \} from '.+';\n/m,'');
  assert.doesNotThrow(()=>new Function(code));
});


test('optimized app data path verifies server-side current access',()=>{
  const fast=read('assets/fast-app-data.js');
  assert.match(fast,/shamatha_my_content_access/);
  assert.match(fast,/fail\('PAYMENT_REQUIRED',402\)/);
});
test('media path still checks RLS before producing signed audio URLs',()=>{
  const fast=read('assets/fast-app-data.js');
  assert.match(fast,/from\('stages'\)/);
  assert.match(fast,/sb\.rpc\('shamatha_my_content_access'\)/);
  const media=read('assets/child-stages-backend.js');
  assert.match(media,/SIGNED_SECONDS = window\.SHAMATHA_CONFIG\?\.billingUiEnabled===true \? 60/);
});
test('login gets server-verified entitlement instead of relying on administrative approval alone',()=>{
  const backend=read('assets/supabase-backend.js');
  assert.match(backend,/if \(path === '\/api\/login' && method === 'POST'\) \{[\s\S]*?return \{ user: await gatedUser\(await profileForUser\(data\.user\)\) \};/);
});
test('both app loader and login direct nonpaying students to subscriptions',()=>{
  assert.match(read('assets/app.js'),/minha-assinatura\.html\?due=1/);
  assert.match(read('assets/login.js'),/user\.billingEnforced/);
});
