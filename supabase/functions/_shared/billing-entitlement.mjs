/**
 * Shamatha: pure billing-access decision engine (DRAFT ONLY).
 * No database access, no remote API, no side effects. The caller is responsible
 * for establishing trustworthy provider state and verified period boundaries.
 *
 * IMPORTANT: This engine must NOT be wired into has_content_access(), RLS,
 * sign-in, or production UI before source-of-truth period mapping, exemptions
 * and administrator authorization are separately reviewed.
 */
export const BILLING_MONTHLY_CENTS = 18000;
export const BILLING_CURRENCY = 'BRL';
const RECOGNIZED_PROVIDER_STATES = new Set([
  'authorized', 'paused', 'cancelled', 'canceled', 'pending'
]);

// Input dates MUST include a timezone and use an unambiguous ISO format.
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
function instant(value) {
  if (typeof value !== 'string' || !RFC3339.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function verifiedPeriod(payment, subscriptionId) {
  if (!payment || typeof payment !== 'object') return null;
  if (payment.verifiedByProvider !== true || payment.status !== 'approved') return null;
  if (payment.subscriptionId !== subscriptionId) return null;
  if (payment.amountCents !== BILLING_MONTHLY_CENTS || payment.currency !== BILLING_CURRENCY) return null;
  if (payment.refunded === true || payment.chargedBack === true || payment.disputed === true) return null;
  const start = instant(payment.periodStart);
  const end = instant(payment.periodEnd);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

/**
 * Returns an evaluation for synthetic fixtures; never persists entitlement.
 * Inputs:
 * - administrativeStatus: approved, pending or suspended
 * - exempt: boolean, server-granted exemption (must not come from user input)
 * - subscriptionId: identifier securely attached to current student in server DB
 * - providerStatus: preapproval status, for display only; NOT proof of payment
 * - payments: trusted reconciled and independently verified payment periods
 * - now: RFC3339 timestamp with offset, generally new Date().toISOString()
 *
 * Policy candidates for final approval: cancelled/paused subscriptions retain
 * access until their already-paid period ends. No paid period = no access.
 */
export function evaluateBillingAccess({
  administrativeStatus,
  exempt = false,
  subscriptionId,
  providerStatus = 'pending',
  payments = [],
  now
} = {}) {
  const at = instant(now);
  if (at === null) throw new TypeError('now must be an RFC3339 instant with timezone');

  // Administrative suspension overrides all billing permissions.
  if (administrativeStatus !== 'approved') {
    return { accessGranted: false, billingStatus: 'blocked_admin', paidThrough: null };
  }
  if (exempt === true) {
    return { accessGranted: true, billingStatus: 'exempt', paidThrough: null };
  }
  if (typeof subscriptionId !== 'string' || !subscriptionId.trim() ||
      !RECOGNIZED_PROVIDER_STATES.has(providerStatus) || !Array.isArray(payments)) {
    return { accessGranted: false, billingStatus: 'pending', paidThrough: null };
  }

  const periods = payments.map(payment => verifiedPeriod(payment, subscriptionId))
    .filter(period => period !== null);
  const current = periods.filter(({ start, end }) => start <= at && at < end);
  const previouslyPaid = periods.some(({ end }) => end <= at);
  const activePaidThrough = current.length
    ? Math.max(...current.map(({ end }) => end))
    : null;

  if (activePaidThrough !== null) {
    return {
      accessGranted: true,
      billingStatus: providerStatus === 'paused' ? 'paused' :
        providerStatus === 'cancelled' || providerStatus === 'canceled' ? 'cancelled' : 'active',
      paidThrough: new Date(activePaidThrough).toISOString()
    };
  }

  // Importantly: a pending/failed renewal never extends the access window.
  return {
    accessGranted: false,
    billingStatus: providerStatus === 'paused' ? 'paused' :
      providerStatus === 'cancelled' || providerStatus === 'canceled' ? 'cancelled' :
        previouslyPaid ? 'overdue' : 'pending',
    paidThrough: previouslyPaid
      ? new Date(Math.max(...periods.filter(({ end }) => end <= at).map(({ end }) => end))).toISOString()
      : null
  };
}
