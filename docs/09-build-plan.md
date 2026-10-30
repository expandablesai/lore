# 09 — Build Plan v2 (TypeScript · PostgreSQL · multi-tenant)

**Status: awaiting approval to mutate. No code, repo, container or VM change made.**
Supersedes v1 (Go/SQLite). Decisions from the 2026-10-29 review are folded in:
TypeScript · pgvector/HNSW · multi-tenant from day 1 · local-first extraction · audited break-glass ·
Docker Compose.

---

## 0. Scope

**v0.1 delivers:** a self-hosted service with an admin console, local accounts + TOTP, organisations and
per-user memory isolation (Postgres RLS), project/personal scopes, MCP + OpenAI/Anthropic proxy capture,
bulk document ingestion (PDF/Office/text/images), provenance, forget-with-receipt, export/import,
scheduled maintenance, and Docker Compose deployment.

**Not in v0.1:** browser extension, cloud sync/E2EE, OIDC/SSO + SCIM, code-anchored validation, graph
visualisation, custom model training, mobile apps, marketplace.

**Definition of done (all seven must pass, on a clean VM):**

1. Install from the guide in **< 15 min**, ending on a green dashboard.
2. Superadmin bootstraps, creates a second user, and that user **cannot** see the first user's personal
   memory — proven by an automated RLS test, not by inspection.
3. Upload a 200-page PDF and an XLSX; both become searchable, with page-level citations, in < 2 min on reference hardware (VM 108: 4 vCPU, 8 GiB).
4. MCP SDK client calls `memory_recall` and cites an assertion ID; the proxy injects the same block.
5. `forget` cascades across assertions, derived summaries **and derived document chunks**, with a receipt.
6. A poisoned PDF never yields a `confirmed` assertion — automated test, zero promotions.
7. Kill -9 during backup/ingestion → restart → no corruption; job resumes or aborts cleanly.

---

## 1. Stack (verified against the npm registry today)

| Layer | Choice | Version | Why |
|---|---|---|---|
| Runtime | Node.js 24 LTS | 24.20.0 present | satisfies every dependency below (`pdfjs-dist` needs ≥22.13/≥24, `pg-boss` ≥22.12) |
| Language | TypeScript strict, ESM | 5.x | one language across API, workers and UI |
| HTTP | **Fastify** | 5.12 | schema validation, first-class streaming for the proxy, low overhead |
| Validation | **Zod** | 4.6 | shared request/MCP/config schemas |
| DB | **PostgreSQL 17 + pgvector** | — | relational truth + vectors in one transaction |
| Driver/ORM | **Drizzle** + `postgres` | 0.45 / 3.4 | SQL-first migrations, typed schema, no hidden query magic |
| Queue | **pg-boss** | 12.38 | durable jobs in Postgres — no Redis, no broker |
| MCP | **@modelcontextprotocol/sdk** | 1.32 | stdio + Streamable HTTP, official |
| Auth | `@node-rs/argon2` 2.2 + `otplib` 13.5 | — | Argon2id, TOTP; prebuilt binaries, no compiler needed |
| UI | React 19 + Vite 8 + Tailwind | — | admin console, built to static, served by Fastify |
| Logs/metrics | pino 10 + `prom-client` | — | structured logs, `/metrics` |
| Extraction | `pdfjs-dist` 6.4, `mammoth` 1.13, `exceljs` 4.4, `tesseract.js` 7.0 | — | local parsers; Tesseract is WASM (no system OCR) |
| Containers | `node:24-bookworm-slim`, `pgvector/pgvector:pg17` | — | image built in CI, multi-arch |

**Module boundaries** (enforced by lint rules, not convention):

