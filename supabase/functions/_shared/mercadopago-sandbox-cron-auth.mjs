/**
 * Signed internal cron calls: never transmit the Vault secret itself.
 *
 * The caller signs "shamatha-sandbox-periodic:v1\nPOST\n" + UNIX_SECONDS
 * using HMAC-SHA256. This request only triggers read-only fake-seller
 * reconciliation and NEVER changes student access.
 */
export const CRON_CONTEXT = "shamatha-sandbox-periodic:v1\nPOST\n";
export const CLOCK_SKEW_SECONDS = 300;

export function cronManifest(timestamp) {
  if (typeof timestamp !== "string" || !/^\d{10}$/.test(timestamp)) return null;
  return CRON_CONTEXT + timestamp;
}

export async function verifyCronSignature({
  timestamp, signature, secret, nowSeconds = Math.floor(Date.now() / 1000)
} = {}) {
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 256) return false;
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const manifest = cronManifest(timestamp);
  if (!manifest) return false;
  const ts = Number(timestamp);
  if (!Number.isSafeInteger(ts) || !Number.isFinite(nowSeconds) ||
      Math.abs(ts - nowSeconds) > CLOCK_SKEW_SECONDS) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const expected = new Uint8Array(signature.match(/../g).map(h => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", key, expected, new TextEncoder().encode(manifest));
}
