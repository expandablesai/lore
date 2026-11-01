# EXPANDABLES LORE — project record

The original plan for this system, and everything that has actually been built,
verified and deployed up to this point. Written to be the single durable record:
if only one document survives, it should be this one.

Last updated: 2026-10-31 · deployed bundle `index-DLumDUVb.js` · commit `d3fde22`
· VM `10.20.10.52` (`/opt/lore`) · 207 tests green.

This document is itself stored in LORE: it was uploaded to the owner org as
`PROJECT-RECORD.md` (scope `org`), chunked, embedded with `nomic-embed-text` and
indexed, so the system can recall its own plan.

---

## 1. The brief

People's working memory is scattered across chat windows, documents, screenshots
and code, and each AI tool keeps its own private, unauditable copy of a fragment
of it. LORE is the opposite: a **self-hosted, multi-tenant memory system** where
one organisation's documents, images and conversations live on its own disk, in
its own Postgres, behind its own login — and where every fact it stores can be
traced to a source, scoped, disputed, or forgotten on request.

Four properties were treated as non-negotiable, because they are what make it a
memory system rather than a vector search demo:

1. **Provenance** — an assertion cannot exist without a source (`sources` is
   required; a remember with no source is rejected by the API).
2. **Trust tiers** — T0 material is quarantined and can never be asserted; the
   event chain enforces `0..3` in the database, not just in the UI.
3. **Scopes** — personal / project / org, carried on documents and assertions.
4. **Forgetting** — a forget is a *cascade* with a receipt (assertion, its
   documents, their chunks and vectors), not a soft-delete flag.

## 2. The original plan

### Definition of done (the four phases)

| Phase | Requirement |
| --- | --- |
| **A** | The proxy calls `/v1/chat/completions` over HTTPS against the configured provider, using **per-org API keys encrypted in Postgres**. |
| **B** | **Real embeddings** from the configured provider + **pgvector cosine** semantic recall. |
| **C** | In-app **chat UI** that replies using memory retrieval. |
| **D** | **Cloudflare Workers AI** selectable as a provider, **Authelia in front**, documents stored on **local disk** (`/srv/lore/blobs`), reachable over public DNS/Tunnel. |

Each phase had to build clean (`pnpm -r build`), pass the gates
(`pnpm -r typecheck`, `pnpm -r test`), and be **verified on the VM** — not just
locally.

### Milestones

| # | Scope | Exit criteria |
| --- | --- | --- |
| **M0** | monorepo skeleton, config, Drizzle schema, compose (pg17 + pgvector), RLS proof, MCP hello-world, CI | RLS test: user A cannot read user B; `tools/list` works |
| **M1** | auth (argon2 + TOTP + sessions), orgs/users/projects, roles, audit | superadmin bootstrap → second user isolated |
| **M2** | memory core: events, assertions, trust, forget + receipt | poison corpus: zero promotions |
| **M3** | ingestion: PDF/DOCX/XLSX/CSV/MD/TXT/HTML/images, chunking, embedding, jobs | 200-page PDF + XLSX searchable with citations |
| **M4** | retrieval + compiler + bench harness | compiler ≥ 10 pts over naive top-k at equal tokens |
| **M5** | MCP tools + proxy + capture | an agent cites LORE; a 10-turn proxy session is captured |
| **M6a/b/c** | admin console: auth/dashboard/org, memory CRUD/audit, browser/conflicts/jobs | a second person administers the org without docs |
| **M7** | maintenance, backup/restore, export/import, doctor | SIGKILL chaos + restore verified |
| **M8** | Docker image, compose, install, docs, release | clean-VM install < 15 min |

### Architecture as planned

- **pnpm workspace**: `apps/{api,web,worker}`, `packages/{core,db,proxy,ui,mcp}`.
- **API**: Fastify 5 + `fastify-type-provider-zod`.
- **DB**: Postgres 17 + pgvector, drizzle-orm; `embeddings.vec vector(3072)` and
  cosine distance `<=>`; per-request RLS transactions for tenant isolation.
- **Jobs**: pg-boss (`document.ingest`, `document.reprocess`).
- **LLM layer**: a provider adapter (OpenAI-compatible + Anthropic), with
  per-org keys holding provider, base URL, chat model, embedding model,
  embedding dimension, and an optional vision model.
