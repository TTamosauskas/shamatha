// Pure verifier for Mercado Pago x-signature, usable by Deno and Node tests.
// No network calls or stored credentials. The caller must also re-read the
// referenced resource with the seller's MP token before taking any action.
const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000;

export function signatureParts(header, nowMs = Date.now()) {
  if (typeof header !== 'string' || header.length > 512) return null;
  const parts = new Map();
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator < 1) return null;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key || parts.has(key)) return null;
    parts.set(key, value);
  }
  const ts = parts.get('ts') || '';
  const v1 = parts.get('v1') || '';
  if (!/^\d{10}$|^\d{13}$/.test(ts) || !/^[0-9a-f]{64}$/i.test(v1)) return null;
  const time = Number(ts) * (ts.length === 10 ? 1000 : 1);
  if (!Number.isSafeInteger(time) || Math.abs(nowMs - time) > MAX_CLOCK_SKEW_MS) return null;
  return { ts, v1 };
}

export function signatureManifest(dataId, requestId, ts) {
  if (typeof dataId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(dataId)) return null;
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(requestId)) return null;
  if (typeof ts !== 'string' || !/^\d{10}$|^\d{13}$/.test(ts)) return null;
  return `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
}

export async function verifyMercadoPagoSignature({ header, requestId, dataId, secret, nowMs = Date.now() }) {
  if (typeof secret !== 'string' || !secret) return false;
  const parts = signatureParts(header, nowMs);
  if (!parts) return false;
  const manifest = signatureManifest(dataId, requestId, parts.ts);
  if (!manifest) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const signature = new Uint8Array(parts.v1.match(/../g).map(byte => parseInt(byte, 16)));
  return crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(manifest));
}
