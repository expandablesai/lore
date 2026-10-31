#!/usr/bin/env node
// The LOCK.
//
// `node scripts/lock.mjs` (or `pnpm lock:check`) verifies that the design
// system and the feature surface are exactly what the owner froze on
// 2026-11-01, and that every later change was recorded with a reason.
//
// Nothing here is decorative: a mismatch exits non-zero, so CI and every
// release build stop until the change is either reverted or written into the
// ledger on purpose. There is deliberately no environment flag that turns the
// check into a warning.
//
//   node scripts/lock.mjs                 verify
//   node scripts/lock.mjs update --reason "why"   record a sanctioned change
//
// Hashes are computed over LF-normalised, BOM-stripped text so a Windows
// checkout and a Linux CI run agree on the same file.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LOCK_PATH = join(ROOT, "lore.lock.json");

/** Files that *are* the design system. Their bytes may not change. */
const DESIGN_FILES = [
  "apps/web/src/index.css",
  "apps/web/src/views/common.tsx",
  "apps/web/src/lib/theme.tsx",
  "packages/ui/src/index.ts",
];

/**
 * Layout contracts that survive re-wording but not restructuring:
 * the console owns the viewport, the transcript is the only thing that scrolls,
 * and message metadata stays a quiet row under the bubble.
 */
const INVARIANTS = [
  {
    file: "apps/web/src/Shell.tsx",
    mustContain: ["h-screen", "overflow-hidden", "min-h-0 flex-1 overflow-y-auto"],
    why: "the console owns the viewport; only the content column scrolls",
  },
  {
    file: "apps/web/src/views/Chat.tsx",
    mustContain: ["min-h-0 flex-1", "bubble-user", "glass"],
    why: "the transcript is the single scroll region, bubbles are glass",
  },
];

/** The embedding space and locale set are product contract, not preference. */
const CONTRACT = {
  locales: "packages/core/src/locales.ts",
  embeddingModel: "packages/core/src/embedding.ts",
};

const FEATURES_DOC = "docs/LOCKED-FEATURES.md";

function toPosix(p) {
  return p.split(sep).join(posix.sep);
}

function read(root, rel) {
  return readFileSync(join(root, rel), "utf8");
}

function normalise(text) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

function sha(text) {
  return createHash("sha256").update(normalise(text), "utf8").digest("hex").slice(0, 16);
}

function walk(root, dir, filter) {
  const out = [];
  const base = join(root, dir);
  if (!existsSync(base)) return out;
  const stack = [base];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (filter(entry)) out.push(toPosix(relative(root, full)));
    }
  }
  return out.sort();
}

/**
 * `METHOD /path` pairs, with the file that registers them.
 *
 * Routes are registered both bare (`app.post("/chat", …)`) and with a typed
 * generic (`app.get<{ Params: … }>("/documents/:id", …)`), so both forms are
 * read. Anything that looks like a registration but cannot be read is reported
 * as `unparsed` and fails the check — a lock that quietly skips routes would be
 * worse than no lock.
 */
/**
 * Plugin prefixes, mirroring the `register(…)` calls in `apps/api/src/app.ts`.
 * Keeping this explicit means a route reads as the caller sees it
 * (`GET /documents/:id`), not as a fragment inside one file.
 */
const ROUTE_PREFIX = {
  "apps/api/src/routes/documents.ts": "/documents",
};

