import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBillingAccess } from '../supabase/functions/_shared/billing-entitlement.mjs';

const period = (overrides = {}) => ({
  subscriptionId: 'sandbox-sub-1', verifiedByProvider: true, coveragePeriodVerified: true, status: 'approved',
  amountCents: 18000, currency: 'BRL',
  periodStart: '2026-10-19T18:22:00Z', periodEnd: '2026-11-19T18:22:00Z',
  ...overrides
});
const opts = (overrides = {}) => ({
  administrativeStatus: 'approved', exempt: false,
  subscriptionId: 'sandbox-sub-1', providerStatus: 'authorized',
  payments: [period()], now: '2026-11-01T00:00:00Z', ...overrides
});
const run = changes => evaluateBillingAccess(opts(changes));

test('approved payment with confirmed coverage grants access', () => {
  const result = run();
  assert.equal(result.accessGranted, true);
  assert.equal(result.billingStatus, 'active');
  assert.equal(result.paidThrough, '2026-11-19T18:22:00.000Z');
});
test('an existing student exempted server-side retains access without payment', () => {
  assert.deepEqual(run({ exempt: true, payments: [], providerStatus: 'pending' }),
    { accessGranted: true, billingStatus: 'exempt', paidThrough: null });
});
test('suspended or unapproved student cannot bypass administrative access', () => {
  for (const status of ['suspended', 'pending', null]) {
    assert.equal(run({ exempt: true, administrativeStatus: status }).accessGranted, false);
  }
});
test('subscription authorized alone is never sufficient for payment access', () => {
  assert.deepEqual(run({ payments: [] }),
    { accessGranted: false, billingStatus: 'pending', paidThrough: null });
});
test('approved but not independently verified is not proof of payment', () => {
  assert.equal(run({ payments: [period({ verifiedByProvider: false })] }).accessGranted, false);
});
test('pending, rejected or refunded payments cannot extend access', () => {
  for (const status of ['pending', 'rejected', 'in_process', 'cancelled']) {
    assert.equal(run({ payments: [period({ status })] }).accessGranted, false);
  }
  for (const revokedFlag of ['refunded', 'chargedBack', 'disputed']) {
    assert.equal(run({ payments: [period({ [revokedFlag]: true })] }).accessGranted, false);
  }
});
test('payment from different subscription cannot open current account', () => {
  assert.equal(run({ payments: [period({ subscriptionId: 'another-user-sub' })] }).accessGranted, false);
});
test('mismatched amount and currency fail closed', () => {
  assert.equal(run({ payments: [period({ amountCents: 1 })] }).accessGranted, false);
  assert.equal(run({ payments: [period({ currency: 'USD' })] }).accessGranted, false);
});
test('exact paid-through instant is blocked with zero grace period', () => {
  const result = run({ now: '2026-11-19T18:22:00Z' });
  assert.equal(result.accessGranted, false);
  assert.equal(result.billingStatus, 'overdue');
});
test('one millisecond before paid-through remains active', () => {
  assert.equal(run({ now: '2026-11-19T18:21:59.999Z' }).accessGranted, true);
});
test('local time offset does not extend coverage', () => {
  const result = run({ now: '2026-11-19T15:22:00-03:00' });
  assert.equal(result.accessGranted, false);
  assert.equal(result.billingStatus, 'overdue');
});
test('a scheduled payment without approval cannot renew coverage', () => {
  const result = run({
    now: '2026-11-21T10:00:00Z',
    payments: [period(), period({ status: 'pending', periodStart: '2026-11-19T18:22:00Z', periodEnd: '2026-12-19T18:22:00Z' })]
  });
  assert.equal(result.billingStatus, 'overdue');
  assert.equal(result.accessGranted, false);
});
test('approved renewal extends service when its verified next period starts', () => {
  const result = run({
    now: '2026-11-21T10:00:00Z',
    payments: [period(), period({ periodStart: '2026-11-19T18:22:00Z', periodEnd: '2026-12-19T18:22:00Z' })]
  });
  assert.equal(result.accessGranted, true);
  assert.equal(result.paidThrough, '2026-12-19T18:22:00.000Z');
});
test('a paid future period does not backfill an unpaid gap', () => {
  assert.equal(run({
    now: '2026-11-21T10:00:00Z',
    payments: [period(), period({ periodStart: '2026-12-01T00:00:00Z', periodEnd: '2027-01-01T00:00:00Z' })]
  }).accessGranted, false);
});
test('cancelled subscription keeps already paid period (policy pending approval)', () => {
  const inside = run({ providerStatus: 'cancelled' });
  assert.equal(inside.accessGranted, true);
  assert.equal(inside.billingStatus, 'cancelled');
  const expired = run({ providerStatus: 'cancelled', now: '2026-11-20T00:00:00Z' });
  assert.equal(expired.accessGranted, false);
  assert.equal(expired.billingStatus, 'cancelled');
});
test('paused subscription also expires at paid-through boundary', () => {
  assert.equal(run({ providerStatus: 'paused' }).accessGranted, true);
  assert.equal(run({ providerStatus: 'paused', now: '2026-11-20T00:00:00Z' }).accessGranted, false);
});
test('unknown provider status fails closed even with apparently approved payment', () => {
  assert.equal(run({ providerStatus: 'arbitrary' }).accessGranted, false);
});
test('invalid, missing or timezone-less dates are rejected', () => {
  for (const time of ['2026-11-19', '2026-11-19T18:22:00', undefined, 'not a date']) {
    assert.throws(() => run({ now: time }), TypeError);
  }
  assert.equal(run({ payments: [period({ periodEnd: '2026-11-19' })] }).accessGranted, false);
});
test('invalid duration and boundary cannot authorize access', () => {
  assert.equal(run({ payments: [period({ periodEnd: '2026-10-19T18:22:00Z' })] }).accessGranted, false);
  assert.equal(run({ payments: [period({ periodEnd: '2026-09-19T18:22:00Z' })] }).accessGranted, false);
});
test('future-only verified period does not grant early access', () => {
  assert.equal(run({
    now: '2026-10-18T00:00:00Z',
    payments: [period()]
  }).accessGranted, false);
});
test('duplicate observations cannot extend end date on their own', () => {
  assert.equal(run({
    payments: [period(), period()],
    now: '2026-11-20T00:00:00Z'
  }).accessGranted, false);
});
test('stale access_status is not an input and cannot grant access', () => {
  assert.equal(evaluateBillingAccess({ ...opts({ payments: [] }), accessStatus: 'active' }).accessGranted, false);
});

test('approved payment without independently verified coverage period cannot grant access', () => {
  const result=run({payments:[period({
    coveragePeriodVerified:false,
    periodStart:'2026-10-19T18:22:38Z',
    periodEnd:'2026-11-19T18:22:38Z'
  })],now:'2026-10-20T00:00:00Z'});
  assert.equal(result.accessGranted,false);
  assert.equal(result.billingStatus,'pending');
});
test('next scheduled charge alone cannot authorize or extend access', () => {
  const result=run({payments:[period({
    coveragePeriodVerified:false,
    periodStart:'2026-10-19T18:22:38Z',
    periodEnd:'2026-11-19T18:22:38Z',
    nextPaymentDate:'2026-11-19T18:22:38Z',
  })],now:'2026-10-20T00:00:00Z'});
  assert.equal(result.accessGranted,false);
  assert.equal(result.paidThrough,null);
});
