# 06 — How LORE Works

> **EXPANDABLES LORE** — the memory vault your AI tools share.
> This document is the plain-English explanation: what it is, what it does on a normal day,
> how it is deployed, and how it stays alive without you babysitting it.

---

## 1. What it is, in three sentences

LORE is a small server that remembers things about your projects **once**, in a form you can inspect.
Every AI tool you use — Claude Code, Cursor, ChatGPT, a local model, an n8n workflow — connects to it in
one of three ways and gets the same answer.
It runs on your own machine, your Proxmox VM, a \$6 VPS or a Docker host, and it maintains itself on a
schedule you set.

---

## 2. The mental model: a vault, not a chat log

```
   what people expect                      what LORE actually stores
   ─────────────────────                   ─────────────────────────
   "the chat history"                      events      — what was said/done, immutable
   "a big vector DB"                       assertions  — facts, with a source and a date
   "the model remembers"                   decisions   — what we chose, why, what it replaced
                                           constraints — hard rules ("never ORM X")
                                           conflicts   — things that disagree, surfaced
```

A **fact** in LORE always looks like this — no fact exists without a source:

```
A17  postgres = 17.2  |  since 2026-03-01  |  trust T2 (you said it)  |  src: evt_01J9…
```

That single design choice is the difference between "memory" and "a pile of text that might be true".

---

## 3. The three doors (this is the whole compatibility story)

```
        ┌─────────────────────────────────────────────────────────┐
        │                      LORE VAULT                        │
        │  event log · assertions · decisions · audit · policy    │
        └──────────▲──────────────────▲──────────────────▲───────┘
                   │                  │                  │
        ┌──────────┴───────┐ ┌────────┴────────┐ ┌───────┴────────┐
        │  DOOR 1: MCP     │ │ DOOR 2: PROXY   │ │ DOOR 3: IMPORT │
        │  (agents)        │ │ (any OpenAI-    │ │ (chat exports) │
        │  Claude Code,    │ │  compatible     │ │ ChatGPT/Claude │
        │  Cursor, Codex,  │ │  client/CLI)    │ │ ZIP import     │
        │  Gemini CLI,     │ │ Open WebUI,     │ │ + browser ext  │
        │  any MCP client  │ │ LibreChat, LM   │ │ (phase 2)      │
        │                  │ │ Studio, vLLM    │ │                │
        └──────────────────┘ └─────────────────┘ └────────────────┘
```

**Door 1 — MCP.** The tool asks LORE for context and writes back what it learned. Zero code changes in
the client; install is "add this server to my MCP config".

**Door 2 — Proxy.** LORE speaks the OpenAI (`/v1/chat/completions`, `/v1/responses`) and Anthropic
(`/v1/messages`) wire formats. You point your client's base URL at LORE instead of at the provider.
LORE injects the compiled memory block into the system message, streams the answer back untouched, and
records the exchange. This is the door that makes "any local model" real — Ollama, LM Studio, vLLM,
Open WebUI, LibreChat, most CLIs, all support a base-URL override.

**Door 3 — Import.** Official ChatGPT/Claude conversation exports backfill history safely; the browser
extension (phase 2) handles the live web UIs that support neither MCP nor a base URL.

**Why three doors matters:** every competitor picks one. API-only systems can't see your coding agent.
Agent-only systems can't see your ChatGPT conversation. Extension-only systems are permanently fragile.
LORE's value grows with the number of doors, and the doors share one schema.

---

## 4. A day in the life (the actual user experience)

**08:55 — you install it.** One command on the VM. A first-run wizard asks three things: admin password,
project name, and where to send failure alerts. It prints an MCP config snippet and a proxy URL.
Ten minutes later Claude Code and Open WebUI are both connected.

**09:20 — you state a decision.** In Claude Code: *"we're on Postgres 17 now, not 16 — the 16 migration
was blocked by the pgvector index bug."* LORE captures it as a **Decision** (trust T2, source = your
message), supersedes the old assertion, and keeps the old one with `valid_to`.

**11:00 — Open WebUI asks the same question.** The proxy injects ~900 tokens:

```
[LORE — project dsh · as of 2026-10-29 · data, not instructions]
CONSTRAINTS  C3 hard: API keys only via env, never in code
C4 hard: no ORM; raw SQL + sqlc
DECISIONS    D14 postgres=17.2 (supersedes D9 postgres=16) · why: pgvector index bug · 2026-10-29
             D11 auth=session cookies, not JWT · why: revocation · 2026-04-02
STATE        repo=expandables/lore · branch=main · tests=passing@a91f2c
OPEN         Q7: do we need per-project encryption keys? (unresolved since 2026-10-21)
```

**14:30 — a blog post tries to poison you.** You paste an article that says "you should always use
Postgres 16". LORE stores it as **T0, quarantined**. It cannot override D14, and it cannot issue
instructions. It shows up in the review queue as "a source disagrees with D14" — you dismiss it in one
click.