- **Edge**: Caddy (TLS, SPA, `/api` proxy) with Authelia `forward_auth` in front.

## 3. What is built

Everything below is on `master`, deployed, and covered by tests.

### Platform and deployment

- Monorepo, Dockerfile, compose stack: `db` (pgvector/pg17), `app`, `worker`,
  `web` (one-shot dist copier), `caddy`, `authelia`.
- Migrations `0000`–`0009` (including `pg_trgm` for lexical recall), applied with
  `pnpm --filter @lore/db migrate`; migration ordering on a running deployment is
  documented because `run --rm app` executes the *current image*.
- Documents and avatars live on the VM's disk under `/srv/lore/blobs` (mounted
  into `app` and `worker`); Postgres data under `/srv/lore/pgdata`.
- Authelia 4 gate in front of the console (`dushyant.com` family, internal CA
  TLS), with a 12 h session / 1 h inactivity, plus the app's own bearer sessions.

### Auth and tenancy

- Signup/login/session (argon2, SHA-256 token digests — the plaintext token is
  never stored), roles `viewer/member/org_admin/superadmin`, audit rows on every
  mutation.
- **Tenant isolation is enforced and tested** (suite `m7`): role fields are
  validated and capped at the caller's own rank (no self-promotion to
  superadmin), user/assertion/LLM-key/project lookups are all scoped by org, and
  an id from another org returns 404 rather than touching a foreign row.

### Memory core (M2)

- `events` hash chain (each event carries the previous hash; tampering breaks the
  chain), `assertions` with scope + trust + status, `remember` / `recall` /
  `forget` endpoints, forget cascade with a receipt.
- Recall is hybrid: `pg_trgm` subject similarity **OR** semantic nearest
  documents, and it degrades to the local hash vector space instead of failing
  when the org has no embed-capable key.

### Ingestion (M3)

- Text extraction for PDF, DOCX, XLSX, CSV, MD, TXT, HTML; images are indexed by
  having the org's **vision model describe them**, so a picture becomes findable
  text.
- Chunking targets ~500 tokens, splits on paragraphs then sentences, and
  hard-cuts pathological content (minified JSON, base64, one long line);
  per-page chunking preserves page numbers for citation.
- Embeddings: real provider vectors when a key can embed (in batches, one vector
  per chunk, refusing partial replies), deterministic hash vectors otherwise. The
  org is **pinned to one vector space**: ingestion re-uses the model its existing
  vectors came from, and refuses rather than silently mixing models.
- Ingestion is **transactional**: extract → embed → (delete old derived rows,
  write chunks, write vectors, mark indexed) in one transaction, so a failure or
  a crash can never leave a half-indexed document, and a reprocess that cannot
  embed leaves the previous index intact.
- Zero-byte uploads and files with no extractable text are refused instead of
  becoming "indexed" with nothing in them.

### Retrieval and chat (M4/M5/C)

- `/chat` embeds the question in the stored space, retrieves the top chunks by
  cosine distance, grounds the model with them, and returns the reply together
  with the images the answer rests on.
- A capabilities prompt stops the model claiming it can generate images, browse
  or run code.
- Conversations are persisted (`chats`, `chat_messages`), named after their first
  question, listable/deletable from the sidebar, and reloadable.
- A question that asks for a picture ("show me the character sheet") also
  searches image documents directly, so the picture surfaces as the answer.

### Configurable multi-provider LLM layer (A/D)

- Per-org keys, encrypted at rest (`LORE_ENCRYPTION_KEY`), never returned to a
  client; providers: `openai`, `deepseek`, `ollama`, `strata`, `workers-ai`,
  `custom`, plus an Anthropic chat-only fast-follow.
- Each key carries base URL, chat model, embedding model, embedding dimension,
  optional vision model, and an enable/disable switch that keeps the row.
- "Test" tests what the key is actually *for*: if chat is refused but the key has
  an embedding model, it pings `/embeddings` and reports `embedding only — N
  dimensions` rather than calling a working key broken. "Models" lists the
  provider's catalogue (with the correct Anthropic auth headers) so a vision
  model is picked by name instead of guessed.

### Console (M6, D)

- React SPA with a hash router: Dashboard, Chat, Documents, Memory, Members,
  LLM Keys, Profile — plus recent chats in the sidebar.