```
apps/api        Fastify: REST, MCP HTTP, proxy, auth, admin routes
apps/web        React admin console (built → apps/api/public)
apps/worker     ingest/extract/embed/consolidate jobs (same image, different entrypoint)
packages/db     Drizzle schema + migrations + RLS SQL
packages/core   domain: trust, compiler, retrieval, sanitise, receipts  (no HTTP, no DB driver)
packages/mcp    MCP tool definitions (shared by API + stdio entrypoint)
packages/proxy  upstream adapters (openai / anthropic / responses)
```

`packages/core` must not import Fastify, pg, or any SDK — that is what makes it testable and reusable.

### 1.1 Dependency risks retired in M0

| Risk | Probe | Fallback |
|---|---|---|
| RLS silently bypassed | connect as a **non-superuser** role, `FORCE ROW LEVEL SECURITY`, assert admin cannot read another user's row | none — this is a stop-the-line item |
| pgvector index build time at scale | seed 100k×1536 vectors, build HNSW, measure | `ivfflat`, or pgvectorscale later |
| Tesseract WASM memory | OCR a 50-page scan in a worker with a 512 MB cap | external OCR service (opt-in) |
| pdfjs/canvas native deps | build the image on alpine and bookworm | bookworm-slim only |
| Node 24 + `postgres` prepared statements behind PgBouncer | none in v0.1 (direct connection) | disable prepared statements |

---

## 2. Tenancy model (the thing that must be right on day 1)

```
org (company / household / you)
 └── users            role: superadmin | org_admin | member | viewer
      └── personal scope   (private: owner_user_id; admins see metadata only)
 └── projects         members with roles
      ├── project scope   (visible to project members)
      ├── documents       (PDF/XLSX/DOCX/…, page-level provenance)
      └── org scope       (visible to the whole org, policy-gated)
```

**Isolation is enforced by PostgreSQL, not by application code.**

```sql
ALTER TABLE assertions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assertions FORCE ROW LEVEL SECURITY;

-- RESTRICTIVE: always AND'd with permissive policies (fixes OR-combination leak)
CREATE RESTRICTIVE POLICY tenant_isolation ON assertions
  USING (org_id = current_setting('lore.org_id')::uuid);

-- Permissive: scope-aware visibility (project rows require membership)
CREATE POLICY scope_isolation ON assertions
  USING (
    (scope = 'personal' AND owner_user_id = current_setting('lore.user_id')::uuid)
    OR (scope = 'project' AND project_id IN (
          SELECT project_id FROM project_members
          WHERE user_id = current_setting('lore.user_id')::uuid))
    OR (scope = 'org')
    OR lore_break_glass_allows(owner_user_id)     -- SECURITY DEFINER; granted, unexpired, audited
  );
```

Every request runs in a transaction that sets `lore.org_id` and `lore.user_id` via `SET LOCAL`. The
runtime DB role (`lore_app`) is **not** superuser and has **no** `BYPASSRLS` — verified by a test that
asserts `pg_roles.rolbypassrls = false`.

**Break-glass** (your requirement + the privacy answer): an org admin can open a user's personal memory
only through a grant that requires a written reason, expires automatically (default 60 min), appears in
the audit log, and notifies the user if email is configured. Without a grant, the admin sees counts and
health only. Superadmin is a separate, instance-level role and is audited identically.

```sql
-- SECURITY DEFINER: owned by superuser, reads break_glass_grants bypassing RLS
CREATE FUNCTION lore_break_glass_allows(p_target uuid) RETURNS bool
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = lore, pg_temp AS
$$ SELECT EXISTS (
     SELECT 1 FROM break_glass_grants
     WHERE target_user_id = p_target AND expires_at > now() AND revoked_at IS NULL
   ) $$;
REVOKE EXECUTE ON FUNCTION lore_break_glass_allows(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lore_break_glass_allows(uuid) TO lore_app;
```

---

## 3. Schema (contract)

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid

