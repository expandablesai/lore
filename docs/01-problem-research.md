# 01 — The Problem, Backed By Evidence

> Every claim below is either a measured result from a cited study or a labelled inference.
> Numbers belong to the study that reported them; conditions differ, so they are not a meta-analysis.

---

## 1. The failure is not "forgetting". It is silent divergence.

Users describe the symptom as *"it forgot"*. The expensive failure is different: the model **still
answers, confidently, from a stale or wrong premise**. Two things make that lethal:

- **The error is invisible.** A wrong memory is indistinguishable from a right one at generation time.
- **The error compounds.** Once a false premise lands in a summary or a memory store, every later turn
  inherits it. Research now names this: *compaction laundering* shows that when coding agents compact
  their context, provenance is destroyed — the model can no longer tell a user instruction from a web
  page from its own earlier guess ([Dabirsiaghi, 2026](https://arxiv.org/abs/2610.29869)).

That is your "project's destruction" scenario, in the literature.

---

## 2. Six distinct failure modes (they need different fixes)

| # | Failure mode | Mechanism | Evidence |
|---|---|---|---|
| F1 | **Window saturation ("context rot")** | Accuracy degrades as input grows, *before* the window is full; coherent distractors are worse than shuffled ones | [Chroma, 18 models, 2025](https://www.trychroma.com/research/context-rot) |
| F2 | **Positional blindness** | Evidence in the middle of a long context is used far less than evidence at the edges | [Liu et al., 2023](https://arxiv.org/abs/2307.03172) |
| F3 | **Session amnesia** | New chat = zero state. Nothing carries except what the vendor's memory feature chose to keep | [LongMemEval, 2024/25](https://arxiv.org/abs/2410.10813) |
| F4 | **Compaction launders provenance** | Summarisation drops *who said what, when, and whether it was verified* | [Compaction Laundering, 2026](https://arxiv.org/abs/2610.29869) |
| F5 | **Poisoned memory is permanent** | An injected or hallucinated "fact" is written to durable memory, then trusted forever | [MemForm](https://arxiv.org/abs/2610.14431), [MemSentry](https://arxiv.org/abs/2609.08747), [Self-Propagating Misalignment](https://arxiv.org/abs/2610.04083) |
| F6 | **Cross-tool fragmentation** | Five assistants, five partial beliefs, no canonical record, no reconciliation | Inferred; see §4 |

Two findings worth pausing on, because they justify building a *layer* rather than prompt tricks:

- **Rot is architectural, not a tuning bug.** Chroma evaluated 18 frontier models (GPT-4.1, Claude 4,
  Gemini 2.5, Qwen3) and found every one degrades as input length grows, on simple tasks. A bigger
  window does not fix it — it just moves the cliff ([source](https://www.trychroma.com/research/context-rot)).
- **Commercial memory is measurably bad, not just annoying.** LongMemEval measured a **30% accuracy drop**
  for commercial chat assistants and long-context LLMs when recalling information across sustained
  interactions, across five abilities: extraction, multi-session reasoning, temporal reasoning,
  knowledge updates, and **abstention** ([source](https://arxiv.org/abs/2410.10813)).
  Abstention matters: a system that cannot say "I don't know" will invent.

---

## 3. The cost, stated plainly

Three cost lines, one of which is usually ignored:

1. **Context tax.** Re-explaining the project every session. Directly visible in time and tokens.
2. **Rework tax.** Rejected designs get re-proposed; fixed bugs get re-introduced. Developers report this
   in the open — e.g. *"Is Cursor deleting working code for you too or is it just me?"*, 85 points and
   81 comments on Hacker News ([thread](https://news.ycombinator.com/item?id=43298275)).
3. **Decision tax (the quiet one).** When nobody can prove *why* a constraint exists, the constraint gets
   relitigated. This is where inconsistency becomes architectural damage.

An illustrative model (assumption, not a measurement): 8 re-explanations/day × 400 tokens × 20 working
days ≈ 64k tokens/month per person of pure re-teaching — before counting the rework caused by wrong
beliefs. The rework, not the tokens, is the cost that matters.

---

## 4. Why cross-tool fragmentation is the structural problem

A real workflow in 2026 looks like this:

```
ChatGPT (architecture chat)   ─┐
Claude Code / Cursor (repo)   ─┤   5 partial memory stores,
Gemini (docs, long context)   ─┼─▶ 0 shared state, 0 reconciliation,
local Qwen/Ollama (private)   ─┤    0 audit trail, 0 forgetting guarantee
Claude.ai (review, analysis)  ─┘
```

Each store is a *different projection* of the truth, formed under a different context, at a different
time. Nothing merges them. Nothing detects that tool A assumes Postgres 16 and tool B assumes 15.
Nothing says "this decision was reversed on 12 March; stop proposing it."

Vendor memory makes this *worse*, not better, because it adds another silo — one that is opaque,
non-exportable, and per-account. Evidence that users feel this: threads like
*"I turned off ChatGPT's memory"* ([HN](https://news.ycombinator.com/item?id=47132001)) and
*"I don't like ChatGPT's new memory dossier"* ([HN](https://news.ycombinator.com/item?id=44052246))
are about **loss of control over an invisible profile**, not about absence of memory. The demand is for
memory you can *see, edit, scope and revoke*.

Microsoft Recall is the cautionary tale at scale: "record everything" shipped, was called a privacy
nightmare, was delayed a year and rebuilt around a biometric-gated vault — and researchers still
demonstrated extraction of its data in 2026 ([Axios, 2024](https://www.axios.com/2024/06/07/microsoft-recall-security-privacy-criticism),
[GeekWire, 2026](https://www.geekwire.com/2026/one-year-after-its-rocky-launch-microsofts-windows-recall-still-raises-security-red-flags/)).
**Any product that stores a person's working life must assume it will be attacked, and must be designed
to lose gracefully.**

---

## 5. Why the platform vendors will not fix this for you

Native memory (ChatGPT memory, Claude's memory tool) is real and improving — Anthropic now ships a
file-based [memory tool](https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool) for API
agents. But structurally:

| Constraint | Consequence for the user |
|---|---|
| Per-vendor, per-account | Switching model = starting over |
| Opaque extraction policy | You cannot audit or correct what it decided to remember |
| No project scoping | Personal preferences and work constraints share one blob |
| No provenance | "The model believed X" is unattributable |
| No export/portability guarantee | Data gravity is the business model |
| Enterprise review blocks it | Regulated teams can't use it at all |

The gap is not "memory". The gap is **portable, scoped, auditable, revocable memory that the user
controls across providers** — in Mem0's own framing, a "memory passport"
([TechCrunch](https://techcrunch.com/2025/10/28/mem0-raises-24m-from-yc-peak-xv-and-basis-set-to-build-the-memory-layer-for-ai-apps/)).
That framing is right; the execution so far is developer-API-shaped, not user-owned.

---

## 6. The job to be done

> **"Make my AI know my project — provably, across every tool I use — and forget on command."**

Four words carry the product: *provably* (provenance + citations), *across* (capture ladder),
*every tool* (cloud + local), *on command* (deletion with cascade, not best-effort).

---

## 7. Acceptance criteria for "good"

These become the evaluation rubric in [03-architecture.md](03-architecture.md) §11.

1. **Project recall** — after 30 days, a new session answers project questions correctly without
   re-teaching, and *cites* the memory it used.
2. **Temporal correctness** — answers "what do we currently use?" differently from "what did we use in
   March?", correctly.
3. **Abstention** — when memory is silent, it says so instead of guessing.
4. **Contradiction surfacing** — conflicting facts are shown as a conflict, with both sources, not
   silently resolved.
5. **Poison resistance** — a malicious instruction ingested from a web page cannot become a durable,
   trusted fact without explicit promotion.
6. **True forgetting** — deleting a fact removes it and every derived summary, and the deletion is
   verifiable in the audit log.
7. **Portability** — full export in an open schema, re-importable into a competitor.
8. **Cost** — steady-state recall stays inside a fixed token budget per turn (target: ≤1.5k tokens of
   injected memory, measured, not hoped).
