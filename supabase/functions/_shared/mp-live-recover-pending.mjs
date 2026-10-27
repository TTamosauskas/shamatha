import {verifyCreatedMonthlyPreapproval,verifiedMercadoPagoCheckoutUrl} from './mp-live-checkout-proof.mjs';

/**
 * READ-ONLY provider discovery for a checkout intent previously marked
 * needs_review after an ambiguous successful POST /preapproval.
 *
 * A retry MUST NOT issue another POST to Mercado Pago. The provider's
 * payer_email-filtered search and full GET /preapproval/{id} must prove
 * the exact seller, authenticated student, intent, amount and redirect.
 * Never infer buyer or ownership merely from an arbitrary checkout URL.
 */
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{12,80}$/.test(x);
const validEmail=x=>typeof x==='string'&&x.length<=255&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);

export async function recoverExistingPendingPreapproval({
  userId,intentId,payerEmail,sellerId,fetchPage,fetchOne,
  pageSize=20,maxResults=100
}={}){
  if(!validId(userId)||!validId(intentId)||!validEmail(payerEmail)||
     !/^[0-9]+$/.test(String(sellerId))||sellerId==='3778352536'||
     typeof fetchPage!=='function'||typeof fetchOne!=='function'||
     !Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100||
     !Number.isSafeInteger(maxResults)||maxResults<pageSize)
    throw Error('RECOVERY_CONFIGURATION_INVALID');

  const expected='shamatha:production:'+userId+':'+intentId;
  let offset=0,total=null,candidate=null;
  const ids=new Set();
  while(true){
    const page=await fetchPage({payerEmail,offset,limit:pageSize});
    const items=page?.results;
    const got=Number(page?.paging?.total);
    if(!Array.isArray(items)||!Number.isSafeInteger(got)||
       got<0||got>maxResults||items.length>pageSize||
       (page?.paging?.offset!==undefined&&Number(page.paging.offset)!==offset)||
       (total!==null&&total!==got))
      throw Error('RECOVERY_SEARCH_UNSAFE');
    if(total===null)total=got;
    if(offset+items.length>total||(!items.length&&offset<total))
      throw Error('RECOVERY_SEARCH_TRUNCATED');
    for(const item of items){
      if(!validId(item?.id)||ids.has(item.id))
        throw Error('RECOVERY_SEARCH_INVALID_ID');
      ids.add(item.id);
      if(item.payer_email!==null&&item.payer_email!==undefined&&
         String(item.payer_email).trim()!==''&&
         String(item.payer_email).toLowerCase()!==payerEmail.toLowerCase())
        throw Error('RECOVERY_SEARCH_WRONG_BUYER');
      if(String(item.external_reference)===expected){
        if(candidate!==null)throw Error('RECOVERY_DUPLICATE_SUBSCRIPTIONS');
        candidate=item.id;
      }
    }
    offset+=items.length;
    if(offset===total)break;
  }
  if(!candidate)throw Error('RECOVERY_PREAPPROVAL_NOT_FOUND');

  const remote=await fetchOne(candidate);
  if(remote?.id!==candidate)throw Error('RECOVERY_PROVIDER_ID_CHANGED');
  verifyCreatedMonthlyPreapproval({
    remote,sellerId:String(sellerId),userId,intentId,
    payerEmail,requirePending:true,buyerVerified:true
  });
  if(!verifiedMercadoPagoCheckoutUrl(remote.init_point,candidate))
    throw Error('RECOVERY_INVALID_CHECKOUT_URL');
  return {id:candidate,checkoutUrl:remote.init_point,providerStatus:'pending'};
}