CREATE TABLE orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, slug text UNIQUE NOT NULL,
  mode text NOT NULL DEFAULT 'standalone',        -- standalone | multi-tenant
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  email citext UNIQUE NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  totp_secret text, totp_enabled boolean NOT NULL DEFAULT false,
  role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'active',          -- active | disabled
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL, expires_at timestamptz NOT NULL,
  ip inet, user_agent text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL, user_id uuid, project_id uuid,
  name text NOT NULL, token_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{}', last_used_at timestamptz,
  expires_at timestamptz, revoked_at timestamptz
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  name text NOT NULL, slug text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}',
  UNIQUE (org_id, slug)
);

CREATE TABLE project_members (
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  PRIMARY KEY (project_id, user_id)
);

-- --- memory ---
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid, org_id uuid NOT NULL,
  session_id uuid, ts timestamptz NOT NULL,
  actor_type text NOT NULL, actor_id text NOT NULL, surface text NOT NULL,
  kind text NOT NULL, payload jsonb NOT NULL,
  trust smallint NOT NULL CHECK (trust BETWEEN 0 AND 3),
  prev_hash text NOT NULL, hash text NOT NULL, sig text
);

CREATE TABLE assertions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL, project_id uuid, owner_user_id uuid,
  scope text NOT NULL CHECK (scope IN ('personal','project','org')),
  subject text NOT NULL, predicate text NOT NULL, object text NOT NULL,
  valid_from date, valid_to date, asserted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','confirmed','disputed','superseded','deleted')),
  confidence real NOT NULL DEFAULT 0.5,
  trust smallint NOT NULL,
  sources jsonb NOT NULL,                        -- event ids / document refs, never empty
  CHECK (jsonb_array_length(sources) > 0),       -- invariant: no assertion without provenance
  CHECK (valid_to IS NULL OR valid_to >= valid_from), -- temporal ordering invariant
  audience text[] NOT NULL DEFAULT '{}',
  source_doc_ids uuid[] NOT NULL DEFAULT '{}',   -- for cascade
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON assertions (org_id, project_id, status);
CREATE INDEX assertions_tsv ON assertions
  USING gin (to_tsvector('simple', subject || ' ' || predicate || ' ' || object));

CREATE TABLE embeddings (
  entity_type text NOT NULL, entity_id uuid NOT NULL,
  model text NOT NULL, dim int NOT NULL,          -- declared by the provider
  vec vector(1536) NOT NULL,                      -- zero-padded to 1536; cosine is unchanged
  PRIMARY KEY (entity_type, entity_id, model)
);
-- one partial HNSW index per active model, created when a model is enabled
-- NOTE: at runtime, use CREATE INDEX CONCURRENTLY to avoid blocking writes during model switching
CREATE INDEX embeddings_hnsw_default ON embeddings
  USING hnsw (vec vector_cosine_ops) WITH (m = 16, ef_construction = 64)
  WHERE model = 'openai-text-embedding-3-small';

-- --- documents ---
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL, project_id uuid, owner_user_id uuid,
  scope text NOT NULL, filename text NOT NULL, mime text NOT NULL,
  size_bytes bigint NOT NULL, sha256 text NOT NULL,
  storage_key text NOT NULL,                     -- local path or S3 key
  status text NOT NULL DEFAULT 'queued',         -- queued|extracting|indexed|failed
  page_count int, extracted_at timestamptz, error text,
  retention text NOT NULL DEFAULT 'forever',     -- forever | <N> <unit>
  CHECK (retention = 'forever' OR retention ~ '^\d+ (day|week|month|year)s?$'),
  legal_hold boolean NOT NULL DEFAULT false,
  uploaded_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, sha256)                        -- dedupe by content
);

CREATE TABLE chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  org_id uuid NOT NULL, seq int NOT NULL,
  text text NOT NULL, tokens int NOT NULL,
  page_from int, page_to int,
  UNIQUE (document_id, seq)
);

CREATE TABLE decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, project_id uuid,
  subject text NOT NULL, chosen text NOT NULL, rationale text,
  decided_at timestamptz NOT NULL, supersedes uuid, status text NOT NULL DEFAULT 'active'
);

