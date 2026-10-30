# 08 — Decision Log (ADR)

Format: **status · context · decision · consequences · reversibility**.
Anything marked *proposed* is still open; everything else is treated as frozen for Phase 1.

---

### D1 — Product name is **EXPANDABLES LORE** — *accepted 2026-10-29*
**Context:** "EXPANDABLES OS" is the umbrella but a weak product mark: "OS" is a category word, promises
an operating system, and "Memory OS" is already used academically (MemOS).
**Decision:** product = `EXPANDABLES LORE`; umbrella = `EXPANDABLES OS`; plain descriptor = "memory vault".
**Consequences:** all docs, domains, repo name (`expandables/lore`), package scope (`@expandables/lore`).
**Reversibility:** high now, low after a public release.

---

### D2 — First deployment is Proxmox VM 108 — *accepted 2026-10-29*
**Context:** VMID 108 `memory-os` already exists and is running (4 vCPU / 8 GiB / 80 GiB /
192.168.50.28), cloned from the Debian 13 GOLD image.
**Decision:** build and validate Phase 1 there before any cloud deployment; treat it as the reference
"small team" host.
**Consequences:** install docs start with this exact shape; benchmarks run on it; no host resize needed.
**Reversibility:** high — the same Compose stack runs on a VPS unchanged.

---

### D3 — Phase 1 = MCP + proxy. Extension in Phase 2 — *accepted 2026-10-29*
**Context:** browser automation is fragile, subject to store review, and may conflict with vendor terms.
**Decision:** ship Door 1 (MCP) and Door 2 (OpenAI/Anthropic-compatible proxy) first. Door 3 (extension +
export importers) is Phase 2.
**Consequences:** "works with any LLM" is honoured for agents, CLIs and self-hosted UIs in v1; the two
big web chat UIs come later, via import first.
**Reversibility:** medium — Door 3 slots in without schema changes.

---

### D4 — Open source on GitHub, multi-target install — *accepted 2026-10-29*
**Decision:** public repo; signed releases (linux/amd64+arm64, macOS, Windows), container images on GHCR,
`install.sh`, Compose bundle, systemd unit, Proxmox helper.
**Consequences:** every release must pass a clean-VM install test in CI, or the guarantee is a lie.
**Reversibility:** high.

---

### D5 — Local-first default, self-host is the primary story — *accepted*
**Decision:** the vault is the user's; cloud sync is optional and E2E-encrypted. No telemetry on by
default; no phone-home license check.
**Consequences:** no usage analytics from the free tier; product decisions rely on opt-in data and
benchmarks.

---

### D6 — TypeScript / Node.js 24 — *accepted 2026-10-29*
**Context:** Go offers a static binary; TypeScript offers one language across API, workers and console,
the richest MCP ecosystem (`@modelcontextprotocol/sdk` 1.32), and the largest contributor pool for an
open-source project.
**Decision:** TypeScript strict/ESM on Node 24 LTS; Fastify; Drizzle + `postgres`; React/Vite console.
**Consequences:** distribution is a Docker image (no single-binary story); CPU-bound extraction must run
in worker threads; the API and UI share types.
**Trade-off accepted:** a container runtime is now mandatory for the easy install path.
**Reversibility:** low after the first release.

---

### D7 — PostgreSQL 17 + pgvector is the store — *accepted 2026-10-29*
**Decision:** Postgres is the only stateful dependency (app + worker + Postgres + Caddy in Compose).
Vectors live in `pgvector` (HNSW) in the **same database** as the assertions.
**Why this is a correctness decision, not a convenience one:** delete, taint propagation and the audit
receipt must be one transaction. An external vector store makes "forget" a two-system operation that can
half-fail — which is exactly the property the product sells.
**Consequences:** the vector column is `vector(1536)`; smaller models are zero-padded (cosine is exact
under zero-padding); every row records `model`+`dim` and retrieval filters by model; one partial HNSW
index per enabled model. The app connects as a non-superuser role; HNSW builds need
`maintenance_work_mem` guidance.
**Amendment history:** v1 proposed SQLite-first; the user rejected it on vector scale and robustness
grounds, and the transactional-deletion argument supports Postgres.

---

### D8 — No exotic infrastructure — *accepted*
**Decision:** in-process worker + scheduler; no Celery/BullMQ/Kafka. One lock table; idempotent jobs.
**Consequences:** horizontal scaling is limited; that is an acceptable trade for the target size (<100
users per instance).

---

### D9 — License: AGPL-3.0 core, MIT SDKs/adapters — *proposed*
**Context:** AGPL protects against a cloud reselling it as a service; MIT keeps client integration frictionless.
**Decision (proposed):** confirm before the first public release; the repo must carry the correct headers
from commit #1 (relicensing later requires every contributor's consent).

