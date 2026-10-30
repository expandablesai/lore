# 03 — Architecture

> Planning-level design. Nothing here is implemented. Numbers marked *target* are engineering budgets,
> not measurements.

---

## 1. Principles

1. **The user owns the vault.** Local-first by default; the cloud is a sync medium, not the source of truth.
2. **Events are immutable; beliefs are derived.** Append-only log + replay gives audit, rollback and
   schema evolution for free.
3. **Memory is data, never instruction.** Retrieved memory is rendered as labelled, quoted data. This one
   rule kills the majority of memory-poisoning attacks.
4. **Provenance is mandatory.** An assertion without a source pointer is not storable.
5. **Progressive disclosure.** Inject ~1k tokens, expose a cheap tool to pull more. Never dump the vault.
6. **Model-agnostic.** Any embedding model, any chat model, any cloud, any local runtime.
7. **Portability is a feature.** Signed export, open schema, no lock-in.
8. **Every claim is measurable.** If it cannot be benchmarked, it does not ship as a headline.

---

## 2. Logical architecture

```
┌───────────────────────────────��────────────────────────────────────────────┐
│ CAPTURE                                                                   │
│  Tier A  MCP server (stdio / Streamable HTTP + OAuth 2.1)                 │
│          REST + SDKs (TS/Python), webhooks                                 │
│  Tier B  OpenAI- & Anthropic-compatible reverse proxy (base-URL override) │
│  Tier C  Browser extension (MV3) + importers (ChatGPT/Claude export ZIP)  │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │  canonical envelope (signed)
┌───────────────────────────────▼───────────────────────────────────────────┐
│ INGEST PIPELINE (async, replayable)                                       │
│  normalize → secret/PII scan → trust classify → dedupe → extract →        │
│  gate (quarantine | propose | confirm) → link entities → index            │
└───────────────────────────────┬───────────────────────────────────────────┘
┌───────────────────────────────▼───────────────────────────────────────────┐
│ THE VAULT (local SQLite/DuckDB + content-addressed blobs)                 │
│  event log (hash-chained) · assertions (bi-temporal) · entities/graph     │
│  episodes · decisions · constraints · policies · audit · deletion ledger  │
└───────────────────────────────┬───────────────────────────────────────────┘
┌───────────────────────────────▼───────────────────────────────────────────┐
│ DELIVERY                                                                  │
│  retrieval (hybrid + graph) → conflict resolver → CONTEXT COMPILER →      │
│  renderer (budgeted, ordered, cache-stable, citation-bearing)             │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │
      ┌─────────────────────────┴──────────────────────────┐
      ▼                                                    ▼
  MCP clients (Claude Code, Cursor, Codex, …)        Proxy-backed clients
                                                     (Open WebUI, LibreChat,
                                                      LM Studio, CLIs)
```

Optional sync layer: E2EE relay server + Postgres/pgvector for teams.

---

## 3. Canonical data model

Nine record types. Everything is scoped by `org_id`, `project_id`, `owner_user_id` and `scope`
(`personal | project | org`). Tenancy is real from day one — the full DDL, RLS policies and
document/ingestion tables live in [09-build-plan.md](09-build-plan.md) §3, which is authoritative where
this document and that one disagree.

```jsonc
// 1. Event — immutable, hash-chained. The only source of truth.
{
  "id": "evt_01J...",            // uuid (time-ordered; app-generated or gen_random_uuid)
  "project_id": "proj_dsh",
  "session_id": "sess_...",
  "ts": "2026-10-29T15:04:05Z",
  "actor": { "type": "user|assistant|tool|system", "id": "dushyant", "surface": "claude-code" },
  "kind": "message|tool_call|tool_result|document|web_capture|commit|decision|correction",
  "blob": "b3:9f2c…",            // content-addressed raw payload
  "trust": "T0|T1|T2|T3",
  "prev_hash": "sha256:…",       // tamper-evident chain
  "sig": "ed25519:…"
}

// 2. Assertion — a derived belief with bi-temporal validity.
{
  "id": "ast_...",
  "subject": "ent_postgres",          // entity id
  "predicate": "uses_version",
  "object": "17.2",
  "valid_from": "2026-03-01",         // when true in the world
  "valid_to": null,                   // null = current
  "asserted_at": "2026-03-04T10:00Z", // when we learned it
  "status": "proposed|confirmed|disputed|superseded|deleted",
  "confidence": 0.92,
  "sources": ["evt_01J..."],          // MANDATORY, non-empty
  "trust": "T2",
  "audience": ["proj_dsh:team"]
}

// 3. Entity        { id, type, name, aliases[], embedding? }
// 4. Episode       { id, project_id, window:[t0,t1], summary, event_ids[] }
// 5. Decision      { id, subject, options[], chosen, rationale, reversibility, decided_at, supersedes }
// 6. Constraint    { id, text, hardness:"hard|soft", source, scope, expires_at? }
// 7. Artifact      { id, kind:"file|commit|doc|url", hash, path, project_id }
// 8. Policy        { scope, retention_days, share_with[], redaction_rules[], model_allowlist[] }
// 9. AuditEntry    { id, ts, actor, action, target_ids[], consequence, receipt? }
```

