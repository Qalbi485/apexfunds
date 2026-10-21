import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Minimal TOTP (RFC 6238) implementation on node:crypto — no dependencies.
 * HMAC-SHA1, 30s step, 6-digit codes, ±1 time-step verification window.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** otpauth:// provisioning URI for authenticator apps. */
export function totpProvisioningUri(secret: string, account: string, issuer: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function hotp(secretBuf: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secretBuf).update(msg).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    (((digest[offset]! & 0x7f) << 24) |
      ((digest[offset + 1]! & 0xff) << 16) |
      ((digest[offset + 2]! & 0xff) << 8) |
      (digest[offset + 3]! & 0xff)) %
    1_000_000;
  return code.toString().padStart(6, "0");
}

/**
 * Generates the expected code for a given time (testable).
 */
export function totpCode(secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30);
  return hotp(base32Decode(secret), counter);
}

/**
 * Verifies a user-supplied code against the secret, accepting the previous,
 * current, and next time step (clock skew tolerance). Constant-time compare.
 */
export function totpVerify(secret: string, code: string, atMs: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  let expectedBuf: Buffer | null = null;
  const candidate = Buffer.from(code, "utf8");
  const counter = Math.floor(atMs / 1000 / 30);
  for (const c of [counter - 1, counter, counter + 1]) {
    if (c < 0) continue;
    const expected = hotp(base32Decode(secret), c);
    const expBuf = Buffer.from(expected, "utf8");
    if (
      expBuf.length === candidate.length &&
      timingSafeEqual(expBuf, candidate)
    ) {
      return true;
    }
    expectedBuf = expBuf;
  }
  void expectedBuf;
  return false;
}
