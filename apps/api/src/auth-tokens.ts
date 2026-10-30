import { createHash, randomBytes } from "node:crypto";

/**
 * Session token helpers.
 *
 * Tokens are shown once and never stored: only the SHA-256 digest lands in
 * `sessions.token_hash`, so a database leak does not hand over live credentials.
 */

export const SESSION_TTL_DAYS = 30;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function bearerFrom(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return undefined;
  return value || undefined;
}

export function sessionExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}
