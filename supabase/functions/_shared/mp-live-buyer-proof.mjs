/**
 * Check the provider's authenticated /preapproval/search filtered by payer_email.
 * This is a read-only, server-only check, used when GET/POST /preapproval
 * omits payer_email (as in Mercado Pago's official documented responses).
 * A missing, inconsistent or truncated search MUST NOT grant access.
 */
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{12,80}$/.test(x);
const validEmail=x=>typeof x==='string'&&x.length<=255&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
export async function verifyPayerEmailMembership({
  fetchPage,subscriptionId,payerEmail,pageSize=20,maxResults=100
}={}) {
  if(typeof fetchPage!=='function'||!validId(subscriptionId)||
     !validEmail(payerEmail)||!Number.isSafeInteger(pageSize)||pageSize<1||
     pageSize>100||!Number.isSafeInteger(maxResults)||maxResults<pageSize)
    throw Error('PAYER_SEARCH_CONFIG_UNSAFE');
  let offset=0,total=null,matched=false;
  const ids=new Set();
  while(true){
    const page=await fetchPage({payerEmail,offset,limit:pageSize});
    const results=page?.results,paging=page?.paging;
    const got=Number(paging?.total);
    if(!Array.isArray(results)||!Number.isSafeInteger(got)||got<0||
       got>maxResults||results.length>pageSize||
       (paging?.offset!==undefined&&Number(paging.offset)!==offset)||
       (total!==null&&got!==total))
      throw Error('PAYER_SEARCH_UNSAFE');
    if(total===null)total=got;
    if(offset+results.length>total||(!results.length&&offset<total))
      throw Error('PAYER_SEARCH_TRUNCATED');
    for(const item of results){
      const id=item?.id;
      if(!validId(id)||ids.has(id))
        throw Error('PAYER_SEARCH_INVALID_ID');
      ids.add(id);
      // The search is provider-filtered by email. If the provider also
      // returns payer_email, a mismatch is an integrity failure.
      if(item.payer_email!==undefined&&item.payer_email!==null&&
         String(item.payer_email).toLowerCase()!==payerEmail.toLowerCase())
        throw Error('PAYER_SEARCH_WRONG_EMAIL');
      if(id===subscriptionId)matched=true;
    }
    offset+=results.length;
    if(offset===total)break;
  }
  if(!matched)throw Error('PAYER_SUBSCRIPTION_NOT_FOUND');
  return true;
}

export async function verifyProviderBuyer({
  remote,payerEmail,fetchPage
}={}){
  if(!remote||!validId(remote.id)||!validEmail(payerEmail))
    throw Error('PAYER_PROOF_UNSAFE');
  if(remote.payer_email!==undefined&&remote.payer_email!==null&&
     String(remote.payer_email).trim()!==''){
    if(String(remote.payer_email).toLowerCase()!==payerEmail.toLowerCase())
      throw Error('PAYER_EMAIL_MISMATCH');
    return true;
  }
  return verifyPayerEmailMembership({
    fetchPage,subscriptionId:remote.id,payerEmail
  });
}
