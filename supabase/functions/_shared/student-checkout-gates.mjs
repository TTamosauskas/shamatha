// Politica pura do checkout de ALUNO, SEM efeitos colaterais.
// A ativacao requer aprovacao explicita e DUAS flags de producao independentes.
export function checkStudentCheckoutGate({
  productionEnabled = false,
  launchApproved = false,
  checkoutEnabled = false,
  sellerConfigured = false,
  role = null,
  isVerifiedEmail = false,
  administrativeStatus = 'pending',
  isExempt = false,
  hasExistingSubscription = false
} = {}) {
  if (productionEnabled !== true) return { allowed: false, reason: 'PRODUCTION_DISABLED' };
  if (launchApproved !== true) return { allowed: false, reason: 'LAUNCH_NOT_APPROVED' };
  if (checkoutEnabled !== true) return { allowed: false, reason: 'CHECKOUT_DISABLED' };
  if (sellerConfigured !== true) return { allowed: false, reason: 'SELLER_NOT_CONFIGURED' };
  if (role !== 'student') return { allowed: false, reason: 'STUDENT_REQUIRED' };
  if (isVerifiedEmail !== true) return { allowed: false, reason: 'EMAIL_NOT_CONFIRMED' };
  if (administrativeStatus === 'suspended') return { allowed: false, reason: 'ACCOUNT_SUSPENDED' };
  if (administrativeStatus !== 'approved' && administrativeStatus !== 'pending') {
    return { allowed: false, reason: 'ACCOUNT_STATUS_UNRECOGNIZED' };
  }
  if (isExempt === true) return { allowed: false, reason: 'ALREADY_EXEMPT' };
  if (hasExistingSubscription === true) return { allowed: false, reason: 'EXISTING_SUBSCRIPTION' };
  return { allowed: true, reason: 'ELIGIBLE_FOR_CHECKOUT_ONLY' };
}


/**
 * A cancelled subscription can be replaced ONLY after its paid coverage ends.
 * Pending, authorized, paused or unknown status must never produce a second
 * live recurring subscription. Operates on trusted server-side DB rows only.
 */
export function priorSubscriptionCheckoutGate(rows,nowMs=Date.now()) {
  if(!Array.isArray(rows)||rows.length>100||!Number.isFinite(nowMs))
    return {allowed:false,reason:'SUBSCRIPTION_HISTORY_REQUIRES_REVIEW'};
  for(const row of rows) {
    if(!['canceled','cancelled'].includes(row?.provider_status))
      return {allowed:false,reason:'EXISTING_SUBSCRIPTION_REQUIRES_RECONCILIATION'};
    const end=row?.paid_through;
    if(end!==null&&end!==undefined){
      const time=Date.parse(end);
      if(!Number.isFinite(time))
        return {allowed:false,reason:'COVERAGE_DATE_REQUIRES_REVIEW'};
      if(time>nowMs)
        return {allowed:false,reason:'PREVIOUS_COVERAGE_STILL_ACTIVE'};
    }
  }
  return {allowed:true,reason:'NO_OPEN_SUBSCRIPTION_OR_PAID_PERIOD'};
}
