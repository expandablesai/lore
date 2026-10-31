// The reaper's database half: a document a dead worker left in `extracting` is
// found, and the row that nothing is working on is closed out as failed-with-a-
// reason instead of reading "extracting" for ever.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { createDb, type Db } from "./client.js";
import { documents } from "./schema.js";
import { failStuckDocuments, listExtractingDocuments } from "./documents.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://lore:lore@localhost:5432/lore_test";

const orgId = randomUUID();
const ids = {
  abandoned: randomUUID(),
  fresh: randomUUID(),
  queued: randomUUID(),
};

let db: Db;

async function seed(id: string, status: "queued" | "extracting", ageMs: number): Promise<void> {
  await db.insert(documents).values({
    id,
    orgId,
    scope: "org",
    filename: `${id}.md`,
    mime: "text/markdown",
    sizeBytes: 10,
    sha256: randomUUID().replaceAll("-", ""),
    storageKey: `${id}.md`,
    status,
    createdAt: new Date(Date.now() - ageMs),
  });
}

beforeAll(async () => {
  db = createDb(DATABASE_URL, 2);
  await seed(ids.abandoned, "extracting", 10 * 60_000);
  await seed(ids.fresh, "extracting", 0);
  await seed(ids.queued, "queued", 10 * 60_000);
});

afterAll(async () => {
  await db.delete(documents).where(inArray(documents.id, Object.values(ids)));
});

describe("abandoned extraction reaper", () => {
  test("finds only the extractions old enough to have been abandoned", async () => {
    const found = await listExtractingDocuments(db, 60_000);
    const mine = found.filter((doc) => doc.orgId === orgId).map((doc) => doc.id);
    expect(mine).toContain(ids.abandoned);
    // A just-started extraction may belong to another worker, and a queued
    // document has not started at all.
    expect(mine).not.toContain(ids.fresh);
    expect(mine).not.toContain(ids.queued);
  });

  test("closes the abandoned row out and leaves the rest alone", async () => {
    const closed = await failStuckDocuments(db, [ids.abandoned], "the worker stopped");
    expect(closed).toEqual([ids.abandoned]);

    const rows = await db
      .select({ id: documents.id, status: documents.status, error: documents.error, extractedAt: documents.extractedAt })
      .from(documents)
      .where(inArray(documents.id, Object.values(ids)));
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(ids.abandoned)?.status).toBe("failed");
    expect(byId.get(ids.abandoned)?.error).toBe("the worker stopped");
    expect(byId.get(ids.abandoned)?.extractedAt).not.toBeNull();

    // Untouched: still extracting, and still queued.
    expect(byId.get(ids.fresh)?.status).toBe("extracting");
    expect(byId.get(ids.queued)?.status).toBe("queued");
  });

  test("will not overwrite a document that finished in the meantime", async () => {
    // The reaper read the row, then the worker indexed it. The update must not
    // turn a freshly indexed document into a failure.
    await db.update(documents).set({ status: "indexed" }).where(eq(documents.id, ids.fresh));
    const closed = await failStuckDocuments(db, [ids.fresh], "stale decision");
    expect(closed).toEqual([]);

    const [row] = await db
      .select({ status: documents.status })
      .from(documents)
      .where(and(eq(documents.id, ids.fresh), eq(documents.orgId, orgId)));
    expect(row?.status).toBe("indexed");
  });

  test("an empty candidate list is not a query", async () => {
    expect(await failStuckDocuments(db, [], "nothing to do")).toEqual([]);
  });
});
