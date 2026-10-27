import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../minha-assinatura.html',import.meta.url),'utf8');
const inline=page.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert.ok(inline,'Subscription page has an inline controller');
const stripped=inline.replace(/^import \{ formatSubscriptionState \} from '.+';\n/m,'');

function mockModal({inFlight=false}={}){
  const focus=[];
  const nodes=Object.fromEntries([
    'checkoutModalTitle','checkoutModalMessage','checkoutProgress',
    'checkoutModalClose','checkoutModal','checkoutModalPanel','startSubscription'
  ].map(id=>[id,{
    id,hidden:id==='checkoutModal',textContent:'',
    focus(){focus.push(id)},
    setAttribute(key,value){this[key]=value},
    removeAttribute(key){delete this[key]}
  }]));
  const helperNames=['openCheckoutModal','showCheckoutModalError','closeCheckoutModal'];
  const definitions=helperNames.map(name=>{
    const start=inline.indexOf('function '+name+'(){');
    assert.ok(start>0,'Missing helper '+name);
    const end=inline.indexOf('\n}',start);
    assert.ok(end>start);
    return inline.slice(start,end+2);
  }).join('\n');
  const helpers=new Function('el','checkoutInFlight',
    definitions+'\nreturn {openCheckoutModal,showCheckoutModalError,closeCheckoutModal};')(
      id=>nodes[id],inFlight
    );
  return {nodes,focus,...helpers};
}

test('subscription checkout modal is a labelled and described dialog',()=>{
  assert.match(page,/id="checkoutModal"[^>]*role="dialog" aria-modal="true"/);
  assert.match(page,/aria-labelledby="checkoutModalTitle"/);
  assert.match(page,/aria-describedby="checkoutModalMessage"/);
  assert.match(page,/id="checkoutModalPanel"[^>]*tabindex="-1"/);
  assert.match(page,/id="checkoutModalClose"/);
});

test('progress bar is visibly indeterminate and honors reduced motion',()=>{
  assert.match(page,/id="checkoutProgress"[^>]*role="progressbar"/);
  assert.match(page,/aria-valuetext="Processando, aguarde"/);
  assert.doesNotMatch(page,/aria-valuenow/);
  assert.match(page,/@keyframes checkout-progress-slide/);
  assert.match(page,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(page,/\.checkout-modal\[hidden\]/);
});

test('loading dialog opens and grabs focus before any network request',()=>{
  const start=inline.lastIndexOf("el('startSubscription').addEventListener('click'");
  assert.ok(start>0);
  const handler=inline.slice(start);
  const lockAt=handler.indexOf('checkoutInFlight=true;');
  const openAt=handler.indexOf('openCheckoutModal();');
  const apiAt=handler.indexOf("sb.functions.invoke('shamatha-create-subscription'");
  assert.ok(lockAt>=0 && openAt>lockAt && apiAt>openAt);
  assert.match(handler,/if\(checkoutInFlight \|\| flags\.billingCheckoutEnabled!==true/);
  assert.match(handler,/el\('startSubscription'\)\.disabled=true/);
  const ui=mockModal();
  ui.openCheckoutModal();
  assert.equal(ui.nodes.checkoutModal.hidden,false);
  assert.equal(ui.nodes.checkoutProgress.hidden,false);
  assert.equal(ui.nodes.checkoutModalClose.hidden,true);
  assert.equal(ui.nodes.checkoutModal['aria-busy'],'true');
  assert.equal(ui.nodes.checkoutModalTitle.textContent,'Preparando seu checkout');
  assert.equal(ui.focus.at(-1),'checkoutModalPanel');
});

test('checkout errors stop the animation and show a dismissible modal',()=>{
  const ui=mockModal();
  ui.openCheckoutModal();
  ui.showCheckoutModalError('Tentativa anterior em revisão');
  assert.equal(ui.nodes.checkoutModalMessage.textContent,'Tentativa anterior em revisão');
  assert.equal(ui.nodes.checkoutProgress.hidden,true);
  assert.equal(ui.nodes.checkoutModalClose.hidden,false);
  assert.equal(ui.nodes.checkoutModal['aria-busy'],undefined);
  assert.equal(ui.focus.at(-1),'checkoutModalClose');
  ui.closeCheckoutModal();
  assert.equal(ui.nodes.checkoutModal.hidden,true);
  assert.equal(ui.focus.at(-1),'startSubscription');
});

test('modal cannot be dismissed while checking or preparing the subscription',()=>{
  const ui=mockModal({inFlight:true});
  ui.openCheckoutModal();
  ui.closeCheckoutModal();
  assert.equal(ui.nodes.checkoutModal.hidden,false);
  assert.match(inline,/event\.key==='Escape'&&!checkoutInFlight/);
  assert.match(inline,/event\.key==='Tab'/);
});

test('checkout failure continues to show review guidance without claiming no provider contract',()=>{
  assert.match(inline,/code==='EXISTING_ATTEMPT_REQUIRES_REVIEW'/);
  assert.match(inline,/Não inicie outra assinatura/);
  assert.match(inline,/Pode existir uma/);
  assert.match(inline,/checkoutInFlight=false;\s*showCheckoutModalError\(message\)/);
  assert.match(inline,/el\('startSubscription'\)\.disabled=false/);
  assert.match(inline,/location\.assign\(target\.href\)/);
});

test('inline checkout logic remains syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(stripped));
});