---

### D10 — Provenance and trust tiers are core invariants — *accepted*
**Decision:** no assertion without a source; memory is rendered as data, never instructions; untrusted
content cannot be promoted without confirmation or corroboration; deletion is transactional with a receipt.
**Consequences:** some convenient features are rejected by design (e.g. "just remember everything the
model says"). Correct.

---

### D11 — Auto-maintenance with quiet defaults; auto-upgrade opt-in — *accepted*
**Decision:** scheduled backup/consolidate/retention/reindex/health jobs, user-set window, failure-only
alerts. Upgrades snapshot, migrate, self-test, and roll back on failure.
**Consequences:** the scheduler is part of the product surface (UI + receipts), not a hidden cron.

---

### D12 — Integrate a graph engine, don't rebuild one — *accepted*
**Decision:** v1 uses SQL graph queries; adopt Graphiti (or equivalent) behind a storage interface if
temporal-graph needs grow.
**Consequences:** no graph-database dependency in v1; the option stays open.

---

### D13 — Hindsight is a source, not a competitor — *accepted*
**Decision:** ship a Hindsight adapter that ingests its banks/pages as T1/T2 sources.
**Consequences:** migration path for existing users; the product complements rather than displaces a tool
that already works.

---

### D14 — Browser extension is Tier C only — *accepted*
**Decision:** never the foundation; adapter recipes as versioned JSON, nightly fixture tests, explicit
insert rather than silent injection, local bridge by default.
**Consequences:** if a vendor breaks the DOM, the product degrades to Doors 1–2, not to zero.

---

### D15 — Multi-tenancy from day one, enforced by Postgres RLS — *accepted 2026-10-29*
**Context:** enterprise = one company hosting many users, each with private memory. This is a mandatory
requirement, and retrofitting tenancy across every table and every auth path is a rewrite.
**Decision:** every tenant row carries `org_id`; `users`, `projects`, `documents` and `assertions` carry
`owner_user_id`/`scope`. RLS policies enforce isolation; the runtime role has no `BYPASSRLS`.
A single-user install is simply one org.
**Consequences:** all queries run inside a transaction that sets `SET LOCAL lore.org_id/lore.user_id`;
cross-tenant reads fail at the database, not in application code.
**Reversibility:** none — this is foundational.

---

### D16 — Documents are evidence; derived facts are proposals — *accepted 2026-10-29*
**Context:** bulk upload of years of company documents must be immediately useful, but a malicious PDF
must not be able to poison the vault.
**Decision:** uploaded content is stored as T2 *evidence* (searchable, citable, page-anchored). Assertions
automatically derived from documents are T1 `proposed` until a human confirms them. Deletion of a document
cascades in one transaction to chunks, embeddings and every assertion that cites it.
**Consequences:** "upload everything and it is remembered for life" is true for retrieval without weakening
the poisoning defence.

---

### D17 — Admin console with audited break-glass, metadata-only by default — *accepted 2026-10-29*
**Decision:** org admins see counts, health, policies and audit. Reading a user's personal memory requires
a time-boxed grant with a written reason, is audited, and notifies the user where email is configured.
Superadmin is instance-level and audited identically.
**Consequences:** the console is in v0.1 scope (11 screens, frozen list); privacy review is a first-class
acceptance test, not a later feature.

---

### D18 — Docker Compose is the primary distribution — *accepted 2026-10-29*
**Decision:** app + worker + Postgres/pgvector + Caddy in one compose file; multi-arch images on GHCR;
a bare-metal/systemd path documented but not the default.
**Consequences:** install guide must install Docker where absent; every release tests the compose path on a
clean VM.

---

### D19 — Publish to GitHub after internal testing — *accepted 2026-10-29*
**Decision:** build and dogfood locally first; create the public repository when v0.1 passes its gates.
**Consequences:** package scope and module paths are placeholders until the org exists; the first public
commit must therefore be a clean, single import with license headers already correct.

---

### D20 — OpenAI 1536-dim embeddings by default, local model selectable per project — *accepted 2026-10-30*
**Context:** the user wants OpenAI embeddings as the default for quality, with a local model available in
the admin console, and does not want to choose permanently at install time.
**Decision:** both live in the `embeddings` table (`model`, `dim`, `vector(1536)`), zero-padded where
shorter, with one partial HNSW index per model and a `re-embed project` job for switching. Resolution is
project → org → instance. Per-org `embedding_policy` can force local-only for enterprise.
**Consequences:** vectors from different spaces are never compared; switching is non-blocking; documents
record which provider processed them.
