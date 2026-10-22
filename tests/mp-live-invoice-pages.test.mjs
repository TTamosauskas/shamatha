import test from 'node:test';
import assert from 'node:assert/strict';
import { collectAuthorizedInvoicePages, currentCycleCandidatePaymentIds,
  rotatingBillingBatchOffset } from '../supabase/functions/_shared/mp-live-invoice-pages.mjs';
import { verifyLiveMonthlyPayments } from '../supabase/functions/_shared/mp-live-monthly-evidence.mjs';

const userId='11111111-2222-4333-8444-555555555555';
const intent='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const sid='abcd1234efgh5678',seller='888777666',email='student@example.com';
const debit=i=>new Date(Date.UTC(2026,i,15,12)).toISOString();
const invoices=Array.from({length:14},(_,i)=>({
  id:String(10000+i),preapproval_id:sid,transaction_amount:180,
  currency_id:'BRL',debit_date:debit(i),
  status:'processed',payment:{id:String(90000+i),status:'approved'}
}));
const sub={id:sid,collector_id:seller,payer_email:email,
  status:'authorized',
  external_reference:'shamatha:production:'+userId+':'+intent,
  auto_recurring:{frequency:1,frequency_type:'months',
    transaction_amount:180,currency_id:'BRL'}};
const now=Date.parse('2027-02-20T12:00:00Z');
const latestPayment={id:'90013',collector_id:seller,transaction_amount:180,
  currency_id:'BRL',status:'approved',date_approved:'2027-02-15T12:00:02Z'};
const audit=(opts={})=>verifyLiveMonthlyPayments({
  userId,email,sellerId:seller,localSubscriptionId:intent,
  providerSubscription:sub,invoiceSearch:{results:invoices,paging:{total:14}},
  paymentsById:{'90013':latestPayment},nowMs:now,...opts
});

test('bounded invoice pager follows all pages with explicit offsets',async()=>{
  const requested=[];
  const paged=await collectAuthorizedInvoicePages({
    pageSize:5,maxInvoices:25,
    getPage:async({limit,offset})=>{
      requested.push({limit,offset});
      return {paging:{offset,total:14,limit},
        results:invoices.slice(offset,offset+limit)};
    }
  });
  assert.deepEqual(requested.map(x=>x.offset),[0,5,10]);
  assert.equal(paged.paging.total,14);
  assert.equal(paged.results[13].id,'10013');
});
test('empty invoice history is safe',async()=>{
  const result=await collectAuthorizedInvoicePages({
    getPage:async()=>({paging:{total:0,offset:0},results:[]})
  });
  assert.deepEqual(result.results,[]);
});
test('truncated invoice page is rejected',async()=>{
  await assert.rejects(()=>collectAuthorizedInvoicePages({
    getPage:async()=>({paging:{offset:0,total:2},results:[]})
  }),/INVOICE_PAGINATION_TRUNCATED/);
});
test('total changes while paging: fail closed',async()=>{
  await assert.rejects(()=>collectAuthorizedInvoicePages({
    pageSize:5,
    getPage:async({offset})=>({
      paging:{offset,total:offset===0?14:15},
      results:invoices.slice(offset,offset+5)
    })
  }),/INVOICE_PAGINATION_UNSAFE/);
});
test('offset mismatch: fail closed',async()=>{
  await assert.rejects(()=>collectAuthorizedInvoicePages({
    getPage:async()=>({paging:{offset:3,total:1},results:[invoices[0]]})
  }),/INVOICE_PAGINATION_UNSAFE/);
});
test('repeated IDs across pages: fail closed',async()=>{
  await assert.rejects(()=>collectAuthorizedInvoicePages({
    pageSize:1,maxInvoices:5,
    getPage:async({offset})=>({
      paging:{offset,total:2},results:[invoices[0]]
    })
  }),/INVOICE_PAGINATION_DUPLICATE/);
});
test('unsafe invoice history limit: fail closed',async()=>{
  await assert.rejects(()=>collectAuthorizedInvoicePages({
    maxInvoices:20,
    getPage:async()=>({paging:{total:21,offset:0},results:[]})
  }),/INVOICE_PAGINATION_UNSAFE/);
});
test('only potentially current payment IDs are fetched',()=>{
  const result=currentCycleCandidatePaymentIds(invoices,now);
  assert.deepEqual(result,['90013']);
});
test('current cycle audit supports 14 invoices without fetching 13 historical payments',()=>{
  const result=audit();
  assert.equal(result.totalInvoices,14);
  assert.equal(result.rows.length,1);
  assert.equal(result.approvedPeriods,1);
  assert.equal(result.paidThrough,'2027-03-15T12:00:00.000Z');
});
test('refunded current payment loses current coverage',()=>{
  const result=audit({paymentsById:{'90013':{...latestPayment,status:'refunded'}}});
  assert.equal(result.paidThrough,null);
  assert.equal(result.rows[0].period_end,null);
});
test('current payment cannot be approved based on invoice status alone',()=>{
  assert.throws(()=>audit({paymentsById:{}}),/PAYMENT_NOT_FETCHED/);
});
test('missing or displaced historic invoice invalidates entire cycle alignment',()=>{
  const altered=invoices.map(x=>({...x}));
  altered[4]={...altered[4],debit_date:'2026-05-16T12:00:00Z'};
  assert.throws(()=>audit({invoiceSearch:{results:altered,paging:{total:14}}}),/CYCLE_SHIFT_REVIEW/);
});
test('future invoice cannot turn on access without its period starting',()=>{
  const time=Date.parse('2027-01-20T12:00:00Z');
  const result=audit({nowMs:time,paymentsById:{'90012':{
    id:'90012',collector_id:seller,transaction_amount:180,currency_id:'BRL',
    status:'approved',date_approved:'2027-01-15T12:00:02Z'
  }}});
  assert.equal(result.paidThrough,'2027-02-15T12:00:00.000Z');
});
test('rotating batch offsets eventually revisit all account slices',()=>{
  const indices=new Set();
  for(let slot=0;slot<30;slot++){
    const offset=rotatingBillingBatchOffset(17,5,slot);
    for(let i=offset;i<Math.min(17,offset+5);i++)indices.add(i);
  }
  assert.equal(indices.size,17);
  assert.equal(rotatingBillingBatchOffset(0,5,5),0);
  assert.equal(rotatingBillingBatchOffset(2,5,5),0);
});
