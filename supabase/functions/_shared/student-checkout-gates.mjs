// Politica pura do checkout de ALUNO, SEM efeitos colaterais.
// A ativacao requer aprovacao explicita e DUAS flags de producao independentes.
export function checkStudentCheckoutGate({
  productionEnabled = false,
  checkoutEnabled = false,
  sellerConfigured = false,
  role = null,
  isVerifiedEmail = false,
  administrativeStatus = 'pending',
  isExempt = false,
  hasExistingSubscription = false
} = {}) {
  if (productionEnabled !== true) return { allowed: false, reason: 'PRODUCTION_DISABLED' };
  if (checkoutEnabled !== true) return { allowed: false, reason: 'CHECKOUT_DISABLED' };
  if (sellerConfigured !== true) return { allowed: false, reason: 'SELLER_NOT_CONFIGURED' };
  if (role !== 'student') return { allowed: false, reason: 'STUDENT_REQUIRED' };
  if (isVerifiedEmail !== true) return { allowed: false, reason: 'EMAIL_NOT_CONFIRMED' };
  if (administrativeStatus === 'suspended') return { allowed: false, reason: 'ACCOUNT_SUSPENDED' };
  if (isExempt === true) return { allowed: false, reason: 'ALREADY_EXEMPT' };
  if (hasExistingSubscription === true) return { allowed: false, reason: 'EXISTING_SUBSCRIPTION' };
  return { allowed: true, reason: 'ELIGIBLE_FOR_CHECKOUT_ONLY' };
}