function readRoutes(root) {
  const files = walk(root, "apps/api/src", (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
  const routes = [];
  const unparsed = [];
  const pattern = /app\.(get|post|patch|delete|put|head|options)(?:<[^>]*>)?\(\s*["'`]([^"'`]+)["'`]/g;
  const begins = /app\.(get|post|patch|delete|put|head|options)[<(]/g;
  for (const file of files) {
    const source = read(root, file);
    const prefix = ROUTE_PREFIX[file] ?? "";
    const found = [...source.matchAll(pattern)];
    for (const match of found) {
      const raw = match[2];
      const path = raw === "/" ? prefix || "/" : `${prefix}${raw}`.replace(/\/{2,}/g, "/");
      routes.push(`${match[1].toUpperCase()} ${path}  <- ${file}`);
    }
    const declared = [...source.matchAll(begins)].length;
    if (declared !== found.length) {
      unparsed.push(`${file}: ${declared - found.length} registration(s) not understood`);
    }
  }
  // Route registration order is not part of the contract; the set is.
  return { routes: [...new Set(routes)].sort(), unparsed };
}

function readViews(root) {
  return walk(root, "apps/web/src/views", (name) => name.endsWith(".tsx") && !name.includes(".test.")).map(
    (file) => file.replace("apps/web/src/views/", ""),
  );
}

function readLocales(root) {
  const source = read(root, CONTRACT.locales);
  const match = source.match(/LOCALES\s*=\s*\[([^\]]+)\]/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
    .sort();
}

function readEmbeddingModel(root) {
  const source = read(root, CONTRACT.embeddingModel);
  const match = source.match(/EMBED_MODEL\s*=\s*["']([^"']+)["']/);
  return match ? match[1] : null;
}

function readMigrations(root) {
  const dir = "packages/db/migrations";
  const files = walk(root, dir, (name) => name.endsWith(".sql"));
  const out = {};
  for (const file of files) out[file.replace(`${dir}/`, "")] = sha(read(root, file));
  return out;
}

/** Every feature states the tests that prove it still works. */
function readFeatureEvidence(root) {
  const doc = read(root, FEATURES_DOC);
  const rows = doc.match(/^\|\s*`([a-z0-9-]+)`\s*\|.*$/gm) ?? [];
  return rows
    .map((row) => row.split("|").map((cell) => cell.trim()))
    .map((cells) => ({ id: cells[1].replaceAll("`", ""), evidence: cells.slice(2) }))
    .map(({ id, evidence }) => ({
      id,
      files: evidence
        .flatMap((cell) => cell.match(/`[^`]+\.test\.(ts|tsx)`/g) ?? [])
        .map((token) => token.replaceAll("`", "")),
    }));
}

function snapshot(root) {
  const design = {};
  for (const file of DESIGN_FILES) design[file] = sha(read(root, file));
  const { routes, unparsed } = readRoutes(root);
  return {
    design,
    routes,
    unparsed,
    views: readViews(root),
    locales: readLocales(root),
    embeddingModel: readEmbeddingModel(root),
    migrations: readMigrations(root),
  };
}

function diffSets(label, before, after) {
  const added = after.filter((item) => !before.includes(item));
  const removed = before.filter((item) => !after.includes(item));
  const lines = [];
  for (const item of added) lines.push(`  + ${label} added:   ${item}`);
  for (const item of removed) lines.push(`  - ${label} removed: ${item}`);
  return lines;
}

function verify(root, lock) {
  const now = snapshot(root);
  const problems = [];

  for (const file of DESIGN_FILES) {
    const was = lock.design[file];
    if (now.design[file] !== was) {
      problems.push(`  ! design file changed: ${file} (locked ${was}, now ${now.design[file]})`);
    }
  }

  for (const rule of INVARIANTS) {
    const source = read(root, rule.file);
    for (const token of rule.mustContain) {
      if (!source.includes(token)) {
        problems.push(`  ! layout contract broken in ${rule.file}: missing "${token}" — ${rule.why}`);
      }
    }
  }

  problems.push(...diffSets("route", lock.routes, now.routes));
  problems.push(...diffSets("view", lock.views, now.views));

  for (const item of now.unparsed) problems.push(`  ! ${item} — widen the parser, do not skip it`);

  if (lock.locales.join(",") !== now.locales.join(",")) {
    problems.push(`  ! locale set changed: locked ${lock.locales.join(",")} / now ${now.locales.join(",")}`);
  }
  if (lock.embeddingModel !== now.embeddingModel) {
    problems.push(
      `  ! embedding model changed: locked ${lock.embeddingModel} / now ${now.embeddingModel}` +
        " — every stored vector lives in that space",
    );
  }

  for (const [file, hash] of Object.entries(lock.migrations)) {
    if (!(file in now.migrations)) problems.push(`  ! migration removed: ${file}`);
    else if (now.migrations[file] !== hash) problems.push(`  ! migration rewritten: ${file}`);
  }
  for (const file of Object.keys(now.migrations)) {
    if (!(file in lock.migrations)) problems.push(`  + migration added: ${file}`);
  }

  const features = readFeatureEvidence(root);
  if (features.length === 0) problems.push(`  ! no features readable from ${FEATURES_DOC}`);
  for (const feature of features) {
    if (feature.files.length === 0) problems.push(`  ! feature "${feature.id}" names no test file`);
    for (const file of feature.files) {
      if (!existsSync(join(root, file))) {
        problems.push(`  ! feature "${feature.id}" cites a missing test: ${file}`);
      }
    }
  }

  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "check";
  const root = ROOT;

  if (command === "update") {
    const reasonIndex = args.indexOf("--reason");
    const reason = reasonIndex >= 0 ? args.slice(reasonIndex + 1).join(" ") : "";
    if (reason.trim().length < 8) {
      console.error("refusing to move the lock without --reason \"<why this change is allowed>\"");
      process.exit(2);
    }
    const previous = existsSync(LOCK_PATH) ? JSON.parse(readFileSync(LOCK_PATH, "utf8")) : null;
    const next = snapshot(root);
    const changelog = previous?.changelog ?? [];
    const changed = [];
    if (previous) {
      for (const file of DESIGN_FILES) {
        if (previous.design[file] !== next.design[file]) changed.push(`design:${file}`);
      }
      for (const route of next.routes.filter((item) => !previous.routes.includes(item))) {
        changed.push(`route+ ${route}`);
      }
      for (const route of previous.routes.filter((item) => !next.routes.includes(item))) {
        changed.push(`route- ${route}`);
      }
      for (const view of next.views.filter((item) => !previous.views.includes(item))) changed.push(`view+ ${view}`);
      for (const view of previous.views.filter((item) => !next.views.includes(item))) changed.push(`view- ${view}`);
      for (const file of Object.keys(next.migrations)) {
        if (!(file in previous.migrations)) changed.push(`migration+ ${file}`);
      }
      if (previous.locales.join(",") !== next.locales.join(",")) changed.push("locales");
      if (previous.embeddingModel !== next.embeddingModel) changed.push("embeddingModel");
    }
    const record = {
      version: 1,
      lockedAt: previous?.lockedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reason: previous?.reason ?? reason,
      changelog: [...changelog, { at: new Date().toISOString(), reason, changed }],
      ...next,
    };
    writeFileSync(LOCK_PATH, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    console.log(`lock updated: ${changed.length} change(s) recorded`);
    for (const item of changed) console.log(`  ${item}`);
    return;
  }

  if (!existsSync(LOCK_PATH)) {
    console.error("no lore.lock.json — run: node scripts/lock.mjs update --reason \"initial freeze\"");
    process.exit(2);
  }

  const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
  const problems = verify(root, lock);
  if (problems.length === 0) {
    console.log(
      `lock intact — ${lock.routes.length} routes, ${lock.views.length} views, ` +
        `${Object.keys(lock.migrations).length} migrations, ${lock.design ? Object.keys(lock.design).length : 0} design files`,
    );
    return;
  }

  console.error("LOCK VIOLATED — the design system and the feature surface are frozen:");
  for (const line of problems) console.error(line);
  console.error("");
  console.error('If this change is sanctioned, record it and say why:');
  console.error('  node scripts/lock.mjs update --reason "the owner approved X"');
  process.exit(1);
}

main();
