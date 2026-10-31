import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const backend = read('assets/supabase-backend.js');
const login = read('assets/login.js');

function sourceOf(code, signature) {
  const start = code.indexOf(signature);
  assert.ok(start >= 0, 'Missing function ' + signature);
  const end = code.indexOf('\n}', start);
  // Backend function uses two-space indentation before its closing brace.
  const backendEnd = code.indexOf('\n  }', start);
  const stop = signature.includes('redirectHashLogout') ? backendEnd : end;
  assert.ok(stop > start, 'Missing function close for ' + signature);
  return code.slice(start, stop + (signature.includes('redirectHashLogout') ? 4 : 2));
}

const redirectSource = sourceOf(backend, 'function redirectHashLogout() {');
const logoutSource = sourceOf(login, 'async function handleHashLogout() {');

function simulateRedirect(path, hash = '#deslogar') {
  const origin = 'https://ttamosauskas.github.io';
  let redirected = null;
  const location = {
    origin, pathname: path, hash,
    href: origin + path + hash,
    replace(destination) { redirected = destination; }
  };
  const factory = new Function('location','CONFIG','URL', redirectSource +
    '\nreturn redirectHashLogout;');
  factory(location,{baseUrl:origin + '/shamatha/'},URL)();
  return redirected;
}

function simulateLogout({hash='#deslogar',signOutResult={error:null}}={}) {
  const statuses=[],historyEvents=[],events=[],focus=[];
  const location={hash,pathname:'/shamatha/index.html',search:'?utm_source=site'};
  const history={replaceState(...args){historyEvents.push(args)}};
  const nodes={pendingActions:{classList:{add(name){events.push('hidden:'+name)}}}};
  const $=id=>nodes[id];
  const window={ShamathaBackend:{getClient(){return{auth:{
    async signOut(options){events.push(options);return signOutResult;}
  }}}}};
  let hideCount=0;
  const evaluate = new Function('location','history','window','setStatus','selectTab','$','hideAuthLoading',
    'let hashLogoutInProgress=false;\n' + logoutSource +
    '\nreturn handleHashLogout;');
  const handle = evaluate(location,history,window,
    (...args)=>statuses.push(args),
    tab=>focus.push(tab),
    $,
    ()=>{hideCount++});
  return {handle,statuses,historyEvents,events,focus,get hideCount(){return hideCount;}};
}

test('app, editor, subscriptions, and nested trash route hash logout to central login',()=>{
  for (const pathname of [
    '/shamatha/app.html',
    '/shamatha/editor.html',
    '/shamatha/minha-assinatura.html',
    '/shamatha/lixeira/index.html'
  ]) assert.equal(simulateRedirect(pathname),
      'https://ttamosauskas.github.io/shamatha/index.html#deslogar');
});

test('login and site root do not redirect recursively',()=>{
  assert.equal(simulateRedirect('/shamatha/index.html'),null);
  assert.equal(simulateRedirect('/shamatha/'),null);
});

test('unrelated hash fragments never sign out or redirect',()=>{
  assert.equal(simulateRedirect('/shamatha/app.html','#etapa-1'),null);
  assert.equal(simulateRedirect('/shamatha/editor.html',''),null);
  assert.equal(simulateRedirect('/shamatha/app.html','#deslogar-outro'),null);
});

test('hash logout removes only current browser Supabase auth session',async()=>{
  const result=simulateLogout();
  assert.equal(await result.handle(),true);
  assert.deepEqual(result.events[0],{scope:'local'});
  assert.deepEqual(result.historyEvents[0],[null,'','/shamatha/index.html?utm_source=site']);
  assert.equal(result.focus[0],'login');
  assert.match(result.statuses.at(-1)[0],/Sessão encerrada/);
  assert.equal(result.hideCount,1);
});

test('failed Supabase sign out never falsely claims logout succeeded',async()=>{
  const result=simulateLogout({signOutResult:{error:new Error('offline')}});
  assert.equal(await result.handle(),true);
  assert.equal(result.historyEvents.length,0);
  assert.match(result.statuses.at(-1)[0],/Não foi possível encerrar/);
});

test('other fragments do not clear a session',async()=>{
  const result=simulateLogout({hash:'#outra-coisa'});
  assert.equal(await result.handle(),false);
  assert.equal(result.events.length,0);
  assert.equal(result.historyEvents.length,0);
});

test('index checks logout before auto-route to app and observes hash changes',()=>{
  assert.match(login,/if \(await handleHashLogout\(\)\) return;/);
  assert.match(login,/window\.addEventListener\('hashchange', \(\) => \{ void handleHashLogout\(\); \}\);/);
  assert.match(login,/if \(hashLogoutInProgress \|\| location\.hash\.toLowerCase\(\) === '#deslogar'\) return;/);
  assert.match(backend,/window\.addEventListener\('hashchange', redirectHashLogout\);/);
});

test('all production entrypoints load fresh backend, and login loads fresh handler',()=>{
  for(const page of [
    'index.html','app.html','editor.html','minha-assinatura.html','lixeira/index.html'
  ]) assert.match(read(page),/assets\/supabase-backend\.js\?v=20261031-hash-logout1/);
  assert.match(read('index.html'),/assets\/login\.js\?v=20261031-hash-logout1/);
});