CREATE TABLE constraints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, project_id uuid,
  text text NOT NULL, hardness text NOT NULL DEFAULT 'hard', source jsonb
);

CREATE TABLE break_glass_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL, admin_user_id uuid NOT NULL, target_user_id uuid NOT NULL,
  reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz
);

CREATE TABLE audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, actor_id uuid,
  action text NOT NULL, target_type text, target_ids uuid[],
  detail jsonb, ip inet, ts timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (   -- pg-boss owns its own tables; this is the product-facing view
  name text PRIMARY KEY, last_run timestamptz, last_status text, last_error text, locked_until timestamptz
);
```

**Invariants enforced in code + tests:** `sources` non-empty; T0 never `confirmed`; `valid_to ≥ valid_from`;
every mutation writes `audit` in the same transaction; `scope='personal'` implies `owner_user_id IS NOT NULL`.

---

## 4. Interfaces

### 4.1 REST (all under `/api/v1`, session or bearer)

```
POST /auth/login | /auth/logout | /auth/totp/verify
GET  /me
POST /orgs/:id/users            (admin)   GET /orgs/:id/users
POST /projects                  GET /projects           POST /projects/:id/members
POST /documents/upload          (multipart, chunked, resumable)
GET  /documents/:id             GET /documents?status=  POST /documents/:id/reprocess
POST /recall                    POST /remember           POST /forget
GET  /conflicts                 GET  /audit              POST /break-glass
GET  /export                    POST /import
GET  /admin/health | /admin/jobs | /admin/backups
POST /admin/jobs/:name/run
GET  /healthz /readyz /metrics
```

### 4.2 MCP tools (unchanged surface, now tenant-aware)

`memory_recall`, `memory_remember`, `memory_forget`, `memory_conflicts`, `memory_audit`.
Tokens are scoped `org + user + project`; a token cannot widen its scope. Resource:
`lore://project/{slug}/brief`. Prompt: `session_kickoff`.

### 4.3 Proxy

`/v1/chat/completions`, `/v1/messages`, `/v1/responses` — inject compiled block, stream passthrough,
capture. Upstream chosen by header → project default → instance default.

---

## 5. Ingestion pipeline (bulk upload → searchable forever)

```
upload → sha256 dedupe → store blob → queue → extract → normalise → chunk → embed → index → ready
                                                   └→ (opt-in) derive assertions  (trust T1, proposed)
```

| Format | v0.1 extractor | Notes |
|---|---|---|
| PDF | `pdfjs-dist` text layer; per-page OCR fallback via Tesseract | keeps page numbers for citations `D3#p12` |
| DOCX | `mammoth` → HTML → text + headings | tables preserved as blocks |
| XLSX / CSV | `exceljs` → sheets → row blocks + header-aware text | large sheets chunked by 500 rows |
| PPTX | *(v0.2)* | |
| MD / TXT / HTML | direct | front-matter preserved |
| Images (PNG/JPG/WEBP) | Tesseract OCR | optional cloud vision, per-file opt-in |
| ZIP | bounded recursive unwrap (max depth 3, max 1k entries) | inherit limits |
| EML / MSG | *(v0.2)* | |

**Safety:** every extractor runs in a worker thread with `maxOldGenerationSizeMb: 512` and a 120 s kill
timer; decompression-bomb limits; MIME sniffing (not extension trust); optional ClamAV profile in compose;
uploaded content is **evidence (searchable, citable)**, while *assertions automatically derived from it*
are `proposed`/T1 until a human confirms — this is how a malicious PDF cannot poison the vault.

### 5.1 Embedding models — OpenAI 1536 default, local optional

Both, selectable per project, without a migration:

