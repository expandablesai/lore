# EXPANDABLES LORE — Planning Dossier

**Product:** `EXPANDABLES LORE` — the memory vault your AI tools share.
**Umbrella:** `EXPANDABLES OS` (platform/company), `EXPANDABLES` (registered trademark).
**Status:** Planning. No application code yet. Design is frozen enough to build against.
**Date:** 2026-10-29

---

## 1. One-page brief

Every AI product ships memory as *a feature of one chat window*. Nobody ships memory as
*infrastructure the user owns*. So the same project facts get re-taught to Claude Code, then Cursor, then
ChatGPT, then a local Qwen — and each one forms a slightly different, sometimes confidently wrong,
belief. The damage is not "the bot forgot"; it is **silent divergence**: five tools, five beliefs, one
project, no canonical record.

**LORE is a small self-hosted server that remembers a project once, in a form you can inspect, and serves
it to every model through three doors.**

```
  Surfaces            Doors                    The Vault                 Delivery
  ─────────           ─────                    ─────────                 ────────
  Claude Code     ─┐  MCP (agents)          ┌─ events (immutable, hash-chained)
  Cursor/Codex    ─┤  Proxy (any OpenAI/    │  assertions (sourced, dated)
  Open WebUI      ─┼─ Anthropic client)  ──▶│  decisions · constraints      ─▶ context compiler
  Local LLMs      ─┤  Import (exports,      │  conflicts · audit            ─▶ ≤1.5k tokens, cited,
  Team agents     ─┘  extension in phase 2) └─ policy · deletion ledger       cache-stable
```

**Why it wins:** nobody else does *all three doors with one schema*, *provenance as the core*, and
*an appliance you can forget about*. Mem0 is a library your app calls; Graphiti is an engine you feed;
Hindsight is one agent's memory; native memory is a silo. LORE is where the tools agree.

**Decisions locked (see [08-decisions.md](docs/08-decisions.md)):** name `LORE`; build first on Proxmox
VM 108; **TypeScript on Node 24**; **PostgreSQL 17 + pgvector** (not SQLite); **multi-tenant from day 1**
(orgs, per-user memory, RLS); **admin console with audited break-glass**; **bulk document ingestion**;
Docker Compose as the distribution; MCP + proxy in v1, extension in v2; publish to GitHub after internal
testing.

**Plan version:** [09-build-plan.md](docs/09-build-plan.md) is **v2** (TypeScript/Postgres/multi-tenant)
and supersedes v1 (Go/SQLite). It is the implementation contract.

---

## 2. Documents

| Doc | What it answers |
|---|---|
| [01-problem-research.md](docs/01-problem-research.md) | Evidence-backed pain taxonomy: six failure modes, with citations |
| [02-competitive-landscape.md](docs/02-competitive-landscape.md) | Who builds this, what they miss, where the white space is |
| [03-architecture.md](docs/03-architecture.md) | Data model, capture ladder, context compiler, security, sync, deployment |
| [04-product-plan.md](docs/04-product-plan.md) | Feature set, roadmap, metrics, pricing, risks |
| [05-naming-and-trademark.md](docs/05-naming-and-trademark.md) | Name candidates and trademark action list (decision: LORE) |
| **[06-how-it-works.md](docs/06-how-it-works.md)** | **Plain-English walkthrough, deployment options, auto-maintenance, GitHub shape** |
| **[07-vs-alternatives.md](docs/07-vs-alternatives.md)** | **Rigorous comparison vs Mem0, Graphiti/Zep, Hindsight, native memory** |
| [08-decisions.md](docs/08-decisions.md) | ADR log — every decision, with rationale and reversibility |
| **[09-build-plan.md](docs/09-build-plan.md)** | **The implementation contract: stack, DDL, interfaces, tests, milestones, gates — awaiting sign-off** |

Research raw material: `.research/pages/` (fetched sources) and `.research/*.ps1` (harness).

---

## 3. Build target

| Item | Value |
|---|---|
| VM | Proxmox VMID **108** `memory-os`, **running** |
| Shape | 4 vCPU · 8 GiB RAM · 80 GiB scsi0 · q35 · guest agent on |
| Address | `192.168.50.28/24` on `vmbr0` (MEMOS-PROD) |
| OS | Debian 13 (cloned from GOLD 103) |
| Runtime | Docker + Compose; Caddy for TLS; Postgres 17 + pgvector |
| Access | Tailscale (recommended for a lab without public DNS) or Cloudflare Tunnel |

Resource check: the node currently has ~9 GB free of ~49.9 GB; the VM is already sized at 8 GiB, so the
plan does not require resizing the host.

---

## 4. Open questions (not blockers)

1. **License confirmation** — AGPL-3.0 core + MIT SDKs is the recommendation; confirm you are comfortable
   with copyleft before the first public commit.
2. **Public domain** — needed only for the VPS/Let's Encrypt path; the lab can run on Tailscale.
3. **Which extraction model by default** — local (`bge-m3` + a small instruct model via Ollama) is the
   privacy default; confirm the VM has enough headroom for it alongside Postgres.
