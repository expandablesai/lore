# SESSION HANDOFF — EXPANDABLES LORE

_Written 2026-10-30. Everything below is verified state from the build session; where
something is uncertain it says so explicitly._

---

## 1. What this project is

**EXPANDABLES LORE** — a self-hosted, multi-tenant AI memory system:
Fastify API + Drizzle/PostgreSQL 17 + pgvector + worker + Caddy-served React admin console,
deployed with Docker Compose. Full v0.1 scope lives in `docs/09-build-plan.md`
(47 effort-days across milestones M0–M8).

- **Repo:** https://github.com/expandablesai/lore.git (owner `expandablesai`)
- **Deploy host:** expandables-lab `10.20.10.52`, app at `/opt/lore`
- **Dev box:** `D:\DSH-PROJECTS\MSI-AMD\EXPANDABLES OS` (Docker Desktop, WSL2)

---

## 2. Live deployment state (VERIFIED)

`10.20.10.52:80` and `:3001` are **both open** and serving.

Running stack on the VM (`docker compose -f deploy/compose/docker-compose.yml ps`):

| container | image | role |
|---|---|---|
| `lore-app-1` | `ghcr.io/expandyne/lore:latest` | API, publishes `0.0.0.0:3001` |
| `lore-caddy-1` | `caddy:2-alpine` | serves SPA at `:80`, proxies `/api/*` → `app:3001` |
| `lore-db-1` | `pgvector/pgvector:pg17` | PostgreSQL 17 + pgvector, healthy |
| `lore-worker-1` | same app image | background worker |
| `lore-web-1` | same app image | one-shot: copies `apps/web/dist` → `web_dist` volume, then exits 0 |

**Deployed commit is `e725355`** (M2 memory routes). The SPA is still the M0
"under construction" placeholder — the API is far ahead of the UI.

### Verified live on the VM (curl, through Caddy)

```
POST /api/auth/signup   → 201 {"token":…,"user":{…,"role":"org_admin"}}
POST /api/auth/login    → 200 {"token":…}
GET  /api/auth/session  → 200 {"user":{…}}
POST /api/auth/signup with bad body → 400 (NOT 500)
pg_isready              → accepting connections
```

---

## 3. Repo state

`origin/master` = **`e725355`**, working tree **dirty** (see §5).

Commit history (oldest → newest):

| commit | content |
|---|---|
| `eb76d40` | M0 monorepo skeleton + deploy pipeline |
| `e655ca2` | runbook: remote URL, bootstrap marked done |
| `ff9fce3` | **fix:** install pnpm in runtime image stage |
| `48accff` | auth vertical (signup/login/session) + 9 vitest |
| `40ecc0c` | M1 orgs/users/projects + auth guard + audit + 8 vitest |
| `e725355` | M2 memory routes (remember/recall/forget) |

---

## 4. Milestone progress

| M | Scope | Status |
|---|---|---|
| **M0** | skeleton, Drizzle schema, compose, RLS proof, CI | ✅ deployed |
| **M1** | auth (argon2, sessions), orgs, users, projects, roles, audit | ✅ done, 17/17 tests |
| **M2** | memory core: remember / recall / forget, trust, scope | 🟡 routes written; isolation test **passes**; one legacy test regressed (see §6) |
| **M3** | ingestion (PDF/DOCX/XLSX/CSV/MD/images), chunking, embedding, jobs | ⬜ not started |
| **M4** | retrieval + compiler + bench | ⬜ not started |
| **M5** | MCP tools + proxy capture | ⬜ not started |
| **M6a/b/c** | admin console SPA screens | ⬜ not started |
| **M7** | maintenance, backup/restore, export/import | ⬜ not started |
| **M8** | install.sh, docs, release | ⬜ not started |

---

## 5. UNCOMMITTED work (must be committed before the VM can get it)

