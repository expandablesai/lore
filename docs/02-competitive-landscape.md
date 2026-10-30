# 02 — Competitive Landscape and White Space

> Assessment as of October 2026. Vendor numbers are the vendors' own claims unless a paper is cited.

---

## 1. The field, in one table

| Player | What it actually is | Strength | Gap relative to your goal |
|---|---|---|---|
| **Mem0** | Memory API + managed service; hybrid vector + optional graph (Neo4j); [\$24M raised, 200k+ devs](https://techcrunch.com/2025/10/28/mem0-raises-24m-from-yc-peak-xv-and-basis-set-to-build-the-memory-layer-for-ai-apps/) | Best-funded, strong DX, published benchmarks ([README claims LoCoMo 92.5 / LongMemEval 94.4](https://github.com/mem0ai/mem0)) | Developer-API shaped. Your app must call it. No capture from ChatGPT's UI, no user-owned vault, provenance is metadata not architecture |
| **Zep / Graphiti** | Temporal knowledge graph memory service, bi-temporal edges ([paper](https://arxiv.org/abs/2501.13956)) | Genuinely good temporal model: facts invalidate instead of overwrite. Open-source engine | Still an API you integrate. Enterprise-shaped. No cross-surface capture, no user-facing audit/forget UX |
| **Letta (MemGPT)** | Stateful agent runtime with self-editing memory blocks | Strong "agent that remembers" story, sleep-time compute | A runtime, not a layer. You adopt their agent, not their memory |
| **MemOS** | Research "memory OS": unifies plaintext, activation and parameter memory ([paper](https://arxiv.org/abs/2507.03724)) | The most ambitious architecture on paper | Research-grade. **Name collision risk with "Memory OS"** — see naming doc |
| **supermemory** | Memory layer for apps, [\$2.6M seed](https://www.axios.com/newsletters/axios-pro-rata-60ba74b4-004e-4f57-b2e5-496aa335b1f7) | Fast-moving, developer-friendly | Same API-shaped gap |
| **Native vendor memory** | ChatGPT memory, Anthropic [memory tool](https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool) + context editing | Free, integrated, improving fast | Siloed per vendor, opaque, unscoped, non-portable, no provenance, often blocked by enterprise policy. **This is your competition and your tailwind** |
| **MCP memory servers** | Reference/reference-grade memory MCP servers (knowledge-graph or file-backed) | Instant compatibility with every MCP client | Toy-grade: no consolidation, no conflict handling, no security model, no UI |
| **Agent-side memory tools** | OKF-style git-native memory, Memctl, Friday, C.O.R.E, ContextNest (`Show HN` wave, e.g. [thread](https://news.ycombinator.com/item?id=45329322)) | Local-first, developer-trustworthy, cheap | Single-surface (coding agents), no multi-model capture, no poisoning model |
| **Browser memory extensions** | e.g. [LocalBrain – AI Memory Sync](https://chromewebstore.google.com/detail/localbrain-ai-memory-sync/cpnladiiocfdhcflkdfjlapgeackgjlc) | Proves demand for "memory across chat UIs" | DOM-scraping fragility, no schema, no conflict semantics, no security posture |

**Read the market correctly:** the *API* layer is commoditised (Mem0 is open source; Graphiti is open
source). The *unowned* layer is what a person's tools collectively know, and who is allowed to see it.

---

## 2. Where the incumbents are structurally weak

1. **They sell to builders, not to the person whose memory it is.**
   Every one of them is "add our SDK to your app". None is "this is *your* vault, and here is the key".
   That inverts the trust story and cedes the consumer/team market.
2. **Capture is one-dimensional.** API-only systems cannot see the ChatGPT conversation where the
   architecture was actually decided. Extension-only systems cannot see the agent's tool calls.
3. **Security is an afterthought.** 2026 produced an entire literature on memory poisoning
   ([MemForm](https://arxiv.org/abs/2610.14431), [MemSentry](https://arxiv.org/abs/2609.08747),
   [self-propagating misalignment](https://arxiv.org/abs/2610.04083),
   [audience-bound memory](https://arxiv.org/abs/2609.36373)). No shipping product markets
   "your memory cannot be poisoned into instruction-following".
4. **Retrieval is treated as the finish line.** Getting the right 20 facts is step one. Placing them so a
   rotting context still uses them (see §2 of the problem doc) is step two, and nobody sells step two.
5. **Evaluation is vendor-flavoured.** Everyone cites their best benchmark. Nobody publishes a
   red-team suite or a "memory caused harm" metric. **Publishing both is a trust moat.**

---

## 3. White space (ranked by defensibility)

| Rank | Position | Why it is defensible | Who it beats |
|---|---|---|---|
| **W1** | **Capture ladder** — MCP/API → OpenAI-compatible proxy → UI extension, one canonical schema | Hard integration work, per-site adapters are a moat that compounds; nobody else does all three | Mem0, Zep, native memory, extensions |
| **W2** | **Provenance + poisoning resistance as the product** | Requires architectural decisions (signing, quarantine, taint, audience binding) that are expensive to retrofit | Everyone |
| **W3** | **Context compiler** (budgeted, ordered, cache-stable, citation-bearing injection) | Empirical tuning per model; measurable win on rot benchmarks; invisible to competitors' marketing | Retrieval-only systems |
| **W4** | **User-owned, local-first, E2E-synced vault** with enterprise self-host | Trust + compliance; the Recall backlash shows the market punishes "we keep everything" | Cloud-only SaaS |
| **W5** | **Project-scoped memory** (not "personalisation") | The unit users actually care about is the project, with constraints, decisions and reversals | Personal-assistant memory |
| **W6** | **Honest evaluation + portability guarantee** ("memory passport", signed export) | Switching costs *down* is a feature when trust is the product | Lock-in business models |

Do **not** compete on W3 alone (a compiler is copyable in a quarter) and do **not** compete on
"we have a graph" (table stakes since 2025).

---

## 4. Build vs. integrate (recommendation)

You do not need to rebuild a graph database or an embedding pipeline to win.

| Component | Recommendation | Why |
|---|---|---|
| Event log / provenance / policy | **Build** | This is the moat; it must be yours |
| Context compiler | **Build** | The measurable differentiator |
| Capture adapters (MCP, proxy, extension) | **Build** | The compounding moat |
| Extraction/consolidation LLM calls | Build thin, model-agnostic | Must work with any cloud/local model |
| Vector index | **Integrate** (`sqlite-vec` / LanceDB / pgvector) | Commodity |
| Graph traversal | **Integrate** (Graphiti if you go temporal-graph; or plain SQL recursive CTEs) | Already excellent open source |
| Embeddings | **Integrate**, default local (`nomic-embed`, `bge-m3` via Ollama) | Privacy default |
| Reranker | Integrate, optional | Cost control |
| Eval | **Build** (LongMemEval harness + your own project-consistency suite) | Selling point |

A useful sanity check from the field: practitioners are openly sceptical that vectors and graphs are the
hard part — *"Everyone's trying vectors and graphs for AI memory. We went back to SQL"*, 136 points
([HN](https://news.ycombinator.com/item?id=45329322)). The schema and the lifecycle are the hard part.

---

## 5. What would make this fail commercially

- **"Another memory API."** If the pitch is API-shaped, it competes with a \$24M-funded open-source
  incumbent on day one. Avoid.
- **Feature parity chasing.** Native memory gets better every quarter; parity is a treadmill.
- **Trust without proof.** Claiming privacy/security without third-party review or published red-team
  results is worse than not claiming it.
- **Extension-first.** Chrome Web Store review, ToS risk and DOM drift make it the worst place to start
  and the best place to finish (details in architecture §4.3).
