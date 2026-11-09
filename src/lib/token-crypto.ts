// AES-256-GCM encryption for OAuth refresh tokens. Server only (never imported by client components).
// Format: "v1:<iv b64>:<auth tag b64>:<ciphertext b64>". The account's email address is bound in as
// additional authenticated data, so an encrypted token copied onto another account's row won't decrypt.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyFrom(raw: string | undefined): Buffer {
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set (generate one with: openssl rand -base64 32)");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (base64 or 64 hex chars)");
  return key;
}

export function encryptToken(plain: string, boundTo: string, rawKey = process.env.TOKEN_ENCRYPTION_KEY): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(rawKey), iv);
  cipher.setAAD(Buffer.from(boundTo.toLowerCase(), "utf8"));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptToken(enc: string, boundTo: string, rawKey = process.env.TOKEN_ENCRYPTION_KEY): string {
  const [v, iv, tag, data] = enc.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised encrypted token format");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(rawKey), Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(boundTo.toLowerCase(), "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