| Provider | Model | Dim | Role |
|---|---|---|---|
| `openai` | `text-embedding-3-small` / `-large` | 1536 | **instance default** — best quality, needs an API key, documents leave the box |
| `ollama` | `bge-m3` | 1024 | local option, zero cost, runs on the Mac Studio or the VM |
| `hash` | built-in deterministic | 1024 | zero-config fallback so a fresh install works before any key is entered |

How two spaces coexist without corruption:

- One `vector(1536)` column holds every provider. Shorter vectors are **zero-padded**, and zero-padding
  preserves cosine similarity *exactly* — dot product and both norms are unchanged — so a 1024-dim model
  is indexed and queried correctly alongside a 1536-dim one.
- Every row records `model` and `dim`; retrieval always filters `model = <active model>`, so vectors from
  different spaces are never compared.
- One **partial HNSW index per enabled model** (`WHERE model = '…'`), created when a model is switched on.
- Resolution order: project → org → instance. A project can use local embeddings while the org default is
  OpenAI, or the reverse.
- Switching never blocks: a background `re-embed project` job writes rows for the new model, the old rows
  stay searchable until it completes, then are pruned. Switching back is instant.
- Admin console shows, per model: items embedded, estimated spend, and a re-embed action with an ETA.
- Enterprise policy: `embedding_policy = 'cloud-allowed' | 'local-only'` per org. Cloud-allowed is your
  default; an org admin can force local-only, which also disables the cloud OCR opt-in. Every document
  records which provider processed it.
- Cost: a 10,000-page corpus is roughly 10M tokens — single-digit dollars at current large-model rates.
  Verify against live pricing before quoting a number to a customer.


**"Memory for life":** documents default to `retention='forever'` and are never deleted by TTL. Only an
explicit `forget` (or a policy the owner sets) removes them, and `legal_hold` blocks even that. Deleting a
document cascades to its chunks, chunks' embeddings, and every assertion with `source_doc_ids` containing
it — all in one transaction, with a receipt.

---

## 6. Admin console (v0.1 screens)

| Screen | Contains |
|---|---|
| First-run setup | create org, superadmin, choose standalone vs multi-tenant, embedding model |
| Login | password + TOTP, rate-limited, lockout |
| Dashboard | users, projects, documents, memory counts, job health, disk, backup age |
| Users | create/invite, roles, disable, reset TOTP, per-user memory **counts only** |
| Projects | create, members, scope defaults, retention |
| Upload | drag-drop batch, progress, per-file status, reprocess, error detail |
| Memory browser | search assertions, provenance drawer, supersede, forget with reason |
| Conflicts | side-by-side sources, resolve → creates a decision |
| Audit | filter by actor/action/target, export CSV |
| Break-glass | request with reason, expiry, revoke; banner while active |
| Settings | proxy upstreams, embeddings, alerts, maintenance window |

---

## 7. Algorithms (unchanged in substance)

Retrieval: `0.45·cos + 0.25·ts_rank + 0.15·graph + 0.10·recency + 0.05·trust`, filtered by RLS, scope,
`as_of`, status. Top-120 → top-24.

Compiler budget: constraints 30% · decisions 25% · facts 25% · evidence (doc chunks) 15% · open 5%;
hard constraints never dropped; deterministic ordering; constant header for cache stability; sanitise
before render (control tokens, role markers, instruction patterns, zero-width/bidi, fence-breaking).

Trust: T0 quarantined; T1 proposed; T2 user-asserted; T3 verified. Document upload = T2 evidence; derived
assertions = T1. Any invalidated source taints every derived row to `disputed`.

---

## 8. Milestones

