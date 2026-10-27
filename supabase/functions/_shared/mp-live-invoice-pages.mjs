/**
 * Mercado Pago /authorized_payments/search pagination.
 * Never treat a truncated/unstable result as a complete billing history.
 */
export async function collectAuthorizedInvoicePages({
  getPage, pageSize=20, maxInvoices=240
}={}) {
  if(typeof getPage!=='function' ||
      !Number.isInteger(pageSize)||pageSize<1||pageSize>100||
      !Number.isInteger(maxInvoices)||maxInvoices<pageSize)
    throw Error('INVALID_PAGINATION_CONFIG');
  const invoices=[],seen=new Set();
  let offset=0,expectedTotal=null;
  while(true) {
    const page=await getPage({offset,limit:pageSize});
    const entries=page?.results, paging=page?.paging;
    const total=Number(paging?.total);
    if(!Array.isArray(entries)||!Number.isSafeInteger(total)||total<0||total>maxInvoices||
        entries.length>pageSize||
        (paging?.offset!==undefined && Number(paging.offset)!==offset)||
        (expectedTotal!==null&&total!==expectedTotal))
      throw Error('INVOICE_PAGINATION_UNSAFE');
    if(expectedTotal===null)expectedTotal=total;
    if(offset+entries.length>total||(!entries.length&&offset<total))
      throw Error('INVOICE_PAGINATION_TRUNCATED');
    for(const item of entries) {
      const id=String(item?.id??'');
      if(!/^\d{1,30}$/.test(id)||seen.has(id))
        throw Error('INVOICE_PAGINATION_DUPLICATE');
      seen.add(id);
      invoices.push(item);
    }
    offset+=entries.length;
    if(offset===total)
      return {results:invoices,paging:{total,offset:0,limit:invoices.length}};
    if(offset>maxInvoices)throw Error('INVOICE_HISTORY_LIMIT_REVIEW');
  }
}

/**
 * Shortlist payment IDs for invoices that COULD cover today.
 * Deliberately uses an overinclusive 32-day window. The contractual
 * verifier independently validates exact monthly boundaries, IDs, amounts,
 * merchant, payment status, and approval date before granting coverage.
 */
export function currentCycleCandidatePaymentIds(invoices,nowMs) {
  if(!Array.isArray(invoices)||!Number.isFinite(nowMs))
    throw Error('INVALID_CYCLE_INPUT');
  const ids=new Set();
  for(const invoice of invoices) {
    const start=Date.parse(invoice?.debit_date);
    if(!Number.isFinite(start)||start>nowMs||nowMs-start>32*86400000)continue;
    const id=invoice?.payment?.id;
    if(id!==undefined&&id!==null&&String(id)!=='') {
      if(!/^\d{1,30}$/.test(String(id)))throw Error('INVALID_PAYMENT_ID');
      ids.add(String(id));
    }
  }
  return [...ids];
}

/** Deterministic, clock-based rotation: failures do not starve later students. */
export function rotatingBillingBatchOffset(total,batchSize,slot) {
  if(!Number.isSafeInteger(total)||total<0||
     !Number.isSafeInteger(batchSize)||batchSize<1||
     !Number.isSafeInteger(slot)||slot<0)
    throw Error('INVALID_BILLING_BATCH');
  if(total<=batchSize)return 0;
  return (slot*batchSize)%total;
}
