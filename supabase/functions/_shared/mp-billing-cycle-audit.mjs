/**
 * Mercado Pago monthly billing evidence audit (SANDBOX; no permissions).
 *
 * A 'next_payment_date' is the next scheduled CHARGE, not a guaranteed period
 * of service. This module only checks calendar-month consistency, never grants
 * access or writes paid_through. A separately approved contractual coverage
 * policy and provider reconciliation are required before producing entitlement.
 */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
function parseInstant(input) {
  if (typeof input !== 'string' || !ISO_WITH_OFFSET.test(input)) return null;
  const n = Date.parse(input);
  return Number.isFinite(n) ? n : null;
}
export function nextUtcCalendarMonth(isoDate) {
  const timestamp = parseInstant(isoDate);
  if (timestamp === null) return null;
  const d = new Date(timestamp);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const nextFirst = new Date(Date.UTC(year, month + 1, 1));
  const following = new Date(Date.UTC(year, month + 2, 0));
  const finalDay = Math.min(day, following.getUTCDate());
  nextFirst.setUTCDate(finalDay);
  nextFirst.setUTCHours(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
  return nextFirst.toISOString();
}

/**
 * Inputs must be trusted snapshots read directly from Mercado Pago for one
 * authenticated merchant subscription (NOT client-supplied access assertions).
 * This function deliberately never returns a validated paid-through timestamp.
 */
export function auditFirstMonthlyCycle({
  frequency,
  frequencyType,
  subscriptionStatus,
  invoiceStatus,
  subscriptionId,
  invoiceSubscriptionId,
  paymentStatus,
  providerVerifiedPayment,
  amountCents,
  currency,
  debitAt,
  approvedAt,
  nextPaymentAt
} = {}) {
  const result = {
    billingCadenceConsistent: false,
    scheduledChargeAt: null,
    candidateCycleStart: null,
    candidateCycleEnd: null,
    coveragePeriodVerified: false,
    paidThrough: null,
    grantsStudentAccess: false,
    outcome: 'needs_review'
  };
  const debit = parseInstant(debitAt);
  const approved = parseInstant(approvedAt);
  const next = parseInstant(nextPaymentAt);
  if (!subscriptionId || typeof subscriptionId !== 'string' ||
      invoiceSubscriptionId !== subscriptionId ||
      frequency !== 1 || frequencyType !== 'months' ||
      subscriptionStatus !== 'authorized' ||
      invoiceStatus !== 'processed' ||
      paymentStatus !== 'approved' ||
      providerVerifiedPayment !== true ||
      amountCents !== 18000 || currency !== 'BRL') {
    result.outcome = 'invalid_or_unconfirmed_payment';
    return result;
  }
  if (debit === null || approved === null || approved < debit || next === null) {
    result.outcome = 'missing_or_inconsistent_provider_dates';
    return result;
  }
  const expectedNext = nextUtcCalendarMonth(debitAt);
  if (!expectedNext || Date.parse(expectedNext) !== next || next <= approved) {
    result.outcome = 'billing_schedule_mismatch';
    result.scheduledChargeAt = nextPaymentAt;
    return result;
  }
  return {
    ...result,
    billingCadenceConsistent: true,
    scheduledChargeAt: new Date(next).toISOString(),
    candidateCycleStart: new Date(debit).toISOString(),
    candidateCycleEnd: expectedNext,
    outcome: 'schedule_aligned_but_access_period_unverified'
  };
}
