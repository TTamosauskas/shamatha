/**
 * Pure, fail-closed validation of a SANDBOX-only Mercado Pago webhook body.
 * Must run AFTER x-signature verification of query data.id and x-request-id.
 *
 * The notification is an inbox hint ONLY. Its payload and status cannot prove
 * payment approval, paid period, content access or ownership of a student.
 */
const TOPICS=new Set([
  "payment","subscription_preapproval","subscription_authorized_payment"
]);
const RESOURCE_ID=/^[a-zA-Z0-9_-]{1,64}$/;
const EVENT_ID=/^[a-zA-Z0-9_-]{1,80}$/;

export function validateSandboxWebhook({ payload, dataId, sellerId="3778352536" }={}) {
  if(!payload||typeof payload!=="object"||Array.isArray(payload))
    throw new Error("INVALID_PAYLOAD");
  const type=payload.type;
  if(typeof type!=="string"||!TOPICS.has(type))
    throw new Error("UNSUPPORTED_EVENT");
  if(typeof dataId!=="string"||!RESOURCE_ID.test(dataId)||
     !payload.data||typeof payload.data!=="object"||Array.isArray(payload.data))
    throw new Error("INVALID_RESOURCE_ID");
  const resourceId=payload.data.id;
  if(!["string","number"].includes(typeof resourceId) ||
     !RESOURCE_ID.test(String(resourceId)) ||
     String(resourceId).toLowerCase()!==dataId.toLowerCase())
    throw new Error("RESOURCE_ID_MISMATCH");
  const eventId=payload.id;
  if(!["string","number"].includes(typeof eventId)||
     !EVENT_ID.test(String(eventId)))throw new Error("INVALID_EVENT_ID");

  // A test seller is never allowed to create/update PRODUCTION records.
  // Reconfirm the real delivery's live_mode field before enabling this code.
  if(payload.live_mode!==false)throw new Error("NOT_SANDBOX_EVENT");
  if(!/^[0-9]{1,20}$/.test(String(payload.user_id??""))||
     String(payload.user_id)!==String(sellerId))
    throw new Error("SELLER_MISMATCH");
  // Ignore all payment amounts/statuses from the webhook body. Server must
  // call the seller's authenticated API during reconciliation.
  const action=typeof payload.action==="string"
    ?payload.action.slice(0,96):"";
  return {
    event_key:"sandbox:"+type+":"+String(eventId),
    event_type:type,
    provider_resource_id:dataId,
    processing_status:"verified_requires_reconciliation",
    payload:{
      type, action, data:{id:dataId},
      event_id:String(eventId), test_seller_id:String(sellerId)
    }
  };
}