- Liquid-glass UI with day/night/auto, a toggleable RGB neon layer rendered as
  **light under the glass** (blurred conic gradients beneath each pane, not an
  outline), and a 3D-ish AI-brain mark as the logo.
- Chat: ChatGPT-shaped thread, per-image download, "download all", full-screen
  viewer (Esc to close), user avatars beside bubbles.
- Paste → **the top of the Memory page**: text and/or images, Save & index,
  receipt per item showing mime, size, chunks, saved/indexed timestamps and who
  uploaded it.
- Documents: list with uploader and chunk counts, detail with chunks and
  provenance, file download/reprocess.
- Profile: avatar upload/remove, display name, theme and neon controls.

## 4. How it is verified

- `pnpm -r build`, `pnpm -r typecheck`, `pnpm -r test` — currently **207 tests**:
  api 72, web 59, core 26, worker 20, db 18, proxy 11, mcp 1.
- Live checks on the VM (`10.20.10.52`) after each deploy: health, upload →
  indexed with the expected scope, chunk count and embedding model, blob
  byte-for-byte round trip, reprocess, recall (lexical + semantic), a real chat
  turn against the configured provider, and refusal paths (empty file, unsupported
  MIME, cross-tenant read, privilege escalation).
- The edge is checked with SNI: page → 302 to the Authelia portal, `/api/…` →
  401 JSON, assets gated while unauthenticated.

## 5. The journey (62 commits, oldest first)

```
eb76d40 M0 monorepo with deploy pipeline
e655ca2 record pushed remote URL and mark dev-box bootstrap complete
ff9fce3 install pnpm in runtime image stage so one-off migrate/apply-rls work
48accff auth vertical (signup, login, session) with vitest coverage
40ecc0c M1 orgs/users/projects routes with auth guard and audit trail
e725355 M2 memory routes (remember, recall, forget) with scope and trust
f11c552 M2 memory routes with per-request RLS tx wrapper and cross-tenant proof
c94a275 schema RLS proof tests run as lore_app, not superuser
22cc3b6 session 10 handoff doc
f567c75 M2 memory hash-chain events, T0 enforcement, forget cascade
bd625b7 M3 document ingestion pipeline (chunking, deterministic embedding, pg-boss jobs)
6b7a08b build admin console SPA (auth session, documents, memory, members)
4bb4c47 fix worker build type errors and make apply-rls idempotent
4afd488 declare pg-boss in apps/api so the bundled server resolves it at runtime
83433e0 add real OpenAI adapter, per-org encrypted LLM keys, admin UI
9360c12 real OpenAI embeddings, 3072-dim pgvector, semantic recall
0ab537e add in-app chat UI and POST /chat route with memory retrieval
6b24aef wire LORE_ENCRYPTION_KEY into app/worker compose env + runbook
7a30394 harden runbook smoke with API readiness wait
37bc864 configurable multi-provider LLM keys (base URL + chat/embed models + dimension)
ea2f9e7 anthropic chat-only adapter + apiType dispatch + claude preset
3d9143f worker declares postgres dep for bundled db client
1b1d93c add pg_trgm migration for lexical recall operator
f059f39 add Workers AI provider and raise body limits for large uploads
8e13e90 mount /srv/lore/blobs volume into app and worker containers
20d228b add Authelia gateway with Caddy forward_auth
24a7e77 fix Authelia config for v4 schema
88b00a6 fix Authelia config validation errors
8ed7d1e rename Authelia config to configuration.yml
58c3a6b authelia users db outside git, non-AUTHELIA env names, state volume
a9efbeb TLS edge via caddy internal CA, dedicated auth host for authelia portal
e1f1e25 strip /api prefix before proxying to the fastify app
3c6b843 fix raw pgvector SQL so it does not assume a lore schema
49955c4 authelia healthcheck uses wget so it reports healthy
0f6e788 ignore the exported edge CA certificate
3137515 add elevated edge setup script for hosts and CA trust
181eefd re-run ingestion when the same file is uploaded after a failed index
58f42aa embed with the model the stored vectors came from
dc501dc let a key that cannot embed fall through to one that can
f7246c4 add split-key end-to-end verification script
4bb42c7 a lapsed portal session no longer reads as a network error
8416c14 mount the Caddy config directory so a rewritten Caddyfile is seen
be6b1ba replace the published SPA bundle instead of layering over it
d4fb68c Enter sends a chat message, Shift+Enter starts a new line
b83a952 stop an unindexable upload from taking the worker with it
b8244da index images by describing them with a vision model
54ec3dc document the migration order that bites on a running deployment
3bfd3ea upload many files at once, and let chat hand back the images
bf9a63b keep the model's markdown image link out of the chat text
283a8c1 glass console, day/night theme, and saved chat history
631c3ee drop a throwaway database probe
075bfce switch a provider key off without losing it, plus an RGB neon layer
a23d2ab paste capture with receipts, documents that say who and when, profile pictures, brain mark
228ad20 a blank assistant turn no longer breaks the next question
b7fab94 neon as light under the glass, and a Test button that knows what the key is for
7881760 paste is the top of Memory, not a sidebar destination
fb6f21f runbook — the shared image is built by app, not web
67caeee close the tenant holes, and stop ingestion from losing documents
c584d5e the project record — original plan and everything built so far
ee1b32d send a token budget to the chat provider, so a thinking model cannot answer with nothing
7f997ef log the shape of an empty provider answer
d3fde22 retry a silent provider once, and name the model that went quiet
```

