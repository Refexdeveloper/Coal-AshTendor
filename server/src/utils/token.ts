const COOKIE = "ca_session";

function bytesToB64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not set");
  return value;
}

async function hmac(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToB64Url(new Uint8Array(signature));
}

export async function signSession(userId: string) {
  const payload = bytesToB64Url(new TextEncoder().encode(JSON.stringify({ uid: userId, exp: Date.now() + 7 * 864e5 })));
  return `${payload}.${await hmac(payload)}`;
}

export async function readSession(token: string | undefined | null) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await hmac(payload);
  if (expected.length !== signature.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (mismatch) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(b64UrlToBytes(payload))) as { uid?: string; exp?: number };
    if (!parsed.uid || !parsed.exp || parsed.exp < Date.now()) return null;
    return parsed.uid;
  } catch {
    return null;
  }
}

export { COOKIE };
