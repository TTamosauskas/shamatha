/**
 * Pure validation of a provider-created Mercado Pago recurring subscription.
 * This is a READ-ONLY proof; it never creates a charge or grants access.
 * Refuse all missing/altered identity, amount, frequency or redirect fields.
 */
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{12,80}$/.test(x);
const numeric=x=>typeof x==='string'&&/^[0-9]+$/.test(x);
export function verifiedMercadoPagoCheckoutUrl(url,preapprovalId) {
  if(typeof url!=='string'||!validId(preapprovalId))return false;
  try {
    const u=new URL(url);
    return u.protocol==='https:'&&
      /(^|\.)mercadopago\.(com|com\.br|com\.ar|com\.mx|com\.uy)$/.test(u.hostname)&&
      u.username===''&&u.password===''&&
      u.searchParams.get('preapproval_id')===preapprovalId;
  }catch{return false;}
}
export function verifyCreatedMonthlyPreapproval({
  remote,sellerId,userId,intentId,payerEmail,requirePending=true,buyerVerified=false
}={}) {
  if(!validId(userId)||!validId(intentId)||!numeric(sellerId)||
     sellerId==='3778352536'||typeof payerEmail!=='string'||
     !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)||
     !remote||!validId(remote.id)||
     String(remote.collector_id)!==sellerId||
     String(remote.external_reference)!=='shamatha:production:'+userId+':'+intentId||
     (remote.payer_email!==null&&remote.payer_email!==undefined&&
       String(remote.payer_email).trim()!==''&&
       String(remote.payer_email).toLowerCase()!==payerEmail.toLowerCase())||
     ((!remote.payer_email||String(remote.payer_email).trim()==='')&&
       buyerVerified!==true)||
     Number(remote.auto_recurring?.transaction_amount)!==180||
     remote.auto_recurring?.currency_id!=='BRL'||
     Number(remote.auto_recurring?.frequency)!==1||
     remote.auto_recurring?.frequency_type!=='months'||
     !['pending','authorized','paused','cancelled','canceled'].includes(remote.status)||
     (requirePending&&remote.status!=='pending')) {
    throw Error('MP_SUBSCRIPTION_PROOF_FAILED');
  }
  return {id:remote.id,status:remote.status};
}