| M | Scope | Est. | Gate |
|---|---|---|---|
| **M0** | monorepo skeleton, config, Drizzle schema, compose (pg17+pgvector), RLS proof, MCP hello-world, CI | 3 d | RLS test: user A cannot read user B; `tools/list` works |
| **M1** | auth (argon2+TOTP+sessions), orgs/users/projects, roles, audit | 5 d | superadmin bootstrap → second user isolated |
| **M2** | memory core: events, assertions, trust, forget+receipt, CLI | 5 d | poison corpus: zero promotions |
| **M3** | ingestion: PDF/DOCX/XLSX/CSV/MD/TXT/HTML/images, chunking, embedding, jobs | 7 d | 200-page PDF + XLSX searchable with page citations |
| **M4** | retrieval + compiler + bench harness | 5 d | compiler ≥ 10 pts over naive top-k at equal tokens |
| **M5** | MCP tools + proxy + capture | 5 d | Claude Code cites; 10-turn proxy session captured |
| **M6a** | admin console: auth + dashboard + org/user screens | 3 d | second person administers org via console |
| **M6b** | admin console: memory CRUD + audit + break-glass screens | 3 d | full memory lifecycle via console |
| **M6c** | admin console: memory browser + conflicts + jobs screens | 3 d | a second person administers it without docs |
| **M7** | maintenance, backup/restore, export/import, doctor | 4 d | SIGKILL chaos + restore verified |
| **M8** | Docker image, compose, install.sh, docs, release | 4 d | clean-VM install < 15 min |

**≈ 47 working days (≈ 9.5 weeks solo).**

**Plan B (if you want value sooner):** M0–M5 + M7 without the console ≈ **31 days**; administration via
CLI + JSON API; the console lands as v0.2. The RLS/multi-tenant foundation is identical either way.

M4 is the kill point: if the compiler does not beat naive retrieval by 10 points at equal token budget,
stop before M5–M8.

### 8.1 Delivery calendar (what "finished" means in weeks)

Effort days are focused engineering days. The calendar adds integration, CI, your review and acceptance
testing. The build is driven through this harness, so the model matters:

| Driver | Drag | Effect |
|---|---|---|
| Cloud frontier model | 1.0× | baseline |
| **Strata (`strata-iq3-256`, Mac Studio M1 Ultra, 262K ctx, litellm-gw)** | **~1.3–1.6×** | slower tokens, and a 3-bit quant makes subtler TypeScript/type errors, so review cycles are longer. The 262K context partly offsets this by holding more of the codebase at once. |

| Plan | Effort | Cloud model, full-time | Strata, full-time | Strata, ~2 days/week |
|---|---|---|---|---|
| **B** — backend + MCP + proxy + ingestion + CLI; console as v0.2 | 31 d | ~7–8 weeks | **~10–12 weeks** | ~5–6 months |
| **A** — full v0.1 including the admin console | 47 d | ~10–11 weeks | **~14–17 weeks** | ~7–8 months |

"Finished" means the seven definition-of-done items pass on a clean VM — not "feature-complete forever".
Plan B reaches a usable product about **4–5 weeks earlier** and costs nothing in architecture: the console
is additive.

---

## 9. Testing and CI

| Level | Tool | Gate |
|---|---|---|
| Unit | vitest | every invariant in §3 has a named test |
| DB/RLS | real Postgres in CI + PGlite locally | cross-tenant read must fail |
| Integration | `fastify.inject` + minio/postgres services | MCP, proxy SSE, upload |
| E2E | Playwright on the admin console | bootstrap → upload → recall → forget |
| Bench | seeded 100k vectors | compile p95 < 50 ms, recall p95 < 150 ms |
| Security | 20-payload corpus, hostile PDFs, zip bombs | zero promotions, zero OOM |
| Chaos | SIGKILL during job | no corruption, clean resume |

CI: typecheck, lint, unit, integration (services), image build (multi-arch), Trivy scan, SBOM, bench
regression. Every release also runs the install guide end-to-end on a clean Debian 13 image.

---

## 10. Deployment (VM 108 today, VPS/NAS later)

```yaml
# deploy/compose/docker-compose.yml
services:
  db:    image: pgvector/pgvector:pg17
  app:   image: ghcr.io/<org>/lore:<tag>     # serves API + MCP + console
  worker: same image, entrypoint worker
  caddy: reverse proxy + TLS
```