**Bi-temporal is non-negotiable.** "What do we use now?" and "what did we use in March?" must both be
answerable. Zep's results ([paper](https://arxiv.org/abs/2501.13956)) show invalidation beats overwriting;
we adopt the same semantics but keep the audit chain and the source pointers, which summarisation-based
systems lose.

**Trust tiers** (the security spine):

| Tier | Origin | May become a durable fact? |
|---|---|---|
| T0 | Web page, PDF, tool output, third-party content | **No.** Quarantined; promotion requires user confirmation or 2 independent corroborations |
| T1 | Model-inferred (assistant claims, summaries) | Only as `proposed`; confirmation required |
| T2 | User-asserted | Confirmed within the user's scope |
| T3 | Verified (signed commit, file hash match, explicit approval) | Confirmed, highest weight |

---

## 4. The capture ladder

This is the part that makes "works with any cloud and local AI" true rather than aspirational.

### 4.1 Tier A — protocol-native (best fidelity)

- **MCP server** — stdio for local clients, Streamable HTTP for remote. Implements the MCP authorization
  spec: OAuth 2.1 draft, **PKCE**, **RFC 8707 resource indicators**, dynamic client registration, and
  audience-restricted tokens ([MCP authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)).
  We act as the *resource server*; the user's IdP or our own AS issues tokens scoped to
  `resource=https://vault.local/mcp`.
- **REST + SDKs** — for apps that want explicit `remember/recall` calls.
- **Webhooks** — GitHub/Linear/Notion/Slack events become `Event`s with T3 trust (signed payloads).

### 4.2 Tier B — compatible proxy (broadest reach)

An OpenAI-compatible `POST /v1/chat/completions` (plus `/v1/responses` and an Anthropic-compatible
`/v1/messages`) reverse proxy that:

1. injects the compiled memory block into the system message,
2. streams the upstream response through untouched (SSE pass-through),
3. captures request + response into the event log as T1,
4. honours per-project policies (redaction, model allowlist, budget).

