# 04 — Product Plan

---

## 1. Positioning in one sentence

**For people whose AI work spans more than one tool, EXPANDABLES is the memory vault they own — it
captures what every model learns about a project, proves where each fact came from, and hands the right
1,000 tokens to whichever model is asking.**

Not "a memory API". Not "an agent framework". A **vault with a compiler**.

---

## 2. Feature set

### 2.1 v1 — "it remembers, and you can prove it"

| # | Feature | Why it is in v1 |
|---|---|---|
| 1 | **MCP server** (stdio + HTTP/OAuth) | Instant compatibility with Claude Code, Cursor, Codex, Gemini CLI, and every MCP client |
| 2 | **Compatible proxy** (OpenAI + Anthropic shapes) | Captures local/self-hosted workflows with no scraping — highest value per hour |
| 3 | **Multi-tenant from day 1** (orgs, users, per-user memory, Postgres RLS) | Mandatory enterprise requirement; retrofitting tenancy is a rewrite |
| 4 | **Admin console + superadmin** (users, projects, memory, audit, break-glass) | "Manage and see memories from the backend" is a requirement, and privacy needs an audited door |
| 5 | **Bulk document memory** — PDF, DOCX, XLSX/CSV, MD/TXT/HTML, images (OCR), ZIP | Personal and corporate document history made searchable for life |
| 6 | **Project + personal scopes** | The unit of memory is the project; privacy is the person |
| 7 | **Context compiler** | The measurable differentiator (§6 of architecture) |
| 8 | **Provenance + citations** (event chain, document page anchors) | "Prove it" is the product promise |
| 9 | **Conflict surfacing** | Kills silent divergence |
| 10 | **Forget with cascade + receipt** (assertions, summaries, chunks, embeddings) | The trust feature users actually ask for |
| 11 | **Signed export / import** | Portability as a moat, not a concession |
| 12 | **Local embeddings, BYO model** | Works offline, works with Ollama/vLLM/any API |
| 13 | **Eval harness + published numbers** | Credibility in a market full of claims |

### 2.2 v2 — "it stops you from repeating yourself"

| # | Feature | Notes |
|---|---|---|
| 12 | **Browser extension (Tier C)** + adapter recipes | For ChatGPT/Claude/Gemini web |
| 13 | **Conversation-export importers** (ChatGPT, Claude) | ToS-safe backfill; day-one "wow" |
| 14 | **Decision ledger** with supersession chains | ADR-native: chosen option, rationale, what it replaced |
| 15 | **Consistency checker** ("pre-flight") | Before a task: scan the plan against constraints and past decisions → "this contradicts D-14 (2026-03-12)" |
| 16 | **Memory health dashboard** | Stale facts, contradictions, orphans, never-used memories |
| 17 | **Sleep-cycle consolidation with review queue** | Merge/dedupe/supersede with human approval, provenance preserved |
| 18 | **Agent handoff packets** | One agent writes a compact, sourced brief for the next |
| 19 | **E2EE multi-device sync** | Personal tier monetisation |

### 2.3 v3 — "it makes the whole team consistent"

| # | Feature | Notes |
|---|---|---|
| 20 | **Code-anchored memory** | Assertions tied to file/commit hashes; when the repo changes, the memory is re-validated or flagged. *Nobody does this and it is the single best answer to "the AI is confidently wrong about my codebase".* |
| 21 | **CI drift check** | Run memory validation in the pipeline like a linter: "3 memories contradict the current code" |
| 22 | **Team namespaces, RBAC, SSO/SCIM** | Enterprise entry |
| 23 | **Retention + DSR automation** | GDPR erasure with verifiable receipts |
| 24 | **Skills / procedure memory** | Successful runbooks captured as reusable, versioned procedures |
| 25 | **Red-team mode** | Run the poisoning corpus against your own vault |

### 2.4 v4 — "future proofing"

| # | Feature | Why it matters |
|---|---|---|
| 26 | **Memory time-travel** | "What did the assistant believe on 12 March?" + rollback to a prior belief state |
| 27 | **Vault federation** | Personal ↔ team vault with policy-mediated sharing (no copying) |
| 28 | **A2A / agent-to-agent negotiation** | When agents talk to each other, memory needs a handshake, not a dump |
| 29 | **Multimodal memory** | Diagrams, screenshots, whiteboard photos — with OCR provenance |
| 30 | **On-device extraction model** | Extraction never leaves the machine for sensitive scopes |
| 31 | **Memory-aware cost optimiser** | Choose which memories to inject based on model price × cache state |
| 32 | **Open memory schema + registry** | Become the interchange format; publish a spec and let others implement it |

**Deliberately excluded:** parameter-level memory/fine-tuning, an agent runtime, a chat UI, a memory
marketplace (privacy and provenance cannot be guaranteed in a marketplace yet).

---

## 3. Roadmap

Gates are explicit: each phase ends with a measurable pass/fail, not a vibe.