**Memory tuning (8 GiB VM budget):**
```yaml
# docker-compose.yml additions
services:
  db:
    command: >
      postgres -c shared_buffers=512MB -c effective_cache_size=2GB
               -c maintenance_work_mem=128MB -c work_mem=16MB
    deploy: { resources: { limits: { memory: 2G } } }
  app:
    environment:
      NODE_OPTIONS: "--max-old-space-size=1024"
    deploy: { resources: { limits: { memory: 1536M } } }
  worker:
    environment:
      NODE_OPTIONS: "--max-old-space-size=512"
    deploy: { resources: { limits: { memory: 768M } } }
  caddy:
    deploy: { resources: { limits: { memory: 256M } } }
# Total capped: 2G + 1.5G + 0.75G + 0.25G = 4.5G (leaves 3.5G for OS/page cache)
```

```bash
# on 192.168.50.28
curl -fsSL https://get.expandables.dev/lore | sh   # installs docker if missing, writes .env, starts stack
lore admin init --org "Dushyant" --email me@dushyant.me
lore doctor
```

Access via **Tailscale** (recommended for the lab) or Caddy + domain for public. Data lives in
`/srv/lore/{pgdata,blobs,backups}` — one directory to snapshot, one to move.

---

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| RLS misconfiguration leaks tenant data | **critical** | non-superuser role, FORCE RLS, cross-tenant test in CI, security review before release |
| Node single-process CPU starvation from OCR | high | worker threads + concurrency caps + queue backpressure |
| pgvector index build blocks writes at scale | medium | build concurrently, `maintenance_work_mem` guidance, reindex job |
| Hostile/malformed documents | high | worker sandbox, limits, MIME sniffing, optional ClamAV |
| Admin console becomes the whole project | high | screens frozen in §6; anything else is v0.2 |
| Multi-tenant billing/quotas creep | medium | quotas in DB now, billing not in v0.1 |
| Node 24 native module availability | low | prebuilt `@node-rs/*`; bookworm base |
| 10-week scope fatigue | high | Plan B cut-line at M5 |

---

## 12. Decisions resolved (2026-10-30)

All 14 wave-2 decisions are now **locked**:

1. **License** — Apache-2.0 everywhere (permissive, no copyleft).
2. **GitHub** — Build locally first; org name and repo visibility decided when the repo is created.
3. **Auth scope** — Local accounts + TOTP only in v0.1; OIDC/SSO lands in v0.2.
4. **Network** — Tailscale for the lab + Cloudflare Tunnel for public MCP/REST endpoints.
5. **Backups** — Local directory (pg_dump to /srv/lore/backups/), retention 7 daily / 4 weekly / 12 monthly.
6. **Retention defaults** — Documents and assertions "forever" (matches 'memory for life' requirement).
7. **Quotas** — Unlimited (self-hosted trust; admin owns the hardware).
8. **Embedding default** — Ollama bge-m3 (best local quality; falls back to deterministic hash).
9. **Extraction LLM** — None by default (documents searchable via OCR/chunking); opt-in Ollama per doc.
10. **Alerts** — Dashboard-only in v0.1; webhook/email in v0.2.
11. **Telemetry** — Off by default (privacy-first); opt-in anonymous usage counts.
12. **Auto-update** — Notify-only (admin pulls when ready).
13. **Blob storage** — Local disk (/srv/lore/blobs/).
14. **Branding** — English only.

---

## 13. Environment note

No project mutation has occurred: no `git init`, no `package.json`, no containers, no VM access. The only
machine-level change remains the Go toolchain installed earlier for stack verification; with TypeScript
chosen it is now unnecessary and can be removed with
`Remove-Item -Recurse "C:\Users\DUSHYANT KUMAR\tools\go"`.
