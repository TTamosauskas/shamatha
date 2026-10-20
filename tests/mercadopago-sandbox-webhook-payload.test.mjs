import test from "node:test";
import assert from "node:assert/strict";
import {validateSandboxWebhook} from "../supabase/functions/_shared/mercadopago-sandbox-webhook-payload.mjs";

const sellerId="3778352536";
const dataId="185024682360";
const fixture=()=>({
  id:703301,live_mode:false,user_id:3778352536,
  type:"payment",action:"payment.updated",
  data:{id:dataId},
  status:"approved",payer_email:"SECRET_NOT_FOR_EVENT_INBOX"
});
const validate=(patch={},opts={})=>validateSandboxWebhook({
  payload:Object.assign(fixture(),patch),dataId,sellerId,...opts
});

test("correct sandbox event writes a sanitized reconciliation hint",()=>{
  const result=validate();
  assert.equal(result.event_key,"sandbox:payment:703301");
  assert.equal(result.processing_status,"verified_requires_reconciliation");
  assert.equal(result.event_type,"payment");
  assert.equal(result.provider_resource_id,dataId);
});
test("no reported payment status, buyer data or amounts are persisted",()=>{
  const result=validate({status:"approved",amount:90000,card:"secret"});
  assert.equal(Object.hasOwn(result.payload,"status"),false);
  assert.equal(Object.hasOwn(result.payload,"amount"),false);
  assert.equal(Object.hasOwn(result.payload,"payer_email"),false);
  assert.equal(Object.hasOwn(result.payload,"card"),false);
  assert.equal(Object.hasOwn(result,"paidThrough"),false);
});
test("subscription_preapproval notifications are accepted as inbox hints",()=>{
  const result=validate({type:"subscription_preapproval",data:{id:"c5b3cfd34ca740cb8d1b7687c5ad13b2"}},{dataId:"c5b3cfd34ca740cb8d1b7687c5ad13b2"});
  assert.equal(result.event_type,"subscription_preapproval");
});
test("authorized recurring payment notification is supported",()=>{
  const out=validate({type:"subscription_authorized_payment",data:{id:7033097180}},{dataId:"7033097180"});
  assert.equal(out.event_type,"subscription_authorized_payment");
});
test("event id deduplicates retry regardless of action changes",()=>{
  const first=validate();
  const again=validate({action:"payment.created"});
  assert.equal(first.event_key,again.event_key);
});
test("different event ID produces different inbox key",()=>{
  const a=validate(),b=validate({id:703302});
  assert.notEqual(a.event_key,b.event_key);
});
test("same event ID on distinct topics uses distinct key",()=>{
  const a=validate(),b=validate({type:"subscription_preapproval"});
  assert.notEqual(a.event_key,b.event_key);
});
test("unsupported and unsafe topics fail closed",()=>{
  for(const type of ["merchant_order","chargebacks",null,{},0]){
    assert.throws(()=>validate({type}),/UNSUPPORTED_EVENT/);
  }
});
test("production live_mode is rejected even if seller matches",()=>{
  assert.throws(()=>validate({live_mode:true}),/NOT_SANDBOX_EVENT/);
});
test("unknown live_mode is rejected until true notifications are documented",()=>{
  assert.throws(()=>validate({live_mode:null}),/NOT_SANDBOX_EVENT/);
  assert.throws(()=>validate({live_mode:"false"}),/NOT_SANDBOX_EVENT/);
});
test("seller id must match the fake merchant and cannot be omitted",()=>{
  for(const user_id of [null,100,0,"other","3778352537"]){
    assert.throws(()=>validate({user_id}),/SELLER_MISMATCH/);
  }
});
test("resource ID in signed URL must equal body resource ID",()=>{
  assert.throws(()=>validate({data:{id:"another"}}),/RESOURCE_ID_MISMATCH/);
});
test("resource ID case-insensitive for signed query semantics",()=>{
  const out=validate({data:{id:"abC_D"}},{dataId:"ABC_d"});
  assert.equal(out.provider_resource_id,"ABC_d");
});
test("invalid or oversized resource IDs are rejected",()=>{
  for(const id of ["", "a".repeat(65),";request-id:forged","abc/de"]){
    assert.throws(()=>validate({}, {dataId:id}),/INVALID_RESOURCE_ID/);
  }
});
test("event id is required and bounded",()=>{
  for(const id of [null,"","a".repeat(81),"abc;def",{}]){
    assert.throws(()=>validate({id}),/INVALID_EVENT_ID/);
  }
});
test("not object or array payload is rejected",()=>{
  for(const payload of [null,0,[],"hi"]){
    assert.throws(()=>validate({}, {payload}),/INVALID_PAYLOAD/);
  }
});
test("action is trimmed and is never used as payment status",()=>{
  const out=validate({action:"x".repeat(1000)});
  assert.equal(out.payload.action.length,96);
  assert.equal(out.processing_status,"verified_requires_reconciliation");
});
test("fake status fields never result in active or access grants",()=>{
  const out=validate({access_status:"active",paid_through:"2040-01-01T00:00:00Z",grantsStudentAccess:true});
  assert.equal(Object.hasOwn(out,"grantsStudentAccess"),false);
  assert.equal(Object.hasOwn(out.payload,"access_status"),false);
  assert.equal(Object.hasOwn(out.payload,"paid_through"),false);
});
