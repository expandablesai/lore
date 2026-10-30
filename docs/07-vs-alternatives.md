# 07 — LORE vs. Mem0, Graphiti/Zep, Hindsight, and Native Memory

> Written to be defensible in a technical argument, including the parts where a competitor is better.
> Vendor numbers are the vendors' own claims; benchmark caveats are noted where they matter.

---

## 0. First, define "better"

Anyone claiming to be better at *everything* is selling. LORE is better on **four axes**, and parity or
behind on others:

| Axis | LORE | Why it matters to a real person |
|---|---|---|
| **Ownership** | You run it, you hold the data, you can leave | The reason people turn off native memory and refuse SaaS |
| **Capture breadth** | 3 doors (MCP, proxy, import/extension) | "Works with any cloud or local model" is only true with more than one door |
| **Trust** | Provenance chain, trust tiers, quarantine, receipts | The 2026 failure mode is poisoned memory, not missing memory |
| **Deployability** | Compose/binary + self-maintenance | A self-hosted tool that needs a baby-sitter does not get used |

Where LORE is **not** better on day one: extraction quality tuning, benchmark track record, ecosystem
size, and years of production hardening. Those are earned, and §6 says how.

---

## 1. Side-by-side

| Dimension | **LORE** | **Mem0** | **Graphiti / Zep** | **Hindsight** | **Native (ChatGPT/Claude)** |
|---|---|---|---|---|---|
| **Shape** | Self-hosted vault + compiler | Memory API/SDK (SaaS or self-host) | Temporal knowledge-graph engine/service | Repo-scoped agent memory (DSH plugin) | Built into one vendor's chat |
| **Unit of memory** | Project (with audiences) | User / agent / session | Graph episodes + entities | Repository / bank | Account |
| **How you integrate** | Add MCP server or change a base URL — **no app code** | Write `add()` / `search()` in your app | Run service + feed it episodes | Already wired into the agent | Nothing |
| **Surfaces captured** | Agents, any OpenAI/Anthropic client, chat exports, (later) web UIs | Only what your app sends | Only what you feed it | Coding-agent sessions + git history | Its own chat |
| **Deployment** | One binary or Compose, anywhere | Managed; self-host possible | Service + Neo4j/FalkorDB | Plugin inside DSH | Vendor cloud |
| **Ops burden** | Auto-maintained, `doctor`, rollback | You manage vector store + keys | You manage a graph DB | Near zero, but scoped to one agent | Zero |
| **Provenance** | Hash-chained events, per-assertion sources | Metadata fields | Edge timestamps + episode refs | Page citations | None visible |
| **Deletion** | Transactional, cascade, **receipt** | Best effort | Delete node/edge | Manual page edit | Request-based |
| **Poisoning defence** | Trust tiers + quarantine + instruction stripping | Not a documented model | Not a documented model | Not a documented model | None |
| **Conflicts** | Surfaced as conflicts + decision ledger | Overwrite/merge heuristics | Invalidation (best-in-class temporal) | Page rewrite | Overwrite |
| **Context assembly** | Compiler: budget, ordering, cache-stability, citations | Top-k retrieval | Search/graph traversal | Page/prompt recall | Vendor prompt |
| **Portability** | Signed open export | API export | Graph export | Markdown pages | None |
| **Best at** | Owning + unifying + proving | DX + benchmark marketing | Temporal correctness | Zero-config for one agent | Zero effort |
| **Worst at** | Track record (new) | Seeing anything outside your app | Time-to-first-value | Scope | Lock-in, opacity |

---

## 2. LORE vs. Mem0

