/**
 * Pre-launch FINANCIAL CONTROL CHECKLIST, NOT an entitlement calculation.
 *
 * There is deliberately no enableBilling() path here. All evidence is reviewed
 * by humans and verified separately. This module never authorizes go-live,
 * changes flags, makes API calls, or updates profiles / RLS.
 *
 * Only reviewer-supplied evidence from independent investigations is accepted.
 * A browser, Webhook or customer may NOT provide evidence for these checks.
 */
export const REQUIRED_BILLING_GATES=Object.freeze([
  "owner_explicit_go_live_authorization",
  "legacy_profiles_final_exemption_snapshot",
  "production_checkout_identity_and_idempotency_review",
  "mercadopago_subscription_webhook_delivery_verified",
  "webhook_hmac_and_replay_tested",
  "periodic_provider_reconciliation_and_alerts_tested",
  "contractual_paid_coverage_period_source_verified",
  "refund_chargeback_and_decline_lifecycle_tested",
  "cancel_renewal_reactivation_lifecycle_tested",
  "production_rls_dry_run_and_rollback_tested",
  "separate_production_credentials_and_environment_review",
  "editor_and_student_end_to_end_acceptance"
]);

const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const validRef=x=>typeof x==="string"&&
  /^https:\/\/github\.com\/TTamosauskas\/shamatha\/(?:issues|pull|actions\/runs)\/[1-9]\d*(?:\/[^\s]*)?$/.test(x);
/**
 * Used only for a diagnostic checklist. Evidence URL metadata is not
 * authenticated by this function; manual verification remains mandatory.
 */
export function auditBillingLaunchReadiness({evidence={},now=new Date().toISOString()}={}){
  const nowMs=typeof now==="string"&&ISO.test(now)?Date.parse(now):NaN;
  if(!Number.isFinite(nowMs))throw new TypeError("INVALID_AUDIT_TIME");
  const outstanding=[];
  const accepted=[];
  for(const gate of REQUIRED_BILLING_GATES){
    const entry=evidence?.[gate];
    const date=entry?.verifiedAt;
    const verifiedMs=typeof date==="string"&&ISO.test(date)?Date.parse(date):NaN;
    const valid=entry?.result==="verified"&&validRef(entry?.auditRef)&&
      Number.isFinite(verifiedMs)&&verifiedMs<=nowMs&&
      nowMs-verifiedMs<=30*86400000;
    if(valid)accepted.push(gate);else outstanding.push(gate);
  }
  return {
    gatesRequired:REQUIRED_BILLING_GATES.length,
    evidencePresent:accepted.length,
    gatesWithoutFreshEvidence:outstanding,
    allEvidenceForHumanReview:outstanding.length===0,
    // Mandatory: even a fully documented set of items is not authorization.
    productionBillingEnabled:false,
    authorizesProductionBilling:false,
    grantsStudentAccess:false,
    changesExistingUserAccess:false,
    changesRls:false
  };
}
