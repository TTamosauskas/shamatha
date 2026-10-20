import test from 'node:test';
import assert from 'node:assert/strict';
import { nextUtcCalendarMonth, auditFirstMonthlyCycle } from
  '../supabase/functions/_shared/mp-billing-cycle-audit.mjs';

const realTestCycle = (updates={}) => ({
  frequency: 1,
  frequencyType: 'months',
  subscriptionStatus: 'authorized',
  invoiceStatus: 'processed',
  subscriptionId: 'c5b3cfd34ca740cb8d1b7687c5ad13b2',
  invoiceSubscriptionId: 'c5b3cfd34ca740cb8d1b7687c5ad13b2',
  paymentStatus: 'approved',
  providerVerifiedPayment: true,
  amountCents: 18000,
  currency: 'BRL',
  debitAt: '2026-10-19T18:22:38.000Z',
  approvedAt: '2026-10-19T18:22:39.000Z',
  nextPaymentAt: '2026-11-19T18:22:38.000Z',
  ...updates
});

test('test seller real dates align to one UTC calendar month, without an access grant', () => {
  const r = auditFirstMonthlyCycle(realTestCycle());
  assert.equal(r.billingCadenceConsistent, true);
  assert.equal(r.candidateCycleEnd, '2026-11-19T18:22:38.000Z');
  assert.equal(r.candidateCycleStart, '2026-10-19T18:22:38.000Z');
  assert.equal(r.outcome, 'schedule_aligned_but_access_period_unverified');
  assert.equal(r.coveragePeriodVerified, false);
  assert.equal(r.paidThrough, null);
  assert.equal(r.grantsStudentAccess, false);
});
test('next payment date is not treated as paidThrough even with a valid payment', () => {
  assert.notEqual(auditFirstMonthlyCycle(realTestCycle()).candidateCycleEnd, null);
  assert.equal(auditFirstMonthlyCycle(realTestCycle()).paidThrough, null);
});
test('failed payment cannot substantiate cycle', () => {
  for (const paymentStatus of ['pending','rejected','refunded']) {
    assert.equal(auditFirstMonthlyCycle(realTestCycle({paymentStatus})).billingCadenceConsistent,false);
  }
});
test('unverified payment is denied', () => {
  assert.equal(auditFirstMonthlyCycle(realTestCycle({providerVerifiedPayment:false})).grantsStudentAccess,false);
  assert.equal(auditFirstMonthlyCycle(realTestCycle({providerVerifiedPayment:false})).candidateCycleEnd,null);
});
test('wrong subscription association, amount, or currency is invalid', () => {
  for (const overrides of [
    {invoiceSubscriptionId:'different'}, {amountCents:1}, {currency:'USD'},
    {frequencyType:'days'}, {frequency:2}, {invoiceStatus:'scheduled'}
  ]) assert.equal(auditFirstMonthlyCycle(realTestCycle(overrides)).outcome,'invalid_or_unconfirmed_payment');
});
test('authorized alone does not prove a paid cycle', () => {
  assert.equal(auditFirstMonthlyCycle(realTestCycle({paymentStatus:'pending'})).paidThrough,null);
});
test('next billing date must align exactly; shifts go for review', () => {
  const r=auditFirstMonthlyCycle(realTestCycle({nextPaymentAt:'2026-11-19T18:22:39.000Z'}));
  assert.equal(r.outcome,'billing_schedule_mismatch');
  assert.equal(r.candidateCycleEnd,null);
});
test('missing next billing date is not silently replaced by a month calculation', () => {
  assert.equal(auditFirstMonthlyCycle(realTestCycle({nextPaymentAt:null})).outcome,'missing_or_inconsistent_provider_dates');
});
test('bad or timezone-less dates are not accepted', () => {
  assert.equal(nextUtcCalendarMonth('2026-11-19T15:22:38'),null);
  assert.equal(auditFirstMonthlyCycle(realTestCycle({debitAt:'not-a-date'})).billingCadenceConsistent,false);
});
test('calendar month clamps the 31st in non-leap February', () => {
  assert.equal(nextUtcCalendarMonth('2027-01-31T12:00:00Z'),'2027-02-28T12:00:00.000Z');
});
test('calendar month clamps the 31st in leap February', () => {
  assert.equal(nextUtcCalendarMonth('2028-01-31T12:00:00Z'),'2028-02-29T12:00:00.000Z');
});
test('monthly shifts from March 31 to April 30', () => {
  assert.equal(nextUtcCalendarMonth('2026-03-31T12:00:00Z'),'2026-04-30T12:00:00.000Z');
});
test('monthly shifts from December across year boundary', () => {
  assert.equal(nextUtcCalendarMonth('2026-12-19T12:00:00Z'),'2027-01-19T12:00:00.000Z');
});
test('provider date offsets convert to UTC instants correctly', () => {
  assert.equal(nextUtcCalendarMonth('2026-10-19T15:22:38-03:00'),'2026-11-19T18:22:38.000Z');
});
test('approval before debit requires review', () => {
  assert.equal(auditFirstMonthlyCycle(realTestCycle({approvedAt:'2026-10-19T18:22:37Z'})).outcome,'missing_or_inconsistent_provider_dates');
});
test('if payment approves after the next billing date, cannot infer a paid cycle', () => {
  assert.equal(auditFirstMonthlyCycle(realTestCycle({approvedAt:'2026-11-20T00:00:00Z'})).outcome,'billing_schedule_mismatch');
});