## 6. Current state

- **VM** `expandables-lab` `10.20.10.52`, repo `/opt/lore`, stack up:
  `lore-app-1`, `lore-worker-1`, `lore-db-1`, `lore-caddy-1`,
  `lore-authelia-1`, `lore-web-1` (one-shot, exits 0).
- **Console** served from `web_dist`, gated by Authelia at the edge.
- **Org** (owner) holds the screenplay
  `THE_RED_BUTTON_EN_28_EPISODES_WITH_DIALOGUE.docx` plus six indexed PNGs, all
  with uploader and timestamps; embeddings are `nomic-embed-text` (768 dims,
  zero-padded into the 3072 column), so recall and chat share one vector space.
- **Keys**: one chat-capable gateway key (Strata), two Ollama keys
  (`llama3.1` + `nomic-embed-text`), and a DeepSeek key kept disabled.
- **The record lives in the system**: `PROJECT-RECORD.md` is indexed in the
  owner org (scope `org`, 10 chunks, 10 vectors, `nomic-embed-text`), so the
  plan can be recalled from inside LORE.

## 7. Known gaps / next steps

- **Public DNS + Cloudflare Tunnel** for `lore.dushyant.com` / `auth.dushyant.com`
  — the last unbuilt piece of phase D; tunnel creation needs dashboard OAuth,
  which an API token cannot do.
- **Image generation** is explicitly out of scope (the model is told it cannot
  draw); it would need a separate image-model provider.
- The configured chat gateway (`qwen3.8-flash-next-unsloth-ud-q4-kxl`) returns an
  **empty answer for some questions** — reproducibly with and without retrieved
  context, so it is the model/gateway, not the prompt. LORE now sends a token
  budget, retries once without the retrieved context, and then names the model
  that went quiet instead of showing a blank bubble. Switching the chat key to
  the local Ollama key answers normally.
- Retrieval depth is top-6 chunks with no per-document or per-episode scoping,
  so a generic question ("according to the project record…") can rank other
  documents above the intended one; a distinctive term retrieves correctly.
- A worker that dies mid-job used to leave a document in `extracting` for ever
  (no heartbeat or startup reconciliation), which also made re-uploading the same
  bytes look like a duplicate. **Fixed** — see §12: the reaper asks the queue
  which documents still have a job and closes the rest out with a reason.
- The deployment runs a single worker; multi-worker claim semantics have not been
  exercised.
- The M2/M4 "compiler" idea (a context compiler benchmarked against naive top-k)
  has not been built the way the plan described; the shipped system retrieves
  directly. **M7 backup/restore/doctor is now built** — `scripts/ops/{doctor,
  backup,restore,repair}.sh` and `docs/OPERATIONS.md`, see §13.

## 8. Operating rules that must not be broken

- `LORE_ENCRYPTION_KEY` is **immutable**: regenerating it makes every stored API
  key undecryptable.
- One embedding space per org: never index into a second model while vectors from
  the first exist; re-index instead.
- The `vector(3072)` column is fixed; provider vectors are zero-padded (or
  truncated) to fit.
- Never echo key material or session tokens into logs or the console.
- Build the shared image with `build app` (not `build web`), then re-create the
  one-shot `web` container to publish a new bundle; verify `/srv/assets` inside
  Caddy.

