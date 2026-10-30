import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Secret encryption at rest (AES-256-GCM).
 *
 * The key comes from the LORE_ENCRYPTION_KEY env (64 hex chars or 32-byte
 * base64). Plaintext secrets are never stored or logged; only the `v1.<iv>.
 * <tag>.<ct>` envelope reaches the database.
 */
function key(): Buffer {
  const raw = process.env.LORE_ENCRYPTION_KEY;
  if (!raw) throw new Error("LORE_ENCRYPTION_KEY is not set");
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("LORE_ENCRYPTION_KEY must be 32 bytes (64 hex or base64)");
  }
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("malformed secret payload");
  }
  const iv = Buffer.from(parts[1] ?? "", "base64url");
  const tag = Buffer.from(parts[2] ?? "", "base64url");
  const ct = Buffer.from(parts[3] ?? "", "base64url");
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