**What Mem0 is:** the best-funded memory API. SDK-first: your app calls `add()` and `search()`; Mem0
extracts, stores in vector (+ optional graph), and returns relevant memories. Strong DX, real traction
([\$24M, 200k devs](https://techcrunch.com/2025/10/28/mem0-raises-24m-from-yc-peak-xv-and-basis-set-to-build-the-memory-layer-for-ai-apps/)),
and a published algorithm that posts high [LoCoMo/LongMemEval numbers](https://github.com/mem0ai/mem0).

**Mem0 is better at:** extraction tuning, documentation, ecosystem integrations, and the fact that it
exists today with production mileage.

**Where LORE wins, concretely:**

| Scenario | Mem0 | LORE |
|---|---|---|
| You use Claude Code *and* Open WebUI *and* ChatGPT | Nothing crosses between them unless each app integrates Mem0 | All three hit one vault; the MCP + proxy doors need no app changes |
| You want to see and fix what it believes | No user-facing model of beliefs | Beliefs are first-class records with sources, dates and a UI |
| A web page tries to plant an instruction | Extraction may store it as a memory | T0 quarantine; never promotable to a fact without you |
| You need to prove a fact's origin | Metadata, best effort | Signed event chain + citation on every render |
| You delete something | Delete API call | Cascade + re-derivation + receipt |
| You self-host for a client | Possible, but you operate a memory *service* | Operate an *appliance*: compose up, nightly jobs, `doctor` |

**And the uncomfortable part:** Mem0's extraction is likely better than LORE's on day one. The right move
is not to pretend otherwise — it is to let LORE *use* extraction algorithms in the open (theirs is open
source) while competing where they are structurally weak.

**One-line positioning:** *Mem0 is a library your app calls. LORE is the place your tools agree.*

---

## 3. LORE vs. Graphiti / Zep

**What it is:** a temporally-aware knowledge graph (Graphiti) with a memory service on top (Zep). Facts
have valid-time and transaction-time, edges invalidate instead of being overwritten, and the results on
temporal reasoning are the best published ([94.8 vs 93.4 DMR, +18.5% LongMemEval, −90% latency](https://arxiv.org/abs/2501.13956)).

**Graphiti is better at:** the temporal graph itself. Bi-temporal modelling at that quality is hard and
they have done it. **LORE should not rebuild it** — v1 integrates a graph store (Graphiti or plain SQL
recursive CTEs), and the vault stays independent of the choice.

**Where LORE wins:**

| Scenario | Graphiti/Zep | LORE |
|---|---|---|
| Getting value in 10 minutes | Run Neo4j/FalkorDB, build an ingestion pipeline, write code | Compose up, paste MCP config, done |
| A non-developer wants to use it | Not the audience | Web UI, wizard, one-click adapters |
| "Who told you that, and when?" | Graph edges + episodes, developer-facing | User-facing provenance drawer + citations |
| Poisoned input | No documented trust model | Trust tiers, quarantine, taint propagation |
| Turning retrieved facts into a *good prompt* | Left to the caller | The context compiler is the product |
| Abandoning it later | Export the graph | Signed open export, importable elsewhere |

**One-line positioning:** *Graphiti is a superb memory engine. LORE is the vault, the doors and the
compiler around an engine.*

---

## 4. LORE vs. Hindsight (your current tool)

Be precise, because you use it and it works: Hindsight is **repo-scoped, agent-native memory** — an MCP
server, API access, a small local model, git-history seeding, and curated knowledge pages, wired into the
DSH agent with zero configuration. For "one repo, one coding agent", it is genuinely excellent, and
cheaper to adopt than anything else in this table.

**Hindsight is better at:** zero-config inside DSH, git-history ingestion, the curated knowledge-page
concept (which LORE should adopt as a derived view), and local operation with no external database.

**Where LORE wins:**

| Scenario | Hindsight | LORE |
|---|---|---|
| Memory that spans coding agent + chat + local model | One agent, one bank | One vault, many surfaces |
| Unit of memory | Repository | Project (repo + decisions + docs + chats + tickets) |
| Teams / clients | Single-user oriented | Audiences, RBAC, per-project isolation |
| Deploy as a service for others | Plugin | Server on a VM/VPS/Docker with install guide |
| Provenance and deletion receipts | Citations on pages | Per-assertion sources, cascade delete, audit receipt |
| Poisoning model | Not a documented model | Trust tiers + quarantine |
| Portability | Markdown pages | Signed export in an open schema |

**The strategically right move:** do not replace Hindsight — **ingest it**. Ship a Hindsight adapter that
syncs its banks/pages into LORE as T1/T2 sources. Then your existing knowledge pages become part of the
vault, and Hindsight keeps doing what it does well. That is also the friendliest possible migration story
for other Hindsight users.

**One-line positioning:** *Hindsight remembers your repo for one agent. LORE remembers your project for
all of them — and it can read Hindsight.*

---

## 5. LORE vs. native memory and vs. "just use pgvector"

**Native memory** wins on effort (zero) and loses on everything structural: per-vendor, per-account,
opaque, unscoped, non-portable, often blocked by enterprise policy, and with no provenance. It will keep
improving — and that is fine, because it increases the number of people who notice they now have *five*
memories and no canonical one. LORE should also **import from it** (export files today; extension later),
which turns the vendor's memory into a source rather than a competitor.

**"Just use pgvector + a good prompt"** is the real DIY alternative, and it is a legitimate starting
point. It fails on the things that are not retrieval: lifecycle (dedupe, supersede, consolidate),
conflicts, provenance, security, forgetting, multi-tool capture, and the fact that you end up rebuilding
a worse version of this project over three months.

| | DIY pgvector | LORE |
|---|---|---|
| Time to first value | Days | ~10 minutes |
| Lifecycle jobs | You write them | Built in, scheduled |
| Provenance | You invent a schema | Core invariant |
| Poisoning | You discover it in production | Designed against |
| Upgrade path | Yours forever | Signed releases + rollback |

---

## 6. "Better, stable, easy" — how each claim is earned

**Better** — measured, not asserted:
- Ship the **Project Consistency Suite** (recall, temporal accuracy, abstention, contradiction detection,
  poison resistance, regression rate, tokens/turn) alongside LongMemEval/LOCOMO.
- Publish the red-team corpus and results, including failures.
- Publish a "context tax saved" number computed from real sessions, with the method.

**Stable** — architectural, not aspirational:
- Fewer components (no Neo4j/Redis/broker); one binary; Postgres as the only stateful dependency.
- Immutable event log → derived state is rebuildable; a bad migration is recoverable by replay.
- Every job idempotent and resumable; every upgrade snapshotted with automatic rollback.
- `lore doctor` + a boot self-test that refuses to start half-configured.
- CI gates: migration tests, crash/restart tests, benchmark regression, `govulncheck`, Trivy.
- Explicitly stated non-goal: no unattended schema changes by default.

**Easy** — measured in minutes, tested on a clean VM every release:
- Compose: `docker compose up -d` → wizard → MCP snippet + proxy URL. Target: **under 10 minutes**.
- Bare metal: `lore install --systemd` with no Docker at all.
- Proxmox: a helper script + the `deploy/proxmox/` bundle, validated against a fresh Debian 13 clone.
- Every release: the install guide is executed end-to-end in CI on a clean image.

---

## 7. Where LORE would lose — say it out loud

1. **On a pure benchmark war** against Mem0's tuned extraction, in year one. Don't fight there.
2. **On zero-config inside a single agent**, against Hindsight. Don't fight there either — integrate.
3. **On temporal graph sophistication**, against Graphiti. Integrate the engine.
4. **On enterprise sales**, against anyone with a compliance team and a SOC 2 report. That is a phase-3
   problem, and pretending otherwise would be dishonest.

The winning claim is narrow and defensible:

> **LORE is the only one of these that your tools all share, that proves where every fact came from,
> that you can run on a \$6 VPS and forget about, and that you can leave with your data intact.**