## 9. What landed after this record was written

Six changes, in the order they were asked for. Every one is on `origin/master`
and running on VM `10.20.10.52`.

| Commit | Change | Detail |
| --- | --- | --- |
| `1cfbf17` | Interface language, chosen in Profile, defaulting to the browser | `packages/core/src/locales.ts` is the single source of truth (`en`, `hi`, `zh`); the web console resolves **choice → profile → `navigator.languages` → English**, and `users.locale` carries a nullable column with a `locale_enum` check. English strings are the dictionary keys, so an untranslated sentence stays readable instead of blanking. |
| `567c5d5` | Password change from Profile | `POST /me/password` requires the current password (403), holds the signup floor of 10 characters and refuses a repeat of the same password (400), then revokes **every other session** and audits `user.password`. The screen maps 403 to "Current password is incorrect." |
| `d7774b4` | Memory that survives a new chat | A turn now carries three blocks into the prompt: confirmed **self facts** (extracted from "my name is…", "call me…", "I live in…", "remember that…", stored as subject `the user` with trust 2 and a source link), **related earlier turns** from other conversations (pg_trgm `similarity > 0.1`, limit 4), and document passages (max 2 per document, images excluded from text). |
| `656e76f` | An answer about the reader is text, not pictures | Image documents are attached only when the question asks for them (`WANTS_IMAGE`), so "what is my name?" stopped returning three character-sheet images. |
| `446128c` | The console owns the viewport | `h-screen` + `overflow-hidden` on the shell, one `min-h-0 flex-1 overflow-y-auto` region for the content column: a growing chat moves the transcript, never the header or the sidebar. |
| `92fecd9` | Every message says when it was said, and copies in one click | `appendMessage` returns the stored row's `createdAt`; `/chat` echoes `userAt` and `message.at`, so a live turn and a reloaded one are labelled identically. The label is `Intl` date + time joined by a translated `"{date} at {time}"`; the copy control uses the async clipboard with a selection fallback. |

Two corrections came with them:

- **Spanish was removed**, not merely hidden: `0011_new_salo.sql` drops and
  re-adds the `locale_enum` check without `es`, and `PATCH /me {"locale":"es"}`
  now answers 400 `language must be one of en, hi, zh or null`.
- **The self-promotion hole** (`PATCH /orgs/:id/users/:userId` granting
  `superadmin`) and the cross-org writes beside it are closed and covered by
  `m7`.

## 10. The lock: design system and feature surface (2026-11-01)

At the owner's request the console's look and the shipped feature set are frozen
until explicitly unlocked. It is enforced, not remembered:

| Artifact | Role |
| --- | --- |
| `docs/LOCKED-DESIGN.md` | The frozen design: liquid-glass material, both palettes token by token, the seven primitives, type, the three motion gestures, the layout contract, the neon layer, and the list of what counts as a design change |
| `docs/LOCKED-FEATURES.md` | 30 feature rows, each stating the promise to the reader and the test that proves it |
| `lore.lock.json` | The machine copy: SHA-256 (LF-normalised) of the four design files, the 24 API routes, the 12 views, the locale set, the embedding model, and every migration |
| `scripts/lock.mjs` | `pnpm lock:check` — exits non-zero on any drift, naming each one |

`pnpm test` runs the lock check first, so the whole suite fails on drift instead
of waiting for CI. Sanctioned changes are recorded with
`node scripts/lock.mjs update --reason "why"`, which appends to the lock's
changelog; a lock update without the code change, or the reverse, is a mistake.

The three documents are also **inside LORE itself** (org-scoped documents,
chunked and embedded with `nomic-embed-text`), so the record and the lock can be
recalled from the product they describe.

## 11. Test and deployment state at the freeze

- **249 tests green**: web 76, api 90, core 33, db 18, worker 20, proxy 11, mcp 1.
- Live on `10.20.10.52`: `app`, `worker`, `db`, `caddy`, `authelia` running;
  `web` is a one-shot dist copier (`Exited (0)` is normal).
- Bundle `index-BBm214qI.js`; `/chat` echoes `userAt` and `message.at`, and the
  history endpoint returns the same two stamps.

## 12. Reliability: a document can no longer sit in `extracting` for ever

