import test from 'node:test';
import assert from 'node:assert/strict';
import { signatureParts, signatureManifest, verifyMercadoPagoSignature } from
  '../supabase/functions/_shared/mercadopago-webhook-signature.mjs';

const ts = '1792443000';
const nowMs = Number(ts) * 1000;
const secret = 'sandbox-synthetic-secret-never-used-in-production';
const requestId = 'e6a0fa6b-5010-4b0b-a76f-5be59124901f';
const dataId = 'PAYMENT_185024682360';
const valid = async (value = {}) => verifyMercadoPagoSignature({
  header: await makeHeader(), requestId, dataId, secret, nowMs, ...value
});

async function makeHeader() {
  const manifest = signatureManifest(dataId, requestId, ts);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hash = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
  return `ts=${ts},v1=${Buffer.from(hash).toString('hex')}`;
}

test('accepts valid HMAC-SHA256 signed delivery', async () => {
  assert.equal(await valid(), true);
});
test('normalizes id to lowercase per provider signature format', () => {
  assert.equal(signatureManifest('AbC123', 'request-1', ts),
    `id:abc123;request-id:request-1;ts:${ts};`);
});
test('rejects changed notification data ID', async () => {
  assert.equal(await valid({ dataId: 'other_123' }), false);
});
test('rejects changed x-request-id', async () => {
  assert.equal(await valid({ requestId: 'other-request' }), false);
});
test('rejects incorrect secret', async () => {
  assert.equal(await valid({ secret: 'wrong' }), false);
});
test('rejects missing header', async () => {
  assert.equal(await valid({ header: '' }), false);
});
test('rejects expired and too-far-in-future timestamps', async () => {
  assert.equal(await valid({ nowMs: nowMs + 16 * 60 * 1000 }), false);
  assert.equal(await valid({ nowMs: nowMs - 16 * 60 * 1000 }), false);
});
test('accepts timestamps exactly within permitted clock window', () => {
  assert.notEqual(signatureParts(`ts=${ts},v1=${'a'.repeat(64)}`, nowMs + 15 * 60 * 1000), null);
});
test('rejects duplicate signature fields', async () => {
  assert.equal(await valid({ header: (await makeHeader()) + ',ts=1792443000' }), false);
});
test('rejects malformed signature and injected manifest values', async () => {
  assert.equal(await valid({ header: `ts=${ts},v1=ZZ` }), false);
  assert.equal(await valid({ dataId: 'a;request-id:forged' }), false);
  assert.equal(await valid({ requestId: 'forged\nfoo' }), false);
});
