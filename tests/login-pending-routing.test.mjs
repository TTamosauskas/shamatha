import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const login=read('assets/login.js');
const index=read('index.html');
const billing=read('minha-assinatura.html');
const app=read('app.html');

// Evaluate only the pure login destination function in isolation, without a
// browser, credentials, Supabase API calls or any real payment interactions.
const start=login.indexOf('function loginDestination(user) {');
const end=login.indexOf('\n}\n',start);
assert.ok(start>0&&end>start,'Pure destination function is present');
const loginDestination=new Function(login.slice(start,end+2)+'\nreturn loginDestination;')();
const user=(overrides={})=>({
  role:'user',accessStatus:'pending',billingEnforced:true,
  accessGranted:false,...overrides
});

test('pending registered student is sent to Minha assinatura',()=>{
  assert.equal(loginDestination(user()),'./minha-assinatura.html?pending=1');
});
test('pending is routed even if billing flags are missing or user data is stale',()=>{
  assert.equal(loginDestination(user({billingEnforced:false})),
    './minha-assinatura.html?pending=1');
  assert.equal(loginDestination(user({accessGranted:true})),
    './minha-assinatura.html?pending=1');
});
test('pending account is never sent to editor based only on role',()=>{
  assert.equal(loginDestination(user({role:'editor'})),
    './minha-assinatura.html?pending=1');
});
test('suspended account is not sent to a payment checkout',()=>{
  assert.equal(loginDestination(user({accessStatus:'suspended'})),null);
});
test('approved editor still goes to editor',()=>{
  assert.equal(loginDestination(user({
    role:'editor',accessStatus:'approved',billingEnforced:false,accessGranted:true
  })),'./editor.html');
});
test('approved student without confirmed financial access goes to billing',()=>{
  assert.equal(loginDestination(user({accessStatus:'approved'})),
    './minha-assinatura.html?due=1');
});
test('approved and fully entitled student goes to the course',()=>{
  assert.equal(loginDestination(user({accessStatus:'approved',accessGranted:true})),
    './app.html');
});
test('no user session never gets a content route',()=>{
  assert.equal(loginDestination(null),null);
});
test('login page uses the same decision for sign-in, account creation, and session recovery',()=>{
  assert.match(login,/loginForm\.addEventListener\('submit'[\s\S]*?routeUser\(data\.user\)/);
  assert.match(login,/registerForm\.addEventListener\('submit'[\s\S]*?routeUser\(data\.user\)/);
  assert.match(login,/invitePasswordForm\.addEventListener\('submit'[\s\S]*?routeUser\(data\.user\)/);
  assert.match(login,/navigating = routeUser\(user\)/);
  assert.match(login,/const destination = loginDestination\(user\)/);
  assert.match(login,/location\.href = destination/);
});
test('pending destination presents administrative approval and billing status',()=>{
  assert.match(billing,/id="pendingApprovalNotice"/);
  assert.match(billing,/profile\.data\.access_status!=='pending'/);
  assert.match(billing,/após a aprovação do editor e a confirmação do pagamento/);
  assert.match(billing,/id="adminStatus"/);
  assert.match(billing,/sb\.from\('profiles'\)/);
});
test('page references new versioned scripts so old cached login decisions cannot persist',()=>{
  for(const page of [index,billing,app]){
    assert.match(page,/assets\/config\.js\?v=20261027-pending-route1/);
    assert.match(page,/assets\/supabase-backend\.js\?v=20261027-pending-route1/);
  }
  assert.match(index,/assets\/login\.js\?v=20261027-pending-route1/);
});
