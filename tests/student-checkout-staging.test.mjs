import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/shamatha-mp-student-checkout/index.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../minha-assinatura.html',import.meta.url),'utf8');

test('no user-supplied identity or seller token is trusted by checkout',()=>{
 assert.match(source,/admin\.auth\.getUser\(jwt\)/);
 assert.match(source,/user\.id/);
 assert.match(source,/user\.email/);
 assert.doesNotMatch(source,/body\.userId|body\.payerEmail|body\.sellerId/);
});
test('independent production feature flags are required before new checkout',()=>{
 for(const key of ['SHAMATHA_MP_PRODUCTION_BILLING_ENABLED',
 'SHAMATHA_MP_PRODUCTION_LAUNCH_APPROVED','SHAMATHA_MP_PRODUCTION_CHECKOUT_ENABLED']){
  assert.ok(source.includes(key),key);
 }
 assert.match(source,/if\(!precheck\.allowed\)fail\(precheck\.reason/);
});
test('checkout cannot reuse sandbox seller or sandbox token',()=>{
 assert.match(source,/FAKE_SELLER_ID/);
 assert.match(source,/sellerId !== FAKE_SELLER_ID/);
 assert.match(source,/SHAMATHA_MP_PRODUCTION_SELLER_TOKEN/);
 assert.doesNotMatch(source,/SHAMATHA_MP_SANDBOX_SELLER_TOKEN/);
});
test('original profile and exemption are checked server-side',()=>{
 assert.match(source,/\.from\("profiles"\)/);
 assert.match(source,/\.from\("billing_exemptions"\)/);
 assert.match(source,/\.from\("billing_subscriptions"\)/);
});
test('server reserves one open idempotent checkout per account',()=>{
 assert.match(source,/billing_checkout_intents/);
 assert.match(source,/idempotency_key/);
 assert.match(source,/X-Idempotency-Key/);
 assert.match(source,/CHECKOUT_REQUIRES_REVIEW/);
});
test('server never writes access grants on checkout return',()=>{
 assert.doesNotMatch(source,/\.from\("profiles"\)\.update/);
 assert.doesNotMatch(source,/\.from\("billing_payments"\)\.insert/);
 assert.doesNotMatch(source,/paid_through|grantsStudentAccess/);
});
test('student checkout button starts disabled and requires a GET server capability',()=>{
 assert.match(page,/<button id="startCheckout"[^>]*disabled/);
 assert.match(page,/sb\.functions\.invoke\([\s\S]*?'shamatha-mp-student-checkout',\{method:'GET'\}/);
 assert.match(page,/cap\?\.enabled===true/);
});
test('customer checkout button redirects only to HTTPS Mercado Pago',()=>{
 assert.match(page,/isSafeMercadoPagoUrl\(data\?\.checkoutUrl\)/);
 assert.match(page,/window\.location\.assign\(data\.checkoutUrl\)/);
});
test('checkout returns never grant course access based on browser success',()=>{
 assert.match(page,/retorno da página de pagamento não será tratado como prova/);
 assert.doesNotMatch(page,/setAccess|grantAccess|\.update\(\{access_status/);
});
