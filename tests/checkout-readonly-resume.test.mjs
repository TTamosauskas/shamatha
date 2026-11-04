import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../supabase/functions/shamatha-create-subscription/index.ts',import.meta.url),'utf8');
const html=readFileSync(new URL('../minha-assinatura.html',import.meta.url),'utf8');
const inline=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]||'';

test('resumeOnly is a separate authenticated and entitlement-gated route',()=>{
  const auth=src.indexOf('const { authUser, profile } = await requireStudent(req);');
  const eligibility=src.indexOf('if (!eligibility.allowed) halt(eligibility.reason, 403);');
  const begin=src.indexOf('if(consent?.resumeOnly===true){');
  const end=src.indexOf('    // For a NEW contract',begin);
  assert.ok(auth>0&&eligibility>auth&&begin>eligibility&&end>begin);
  const body=src.slice(begin,end);
  assert.match(body,/existingOpenIntent\(authUser\.id\)/);
  assert.match(body,/if\(!prior\)halt\("NO_EXISTING_ATTEMPT",404\)/);
  assert.match(body,/\["created","needs_review"\]/);
  assert.match(body,/recoverExistingReview\(/);
  assert.match(body,/resumeExisting\(/);
  assert.match(body,/reused:true/);
  assert.match(body,/grantsStudentAccess:false/);
  assert.doesNotMatch(body,/startCheckout\(|fetch\(.*preapproval|method: "POST"/);
  assert.ok(src.indexOf('await startCheckout(',end)>end,
    'The new-subscription operation must occur only after resumeOnly returned');
});

test('recovery still verifies provider seller, exact subscription and buyer',()=>{
  assert.match(src,/await verifiedSeller\(\)/);
  assert.match(src,/verifyCreatedMonthlyPreapproval\(/);
  assert.match(src,/const buyerVerified=await verifiedBuyer\(remote,userEmail\)/);
  assert.match(src,/verifiedMercadoPagoCheckoutUrl\(/);
});

test('UI recovery button is explicit and is invisible during creation',()=>{
  assert.match(html,/id="checkoutModalResume"[^>]*hidden/);
  assert.match(inline,/el\('checkoutModalResume'\)\.hidden=true/);
  assert.match(inline,/el\('checkoutModalResume'\)\.hidden=!canResume/);
  assert.match(inline,/showCheckoutModalError\(message,failure.kind==='review'\)/);
  assert.match(inline,/Retomar checkout existente \(sem nova assinatura\)/);
});

test('UI recovery explicitly calls resumeOnly, not creation body',()=>{
  const start=inline.indexOf("el('checkoutModalResume').addEventListener('click'");
  const end=inline.indexOf("el('startSubscription').addEventListener('click'",start);
  assert.ok(start>0&&end>start);
  const recovery=inline.slice(start,end);
  assert.match(recovery,/body:\{resumeOnly:true\}/);
  assert.doesNotMatch(recovery,/acceptTerms:true|body:\{acceptTerms|startCheckout/);
  assert.match(recovery,/identity\.user\.id!==authenticatedProfile\.id/);
  assert.match(recovery,/redirectToVerifiedCheckout\(data\.checkoutUrl\)/);
  assert.match(recovery,/checkoutInFlight=true/);
});

test('UI does not make automatic provider retries after an error',()=>{
  assert.doesNotMatch(inline,/setInterval\(/);
  assert.doesNotMatch(inline,/setTimeout\([^)]*resumeOnly/);
  assert.match(inline,/el\('startSubscription'\)\.disabled=true/);
  assert.match(inline,/showCheckoutModalError\(message,failure.kind==='review'\)/);
});
