import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { events } from "./schema.js";
import type { Db } from "./client.js";

/**
 * Compute the SHA-256 hash for an event's content.
 * The hash covers: actorType, actorId, surface, kind, payload, trust, prevHash.
 */
export function computeEventHash(input: {
  actorType: string;
  actorId: string;
  surface: string;
  kind: string;
  payload: unknown;
  trust: number;
  prevHash: string;
}): string {
  const canonical = JSON.stringify([
    input.actorType,
    input.actorId,
    input.surface,
    input.kind,
    input.payload,
    input.trust,
    input.prevHash,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Write an event with hash-chain integrity.
 * Looks up the previous event's hash for the given org, computes the new hash,
 * and inserts the event.
 */
export async function writeEvent(
  db: Db,
  orgId: string,
  input: {
    projectId?: string | null;
    sessionId?: string | null;
    actorType: string;
    actorId: string;
    surface: string;
    kind: string;
    payload: unknown;
    trust: number;
  },
): Promise<{ id: string; hash: string }> {
  // Get the previous event's hash for this org (or use the genesis sentinel)
  const prev = await db
    .select({ hash: events.hash })
    .from(events)
    .where(eq(events.orgId, orgId))
    .orderBy(desc(events.ts))
    .limit(1);

  const prevHash = prev[0]?.hash ?? "0".repeat(64);

  const hash = computeEventHash({
    actorType: input.actorType,
    actorId: input.actorId,
    surface: input.surface,
    kind: input.kind,
    payload: input.payload,
    trust: input.trust,
    prevHash,
  });

  const inserted = await db
    .insert(events)
    .values({
      projectId: input.projectId ?? null,
      orgId,
      sessionId: input.sessionId ?? null,
      ts: new Date(),
      actorType: input.actorType as "user" | "assistant" | "tool" | "system",
      actorId: input.actorId,
      surface: input.surface,
      kind: input.kind as "message" | "tool_call" | "tool_result" | "document" | "web_capture" | "commit" | "decision" | "correction",
      payload: input.payload,
      trust: input.trust,
      prevHash,
      hash,
    })
    .returning({ id: events.id, hash: events.hash });

  const row = inserted[0];
  if (!row) throw new Error("event insert failed");
  return row;
}
