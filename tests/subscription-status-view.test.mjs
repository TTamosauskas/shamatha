import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSubscriptionState } from '../assets/subscription-status-view.mjs';

const now = '2026-10-19T22:00:00.000Z';
const subscription = (status, end, environment='production') => ({
  environment,
  access_status:status,
  paid_through:end,
  created_at:'2026-10-19T00:00:00Z'
});
const classify = args=>formatSubscriptionState({now,...args});

test('existing exempt student stays exempt without subscription',()=>{
  assert.equal(classify({exempt:true,subscriptions:[]}).status,'exempt');
});
test('no subscription is pending and cannot create a payment',()=>{
  assert.equal(classify({subscriptions:[]}).status,'pending');
});
test('active paid until next month displays as active',()=>{
  assert.equal(classify({subscriptions:[subscription('active','2026-11-19T22:00:00Z')]}).status,'active');
});
test('expired paid-through shows overdue at exact boundary without grace',()=>{
  assert.equal(classify({subscriptions:[subscription('active',now)]}).status,'overdue');
});
test('payment ending before now shows overdue',()=>{
  assert.equal(classify({subscriptions:[subscription('active','2026-09-19T22:00:00Z')]}).status,'overdue');
});
test('pending provider status never displays active just because end exists',()=>{
  assert.equal(classify({subscriptions:[subscription('pending','2026-11-19T22:00:00Z')]}).status,'pending');
});
test('null paid-through cannot become active',()=>{
  assert.equal(classify({subscriptions:[subscription('active',null)]}).status,'pending');
});
test('cancelled subscription retains cancelled display status',()=>{
  assert.equal(classify({subscriptions:[subscription('cancelled','2026-11-19T22:00:00Z')]}).status,'cancelled');
});
test('paused subscription retains paused display status',()=>{
  assert.equal(classify({subscriptions:[subscription('paused','2026-11-19T22:00:00Z')]}).status,'paused');
});
test('sandbox entries never appear as production subscriptions',()=>{
  assert.equal(classify({subscriptions:[subscription('active','2026-11-19T22:00:00Z','sandbox')]}).status,'pending');
});
test('exemption takes priority over cancelled state',()=>{
  assert.equal(classify({exempt:true,subscriptions:[subscription('cancelled',null)]}).status,'exempt');
});
test('most recent production subscription is shown',()=>{
  const oldest={...subscription('cancelled',null),created_at:'2026-09-01T00:00:00Z'};
  const newest={...subscription('active','2026-11-19T22:00:00Z'),created_at:'2026-10-01T00:00:00Z'};
  assert.equal(classify({subscriptions:[oldest,newest]}).status,'active');
});
test('invalid time fails closed and does not invent billing state',()=>{
  assert.throws(()=>classify({now:'invalid',subscriptions:[subscription('active','2026-11-19T22:00:00Z')]}),TypeError);
});