### Phase 0 — Validation spike (2 weeks)
- CLI + SQLite event log + MCP server + naive retrieval.
- Run a 100-question LongMemEval subset; baseline vs naive RAG vs compiled context.
- **Gate:** compiler ≥ 10 points over naive RAG on the subset, or the thesis needs revisiting.

### Phase 1 — Solo-dev alpha (8–10 weeks)
- Tier A (MCP) + Tier B (proxy), compiler, provenance, forget, export, minimal web UI.
- Internal dogfood on two real projects (one of them this DSH workspace).
- **Gate:** 30 days of dogfood with zero unresolved provenance gaps; ≥ 60% of sessions start without
  re-teaching the project.

### Phase 2 — Public beta (6–8 weeks)
- Tier C extension + importers; conflicts/decisions UI; published benchmarks and red-team results.
- Pricing live; 50 external alpha users.
- **Gate:** D30 retention ≥ 40% among activated users; < 5% adapter breakage per week.

### Phase 3 — Teams (8–12 weeks)
- E2EE sync, RBAC/SSO, retention, audit export, code-anchored memory.
- **Gate:** one paying team, one security review passed.

### Phase 4 — Ecosystem (ongoing)
- Schema spec, federation, skills memory, A2A.

Realistic solo timeline to a credible v1: **4–6 months** part-time, **2–3 months** full-time with one
contract engineer on the extension.

---

## 4. Business model

| Tier | Price | Contents |
|---|---|---|
| **Local** (free, open core) | $0 | Vault, MCP, proxy, compiler, export. Everything that runs on your machine |
| **Pro** | ~$12–15/mo | E2EE sync, multi-device, extension, hosted embeddings option |
| **Team** | ~$25–30/user/mo | Shared projects, RBAC, audit, retention, code-anchored memory, CI drift |
| **Enterprise** | custom | Self-host, SSO/SCIM, air-gap, support, security review |
| **Lifetime founder's edition** | one-off | Early-adopter cash + evangelists |

The free tier must be genuinely useful — trust is the product, and a crippled free tier signals the
opposite. Monetise **sync, team and compliance**, never the user's own data.

---

## 5. Metrics that matter

| Stage | Metric | Target |
|---|---|---|
| Activation | Time to first *useful* recall | < 10 min |
| Habit | Sessions/week with ≥1 memory citation | ≥ 5 |
| Value | "Context tax saved" (est. tokens + minutes) shown in-app | visible, honest |
| Quality | Recall accuracy on own suite | ≥ 85% |
| Safety | Poison sources reaching `confirmed` | 0 |
| Safety | Audience leaks | 0 |
| Cost | Injected tokens/turn p50 | ≤ 1.5k |
| Trust | Export/delete completion | 100%, receipted |

Vanity metrics to ignore: total memories stored, graph nodes, "memories created".

---

## 6. Go-to-market (brief)

1. **Dogfood in public.** Build it on your own DSH/Proxmox work; publish the benchmark and the
   "I stopped re-explaining my project" post.
2. **Target the multi-tool developer.** The person already paying for two assistants is the person who
   feels the divergence.
3. **Security-first launch artefact.** Publish the red-team suite and results — nobody else does, and it
   is the fastest route to enterprise conversations.
4. **MCP ecosystem distribution.** One-click install in every MCP client; be the default memory server.

---

## 7. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Vendors ship good native memory | High | High | Compete on cross-tool + ownership + provenance, not on "having memory" |
| ToS action over extension scraping | Medium | Medium | Extension is Tier C; explicit user action; API/MCP path always works |
| Security incident (poisoning/leak) | Medium | Severe | Five invariants, published red-team, bug bounty, fast disclosure |
| Scope creep | High | High | The non-goals list in architecture §13 is contractual |
| Benchmark gaming / credibility | Medium | Medium | Publish methodology + harness + failures, not just scores |
| Solo bandwidth | High | High | Phase 0/1 ruthlessly narrow; contractor for extension |
| Key loss / data loss | Low | Severe | Recovery phrase, encrypted backups, export reminders |
| Regulatory (GDPR/AI Act) | Medium | Medium | Retention/DSR built in from v1; Art. 50 transparency in the UI |

**Kill criteria (write them now, honour them later):** if after Phase 1 the compiler does not beat naive
RAG by 10 points, *and* external alpha users do not report reduced re-explaining, stop and reassess
before spending on Phase 2.

---

## 8. Regulatory notes (not legal advice)

- **GDPR**: memory is personal data. Need lawful basis, DSR (access/erasure/portability), records of
  processing, and a deletion mechanism that reaches derived summaries — which the architecture provides.
- **EU AI Act Art. 50** transparency: disclose AI interaction and machine-readably mark synthetic content
  ([text](https://artificialintelligenceact.eu/article/50/)). A memory layer that labels what came from a
  model vs a human is *ahead* of this requirement — make it a feature ("provenance labels").
- **Data residency**: local-first is the answer; for teams, region-pinned storage.
- **Trademark**: see the naming doc — clearance before any public use of a new mark.