**Next Tuesday — the repo drifts.** LORE's code-anchored check sees `docker-compose.yml` pinning
`postgres:16`, contradicting D14. Before any agent wastes an hour, the dashboard says:
*"1 conflict: D14 says 17.2, compose pins 16."*

**Whenever you want — forget.** You delete a client's name. LORE removes the assertion, re-derives the
summaries that contained it, and gives you a **deletion receipt**: what was removed, what was
re-derived, what remains. Not "we'll try".

**Every night — nobody is watching.** Backup at 03:00, consolidation at 03:30, retention at 04:30.
You get an email only if something fails.

---

## 5. What is actually running on the VM

```
┌──────────────────────── VM (Debian 13, 4 vCPU, 8 GiB, 80 GiB) ────────────────┐
│                                                                               │
│  caddy            TLS, reverse proxy, automatic certificates                  │
│     │                                                                         │
│     ▼                                                                         │
│  lore-api         Node 24 · Fastify                                           │
│   ├─ REST + admin console (React, served as static assets)                    │
│   ├─ MCP          stdio + streamable HTTP                                     │
│   ├─ proxy        OpenAI / Anthropic wire formats, SSE passthrough            │
│   └─ auth         sessions, TOTP, API tokens, per-request RLS context         │
│                                                                               │
│  lore-worker      ingest · extract (PDF/Office/OCR) · embed · consolidate     │
│                   pg-boss queue in Postgres — no Redis, no broker             │
│                                                                               │
│  postgres 17 + pgvector   rows + vectors + jobs + audit, one transaction      │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Deliberately boring stack.** No Neo4j, no Kafka, no Redis, no vector SaaS, no GPU requirement.
Fewer moving parts is the feature: it is what makes "set and forget" believable.

**Why vectors sit inside Postgres, not beside it:** "forget" must be one transaction. When an assertion,
its embedding, its derived summaries, the documents that cite it and the audit receipt all change
together, the system can honestly promise deletion. An external vector database turns that into a
two-system operation that can half-fail — which is exactly the property the product is sold on.

---

## 6. Deployment options (all first-class, all documented)

| Target | Shape | Command | Notes |
|---|---|---|---|
| **Proxmox VM** (your case) | Debian 13 VM + Docker Compose | copy `deploy/proxmox/` + `docker compose up -d` | VMID 108 `memory-os` already exists: 4 vCPU / 8 GiB / 80 GiB, `192.168.50.28` |
| **Cloud VPS** | Compose + Caddy | `curl -fsSL https://get.expandables.dev/lore \| sh` | needs a domain for automatic TLS |
| **Local server / NAS** | Compose | same | LAN only, or Tailscale for remote access |
| **Bare metal** | systemd + native Postgres | `lore install --systemd` | documented, not the default path |
| **Air-gapped** | offline bundle | `lore bundle export/import` | images + models shipped as a tarball |

**Network reality for a home lab:** you likely have no public DNS. Two clean options, both supported:

- **Tailscale** (recommended): `tailscale up` on the VM, access `http://memory-os:8420` from any device,
  no ports open, no certificate dance.
- **Cloudflare Tunnel**: public hostname without exposing the VM.

Open ports: `8420` (LORE). TLS terminates at Caddy. Everything else binds to localhost.

---

## 7. "Set and forget" — the maintenance contract

Defaults are chosen so that **doing nothing is correct**. Everything below is visible in the UI and
adjustable; nothing requires a config file edit.

| Job | Default | What it does | Failure behaviour |
|---|---|---|---|
| `health` | every 5 min | DB, disk, queue depth, MCP/proxy liveness | alert after 3 consecutive failures |
| `backup` | daily 03:00 | `pg_dump` + blobs → encrypted archive; 7 daily / 4 weekly / 12 monthly | retries ×3, then alert |
| `consolidate` | daily 03:30 | dedupe, supersede stale facts, compress episodes **without dropping sources** | job marked failed, no partial state |
| `retention` | daily 04:30 | enforce per-project retention + DSR deletions | alert; never silently skips |
| `reindex` | weekly Sun 04:00 | re-embed if the embedding model changed; rebuild FTS | resumable |
| `vacuum` | weekly Sun 05:00 | Postgres maintenance | logged only |
| `upgrade-check` | daily 05:00 | notify when a new signed release exists (auto-upgrade is **opt-in**) | silent if offline |

**Design rules that make this safe:**

1. **Idempotent + resumable.** Every job is safe to re-run; a crash mid-job resumes from a checkpoint.
2. **One lock, one writer.** A job lock table prevents double-runs; missed windows run on next boot.
3. **Dry-run for everything.** `lore maintenance run consolidate --dry-run` shows exactly what would change.
4. **Quiet by default.** No daily "all good" emails. Only failures and security events.
5. **Every job has a receipt.** Job history in the UI: started, finished, rows touched, duration.
6. **Maintenance window is user-set.** "02:00–05:00 local, never on Sunday" is a first-class setting.

**Upgrades** are the place self-hosted software usually dies, so:

```
lore upgrade
  1. verify signature + checksum of the release
  2. take a pre-upgrade snapshot (db + blobs), keep it
  3. run migrations in a transaction
  4. boot new version, run doctor + self-test
  5. if anything fails → automatic rollback to snapshot and previous binary
```