The failure this closes: a worker that dies between writing `status =
'extracting'` and the final write leaves a document row nothing will ever touch
again. The queue retries its own job or gives up, but nothing revisits the
document — so it reads "extracting" permanently, and re-uploading the same bytes
is rejected as a duplicate by the `(orgId, sha256)` unique index.

**The queue is the source of truth, not a timer.** A document is abandoned only
when no job for it is in `created`, `retry` or `active` state:

```sql
select distinct data->>'documentId' as id from boss.job
 where state in ('created','retry','active')
```

That matters for more than one worker: a wall-clock heuristic would fail a
document another worker is merely busy with, and a heartbeat column would only
have told us the same thing the queue already knows. pg-boss keeps completed and
failed jobs for a week (`deletion_seconds`), which is why only those three states
count.

- `packages/db/src/documents.ts`: `listExtractingDocuments(db, olderThanMs)` and
  `failStuckDocuments(db, ids, reason)`. The update is guarded by
  `status = 'extracting'` in the `WHERE`, so a document that got indexed between
  the read and the write is never turned into a failure.
- `apps/worker/src/index.ts`: `reconcileStuckExtractions(db)` runs once at
  startup and then every 60 s on an unref'd timer; the decision itself
  (`orphanedExtractions`) is pure and unit-tested. It closes the row as `failed`
  with *"the worker stopped while this file was being read — choose Reprocess to
  index it again"* rather than re-queueing: a file that kills its worker would
  otherwise loop for ever, and Reprocess is one click.
- A 60-second grace window covers the instant between the status write and the
  job showing up as active; a missing `boss` schema is treated as "nothing is
  live" rather than an error, because it just means nothing was ever enqueued.

Tests: `packages/db/src/documents-reaper.test.ts` (4) proves the stale row is
found, is closed out with its reason and `extractedAt`, that a just-started
extraction and a queued document are left alone, and that an indexed document is
never overwritten; `apps/worker/src/index.test.ts` (3 more) covers the decision
with every candidate live, one live, and none.

**Multi-worker claim semantics** are pg-boss's, not ours: a job is claimed by one
worker at a time (`FOR UPDATE SKIP LOCKED` under the hood), and the reaper reads
the same queue state rather than guessing, so N workers and one worker behave the
same way. What is still unexercised in production is running more than one worker
replica — the deployment runs one.

## 13. Operations: doctor, backup, restore, repair (§M7)

The plan's last "not built" item was M7. It exists now, as four scripts plus a
runbook (`docs/OPERATIONS.md`), and all four have been run against the real
installation.

| Script | What it is for |
| --- | --- |
| `scripts/ops/doctor.sh` | Read-only. Answers "is this installation telling readers something untrue?" — 26 checks across stack, API probes, database/migrations/RLS, key material, the embedding space, documents, blobs, backups, disk, the published console, and the lock. `FAIL` exits 1. |
| `scripts/ops/backup.sh` | One directory per run: `db.dump` (`pg_dump -Fc`), `db.toc` (a `pg_restore --list` proving the dump can be read), `blobs.tar.gz`, and a `manifest.txt` with row counts, the git commit and sha256 of both files. Retention `KEEP=7`. |
| `scripts/ops/restore.sh` | Replays a backup into a named database. Refuses the live database without `--force`, prints counts before and after, optionally extracts blobs elsewhere. |
| `scripts/ops/repair.sh` | Dry run by default. Deletes orphan vectors, and re-processes documents stranded in an old embedding space **through the product's own reprocess endpoint** (minting and then revoking a 30-minute session) rather than writing vectors by hand. |

Two details worth keeping:

- The doctor remembers a **fingerprint of `LORE_ENCRYPTION_KEY`** in
  `/var/lib/lore/doctor-key-fingerprint` and fails if it changes, because rotating
  that key silently makes every stored provider key unreadable. It does not claim
  to prove decryption — only the shape of the ciphertext — and the runbook says so.
- The embedding-space check is **per org**, not global: two orgs may legitimately
  use different models, but a second model inside one org produces vectors no
  query can be compared with.

Verified on the live installation: doctor `26 passed, 0 warning(s), 0 failed`;
backup `2026-10-31T165956Z` (368K dump, 16M blobs) with `sha256sum -c` OK on both
files; a restore drill into a throwaway `lore_restore` database reproduced the
manifest exactly (20 documents, 78 chunks, 79 embeddings, 16 users, 17 keys).
The doctor's first run found a real orphan vector and an over-broad model check;
both were fixed (`repair.sh --apply`, and the check now compares models per org).

