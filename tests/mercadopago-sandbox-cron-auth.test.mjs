import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { cronManifest, verifyCronSignature, CRON_CONTEXT } from
  "../supabase/functions/_shared/mercadopago-sandbox-cron-auth.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const secret="A!b#C$d%E^f&G*h(I)j+K=l:M;n<O>P?Q";
const nowSeconds=1792452808;
const timestamp=String(nowSeconds);
async function signature(message=cronManifest(timestamp), password=secret) {
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),
    { name:"HMAC",hash:"SHA-256" },false,["sign"]);
  const result=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message));
  return Buffer.from(result).toString("hex");
}
test("signs correct fixed cron manifest with punctuation-rich Vault secret",async()=>{
  assert.equal(CRON_CONTEXT,"shamatha-sandbox-periodic:v1\nPOST\n");
  assert.equal(await verifyCronSignature({timestamp,signature:await signature(),secret,nowSeconds}),true);
});
test("mismatched stored secret is rejected",async()=>{
  assert.equal(await verifyCronSignature({timestamp,signature:await signature(),secret:"different-32-byte-value-ABCDEF12345",nowSeconds}),false);
});
test("wrong signature fails",async()=>{
  assert.equal(await verifyCronSignature({timestamp,signature:"0".repeat(64),secret,nowSeconds}),false);
});
test("timestamp tampering without new signature fails",async()=>{
  assert.equal(await verifyCronSignature({timestamp:String(nowSeconds+1),signature:await signature(),secret,nowSeconds}),false);
});
test("expired request fails at 301 seconds but is accepted at 300",async()=>{
  const sign=await signature();
  assert.equal(await verifyCronSignature({timestamp,signature:sign,secret,nowSeconds:nowSeconds+301}),false);
  assert.equal(await verifyCronSignature({timestamp,signature:sign,secret,nowSeconds:nowSeconds+300}),true);
});
test("future request fails at 301 seconds",async()=>{
  assert.equal(await verifyCronSignature({timestamp,signature:await signature(),secret,nowSeconds:nowSeconds-301}),false);
});
test("missing and malformed headers are rejected",async()=>{
  for(const sig of ["", "1", "zz".repeat(32), "0".repeat(65)]){
    assert.equal(await verifyCronSignature({timestamp,signature:sig,secret,nowSeconds}),false);
  }
  assert.equal(await verifyCronSignature({timestamp:"bad",signature:await signature(),secret,nowSeconds}),false);
});
test("empty or short HMAC key fails",async()=>{
  assert.equal(await verifyCronSignature({timestamp,signature:await signature(),secret:"short",nowSeconds}),false);
  assert.equal(await verifyCronSignature({timestamp,signature:await signature(),secret:"",nowSeconds}),false);
});
test("wrong signed message context fails",async()=>{
  assert.equal(await verifyCronSignature({timestamp,signature:await signature("different\nPOST\n"+timestamp),secret,nowSeconds}),false);
});
test("UTF-8 secret encoding is deterministic",async()=>{
  const accented="a".repeat(32)+"é-#";
  assert.equal(await verifyCronSignature({
    timestamp,signature:await signature(cronManifest(timestamp),accented),secret:accented,nowSeconds
  }),true);
});