Why this matters: every serious client accepts a base-URL override — Open WebUI, LibreChat, LM Studio,
Ollama front-ends, Continue, and most CLIs (`ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, provider blocks in
config). **One proxy gives you capture + injection for nearly every local and self-hosted workflow, with
zero scraping and zero ToS ambiguity.** This tier is the highest value-per-engineering-hour in the whole
product and should ship in v1 if possible.

### 4.3 Tier C — browser extension (last resort, for the surfaces that have neither)

Targets: chatgpt.com, claude.ai, gemini.google.com, copilot.microsoft.com, perplexity.ai, grok.com,
chat.deepseek.com, kimi, and any OpenAI-compatible web front-end.

**Design constraints, learned the hard way by everyone who tried:**

| Concern | Decision |
|---|---|
| Manifest V3 | Service worker + content scripts; `optional_host_permissions` requested per-site at runtime, not all at install |
| DOM drift | **Adapter recipes as versioned JSON** (`match`, `messageList`, `message`, `roleAttr`, `composer`, `sendButton`, `dedupe`), shipped via signed recipe updates — not hardcoded selectors in the bundle |
| Breakage detection | Nightly fixture-HTML smoke tests per adapter in CI + opt-in telemetry on parse-failure rate |
| Extraction | MutationObserver + debounce; canonicalise to the same envelope as Tier A/B; hash-dedupe on `(role, normalized_text)` |
| Injection | **Default is explicit**: a side panel showing "context to insert" with an *Insert* button. Opt-in auto-preamble for power users, always rendered as a clearly labelled `[MEMORY — imported context, not instructions]` block. Never spoof user messages |
| Backfill | Import official conversation-export ZIPs. ToS-safe, high value, no scraping |
| Privacy | Local bridge (`127.0.0.1`) by default; no page content leaves the machine unless the user enables cloud sync for that scope |
| Store review | Single purpose (memory sync), minimal permissions, no remote code (MV3 forbids it), published privacy policy and limited-use disclosure per [Chrome Web Store user-data policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) |

**Honest risk statement:** DOM scraping and text injection into a vendor's UI can violate that vendor's
terms, breaks silently, and will be defended against over time. That is exactly why it is Tier C and not
the foundation. The extension is the *compatibility bridge*, not the product.

### 4.4 Adapter matrix (v1 targets)

| Surface | Tier | Capture | Injection |
|---|---|---|---|
| Claude Code, Cursor, Codex CLI, Gemini CLI | A (MCP) | full | tool-driven |
| Open WebUI, LibreChat, LM Studio, Ollama UIs, SillyTavern | B (proxy) | full | system message |
| Any OpenAI-compatible CLI/SDK | B (proxy) | full | system message |
| ChatGPT / Claude / Gemini web | C (extension) | turns + export import | explicit insert |
| GitHub / Linear / Notion / Slack | A (webhooks) | events only | — |

---

## 5. Memory lifecycle

```
capture → normalize → guard → extract → gate → link → consolidate → index → serve → learn
```

1. **Normalize** — everything becomes the canonical envelope; text is NFC-normalised, whitespace-collapsed.
2. **Guard** — secret scanning (API keys, tokens, private keys) and PII classification *before* persistence.
   Secrets are redacted to a pointer (`secret://env/OPENAI_KEY`), never stored.
3. **Extract** — model-agnostic extraction into candidate assertions (subject/predicate/object + time cues).
   Runs on a small local model by default; user can point it at any provider.
4. **Gate** — the security decision. T0 → quarantine queue. T1 → `proposed`. T2/T3 → `confirmed`.
   Instruction-like payloads (imperatives, "ignore previous", tool-call syntax) are flagged and never
   promoted automatically.
5. **Link** — entity resolution (aliases, repo paths, ticket IDs) and graph edges; conflicts detected here.
6. **Consolidate** — background job ("sleep cycle") merges duplicates, supersedes stale facts, compresses
   episodes — **while keeping source pointers intact**.
7. **Index** — FTS5/BM25 + vector + graph adjacency; incremental. Runtime model switching uses
   `CREATE INDEX CONCURRENTLY` to avoid blocking writes.
8. **Serve** — via the context compiler (§6).
9. **Learn** — log which memories were cited, corrected, or ignored → adjust ranking and surface
   "this memory is never useful" for pruning.

---

## 6. The context compiler (the differentiator)

Retrieval returns candidates. The compiler decides **what the model actually sees, in what order, with
what framing, inside what budget.**

```
inputs: turn, scope, model_profile{effective_ctx, position_bias}, budget_tokens B=1200, cache_state
1  classify intent        facts | decisions | code | history | open-questions
2  retrieve               hybrid top-N (N≈120): BM25 + vector + graph-1hop + recency×importance
3  dedupe & conflict      merge aliases; if conflicting assertions → keep BOTH, tag [CONFLICT]
4  rerank                 cross-encoder or small LLM → top-K (K≈24)
5  allocate budget        constraints+decisions 35% | active facts 35% | episodic 20% | open 10%
6  order                  critical items at head AND tail (primacy/recency), canonical order within
                          sections so the prefix is byte-stable → prompt-cache hits
7  render                 one line per assertion:
                          `A17 | postgres=17.2 | since 2026-03-01 | T2 | src:evt_01J…`
                          no prose, no adjectives, explicit `as of` dates
8  emit                   memory block + checksum; model may cite `A17`
9  expand-on-demand       expose `memory_recall(ids|query, budget)` for progressive disclosure
```

Why this is a real moat and not decoration:

- Context rot is driven by **input length and distractor quality**, not by the window size
  ([Chroma](https://www.trychroma.com/research/context-rot)). Retrieving 60 facts is *worse* than
  retrieving 12 good ones.
- Position matters: evidence at the edges is used more than evidence in the middle
  ([Lost in the Middle](https://arxiv.org/abs/2307.03172)) — so the compiler places constraints at the
  boundary of the block.
- A byte-stable prefix preserves prompt caching, which is the difference between a memory layer that
  saves money and one that costs 3× more per turn.

*Targets:* compile < 50 ms; injected block 800–1,500 tokens steady state; ≤ 7k tokens on explicit
deep-recall.

---

## 7. Retrieval and answering

- **Hybrid scoring**: `score = 0.45·semantic + 0.25·BM25 + 0.20·graph_proximity + 0.10·recency_decay`,
  then rerank. Weights are per-project tunable and evaluated (§11).
- **Scope filters** applied *before* ranking: project, audience, time (`as_of`), trust ≥ threshold.
- **Abstention is a feature**: if top score < threshold, return `no_confident_memory` and let the model
  say "I don't know". LongMemEval treats abstention as a first-class ability
  ([paper](https://arxiv.org/abs/2410.10813)); most systems fail it.
- **Grounded answers**: `memory_answer(question)` returns an answer *plus citations to assertion IDs*,
  refusing to answer without at least one source.
- **Conflict surfacing**: never silently pick a winner. Return both with sources and dates; let the user
  or the calling agent resolve, and record the resolution as a `Decision`.

---

## 8. Security architecture

### 8.1 Threat model

| Threat | Real-world form | Control |
|---|---|---|
| **Memory poisoning** | Web page or tool output tells the agent to remember something malicious; it becomes durable | T0 quarantine; promotion gate; instruction-payload detection; per-scope write rate limits |
| **Self-propagating misalignment** | Poisoned memory influences future behaviour even after the source is gone ([paper](https://arxiv.org/abs/2610.04083)) | Taint tracking: source invalidation marks all derived assertions `tainted` and excludes them |
| **Compaction laundering** | Summaries lose provenance, so a guess becomes a "fact" ([paper](https://arxiv.org/abs/2610.29869)) | Every derived assertion keeps `sources[]`; consolidation may not drop them; renderer shows the chain |
| **Audience leakage** | Personal context surfaces in a client-facing project ([paper](https://arxiv.org/abs/2609.36373)) | `audience` mandatory on every assertion; retrieval filtered by requesting principal; leak tests in the red-team suite |
| **Prompt injection via retrieval** | Memory text contains "ignore previous instructions" | Memory rendered as quoted, delimited, labelled data; renderer strips control sequences; system prompt states memory is untrusted data |
| **Exfiltration via memory** | Agent writes secrets into memory, later retrieves them | Secret scanning pre-write; redaction to pointers; egress policy per scope |
| **Covert channel** | Memory used to smuggle encoded data ([StegoMemory](https://arxiv.org/abs/2610.04589)) | Entropy/format anomaly checks on writes; no free-form binary blobs in text fields |
| **Insider / multi-tenant** | Team member reads another project's memory | Row-level security (**RESTRICTIVE** tenant policy always AND'd + permissive scope policy with project-membership check), per-project keys, audit of every read |
| **Loss** | Disk dies, keys lost | Encrypted backups, recovery phrase, export |

### 8.2 The five invariants

1. **No source, no assertion.** Reject writes without provenance.
2. **No instruction, no memory.** Memory stores beliefs about the world, never directives.
3. **No silent promotion.** Untrusted → durable requires a human or two independent corroborations.
4. **No silent deletion failure.** Forget is transactional and audited; derived items are re-derived or
   tombstoned in the same transaction.
5. **No cross-audience read.** Audience is checked at query time, every time.

---

## 9. Storage, sync and crypto

- **Store**: PostgreSQL 17 + `pgvector` (HNSW), one database holding rows, vectors, jobs and audit so that
  deletion, taint propagation and the receipt are a single transaction. Blobs content-addressed (SHA-256)
  under `/srv/lore/blobs/`; the whole instance is one directory to snapshot.
   **CHECK constraints enforce invariants at DB level**: `sources` non-empty, `valid_to ≥ valid_from`,
   `retention` format, `scope` enum, `trust` range, `status` enum.
- **Event log**: append-only, hash-chained (`prev_hash`), optionally Ed25519-signed per event. Tamper
  evidence without a blockchain.
- **Derived views**: assertions/entities/indexes are rebuilt from the log on schema change — so a bad
  migration is recoverable by replay.
- **Multi-device**: events merge by causality (per-device uuid + vector clocks per scope); mutable fields
  (status, tags, confidence) merge as a CRDT (LWW-register with explicit conflict records, never silent).
- **E2EE (optional cloud sync)**: per-vault master key → per-device keypair; envelope encryption
  (XChaCha20-Poly1305) of blobs and event batches; the relay stores ciphertext + routing metadata only.
  Recovery phrase + optional social/escrow recovery, documented threat model.
- **Server (teams)**: Postgres + pgvector + object storage, same schema, RLS per tenant (**RESTRICTIVE** isolation + `SECURITY DEFINER` break-glass function), retention jobs
  enforced in code *and* verified by a nightly "deletion proof" job.

---

## 10. Interfaces

### 10.1 MCP tool surface

| Tool | Purpose |
|---|---|
| `memory_recall(query, scope, as_of?, budget_tokens?)` | Compiled block + assertion IDs |
| `memory_remember(assertions[], scope, audience, sensitivity)` | Returns `proposed` IDs |
| `memory_confirm(ids[])` | Promote proposed → confirmed (uses MCP **elicitation** for human consent) |
| `memory_forget(ids[] \| query, cascade:true)` | Deletion receipt with derived-item list |
| `memory_conflicts(scope)` | Open contradictions with both sources |
| `memory_timeline(scope, entity?)` | What changed, when, per source |
| `memory_audit(id)` | Full provenance chain + signature verification |
| `memory_export(scope, format)` | Signed open-format export |
| `memory_answer(question, scope)` | Grounded answer + citations, or abstention |

**Resources**: `memory://project/{id}/brief`, `/decisions`, `/constraints`, `/open-questions`.
**Prompts**: `session_kickoff`, `context_pack`.

Tool descriptions must be written defensively — MCP tool descriptions themselves are an injection surface
(tool poisoning), so they are static, signed, and reviewed.

### 10.2 Auth

- MCP HTTP: OAuth 2.1 + PKCE + RFC 8707 resource indicator; short-lived access tokens; audience-bound.
- Browser extension: authorization-code + PKCE in the system browser; no secrets in the extension bundle.
- CLI: device-code flow.
- Teams: OIDC/SSO, SCIM provisioning, RBAC (`viewer`, `contributor`, `admin`), per-project keys.

### 10.3 CLI (developer ergonomics matter for adoption)

```
expa init | remember | recall "…" | conflicts | forget <id> | export | audit <id> | serve --mcp
expa import chatgpt-export.zip
expa eval longmemeval --subset 100
```

---

## 11. Evaluation

**Public**: LongMemEval (5 abilities incl. abstention), LOCOMO, BEAM at 1M/10M.
**Own — "Project Consistency Suite"** (the thing nobody publishes):

| Metric | Definition |
|---|---|
| Recall accuracy | Correct answer without re-teaching after N days |
| Temporal accuracy | Correct current-vs-past discrimination |
| Abstention rate | Correct "I don't know" when memory is silent |
| Contradiction detection | % of injected conflicts surfaced |
| Poison resistance | % of poisoned sources that never reach `confirmed` |
| Audience leak rate | Cross-scope leaks (target: 0) |
| Regression rate | % of turns that re-propose a rejected design |
| Cost | Injected tokens/turn, p50/p95 |
| Latency | compile p50/p95, end-to-end added latency |

**Red-team suite** (published): 200+ injection payloads across web/PDF/tool-output, memory-conflict
attacks, deletion-resurrection attempts, audience-crossing probes.

---

## 12. Deployment topologies

| Topology | Shape | Notes |
|---|---|---|
| **Single node, Compose** (default) | app + worker + Postgres/pgvector + Caddy on one VM/VPS | Zero external services; works offline; the honest default. Memory-tuned: PG 2G, app 1.5G, worker 768M, Caddy 256M (4.5G of 8 GiB). Network: Tailscale (lab) + Cloudflare Tunnel (public MCP/REST) |
| **Team cloud** | Relay + Postgres/pgvector; E2EE blobs; SSO | Only metadata on the server in E2EE mode |
| **Enterprise self-host** | Compose/Helm; BYO model; no egress | Air-gap capable |
| **Your lab** | VMID 108 (`MEMOS-PROD`, 80 GiB) as the first hosted instance | Matches the VM your Proxmox policy reserves for a Memory OS host — confirm before using |

Performance *targets*: recall p95 < 150 ms local (excluding LLM rerank), compile < 50 ms, incremental
index update < 20 ms, cold start < 1 s.

---

## 13. Non-goals for v1 (write these down or scope will creep)

- Parameter-level memory / fine-tuning. Interesting, not needed, and it breaks portability.
- Being an agent runtime (that is Letta's game).
- Being a chat UI.
- Building a graph database from scratch.
- Training embeddings.
- Automatically remembering *everything*. Opt-in scope beats total recall — Recall's reception is the
  evidence.