## 14. M4: the context compiler, measured

The plan asked for a context compiler benchmarked against naive top-k. The
benchmark needs to see the selection, and the selection only existed inside the
`/chat` handler — so there were two honest options: measure a copy of the
ranking, or expose the real one. The owner chose to expose it.

**What changed.** Retrieval moved to `apps/api/src/retrieval.ts` —
`buildQueryVector`, `rankCandidates` (24 by cosine, pictures only when the
question is about pictures), `applyPassageCap` (at most 2 passages per document
until 6) and `selectContext`, which composes them with the reader's own facts.
`/chat` calls it, so there is one selection algorithm rather than two that can
drift.

**`GET /recall/context?q=`** returns three views of the same query: `selected`
(what the model receives), `naive` (the flat top-6, no per-document cap) and
`candidates` (everything the ranking offered, with distance and a 160-character
excerpt). It is read-only — no chat, no message, no fact — which `m11` asserts by
counting rows before and after.

**The measurement.** `scripts/ops/bench-recall.sh` scores a hand-labelled golden
set (`scripts/ops/golden-questions.tsv`, 12 questions) through that endpoint, using
the `nomic-embed-text` space the org is actually indexed in:

```
naive      hit@1 11/12   hit@3 12/12   hit@6 12/12   MRR 0.958
compiled   hit@1 11/12   hit@3 12/12   hit@6 12/12   MRR 0.958

evidence diversity — distinct documents among the six passages:
  naive 2.7, compiled 3.5 (of 6 possible)
the per-document cap dropped 220 passage(s) across the golden set
```

Read honestly, that says three things:

1. **The cap costs nothing on rank.** The expected document lands in the same
   place with and without it, including the single `#2` (a password question
   answered by both the record and the runbook).
2. **The cap buys evidence diversity.** Of the six passages sent, the flat top-6
   draws from 2.7 distinct documents on average; the compiled selection draws
   from 3.5 — roughly 30% more sources for the same six slots, because the cap
   stops one long document from filling them.
3. **It is not free.** 18–22 of the 24 candidates are discarded per question. On
   this corpus nothing important was discarded; on a corpus where the *answer* is
   the fourth passage of one document, it would be, which is why the cap is a
   number in one place (`PASSAGES_PER_DOCUMENT`) rather than a rule spread
   through the query.

The benchmark is a fixture, not a one-off: the labels are hand-written, so a
"miss" is a fact about the label as much as about retrieval, and the script says
so. What it can do from now on is notice when a change moves those numbers.

## 15. The per-document cap, swept

`/recall/context` accepts optional `limit`, `perDocument` and `candidates`
overrides (bounded, 400 otherwise); `/chat` never passes them. That turns the
constant into something measurable instead of something argued about.
`SWEEP=1 scripts/ops/bench-recall.sh` re-scores the same golden set at each value:

| `PASSAGES_PER_DOCUMENT` | hit@1 | MRR | distinct documents among the 6 passages |
| --- | --- | --- | --- |
| 1 | 11/12 | 0.958 | **5.1** |
| **2 (shipped)** | 11/12 | 0.958 | 3.5 |
| 3 | 11/12 | 0.958 | 2.9 |
| 4 | 11/12 | 0.958 | 2.8 |
| 6 | 11/12 | 0.958 | 2.7 (identical to naive, as expected) |
| 8 | 11/12 | 0.958 | 2.7 |

Two facts and one honest limit:

1. **Rank is invariant to the cap.** Where the expected document lands does not
   move at any value. The cap is not a dial for "finding the right document".
2. **Diversity is monotonic in the cap.** Cap 1 fits six passages from five
   different documents into the same six slots; cap 6 degenerates exactly to the
   naive top-6, which is the check that the override is doing what it says.
3. **These labels cannot choose between 1 and 2.** They are document-level: they
   say which *file* should answer, not which *passage*. Cap 1 maximises breadth by
   halving depth, and a question whose answer spans two adjacent chunks of one
   document would pay for that — invisible to this golden set.

So the shipped value stays at 2, and that is a decision on evidence rather than
on taste: the data justifies "not 6", not "1 instead of 2". Changing it would need
passage-level labels (a third column naming a phrase the answering chunk must
contain), which is the next measurement to build if this constant ever matters
enough to argue about.