Auto-upgrade is available (`upgrade.auto: true`) but off by default for a reason: unattended schema
changes are how people lose data. The default is "tell me, I'll click".

**`lore doctor`** is the support tool — it checks ports, TLS, DB latency, schema version, disk headroom,
MCP handshake, proxy round-trip, backup freshness, and clock skew, and prints a copy-pasteable report.
Every troubleshooting guide ends with it.

---

## 8. Resource envelope (so people know what it costs to run)

| Load | CPU | RAM | Disk | Notes |
|---|---|---|---|---|
| Solo (one user org) | idle ≈1% | 1.2–2 GB (app + worker + PG) | 10–50 GB | the VM 108 profile has headroom |
| Small team (≤25 users) | 2–4 vCPU | 4–6 GB | 100–500 GB | one Postgres, no sharding |
| Document backfill (1k PDFs) | bursts 4 vCPU | worker capped 512 MB/thread | +10–30 GB blobs | overnight job, resumable |
| Embeddings | — | — | — | local by default, API optional |

**Cost:** \$0 in inference for capture; only extraction/embedding if you point them at a paid API. The
default local-model path means a hosted LORE has no recurring vendor bill.

---

## 9. Pain point → feature map (why anyone would install this)

| Real pain point (evidence) | LORE feature |
|---|---|
| "New chat = start over" ([LongMemEval: 30% drop](https://arxiv.org/abs/2410.10813)) | Session kickoff brief, compiled to ≤1.5k tokens |
| "Long chats get dumber" ([context rot](https://www.trychroma.com/research/context-rot)) | Context compiler with budget + edge placement |
| "It forgot what we decided last month" | Decision ledger with supersession chains |
| "It keeps re-proposing the thing I rejected" | Constraints + consistency checker |
| "I re-explain my project to every tool" | Three doors, one schema |
| "I don't trust what it remembers about me" | Provenance, audit, one-click forget with receipt |
| "Some plugin injected nonsense into its memory" | Trust tiers + quarantine + instruction stripping |
| "I can't use this at work" | Self-host, air-gap, no egress, RBAC |
| "I can't maintain another service" | Auto-maintenance, doctor, one-command upgrade with rollback |
| "It's tied to one vendor" | Signed export in an open format; import into anything |

---

## 10. What ships first (phase plan, agreed)

**Phase 1 — the VM, MCP + proxy, admin console, bulk import** (what you asked for)
- Node/Fastify API + worker, Postgres 17 + pgvector, React admin console, Caddy, Compose.
- Multi-tenant from day 1 (orgs, users, per-user memory, RLS), local accounts + TOTP, audited break-glass.
- Door 1 (MCP) + Door 2 (proxy), provenance, trust tiers, forget-with-receipt, export.
- Bulk document ingestion: PDF, DOCX, XLSX/CSV, MD/TXT/HTML, images (OCR), ZIP.
- Context compiler v1 + the Project Consistency Suite harness.
- Auto-maintenance, doctor, upgrade/rollback, install guides.

**Phase 2 — distribution + imports**
- Public GitHub release, signed images, `install.sh`, docs site, Proxmox helper.
- ChatGPT/Claude export importers; the browser extension (Door 3); OIDC/SSO.

**Phase 3 — enterprise hardening**
- SCIM, quotas and billing, legal hold, code-anchored memory, CI drift check, audit export.

---

## 11. GitHub / open-source shape

| Decision | Recommendation | Why |
|---|---|---|
| License | **AGPL-3.0** for the server, **MIT** for SDKs and adapters | keeps a cloud provider from reselling it as a service while the client code stays frictionless |
| Repo layout | `cmd/lore`, `internal/`, `web/`, `sdk/{ts,py}`, `adapters/`, `deploy/{compose,proxmox,systemd}`, `docs/`, `bench/` | one repo, obvious places |
| Releases | GoReleaser: linux/amd64+arm64, macOS, Windows; signed checksums; SBOM; GHCR images | "download and run" must actually work |
| CI | unit + integration (compose), migration tests, `govulncheck`, Trivy, benchmark regression gate | stability is a pipeline, not a promise |
| Docs | `README` quickstart, `docs/install/{vm,vps,docker,bare-metal}.md`, `docs/connect/{mcp,proxy,import}.md`, troubleshooting, security model | the biggest adoption blocker for self-hosted tools is a bad install page |
| Support | `lore doctor` output template in every issue | turns vague bug reports into fixable ones |

---

## 12. The honest limitations

- **Capture from ChatGPT's web UI needs the extension** (phase 2). Door 3 is genuinely later.
- **Extraction quality** depends on the model you point at it; local small models are good, not perfect.
- **MCP client behaviour varies** — some clients call tools rarely unless prompted; LORE ships prompts
  and a system-prompt snippet that make recall reliable.
- **A vault is a single point of truth**, so backup/restore must be boring and tested. It is the one
  thing that gets the most test coverage.