```
 M apps/api/src/routes/memory.ts        # recall now runs inside withRls()
 M packages/db/src/index.ts             # exports withRls
?? packages/db/src/rls-context.ts       # NEW — per-request RLS transaction wrapper
?? packages/db/src/rls-isolation.test.ts# NEW — cross-tenant proof, 2/2 green
```

`packages/db/src/rls-context.ts` is the important new piece:

```ts
export function withRls<T>(db, orgId, userId, fn) {
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    await tx.execute(sql`SET LOCAL ROLE lore_app`);
    await tx.execute(sql`SELECT set_config('lore.org_id', ${orgId}, true)`);
    await tx.execute(sql`SELECT set_config('lore.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
```

**Why `SET LOCAL ROLE lore_app` matters:** the DB user in `DATABASE_URL` is `lore`,
which is the **initial POSTGRES_USER and therefore a superuser** — superusers bypass RLS
even with `FORCE ROW LEVEL SECURITY`. Without `SET ROLE lore_app` the policies silently
do nothing. This was discovered by a failing isolation test, not by inspection.

---

## 6. KNOWN ISSUE — one failing test

`packages/db/src/schema.test.ts` → **"RESTRICTIVE tenant_isolation ANDs with permissive policies"** fails
when the two db test files run together.

- Cause: test interference. `schema.test.ts` connects as the superuser `lore` (RLS bypassed) and
  queries `SELECT * FROM assertions`, asserting nothing from other orgs leaks. The new
  `rls-isolation.test.ts` creates a third org; its rows are visible to the superuser query.
- `rls-isolation.test.ts` got `afterAll` cleanup, but the failure persists → the two files likely
  interleave; cleanup runs too late.
- **The M2 objective itself is met** — `rls-isolation.test.ts` proves user B cannot read user A's
  personal assertion (2/2 green, before interference).
- Fix options: make `schema.test.ts` also `SET LOCAL ROLE lore_app` (correct, and it would stop
  relying on a superuser bypass), or run db tests with `--no-file-parallelism`, or give the
  isolation test a transaction-per-test with rollback.

---

## 7. Critical conventions & gotchas (learned the hard way)

### Build / image
1. **Workspace `.ts` deps are esbuild-bundled** (`tooling/bundle.mjs`, alias map
   `@lore/{db,core,mcp,proxy,ui}` → `packages/<name>/src/index.ts`), `packages: 'external'`
   so npm deps stay external.
2. **A bundling package must declare every npm dep its bundle imports at runtime.**
   - `postgres` is a dep of `@lore/db`; before it was added to `apps/api` the container died with
     `ERR_MODULE_NOT_FOUND: Cannot find package 'postgres'`.
   - `apps/worker` already followed the rule (`pg-boss` declared).
3. **pnpm must exist in the *runtime* image stage.** `docker compose run --rm app pnpm db:migrate`
   failed with `Cannot find module '/repo/pnpm'` because pnpm was only installed in the build stage.
   Fixed with `RUN npm install -g pnpm` in the runtime stage.
4. **`.dockerignore` must exclude `.env` / `**/.env`** — the VM writes `deploy/compose/.env`
   inside the repo, which would otherwise be baked into the image. Verified with a throwaway
   context build.
5. **`pnpm --frozen-lockfile` runs in the image build** — any dependency change on the dev box must
   be committed together with `pnpm-lock.yaml` or the VM build fails.

### Serving
6. **Caddyfile must use two `handle` blocks.** Bare `root`/`try_files` alongside `handle` lets
   `try_files` swallow `/api/*` (returns index.html for API paths). Correct form:
   ```
   :80
   handle_path /api/* { reverse_proxy app:3001 }
   handle { root * /srv
     try_files {path} /index.html
     file_server }
   ```
7. **API must bind `0.0.0.0`** inside the container (`HOST: 0.0.0.0` in compose) or Caddy's
   `reverse_proxy app:3001` cannot reach it.
8. Containers live on Docker bridge `lore_default` at `172.18.0.x`; only `:80` / `:3001` are
   published to the host.

### TypeScript / versions
9. **`fastify-type-provider-zod` must be `^7`** — v4.0.2 declares peer `zod ^3` and its error
   formatter reads `ZodError.errors`, removed in zod 4 (renamed `.issues`). Symptom: **every
   validation failure returned 500 instead of 400**. Repo runs `zod@4.6.7`.
10. `packages/db` uses `.js` import specifiers; `apps/api` allows `.ts` (`allowImportingTsExtensions`).
11. `apps/api/src/index.ts` is the entrypoint only; `createApp()` lives in `apps/api/src/app.ts`
    because `index.ts` calls `app.listen()` at import time (breaks tests otherwise).
12. `todo_write` rejects unknown fields; `pwsh` needs `description`; PowerShell mangles `@{upstream}`
   and `{{…}}` — avoid braces in commands.

### DB / RLS
13. RLS policies read `current_setting('lore.org_id')` / `lore.user_id`; the runtime role must be
    `lore_app` (NOLOGIN, NOSUPERUSER, NOBYPASSRLS).
14. `rlsUp` is raw SQL **not captured by drizzle migrations**; run `pnpm db:apply-rls` once after
    `pnpm db:migrate`. It is **not idempotent**.
15. `packages/db/migrations/0000_init.sql` starts with `CREATE EXTENSION IF NOT EXISTS vector`.

### Workflow
16. Local test DB: `docker run -d --name lore-apitest --network loreapitest --publish 5433:5432 \
    -e POSTGRES_USER=lore -e POSTGRES_PASSWORD=lore -e POSTGRES_DB=lore_test pgvector/pgvector:pg17`,
    then `DATABASE_URL=postgresql://lore:lore@localhost:5433/lore_test pnpm db:migrate && pnpm db:apply-rls`.
    **Container is up right now.**
17. Test command: `$env:DATABASE_URL='postgresql://lore:lore@localhost:5433/lore_test'; pnpm --filter @lore/api test`
    (and `--filter @lore/db test`).
18. Deploy: on the VM `cd /opt/lore && git pull && docker compose -f deploy/compose/docker-compose.yml up -d --build`.
19. **Proxmox broker is reachable (API 9.2.2) but P07 SSH-key phase is denied**
    (`denied:p07-phase-authorization-required`) on VMIDs 101–104 — the agent cannot self-provision
    VM access; on-VM steps are user-executed (or require the phase authorized broker-side).
20. Do not commit unless the user asks. Do not touch any host other than expandables-lab `10.20.10.52`.

---

## 8. Suggested next actions (in order)

1. **Fix the `schema.test.ts` interference** (§6) — add `SET LOCAL ROLE lore_app` to that test's
   queries, or disable file parallelism for the db package.
2. **Commit + push** the four files in §5 (needs user go-ahead).
3. **Deploy to VM** (`git pull && up -d --build`) then re-run the auth smoke.
4. **M2 completion**: add events hash-chain writes, trust enforcement (T0 never `confirmed`),
   `POST /forget` cascade across `source_doc_ids`, receipt persistence.
5. **M3 ingestion** — biggest remaining chunk: `pdfjs-dist`, `mammoth`, `exceljs`, chunking,
   embedding (`openai` / `ollama` / deterministic `hash` fallback), pg-boss jobs.
6. **M6a admin console** — the SPA is still the placeholder; login/signup/dashboard screens are
   what make the deployment usable end-to-end.

---

## 9. Useful commands

```bash
# dev box
pnpm --filter @lore/api typecheck
pnpm --filter @lore/api test          # needs DATABASE_URL (see §7.17)
pnpm --filter @lore/db  test
pnpm bundle                            # esbuild → apps/*/dist
docker build -t ghcr.io/expandyne/lore:latest .

# VM (10.20.10.52, /opt/lore)
git pull && docker compose -f deploy/compose/docker-compose.yml up -d --build
docker compose -f deploy/compose/docker-compose.yml ps
docker logs lore-app-1 --tail 30
curl -fsS http://localhost/api/healthz
```
